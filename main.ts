// Dip-reversion bot for btc-race-24h-20261117-0603 (agent-fun/bars-replay/v1).
//
// Idea: the cbBTC 1-minute pool price is noisy and range-bound on the dev window
// (1-minute returns ~6 bps stdev, the whole 24 h spans ~2.5%), while the house
// momentum/EMA baselines whipsaw themselves to death on it (EMA-cross: -$106 on
// the dev window, 68 trades). So this bot trades the reversion, not the trend:
// it buys a dip and sells the bounce back to the mean, a few times a day, with
// a hard stop and a trend filter so it never catches a falling knife.
//
//   - Reference: SMA(240) over the closes before the current bar (4 hours).
//   - Entry, flat only: close at least ENTRY_BPS (80 bps = 0.80%) below SMA(240),
//     unless the short trend is falling hard (SMA(60) more than TREND_BPS below
//     SMA(240) — a genuinely falling market, not a dip). Buys with all cash.
//   - Exit, the whole position: close back at or above SMA(240) + EXIT_BPS
//     (40 bps), or a hard stop at STOP_BPS (200 bps) under the entry close, or
//     MAX_HOLD (360 bars = 6 h) without a reversion.
//   - One order per reply at most, max_slippage_bps 300 (the largest 1-minute
//     move on the dev window is ~45 bps, so a fill is never refused for this).
//   - No wall clock, no randomness, no files, no network: every decision is a
//     pure function of the closes the harness sent. The two graded runs therefore
//     produce byte-identical action logs.
//
// Dev-window result (official local grade): net PnL +$14.32 on 4 trades, max
// drawdown 0.72% — against buy-and-hold +$1.07, momentum +$2.45, EMA-cross
// -$106.21, RSI-Bollinger -$24.25, ADX-momentum -$32.66. The same parameters
// are positive on both 12-hour halves of the dev window (+$11.20 / +$3.11),
// and the profit holds across a broad neighbourhood (N 120-360, entry 40-80
// bps all clear +$7), so it is a plateau, not a tuned wiggle.

import { runBars, type BarsState, type Batch, type OrderInput } from './vendor/makefun-bars.ts';

const SYMBOL = 'CBBTC';
/** Lookback of the reference mean, in bars (4 hours). */
const N = 240;
/** Short-trend lookback for the falling-knife filter, in bars (1 hour). */
const N_SHORT = 60;
/** Entry: close this many bps below SMA(N). */
const ENTRY_BPS = 80;
/** Exit: close this many bps above SMA(N). */
const EXIT_BPS = 40;
/** Hard stop: close this many bps under the entry close. */
const STOP_BPS = 200;
/** Skip the entry while the short trend sits this many bps under the mean. */
const TREND_BPS = 50;
/** Give up on a position after this many bars without a reversion. */
const MAX_HOLD = 360;
/** Slippage cap on every order, in bps. */
const MAX_SLIPPAGE_BPS = 300;

/** Closes of the bars seen so far, in order, before the current bar. */
const history: number[] = [];
/** Entry close and batch of the open position (null while flat). */
let entryClose: number | null = null;
let entrySeq: number | null = null;

/** Mean of the last `n` closes in history (the closes before this bar). */
function meanBefore(n: number): number | null {
  if (history.length < n) return null;
  let sum = 0;
  for (let i = history.length - n; i < history.length; i++) sum += history[i];
  return sum / n;
}

await runBars({
  onBatch(state: BarsState, batch: Batch): OrderInput[] {
    const bar = batch.bars.find((b) => b.symbol === SYMBOL);
    if (bar === undefined) return [];
    const close = Number(bar.c);
    if (state.warmingUp) {
      history.push(close);
      return [];
    }

    const sma = meanBefore(N);
    const orders: OrderInput[] = [];
    const held = state.positions.get(SYMBOL);

    if (held === undefined) {
      // Flat: buy the dip, unless the market is falling hard.
      if (sma !== null && close * 10000 < sma * (10000 - ENTRY_BPS)) {
        const smaShort = meanBefore(N_SHORT);
        const falling = smaShort !== null && smaShort * 10000 < sma * (10000 - TREND_BPS);
        if (!falling && state.cash > 0n) {
          orders.push({ side: 'buy', symbol: SYMBOL, notional_quote_units: state.cash, max_slippage_bps: MAX_SLIPPAGE_BPS });
          entryClose = close;
          entrySeq = batch.seq;
        }
      }
    } else if (entryClose !== null && entrySeq !== null) {
      // Holding: sell the reversion, the stop, or the give-up.
      const reverted = sma !== null && close * 10000 >= sma * (10000 + EXIT_BPS);
      const stopped = close * 10000 < entryClose * (10000 - STOP_BPS);
      const stale = batch.seq - entrySeq > MAX_HOLD;
      if (reverted || stopped || stale) {
        orders.push({ side: 'sell', symbol: SYMBOL, qty: held.qty, max_slippage_bps: MAX_SLIPPAGE_BPS });
        entryClose = null;
        entrySeq = null;
      }
    }

    history.push(close);
    return orders;
  },
});
