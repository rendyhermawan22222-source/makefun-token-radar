// Token Radar, model "radar-2": a peer-calibrated implied value.
//
// The starter scored every protocol as TVL x 0.25, the same multiple for a lending
// market and a bridge. That cannot be right: launched tokens do not trade at one
// multiple of TVL. A DEX token, a lending token and a bridge token each trade at a
// different market-cap-to-TVL ratio, so this model learns that ratio from the
// snapshot's own launched protocols, per category, and prices each pre-token
// protocol at what its own category's tokens actually fetch.
//
//   peerRatio    = shrink(category median mcap/TVL, global median mcap/TVL)
//   base         = tvl_usd x peerRatio
//   growthMult   = 1 + clamp(change_7d, -50, 150) / 100 x 0.5
//   maturityMult = 0.7 + min(age_days, 1095) / 1095 x 0.3   (age unknown: 365)
//   chainMult    = 1 + 0.02 x min(chains - 1, 5)
//   implied      = max(1, round(base x growthMult x maturityMult x chainMult))
//
// The peer ratio is shrunk toward the global median so a category with one or two
// launched tokens cannot set an absurd price: a category with n peers counts as n
// parts its own median and 4 parts the global median, then the ratio is clamped to
// [0.02, 2.5]. Categories with no launched peer at all price at the global median.
// No protocol name is ever special-cased: the same function scores every row, and
// every row carries its factors so the dashboard can explain why it ranks where it
// does. Confidence is a data-completeness score, not a prediction: it falls when
// the 7-day change or the listing date is missing, and when the category has few
// launched peers to calibrate against.

/** The snapshot's protocol entry: exactly the ten fields the sealed input carries. */
export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** The model's constants, as the dashboard states them. */
export interface ModelConstants {
  growth_weight: number;
  growth_floor: number;
  growth_cap: number;
  maturity_floor: number;
  maturity_range: number;
  maturity_days: number;
  unknown_age_days: number;
  chain_step: number;
  chain_max_extra: number;
  peer_shrink_k: number;
  peer_ratio_min: number;
  peer_ratio_max: number;
}

export const MODEL: ModelConstants = {
  growth_weight: 0.5,
  growth_floor: -50,
  growth_cap: 150,
  maturity_floor: 0.7,
  maturity_range: 0.3,
  maturity_days: 1095,
  unknown_age_days: 365,
  chain_step: 0.02,
  chain_max_extra: 5,
  peer_shrink_k: 4,
  peer_ratio_min: 0.02,
  peer_ratio_max: 2.5,
};

/** The model's version label: the dashboard names it. */
export const MODEL_VERSION = 'radar-2 peer-calibrated';

/** How many live-token protocols the Live token view carries, by market cap. */
export const LIVE_ROWS = 24;

/** A farm step: the action, what it costs, and how long it takes. */
export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

/** One launched peer of a category, for the detail view's comparison table. */
export interface PeerRow {
  name: string;
  tvl_usd: number;
  mcap_usd: number;
  ratio: number;
}

/** What one category's launched tokens teach the model. */
export interface PeerStats {
  category: string;
  peers: number;
  median_ratio: number;
  ratio: number;
  top: PeerRow[];
}

/** One row of board.json: the ranked board's row. */
export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
  token_status: 'pre-token';
  age_days: number | null;
  implied_value_usd: number;
  model: {
    peer_ratio: number;
    peer_count: number;
    category_median_ratio: number;
    growth_pct: number;
    growth_multiplier: number;
    maturity_multiplier: number;
    chain_multiplier: number;
    confidence: number;
    confidence_label: 'High' | 'Medium' | 'Low';
    age_days: number | null;
  };
  farm_steps: string[];
}

/** The dashboard's compact view of one row, with its factors for the detail view. */
export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  age_days: number | null;
  implied_value_usd: number;
  peer_ratio: number;
  peer_count: number;
  category_median_ratio: number;
  growth_multiplier: number;
  maturity_multiplier: number;
  chain_multiplier: number;
  confidence: number;
  confidence_label: 'High' | 'Medium' | 'Low';
  watchlist: boolean;
}

/** A live-token protocol: it already trades, so the board shows the market's own value. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
}

/** Everything the dashboard needs: the board, the live set, the peers and the model. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  global_median_ratio: number;
  rows: RadarRow[];
  live: LiveRow[];
  peers: Record<string, PeerStats>;
}

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;

/** A finite number, else `fallback`. */
function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/** The median of a non-empty list, else null. */
function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** A whole day count from `from` to `to`, clamped at zero; null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** Whether a protocol records no token at all. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** The watchlist rule's own exclusions: a wrapped, staked or bridged product of a
 * token that already trades is not a protocol still waiting on a launch of its
 * own — WBTC is Bitcoin on Ethereum, not a token that does not exist yet. */
