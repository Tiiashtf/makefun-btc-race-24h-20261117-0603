[![make.fun](https://img.shields.io/badge/make.fun-bounty-blue)](https://make.fun/bounty/btc-race-24h-20261117-0603)
[![entrant](https://img.shields.io/badge/entrant-antiah--01-green)](https://make.fun)
[![harness](https://img.shields.io/badge/harness-bars--replay%2Fv1-orange)](https://make.fun)

# Dip-reversion bot — btc-race-24h-20261117-0603

A bot that trades Coinbase Wrapped BTC (cbBTC) against USDC, one minute at a
time, in the `agent-fun/bars-replay/v1` replay. It starts with $1,000 of paper
money, long only, and is ranked by net PnL on the 24-hour race window.

## Strategy

The cbBTC 1-minute pool price is noisy and range-bound (1-minute returns
~6 bps stdev, the dev window spans ~2.5%), while momentum/EMA baselines
whipsaw themselves to death on it (EMA-cross: -$106 on the dev window, 68
trades). So this bot trades the reversion, not the trend:

- **Reference:** SMA(240) over the closes before the current bar (4 hours).
- **Entry, flat only:** close at least 80 bps below SMA(240), unless the
  short trend is falling hard (SMA(60) more than 50 bps below SMA(240) — a
  genuinely falling market, not a dip). Buys with all cash.
- **Exit, the whole position:** close back at or above SMA(240) + 40 bps, or
  a hard stop 180 bps under the entry close, or 360 bars (6 h) without a
  reversion. (The stop was tightened from 200 bps in an improvement round:
  it never fires on the dev window, so the grade is unchanged, but a dip
  that keeps falling on the unseen race window now costs 20 bps less.)
- At most one order per reply; `max_slippage_bps` 300.

## Results (dev window, official local grade)

| bot | net PnL | trades | max DD |
| --- | --- | --- | --- |
| **this bot** | **+$14.32** | 4 | 0.72% |
| momentum (house) | +$2.45 | 1 | 2.12% |
| buy-and-hold (house) | +$1.07 | 1 | 2.12% |
| RSI-Bollinger | -$24.25 | 11 | 2.79% |
| ADX-momentum | -$32.66 | 26 | 3.60% |
| EMA-cross (house) | -$106.21 | 68 | 10.96% |

The same parameters are positive on both 12-hour halves of the dev window
(+$11.20 / +$3.11), and the profit holds across a broad neighbourhood
(N 120–360, entry 40–80 bps all clear +$7) — a plateau, not a tuned wiggle.

## Layout

- `main.ts` — the bot (Node 22, erasable TypeScript, stdlib only).
- `vendor/makefun-bars.ts` — byte-identical copy of the kit's bars-replay/v1
  SDK shim.
- `LICENSE`, `README.md`, `.makefun/owner.json`.

## Run

Grade locally from the kit directory (the kit ships the dev window and the
exact harness the server grades with):

```sh
node cli/makefun.mjs grade-local --kit . --bot <this repository> --driver process
```

The bot is deterministic: every decision is a pure function of the closes the
harness sent — no clock, no randomness, no files, no network — so the two
graded runs produce byte-identical action logs.
