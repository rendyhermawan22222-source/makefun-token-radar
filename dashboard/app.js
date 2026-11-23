// Token Radar's dashboard. It reads window.RADAR (written beside dashboard/ by
// main.ts) and renders the ranked board, filters, sorting, a per-protocol detail
// view with the model's factor breakdown and peer comparison, and the live-token
// set the board sets aside. No network: every byte it shows is in data.js.
//
// The farm plan is the same derivation main.ts writes to board.json: category,
// chains, TVL and age decide the action, the capital, the hold and every cost
// and time. No name is special-cased.
(function () {
  'use strict';

  var DATA = window.RADAR;
  var app = document.getElementById('board');
  if (!DATA || !app) return;

  var state = { q: '', category: 'all', chain: 'all', sort: 'implied', dir: -1, watchlistOnly: false, tab: 'pre-token', selected: null };

  var usd0 = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  function fmtUsd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return usd0.format(n);
  }
  function fmtPct(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return (n > 0 ? '+' : '') + n.toFixed(2) + '%';
  }
  function fmtAge(days) {
    if (days === null || days === undefined) return 'unknown';
    if (days >= 365) return (days / 365).toFixed(1) + 'y';
    return Math.max(0, Math.round(days)) + 'd';
  }
  function fmtRatio(r) { return (r === null || r === undefined || !isFinite(r)) ? 'n/a' : r.toFixed(2) + 'x'; }
  function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;'); }

  function el(tag, attrs) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        if (k === 'class') node.className = attrs[k];
        else if (k === 'text') node.textContent = attrs[k];
        else if (k === 'html') node.innerHTML = attrs[k];
        else if (k.slice(0, 2) === 'on') node.addEventListener(k.slice(2), attrs[k]);
        else if (attrs[k] !== null && attrs[k] !== undefined) node.setAttribute(k, attrs[k]);
      });
    }
    for (var i = 2; i < arguments.length; i++) {
      var child = arguments[i];
      if (child === null || child === undefined) continue;
      if (Array.isArray(child)) child.forEach(function (c) { if (c) node.appendChild(c); });
      else if (typeof child === 'string') node.appendChild(document.createTextNode(child));
      else node.appendChild(child);
    }
    return node;
  }

  /* ---- farm plan: the same derivation as lib/model.ts ---- */
  function chainOf(p) { return p.chains && p.chains.length > 0 ? p.chains[0] : 'its main chain'; }
  function capitalFor(p) {
    if (p.tvl_usd >= 5e9) return 500;
    if (p.tvl_usd >= 1e9) return 250;
    if (p.tvl_usd >= 1e8) return 150;
    return 75;
  }
  function holdDaysFor(age) {
    if (age === null || age === undefined) return 60;
    if (age < 180) return 90;
    if (age < 365) return 60;
    return 45;
  }
  function gasNote(chain) {
    if (chain === 'Ethereum') return 'about $8 to $15 of gas per transaction on Ethereum mainnet';
    return 'under $1 of gas per transaction on ' + chain;
  }
  function actionFor(p, capital, chain) {
    var c = (p.category || '').toLowerCase();
    var name = p.name;
    if (c.indexOf('lend') >= 0 || c.indexOf('cdp') >= 0 || c.indexOf('collateral') >= 0) return 'Supply $' + capital + ' of USDC to ' + name + ' on ' + chain + ' and borrow a small amount against it so the wallet shows both sides of the market.';
    if (c.indexOf('dex') >= 0 || c.indexOf('liquidity manager') >= 0 || c.indexOf('leveraged farm') >= 0) return 'Provide $' + capital + ' of liquidity to ' + name + "'s main pool on " + chain + ' in the pair it lists first, and keep the position in range.';
    if (c.indexOf('bridge') >= 0 || c.indexOf('cross chain') >= 0) return 'Bridge $' + capital + ' of USDC into ' + chain + ' through ' + name + ', then use the bridged funds in the destination app instead of bridging straight back.';
    if (c.indexOf('stak') >= 0 || c.indexOf('restak') >= 0 || c.indexOf('anchor btc') >= 0 || c.indexOf('decentralized btc') >= 0) return 'Stake $' + capital + " of the chain's staking asset through " + name + ' on ' + chain + ' and keep the receipt token in the same wallet.';
    if (c.indexOf('perpetual') >= 0 || c.indexOf('derivative') >= 0 || c.indexOf('basis trading') >= 0 || c.indexOf('options') >= 0) return 'Deposit $' + capital + ' of USDC as margin on ' + name + ' on ' + chain + ' and open one small hedged position, then close it after a few days.';
    if (c.indexOf('prediction') >= 0) return 'Fund $' + capital + ' on ' + name + ' and place one position on a market that settles after at least a week, so the trade is not a same-day flip.';
    if (c.indexOf('curator') >= 0 || c.indexOf('allocator') >= 0 || c.indexOf('yield') >= 0) return 'Deposit $' + capital + ' into a ' + name + ' vault on ' + chain + ' and keep the vault shares; pick the vault with the largest TVL.';
    if (c.indexOf('stable') >= 0) return 'Mint or deposit $' + capital + ' of the stable asset through ' + name + ' on ' + chain + ' and hold it in the wallet that did the mint.';
    if (c.indexOf('rwa') >= 0) return 'Mint $' + capital + " of " + name + "'s yield-bearing asset on " + chain + ' and hold it so the wallet accrues yield on-chain.';
    if (c.indexOf('insurance') >= 0) return 'Buy $' + capital + ' of cover from ' + name + ' on ' + chain + ' for a protocol you already use, and keep the policy for its full term.';
    if (c.indexOf('payment') >= 0 || c.indexOf('card') >= 0) return 'Fund $' + capital + ' through ' + name + ' on ' + chain + ' and spend a small amount with it, so the wallet shows real payment activity.';
    if (c.indexOf('privacy') >= 0) return 'Make a $' + capital + ' shielded deposit through ' + name + ' on ' + chain + ' and leave it shielded for at least a week before withdrawing.';
    if (c.indexOf('governance') >= 0) return 'Deposit $' + capital + ' into ' + name + ' on ' + chain + ', lock it for the shortest voting term, and vote on one live proposal.';
    if (c.indexOf('index') >= 0) return 'Buy $' + capital + " of " + name + "'s index token on " + chain + ' and hold it through one rebalance.';
    if (c.indexOf('otc') >= 0) return 'List a $' + capital + ' OTC offer on ' + name + ' on ' + chain + ' at the market price and let it sit until it fills or expires.';
    if (c.indexOf('chain') >= 0) return 'Bridge $' + capital + ' onto ' + chain + " through " + name + "'s own bridge, then use one native app on the chain so the wallet is active there.";
    if (c.indexOf('cedefi') >= 0) return 'Deposit $' + capital + " into " + name + "'s CeDeFi vault on " + chain + ' and keep the position through one yield cycle.';
    if (c.indexOf('farm') >= 0) return 'Stake $' + capital + " of LP tokens in " + name + "'s farm on " + chain + ' and claim the farm rewards weekly.';
    return 'Deposit $' + capital + ' of USDC into ' + name + ' on ' + chain + " and use the app's main feature with the deposit, not just the deposit alone.";
  }
  function secondActionFor(p, capital, chain) {
    var c = (p.category || '').toLowerCase();
    var name = p.name;
    var top = Math.max(10, Math.round(capital / 5));
    if (c.indexOf('lend') >= 0 || c.indexOf('cdp') >= 0 || c.indexOf('collateral') >= 0) return 'Repay half the borrow, then borrow again for a smaller amount, so the wallet\u2019s borrow history spans two separate loans.';
    if (c.indexOf('dex') >= 0 || c.indexOf('liquidity manager') >= 0 || c.indexOf('leveraged farm') >= 0) return 'Swap $' + top + " of USDC for the pool's other asset on " + name + ' and add it to the same position.';
    if (c.indexOf('bridge') >= 0 || c.indexOf('cross chain') >= 0) return 'Bridge a second, smaller amount of $' + top + ' a week later, on a different day, so the bridge history is not a single burst.';
    if (c.indexOf('stak') >= 0 || c.indexOf('restak') >= 0) return 'Top the stake up by $' + top + ' a week later, so the stake grows in two deposits rather than one.';
    if (c.indexOf('perpetual') >= 0 || c.indexOf('derivative') >= 0 || c.indexOf('basis trading') >= 0 || c.indexOf('options') >= 0) return 'Open a second small position in the opposite direction as a hedge, then close both positions together.';
    if (c.indexOf('curator') >= 0 || c.indexOf('allocator') >= 0 || c.indexOf('yield') >= 0) return 'Deposit a second tranche of $' + top + ' into a different vault of ' + name + ' on ' + chain + '.';
    if (c.indexOf('prediction') >= 0) return 'Place a second, smaller position on a different market of ' + name + ', on a different day from the first.';
    if (c.indexOf('governance') >= 0) return 'Vote on a second proposal, or delegate the vote to an active delegate, and keep the delegation for the term.';
    if (p.chains.length > 1) return 'Repeat the same action on ' + p.chains[1] + ' with $' + top + ', so the wallet is active on a second chain.';
    return 'Use a second feature of ' + name + ' on ' + chain + ', such as a swap, a vote or a claim, so the wallet shows more than one action type.';
  }
  function stepText(step) {
    var s = step.text + ' Cost: ' + step.cost + '. Time: ' + step.time + '.';
    if (s.length > 600) s = s.slice(0, 596) + '...';
    if (s.length < 20) s = s + " Hold the position and check the protocol's own page.";
    return s;
  }
  function farmSteps(p) {
    var chain = chainOf(p);
    var capital = capitalFor(p);
    var hold = holdDaysFor(p.age_days);
    var gas = gasNote(chain);
    var top = Math.max(10, Math.round(capital / 5));
    return [
      { text: 'Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline on paper, never in a screenshot.', cost: 'free to create, and the first transaction costs ' + gas, time: '5 minutes' },
      { text: actionFor(p, capital, chain), cost: '$' + capital + ' of capital and ' + gas, time: '15 minutes to set up' },
      { text: secondActionFor(p, capital, chain), cost: 'about $' + top + ' of capital and ' + gas, time: '10 minutes, a week after the first action' },
      { text: 'Make one qualifying action each week, such as a deposit, a borrow, a swap or a vote, and never do a whole month\u2019s activity in one day.', cost: gas + ' each week', time: '10 minutes a week' },
      { text: 'Hold the position for at least ' + hold + ' days so the activity is counted in more than one snapshot, and do not withdraw early for a small gain.', cost: 'the $' + capital + ' stays in the position', time: hold + ' days' },
      { text: "Before you withdraw, open " + p.name + "'s own points or rewards page from the link it publishes itself, and check whether your wallet qualifies.", cost: 'no fee to check, and never pay anyone to claim', time: '10 minutes' },
      { text: 'Write the wallet, the dates and every transaction hash in a farm log, then unwind in steps: withdraw half, wait a day, and withdraw the rest.', cost: gas + ' per withdrawal', time: '5 minutes to log, 2 days to unwind' }
    ].map(stepText);
  }

  /* ---- model check: recompute a row from the snapshot figures ---- */
  function impliedOf(row, model) {
    var growth = Math.min(model.growth_cap, Math.max(model.growth_floor, row.change_7d === null || row.change_7d === undefined ? 0 : row.change_7d));
    var growthMult = 1 + (growth / 100) * model.growth_weight;
    var age = row.age_days === null || row.age_days === undefined ? model.unknown_age_days : row.age_days;
    var maturity = model.maturity_floor + (Math.min(Math.max(age, 0), model.maturity_days) / model.maturity_days) * model.maturity_range;
    var chainMult = 1 + model.chain_step * Math.min(Math.max((row.chains || []).length - 1, 0), model.chain_max_extra);
    return Math.max(1, Math.round(row.tvl_usd * row.peer_ratio * growthMult * maturity * chainMult));
  }

  /* ---- state from the hash, so a detail or a filter is a link ---- */
  function readHash() {
    var hash = window.location.hash.replace(/^#/, '');
    if (!hash) return;
    var params = new URLSearchParams(hash);
    if (params.get('q')) state.q = params.get('q');
    if (params.get('category')) state.category = params.get('category');
    if (params.get('chain')) state.chain = params.get('chain');
    if (params.get('sort')) state.sort = params.get('sort');
    if (params.get('tab')) state.tab = params.get('tab');
    if (params.get('wl') === '1') state.watchlistOnly = true;
    if (params.get('p')) state.selected = params.get('p');
  }
  function writeHash() {
    var params = new URLSearchParams();
    if (state.q) params.set('q', state.q);
    if (state.category !== 'all') params.set('category', state.category);
    if (state.chain !== 'all') params.set('chain', state.chain);
    if (state.sort !== 'implied') params.set('sort', state.sort);
    if (state.tab !== 'pre-token') params.set('tab', state.tab);
    if (state.watchlistOnly) params.set('wl', '1');
    if (state.selected) params.set('p', state.selected);
    var next = params.toString();
    if (next) window.history.replaceState(null, '', '#' + next);
    else window.history.replaceState(null, '', window.location.pathname + window.location.search);
  }

  /* ---- filtering and sorting ---- */
  function filteredRows() {
    var q = state.q.trim().toLowerCase();
    return DATA.rows.filter(function (r) {
      if (state.watchlistOnly && !r.watchlist) return false;
      if (state.category !== 'all' && (r.category || 'Other') !== state.category) return false;
      if (state.chain !== 'all' && (r.chains || []).indexOf(state.chain) < 0) return false;
      if (!q) return true;
      var hay = [r.name, r.slug, r.category, (r.chains || []).join(' ')].join(' ').toLowerCase();
      return hay.indexOf(q) >= 0;
    });
  }
  function sortedRows(list) {
    var key = state.sort;
    return list.slice().sort(function (a, b) {
      var av, bv;
      if (key === 'name') { av = a.name.toLowerCase(); bv = b.name.toLowerCase(); }
      else if (key === 'tvl') { av = a.tvl_usd; bv = b.tvl_usd; }
      else if (key === 'growth') { av = a.change_7d === null ? -Infinity : a.change_7d; bv = b.change_7d === null ? -Infinity : b.change_7d; }
      else if (key === 'age') { av = a.age_days === null ? Infinity : a.age_days; bv = b.age_days === null ? Infinity : b.age_days; }
      else if (key === 'confidence') { av = a.confidence; bv = b.confidence; }
      else { av = a.implied_value_usd; bv = b.implied_value_usd; }
      if (av < bv) return -state.dir;
      if (av > bv) return state.dir;
      return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
    });
  }

  /* ---- static chrome ---- */
  function fillChrome() {
    document.getElementById('top-meta').textContent = '';
    [['Snapshot ' + DATA.as_of], ['DefiLlama protocol index'], [DATA.model_version + ' model']].forEach(function (t) {
      document.getElementById('top-meta').appendChild(el('span', { text: t[0] }));
    });
    var facts = document.getElementById('facts');
    facts.textContent = '';
    var totalImplied = DATA.rows.reduce(function (s, r) { return s + r.implied_value_usd; }, 0);
    [
      ['Watchlist covered', DATA.watchlist_size + ' / ' + DATA.watchlist_size, 'every protocol on the floor'],
      ['Pre-token rows scored', String(DATA.board_size), DATA.early_size + ' early rows below the floor'],
      ['Combined implied value', fmtUsd(totalImplied), 'across the whole board'],
      ['Live-token protocols set aside', String(DATA.live_size), 'their market caps are facts, not models']
    ].forEach(function (f) {
      facts.appendChild(el('div', { class: 'fact' }, el('span', { text: f[0] }), el('b', { text: f[1] }), el('small', { text: f[2] })));
    });
    document.getElementById('headline').textContent = DATA.watchlist_size + ' watchlist protocols, ranked by implied value';
    document.getElementById('model-version').textContent = DATA.model_version;
    var m = DATA.model;
    document.getElementById('formula').textContent =
      'implied = round( tvl x peer_ratio(' + 'category' + ') x (1 + clamp(change_7d, ' + m.growth_floor + ', ' + m.growth_cap + ') / 100 x ' + m.growth_weight + ') x (' + m.maturity_floor + ' + min(age_days, ' + m.maturity_days + ') / ' + m.maturity_days + ' x ' + m.maturity_range + ') x (1 + 0.02 x min(chains - 1, 5)) )';
    document.getElementById('model-footnote').textContent =
      'peer_ratio is the category median market-cap-to-TVL ratio of launched tokens, shrunk toward the global median of ' + DATA.global_median_ratio.toFixed(2) + 'x (' + m.peer_shrink_k + ' parts global) and clamped to ' + m.peer_ratio_min + '–' + m.peer_ratio_max + '. ' +
      'An unlisted age uses ' + m.unknown_age_days + ' days; a missing 7-day change counts as 0%. The early radar is every rankable pre-token protocol below the watchlist floor, not just the biggest few.';
    // Podium: top three by implied value.
    var podium = document.getElementById('podium');
    podium.textContent = '';
    DATA.rows.slice(0, 3).forEach(function (r, i) {
      podium.appendChild(el('button', { type: 'button', class: 'pod' + (i === 0 ? ' first' : ''), onclick: function () { openDetail(r.slug); } },
        el('span', { class: 'pod-rank', text: i === 0 ? 'Rank 1 · Top pick' : 'Rank ' + r.rank }),
        el('h3', { text: r.name }),
        el('span', { class: 'pod-cat', text: (r.category || 'Other') + ' · ' + (r.chains || []).slice(0, 2).join(', ') }),
        el('div', { class: 'pod-val' }, fmtUsd(r.implied_value_usd), el('small', { text: 'implied value · ' + fmtUsd(r.tvl_usd) + ' TVL' })),
        el('div', { class: 'pod-stats' },
          el('span', { text: '7d ' + fmtPct(r.change_7d) }),
          el('span', { text: 'Age ' + fmtAge(r.age_days) }),
          el('span', { text: 'Confidence ' + r.confidence + '/100' })
        )
      ));
    });
    // Filter options.
    var categories = Array.from(new Set(DATA.rows.map(function (r) { return r.category || 'Other'; }))).sort();
    var catSel = document.getElementById('category');
    catSel.appendChild(el('option', { value: 'all', text: 'All categories' }));
    categories.forEach(function (c) { catSel.appendChild(el('option', { value: c, text: c + ' (' + DATA.rows.filter(function (r) { return (r.category || 'Other') === c; }).length + ')' })); });
    var chains = Array.from(new Set(DATA.rows.reduce(function (a, r) { return a.concat(r.chains || []); }, []))).sort();
    var chainSel = document.getElementById('chain');
    chainSel.appendChild(el('option', { value: 'all', text: 'All chains' }));
    chains.forEach(function (c) { chainSel.appendChild(el('option', { value: c, text: c })); });
  }

  function bindControls() {
    var q = document.getElementById('q');
    q.value = state.q;
    q.addEventListener('input', function () { state.q = q.value; state.selected = null; writeHash(); renderBoard(); });
    var cat = document.getElementById('category');
    cat.value = state.category;
    cat.addEventListener('change', function () { state.category = cat.value; state.selected = null; writeHash(); renderBoard(); });
    var chain = document.getElementById('chain');
    chain.value = state.chain;
    chain.addEventListener('change', function () { state.chain = chain.value; state.selected = null; writeHash(); renderBoard(); });
    var sort = document.getElementById('sort');
    sort.value = state.sort;
    sort.addEventListener('change', function () { state.sort = sort.value; state.dir = state.sort === 'name' ? 1 : -1; writeHash(); renderBoard(); });
    var wl = document.getElementById('watchlist-only');
    wl.checked = state.watchlistOnly;
    wl.addEventListener('change', function () { state.watchlistOnly = wl.checked; state.selected = null; writeHash(); renderBoard(); });
    var pre = document.getElementById('tab-pre');
    var live = document.getElementById('tab-live');
    pre.addEventListener('click', function () { state.tab = 'pre-token'; state.selected = null; writeHash(); renderBoard(); });
    live.addEventListener('click', function () { state.tab = 'live'; state.selected = null; writeHash(); renderBoard(); });
  }

  function syncControls() {
    document.getElementById('q').value = state.q;
    document.getElementById('category').value = state.category;
    document.getElementById('chain').value = state.chain;
    document.getElementById('sort').value = state.sort;
    document.getElementById('watchlist-only').checked = state.watchlistOnly;
    document.getElementById('tab-pre').setAttribute('aria-pressed', state.tab === 'pre-token' ? 'true' : 'false');
    document.getElementById('tab-live').setAttribute('aria-pressed', state.tab === 'live' ? 'true' : 'false');
  }

  function sortHeader(key, label) {
    return el('th', { scope: 'col' },
      el('button', { type: 'button', onclick: function () { if (state.sort === key) state.dir = -state.dir; else { state.sort = key; state.dir = key === 'name' ? 1 : -1; } writeHash(); renderBoard(); } },
        label,
        state.sort === key ? el('span', { 'aria-hidden': 'true', text: state.dir < 0 ? ' ▼' : ' ▲' }) : null
      )
    );
  }

  function confPill(r) {
    var cls = r.confidence_label === 'High' ? 'conf-high' : r.confidence_label === 'Medium' ? 'conf-medium' : 'conf-low';
    return el('span', { class: 'pill ' + cls, text: r.confidence_label + ' ' + r.confidence });
  }

  function boardTable() {
    var list = sortedRows(filteredRows());
    document.getElementById('count').textContent = list.length + ' of ' + DATA.board_size + ' rows shown';
    if (list.length === 0) {
      return el('div', { class: 'panel' }, el('div', { class: 'empty' },
        el('h2', { text: 'No protocol matches that filter' }),
        el('p', { text: 'Clear the search or pick another category or chain to see the board again.' }),
        el('button', { class: 'button', type: 'button', text: 'Clear filters', onclick: function () { state.q = ''; state.category = 'all'; state.chain = 'all'; state.watchlistOnly = false; writeHash(); renderBoard(); } })
      ));
    }
    var max = DATA.rows[0].implied_value_usd || 1;
    var tbody = el('tbody');
    list.forEach(function (r) {
      var growth = r.change_7d === null ? 'n/a' : fmtPct(r.change_7d);
      var growthClass = r.change_7d === null ? '' : r.change_7d >= 0 ? 'pos' : 'neg';
      var tr = el('tr', {
        class: 'clickable',
        'data-selected': state.selected === r.slug ? 'true' : 'false',
        tabindex: '0',
        onclick: function () { openDetail(r.slug); },
        onkeydown: function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetail(r.slug); } }
      },
        el('td', { class: 'num rank' + (r.rank <= 3 ? ' top3' : ''), text: String(r.rank) }),
        el('td', null, el('div', { class: 'name' },
          el('b', null, r.name, r.watchlist ? el('span', { class: 'pill watch', text: 'Watchlist' }) : null),
          el('span', { class: 'sub', text: (r.category || 'Other') + ' on ' + (r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') + (r.chains.length > 2 ? ' +' + (r.chains.length - 2) : '') : 'an unnamed chain') })
        )),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + growthClass, text: growth }),
        el('td', { class: 'num', text: fmtAge(r.age_days) }),
        el('td', null, el('div', null,
          el('div', { class: 'bar', 'aria-hidden': 'true' }, el('i', { style: 'width:' + Math.max(3, Math.round((r.implied_value_usd / max) * 100)) + '%' })),
          el('span', { class: 'num', text: fmtUsd(r.implied_value_usd) })
        )),
        el('td', null, confPill(r)),
        el('td', null, el('span', { class: 'pill pre', text: 'no token' }))
      );
      tbody.appendChild(tr);
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { text: 'Pre-token protocols, strongest implied value first. Select a row for its factor breakdown, peer comparison and farm plan.' }),
          el('thead', null, el('tr', null,
            sortHeader('implied', 'Rank'),
            sortHeader('name', 'Protocol'),
            sortHeader('tvl', 'TVL'),
            sortHeader('growth', '7d'),
            sortHeader('age', 'Age'),
            sortHeader('implied', 'Implied value'),
            sortHeader('confidence', 'Confidence'),
            el('th', { scope: 'col', text: 'Token' })
          )),
          tbody
        )
      )
    );
  }

  function liveTable() {
    document.getElementById('count').textContent = DATA.live.length + ' live-token protocols';
    var tbody = el('tbody');
    DATA.live.forEach(function (r) {
      var ratio = r.tvl_usd > 0 && r.mcap_usd !== null ? (r.mcap_usd / r.tvl_usd) : null;
      tbody.appendChild(el('tr', null,
        el('td', null, el('span', { class: 'pill live', text: 'trades' })),
        el('td', null, el('div', { class: 'name' }, el('b', { text: r.name }), el('span', { class: 'sub', text: (r.category || 'Other') + ' on ' + (r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'an unnamed chain') }))),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + (r.change_7d !== null && r.change_7d >= 0 ? 'pos' : 'neg'), text: fmtPct(r.change_7d) }),
        el('td', { class: 'num', text: fmtUsd(r.mcap_usd) }),
        el('td', { class: 'num', text: fmtRatio(ratio) })
      ));
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { text: 'Token live: these protocols already trade, so their market cap is a fact, not a model. They are set aside from the pre-token ranking — and they are the peers that calibrate it.' }),
          el('thead', null, el('tr', null, el('th', { scope: 'col', text: 'Status' }), el('th', { scope: 'col', text: 'Protocol' }), el('th', { scope: 'col', text: 'TVL' }), el('th', { scope: 'col', text: '7d' }), el('th', { scope: 'col', text: 'Market cap' }), el('th', { scope: 'col', text: 'Mcap / TVL' }))),
          tbody
        )
      )
    );
  }

  function factorBar(label, value, display, max, note) {
    return el('div', { class: 'factor' },
      el('div', { class: 'factor-top' }, el('span', { text: label }), el('b', { text: display })),
      el('div', { class: 'bar', 'aria-hidden': 'true' }, el('i', { style: 'width:' + Math.max(4, Math.min(100, Math.round((value / max) * 100))) + '%' })),
      note ? el('div', { class: 'factor-note', text: note }) : null
    );
  }

  function openDetail(slug) {
    var row = DATA.rows.filter(function (r) { return r.slug === slug; })[0];
    if (!row) return;
    state.selected = slug;
    writeHash();
    renderBoard();
    window.scrollTo(0, 0);
  }

  function closeDetail() {
    state.selected = null;
    writeHash();
    renderBoard();
  }

  function detailView(row) {
    var peers = DATA.peers[row.category || 'Other'];
    var recomputed = impliedOf(row, DATA.model);
    var steps = farmSteps(row);
    var base = Math.round(row.tvl_usd * row.peer_ratio);
    var why = 'Rank ' + row.rank + ' because ' + fmtUsd(row.tvl_usd) + ' of TVL prices at ' + row.peer_ratio.toFixed(2) + 'x — the ' + (row.category || 'Other') + ' peer ratio — for a ' + fmtUsd(base) + ' base, ' +
      (row.growth_multiplier >= 1 ? 'lifted ' : 'trimmed ') + row.growth_multiplier.toFixed(2) + 'x by ' + fmtPct(row.change_7d) + ' seven-day growth, ' +
      row.maturity_multiplier.toFixed(2) + 'x by ' + fmtAge(row.age_days) + ' with no token, and ' + row.chain_multiplier.toFixed(2) + 'x by ' + (row.chains || []).length + ' chain' + ((row.chains || []).length === 1 ? '' : 's') + '.';
    var panel = el('div', { class: 'panel' },
      el('div', { class: 'detail-head' },
        el('div', null,
          el('span', { class: 'brand-name', text: 'Rank ' + row.rank + ' of ' + DATA.board_size + (row.watchlist ? ' · Watchlist' : ' · Early radar') }),
          el('h2', { text: row.name }),
          el('p', { class: 'sub', text: (row.category || 'Other') + ' on ' + (row.chains && row.chains.length ? row.chains.join(', ') : 'an unnamed chain') + ' · listed ' + (row.listed_at || 'on an unknown date') + ' · snapshot ' + DATA.as_of })
        ),
        el('button', { class: 'button ghost', type: 'button', text: '← Back to board', onclick: closeDetail })
      ),
      el('div', { class: 'detail-stats' },
        el('div', { class: 'stat' }, el('span', { text: 'Implied value' }), el('b', { class: 'num', text: fmtUsd(row.implied_value_usd) }), el('small', { text: 'the model\u2019s claim, not a price' })),
        el('div', { class: 'stat' }, el('span', { text: 'TVL' }), el('b', { class: 'num', text: fmtUsd(row.tvl_usd) }), el('small', { text: '7d ' + fmtPct(row.change_7d) })),
        el('div', { class: 'stat' }, el('span', { text: 'Age with no token' }), el('b', { class: 'num', text: fmtAge(row.age_days) }), el('small', { text: 'listed ' + (row.listed_at || 'unknown') })),
        el('div', { class: 'stat' }, el('span', { text: 'Confidence' }), el('b', { class: 'num', text: row.confidence + ' / 100' }), el('small', { text: row.confidence_label + ' — data completeness, not a launch odds' }))
      ),
      el('div', { class: 'detail-grid' },
        el('div', { class: 'detail-section' },
          el('h3', { text: 'Why it ranks here — factor breakdown' }),
          factorBar('Peer ratio (' + (row.category || 'Other') + ')', row.peer_ratio, row.peer_ratio.toFixed(2) + 'x', DATA.model.peer_ratio_max,
            peers ? 'Category median ' + peers.median_ratio.toFixed(2) + 'x from ' + peers.peers + ' launched peer' + (peers.peers === 1 ? '' : 's') + ', shrunk toward the global ' + DATA.global_median_ratio.toFixed(2) + 'x.' : 'No launched peer in this category: priced at the global median.'),
          factorBar('Seven-day growth', row.growth_multiplier, row.growth_multiplier.toFixed(2) + 'x', 1.75,
            'TVL moved ' + fmtPct(row.change_7d) + ' in 7 days' + (row.change_7d === null ? ' (unreported, counted as 0%).' : '.')),
          factorBar('Maturity', row.maturity_multiplier, row.maturity_multiplier.toFixed(2) + 'x', 1,
            fmtAge(row.age_days) + ' since first listing' + (row.age_days === null ? ' (unknown, counted as 365 days).' : '.')),
          factorBar('Chain reach', row.chain_multiplier, row.chain_multiplier.toFixed(2) + 'x', 1.1,
            (row.chains || []).length + ' chain' + ((row.chains || []).length === 1 ? '' : 's') + ' counted.'),
          el('p', { class: 'why', text: why }),
          el('p', { class: 'sub', text: 'The page recomputes this row as ' + fmtUsd(recomputed) + (recomputed === row.implied_value_usd ? ', the same number board.json carries.' : ', which differs from the board: the data would be stale.') })
        ),
        el('div', { class: 'detail-section' },
          el('h3', { text: 'Launched peers in ' + (row.category || 'Other') }),
          peers && peers.top.length > 0
            ? el('div', { class: 'table-wrap' }, el('table', { class: 'peer-table' },
                el('thead', null, el('tr', null, el('th', { scope: 'col', text: 'Peer' }), el('th', { scope: 'col', text: 'TVL' }), el('th', { scope: 'col', text: 'Mcap' }), el('th', { scope: 'col', text: 'Mcap / TVL' }))),
                el('tbody', null, peers.top.map(function (p) {
                  return el('tr', null,
                    el('td', { text: p.name }),
                    el('td', { class: 'num', text: fmtUsd(p.tvl_usd) }),
                    el('td', { class: 'num', text: fmtUsd(p.mcap_usd) }),
                    el('td', { class: 'num', text: fmtRatio(p.ratio) }));
                }))
              ))
            : el('p', { text: 'No launched token in this category in the snapshot, so the row prices at the global median of ' + DATA.global_median_ratio.toFixed(2) + 'x.' }),
          el('p', { class: 'sub', text: 'These are the market\u2019s own numbers for tokens that already trade. A pre-token protocol priced above its peers\u2019 median is the model betting its TVL is worth more per dollar than the category usually fetches — check the TVL and growth before believing it.' }),
          el('h3', { text: 'Farm plan — seven steps' }),
          el('ol', { class: 'steps' }, steps.map(function (s) {
            var at = s.indexOf(' Cost: ');
            var action = at >= 0 ? s.slice(0, at) : s;
            var tail = at >= 0 ? s.slice(at + 1) : '';
            return el('li', null, el('b', { text: action }), el('span', { class: 'cost', text: tail }));
          }))
        )
      )
    );
    return panel;
  }

  function renderBoard() {
    syncControls();
    document.body.classList.toggle('detail-open', state.selected !== null);
    app.textContent = '';
    if (state.selected) {
      var row = DATA.rows.filter(function (r) { return r.slug === state.selected; })[0];
      if (row) { app.appendChild(detailView(row)); }
      else { state.selected = null; app.appendChild(state.tab === 'pre-token' ? boardTable() : liveTable()); }
    } else {
      app.appendChild(state.tab === 'pre-token' ? boardTable() : liveTable());
    }
    app.setAttribute('aria-busy', 'false');
  }

  readHash();
  fillChrome();
  bindControls();
  renderBoard();
  window.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && state.selected) closeDetail();
  });
})();