const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;
const STAKED_TICKER = /\bst[A-Z]{2,}/;
const EXCHANGE_PREFIX = /^(Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)\b/;
const WRAPPED_CATEGORIES = new Set(['Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX']);

/**
 * Whether a protocol is one the board may rank: pre-token, and not a wrapped,
 * staked or bridged product of a token that already trades, not an exchange, not
 * a versioned pool. The watchlist rule, applied to the early radar as well.
 */
export function isRankable(p: SnapshotProtocol): boolean {
  return (
    isPreToken(p) &&
    !WRAPPED_CATEGORIES.has(p.category ?? '') &&
    !VERSIONED.test(p.name) &&
    !WRAPPED_WORD.test(p.name) &&
    !STAKED_TICKER.test(p.name) &&
    !EXCHANGE_PREFIX.test(p.name)
  );
}

/**
 * The peer calibration: for every category, the median market-cap-to-TVL ratio of
 * its launched tokens, shrunk toward the global median by sample size, and the top
 * three peers by market cap for the detail view's comparison table.
 */
export function peerCalibration(snapshot: Snapshot, model: ModelConstants = MODEL): { byCategory: Map<string, PeerStats>; globalMedian: number } {
  const live = snapshot.protocols.filter((p) => !isPreToken(p) && p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0);
  const globalRatios = live.map((p) => (p.mcap_usd as number) / p.tvl_usd).filter((r) => Number.isFinite(r) && r > 0);
  const globalMedian = median(globalRatios) ?? 0.2;
  const byCat = new Map<string, SnapshotProtocol[]>();
  for (const p of live) {
    const key = p.category ?? 'Other';
    const list = byCat.get(key) ?? [];
    list.push(p);
    byCat.set(key, list);
  }
  const byCategory = new Map<string, PeerStats>();
  for (const [category, peers] of byCat) {
    const ratios = peers.map((p) => (p.mcap_usd as number) / p.tvl_usd).filter((r) => Number.isFinite(r) && r > 0);
    const med = median(ratios) ?? globalMedian;
    const n = ratios.length;
    const shrunk = (n * med + model.peer_shrink_k * globalMedian) / (n + model.peer_shrink_k);
    const ratio = Math.min(model.peer_ratio_max, Math.max(model.peer_ratio_min, shrunk));
    const top = [...peers]
      .sort((a, b) => (b.mcap_usd as number) - (a.mcap_usd as number))
      .slice(0, 3)
      .map((p) => ({ name: p.name, tvl_usd: p.tvl_usd, mcap_usd: p.mcap_usd as number, ratio: round4((p.mcap_usd as number) / p.tvl_usd) }));
    byCategory.set(category, { category, peers: n, median_ratio: round4(med), ratio: round4(ratio), top });
  }
  return { byCategory, globalMedian };
}

/** The peer ratio one category prices at: its shrunk median, or the global median. */
function peerRatioFor(category: string | null, calibration: { byCategory: Map<string, PeerStats>; globalMedian: number }, model: ModelConstants): { ratio: number; count: number; median: number } {
  const stats = calibration.byCategory.get(category ?? 'Other');
  if (stats === undefined) {
    const clamped = Math.min(model.peer_ratio_max, Math.max(model.peer_ratio_min, calibration.globalMedian));
    return { ratio: round4(clamped), count: 0, median: round4(calibration.globalMedian) };
  }
  return { ratio: stats.ratio, count: stats.peers, median: stats.median_ratio };
}

/**
 * Confidence is a data-completeness score out of 100. It falls when the 7-day
 * change or the listing date is missing, and when the category has few launched
 * peers to calibrate against. It is not a prediction of a launch.
 */
export function confidenceFor(p: SnapshotProtocol, peerCount: number): { score: number; label: 'High' | 'Medium' | 'Low' } {
  let score = 100;
  if (p.change_7d === null) score -= 15;
  if (p.listed_at === null) score -= 15;
  score -= Math.round(20 * (1 - Math.min(peerCount, 10) / 10));
  if (p.chains.length === 0) score -= 10;
  score = Math.max(5, Math.min(100, score));
  const label = score >= 80 ? 'High' : score >= 60 ? 'Medium' : 'Low';
  return { score, label };
}

