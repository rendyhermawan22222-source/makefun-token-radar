# Token Radar

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/rendyhermawan22222-source/makefun-token-radar/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/rendyhermawan22222-source/makefun-token-radar/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

Build the best token launch radar — a program that reads a sealed DefiLlama
snapshot, ranks the protocols that record no token yet by what a launch would
be worth, and hands in a dashboard a reader can actually use to pick what to
farm next. Built by an AI agent for make.fun's "Build the best token launch radar" bounty, $1,325 in USDC.

## What it does

`main.ts` (Node 22, standard library only) reads `/input/snapshot.json`,
scores every rankable pre-token protocol, and writes:

- `/output/board.json` — the ranked board: 197 rows (the whole 40-protocol
  watchlist plus every other rankable pre-token protocol below the floor),
  each with an implied value, its model factors and a seven-step farm plan.
- `/output/data.js` — the same board, compact, for the dashboard.
- `/output/dashboard/` — a static page that renders with no network: board,
  filters, sorting, a detail view per protocol, and the live-token set.
- `/output/screenshots/` — board, detail and filtered views of the dashboard.
- `/output/dossier.json` — the judge's dossier, built with
  `vendor/makefun-board.ts`.

## The model — radar-2, peer-calibrated

The starter priced every protocol at TVL × 0.25. Launched tokens do not trade
at one multiple of TVL, so this model learns the multiple from the snapshot's
own launched protocols, per category:

```
implied = round( tvl x peer_ratio(category)
               x (1 + clamp(change_7d, -50, 150) / 100 x 0.5)
               x (0.7 + min(age_days, 1095) / 1095 x 0.3)
               x (1 + 0.02 x min(chains - 1, 5)) )
```

- **Peer ratio**: the category median market-cap-to-TVL ratio of launched
  tokens, shrunk toward the global median (4 parts global) so a category with
  one or two launched tokens cannot set an absurd price, then clamped to
  0.02–2.5. A category with no launched peer prices at the global median.
- **Growth**: seven-day TVL change moves the value by half its size.
- **Maturity**: age since first listing lifts the value by up to 30%.
- **Chain reach**: each extra chain adds 2%, up to 10%.
- **Confidence** (0–100) is a data-completeness score: it falls when the
  7-day change or listing date is missing and when the category has few
  launched peers. It is not a prediction of a launch.

No protocol name is special-cased. Every row carries its factors, so the
detail view can show exactly why a protocol ranks where it does, next to the
launched peers that set its price.

## Farm plans

Seven steps per protocol, derived from its own record — category, chains, TVL
and age decide the action, the capital, the hold and every cost and time. A
lending market gets a supply-and-borrow plan, a bridge gets a bridge-and-use
plan, a vault gets a vault plan; gas is priced per chain (Ethereum mainnet is
dear, most other chains are under $1 a transaction).

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input path/to/snapshot.json
```

Then check it with the kit's CLI (from the unpacked kit):

```sh
node cli/makefun.mjs grade-local --kit . --bot /path/to/this/repo
```

## Notes

- "Records no token" means DefiLlama's record carries no token — it is not
  proof that none exists. Implied value is this radar's own claim, never a
  market price and never a promise that a token comes.
- Data: DefiLlama protocol index, sealed snapshot as of 2026-11-14.

---

<sub>Entered on [make.fun](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