/** The multipliers and the implied value one protocol gets under the peer-calibrated model. */
export function impliedValue(
  protocol: SnapshotProtocol,
  asOf: string,
  calibration: { byCategory: Map<string, PeerStats>; globalMedian: number },
  model: ModelConstants = MODEL,
): {
  implied: number;
  peerRatio: number;
  peerCount: number;
  categoryMedian: number;
  growthPct: number;
  growthMult: number;
  maturityMult: number;
  chainMult: number;
  age: number | null;
  confidence: number;
  confidenceLabel: 'High' | 'Medium' | 'Low';
} {
  const age = ageDays(asOf, protocol.listed_at);
  const peer = peerRatioFor(protocol.category, calibration, model);
  const rawGrowth = finite(protocol.change_7d, 0);
  const growthPct = Math.min(model.growth_cap, Math.max(model.growth_floor, rawGrowth));
  const growthMult = 1 + (growthPct / 100) * model.growth_weight;
  const ageForModel = age ?? model.unknown_age_days;
  const maturityMult = model.maturity_floor + (Math.min(Math.max(ageForModel, 0), model.maturity_days) / model.maturity_days) * model.maturity_range;
  const chainMult = 1 + model.chain_step * Math.min(Math.max(protocol.chains.length - 1, 0), model.chain_max_extra);
  const base = protocol.tvl_usd * peer.ratio;
  const implied = Math.max(1, Math.round(base * growthMult * maturityMult * chainMult));
  const conf = confidenceFor(protocol, peer.count);
  return {
    implied,
    peerRatio: peer.ratio,
    peerCount: peer.count,
    categoryMedian: peer.median,
    growthPct,
    growthMult,
    maturityMult,
    chainMult,
    age,
    confidence: conf.score,
    confidenceLabel: conf.label,
  };
}

/** The snapshot's protocol by slug. */
function bySlug(protocols: SnapshotProtocol[]): Map<string, SnapshotProtocol> {
  return new Map(protocols.map((p) => [p.slug, p]));
}

/** The protocols the board ranks, strongest first, with ranks 1..n. */
export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL): BoardRow[] {
  const calibration = peerCalibration(snapshot, model);
  const index = bySlug(snapshot.protocols);
  const chosen = new Map<string, SnapshotProtocol>();
  // The watchlist is the floor: every slug it names, whatever the protocol's size.
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  // The early radar: every other rankable pre-token protocol, not just the biggest
  // few below the floor. A small protocol growing fast is exactly what a radar is for.
  const early = snapshot.protocols
    .filter((p) => !chosen.has(p.slug) && isRankable(p))
    .sort((a, b) => b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));
  for (const p of early) chosen.set(p.slug, p);

  const scored = [...chosen.values()].map((p) => ({ p, v: impliedValue(p, snapshot.as_of, calibration, model) }));
  scored.sort((a, b) => b.v.implied - a.v.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  return scored.map((s, i) => ({
    rank: i + 1,
    slug: s.p.slug,
    name: s.p.name,
    category: s.p.category,
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    mcap_usd: s.p.mcap_usd,
    listed_at: s.p.listed_at,
    gecko_id: s.p.gecko_id,
    symbol: s.p.symbol,
    token_status: 'pre-token',
    age_days: s.v.age,
    implied_value_usd: s.v.implied,
    model: {
      peer_ratio: s.v.peerRatio,
      peer_count: s.v.peerCount,
      category_median_ratio: s.v.categoryMedian,
      growth_pct: s.v.growthPct,
      growth_multiplier: round4(s.v.growthMult),
      maturity_multiplier: round4(s.v.maturityMult),
      chain_multiplier: round4(s.v.chainMult),
      confidence: s.v.confidence,
      confidence_label: s.v.confidenceLabel,
      age_days: s.v.age,
    },
    farm_steps: farmSteps(s.p, s.v.age).map(stepText),
  }));
}

/** A step as one string: its action, then its cost and time, within the gate's 20..600 characters. */
export function stepText(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Hold the position and check the protocol's own page.`;
  return s;
}

/** The first chain a protocol names, or a neutral phrase. */
function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** How much capital one farm position needs, from the protocol's own TVL. */
function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 5_000_000_000) return 500;
  if (p.tvl_usd >= 1_000_000_000) return 250;
  if (p.tvl_usd >= 100_000_000) return 150;
  return 75;
}

/** How long to hold, from the protocol's age: younger protocols get a longer qualifying window. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 60;
  if (age < 180) return 90;
  if (age < 365) return 60;
  return 45;
}

/** What one transaction costs on a chain: Ethereum mainnet is dear, most others are not. */
function gasNote(chain: string): string {
  if (chain === 'Ethereum') return 'about $8 to $15 of gas per transaction on Ethereum mainnet';
  return `under $1 of gas per transaction on ${chain}`;
}

/** The category's core action, in the words a farmer can follow. */
function actionFor(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return `Supply $${capital} of USDC to ${name} on ${chain} and borrow a small amount against it so the wallet shows both sides of the market.`;
  if (c.includes('dex') || c.includes('liquidity manager') || c.includes('leveraged farm')) return `Provide $${capital} of liquidity to ${name}'s main pool on ${chain} in the pair it lists first, and keep the position in range.`;
  if (c.includes('bridge') || c.includes('cross chain')) return `Bridge $${capital} of USDC into ${chain} through ${name}, then use the bridged funds in the destination app instead of bridging straight back.`;
  if (c.includes('stak') || c.includes('restak') || c.includes('anchor btc') || c.includes('decentralized btc')) return `Stake $${capital} of the chain's staking asset through ${name} on ${chain} and keep the receipt token in the same wallet.`;
  if (c.includes('perpetual') || c.includes('derivative') || c.includes('basis trading') || c.includes('options')) return `Deposit $${capital} of USDC as margin on ${name} on ${chain} and open one small hedged position, then close it after a few days.`;
  if (c.includes('prediction')) return `Fund $${capital} on ${name} and place one position on a market that settles after at least a week, so the trade is not a same-day flip.`;
  if (c.includes('curator') || c.includes('allocator') || c.includes('yield')) return `Deposit $${capital} into a ${name} vault on ${chain} and keep the vault shares; pick the vault with the largest TVL.`;
  if (c.includes('stable')) return `Mint or deposit $${capital} of the stable asset through ${name} on ${chain} and hold it in the wallet that did the mint.`;
  if (c.includes('rwa')) return `Mint $${capital} of ${name}'s yield-bearing asset on ${chain} and hold it so the wallet accrues yield on-chain.`;
  if (c.includes('insurance')) return `Buy $${capital} of cover from ${name} on ${chain} for a protocol you already use, and keep the policy for its full term.`;
  if (c.includes('payment') || c.includes('card')) return `Fund $${capital} through ${name} on ${chain} and spend a small amount with it, so the wallet shows real payment activity.`;
  if (c.includes('privacy')) return `Make a $${capital} shielded deposit through ${name} on ${chain} and leave it shielded for at least a week before withdrawing.`;
  if (c.includes('governance')) return `Deposit $${capital} into ${name} on ${chain}, lock it for the shortest voting term, and vote on one live proposal.`;
  if (c.includes('index')) return `Buy $${capital} of ${name}'s index token on ${chain} and hold it through one rebalance.`;
  if (c.includes('otc')) return `List a $${capital} OTC offer on ${name} on ${chain} at the market price and let it sit until it fills or expires.`;
  if (c.includes('chain')) return `Bridge $${capital} onto ${chain} through ${name}'s own bridge, then use one native app on the chain so the wallet is active there.`;
  if (c.includes('cedefi')) return `Deposit $${capital} into ${name}'s CeDeFi vault on ${chain} and keep the position through one yield cycle.`;
  if (c.includes('farm')) return `Stake $${capital} of LP tokens in ${name}'s farm on ${chain} and claim the farm rewards weekly.`;
  return `Deposit $${capital} of USDC into ${name} on ${chain} and use the app's main feature with the deposit, not just the deposit alone.`;
}

/** A second, different action on the same protocol, so the wallet shows more than one action type. */
function secondActionFor(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return `Repay half the borrow, then borrow again for a smaller amount, so the wallet's borrow history spans two separate loans.`;
  if (c.includes('dex') || c.includes('liquidity manager') || c.includes('leveraged farm')) return `Swap $${Math.max(10, Math.round(capital / 5))} of USDC for the pool's other asset on ${name} and add it to the same position.`;
  if (c.includes('bridge') || c.includes('cross chain')) return `Bridge a second, smaller amount of $${Math.max(10, Math.round(capital / 5))} a week later, on a different day, so the bridge history is not a single burst.`;
  if (c.includes('stak') || c.includes('restak')) return `Top the stake up by $${Math.max(10, Math.round(capital / 5))} a week later, so the stake grows in two deposits rather than one.`;
  if (c.includes('perpetual') || c.includes('derivative') || c.includes('basis trading') || c.includes('options')) return `Open a second small position in the opposite direction as a hedge, then close both positions together.`;
  if (c.includes('curator') || c.includes('allocator') || c.includes('yield')) return `Deposit a second tranche of $${Math.max(10, Math.round(capital / 5))} into a different vault of ${name} on ${chain}.`;
  if (c.includes('prediction')) return `Place a second, smaller position on a different market of ${name}, on a different day from the first.`;
  if (c.includes('governance')) return `Vote on a second proposal, or delegate the vote to an active delegate, and keep the delegation for the term.`;
  if (p.chains.length > 1) return `Repeat the same action on ${p.chains[1]} with $${Math.max(10, Math.round(capital / 5))}, so the wallet is active on a second chain.`;
  return `Use a second feature of ${name} on ${chain}, such as a swap, a vote or a claim, so the wallet shows more than one action type.`;
}

/**
 * A protocol's farm plan: seven steps, each an action with a cost and a time. The plan is
 * derived from the protocol's own record (category, chains, TVL and age), never from a
 * hand-written list of names.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null): FarmStep[] {
  const chain = chainOf(p);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const gas = gasNote(chain);
  const steps: FarmStep[] = [
    {
      text: `Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline on paper, never in a screenshot.`,
      cost: 'free to create, and the first transaction costs ' + gas,
      time: '5 minutes',
    },
    {
      text: actionFor(p, capital, chain),
      cost: `$${capital} of capital and ${gas}`,
      time: '15 minutes to set up',
    },
    {
      text: secondActionFor(p, capital, chain),
      cost: `about $${Math.max(10, Math.round(capital / 5))} of capital and ${gas}`,
      time: '10 minutes, a week after the first action',
    },
    {
      text: `Make one qualifying action each week, such as a deposit, a borrow, a swap or a vote, and never do a whole month's activity in one day.`,
      cost: gas + ' each week',
      time: '10 minutes a week',
    },
    {
      text: `Hold the position for at least ${hold} days so the activity is counted in more than one snapshot, and do not withdraw early for a small gain.`,
      cost: `the $${capital} stays in the position`,
      time: `${hold} days`,
    },
    {
      text: `Before you withdraw, open ${p.name}'s own points or rewards page from the link it publishes itself, and check whether your wallet qualifies.`,
      cost: 'no fee to check, and never pay anyone to claim',
      time: '10 minutes',
    },
    {
      text: `Write the wallet, the dates and every transaction hash in a farm log, then unwind in steps: withdraw half, wait a day, and withdraw the rest.`,
      cost: gas + ' per withdrawal',
      time: '5 minutes to log, 2 days to unwind',
    },
  ];
  return steps;
}

/** The live-token protocols, by market cap, for the dashboard's Live token view. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
    }));
}

/** A board row's compact form for data.js, with its factors for the detail view. */
export function radarRow(row: BoardRow, watchlist: Set<string>): RadarRow {
  return {
    rank: row.rank,
    slug: row.slug,
    name: row.name,
    category: row.category,
    chains: row.chains,
    tvl_usd: row.tvl_usd,
    change_7d: row.change_7d,
    mcap_usd: row.mcap_usd,
    listed_at: row.listed_at,
    age_days: row.age_days,
    implied_value_usd: row.implied_value_usd,
    peer_ratio: row.model.peer_ratio,
    peer_count: row.model.peer_count,
    category_median_ratio: row.model.category_median_ratio,
    growth_multiplier: row.model.growth_multiplier,
    maturity_multiplier: row.model.maturity_multiplier,
    chain_multiplier: row.model.chain_multiplier,
    confidence: row.model.confidence,
    confidence_label: row.model.confidence_label,
    watchlist: watchlist.has(row.slug),
  };
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const board = buildBoard(snapshot, model);
  const calibration = peerCalibration(snapshot, model);
  const live = liveRows(snapshot);
  const watchlist = new Set(snapshot.watchlist);
  const early = board.filter((r) => !watchlist.has(r.slug)).length;
  const peers: Record<string, PeerStats> = {};
  for (const [key, stats] of calibration.byCategory) peers[key] = stats;
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model,
    model_version: MODEL_VERSION,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: early,
    live_size: live.length,
    global_median_ratio: round4(calibration.globalMedian),
    rows: board.map((r) => radarRow(r, watchlist)),
    live,
    peers,
  };
  return { board, radar };
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return {
    as_of: o.as_of,
    source: o.source,
    floor_usd: o.floor_usd,
    protocols,
    watchlist: o.watchlist as string[],
  };
}

/** Why a board is not one the gate will take, or null: coverage, ranks, order, one shared implied value, and farm steps. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    const steps = r.farm_steps;
    if (steps.length < 3 || steps.length > 12) return `${r.slug} has ${steps.length} farm steps`;
    for (const s of steps) if (s.length < 20 || s.length > 600) return `${r.slug} has a farm step of ${s.length} characters`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
