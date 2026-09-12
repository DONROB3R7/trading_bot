# TradingView → WEEX Bot V3 — Trading & Execution Documentation

**Status:** Active Development  
**Version:** SERVER V3  
**Last Updated:** 2026-09-04  
**Execution Exchange:** WEEX V3 USDT-M Futures  
**Position Source of Truth:** Live WEEX account position

This file contains the detailed trading behavior separated from the main architecture README.

---

# 1. Trading Model

The project has a strict strategy/execution boundary:

```text
TRADINGVIEW / PINE
        |
        | LONG / SHORT / CLOSE
        v
WEEX BOT
        |
        +--> position verification
        +--> entry order-book filter
        +--> quantity/risk validation
        +--> execution
        +--> position confirmation
        +--> TP/SL protection
```

Core principle:

```text
TradingView = SIGNAL GENERATOR
WEEX BOT    = EXECUTION + SAFETY LAYER
WEEX        = FINAL POSITION STATE
```

The bot does not replace the TradingView strategy.

---

# 2. Live WEEX Position Is the Source of Truth

Before execution, the bot checks the actual WEEX position.

The exchange state is interpreted as:

```text
FLAT
LONG
SHORT
```

Local state may assist orchestration, but it is not authoritative.

This protects against server restarts, missed alerts, rejected orders, manual exchange changes and incomplete operations.

---

# 3. Same-Direction Behavior

If TradingView sends LONG while WEEX is already LONG:

```text
LONG signal
    |
    v
WEEX = LONG
    |
    v
NO ACTION
```

Likewise, SHORT while already SHORT produces no additional entry.

This prevents repeated TradingView alerts from creating duplicate same-direction entries.

---

# 4. Order-Book Data Source

Entry filtering uses the WEEX REST market-depth request.

The current architecture uses **one fresh 200-level order-book snapshot** and derives all confirmation depths from that same snapshot.

```text
ONE 200-LEVEL SNAPSHOT
        |
        +----> 15 levels
        +----> 20 levels
        +----> 30 levels
        +----> 60 levels
```

The bot should not unnecessarily request four independent snapshots for the four confirmation depths.

---

# 5. Order-Book Calculations

The order-book filter calculates:

```text
Bid Liquidity
Ask Liquidity
Total Liquidity
Bid Percentage
Ask Percentage
Imbalance
Bid/Ask Ratio
Ask/Bid Ratio
```

Imbalance:

```text
                 Bid Liquidity - Ask Liquidity
Imbalance = -----------------------------------------
                 Bid Liquidity + Ask Liquidity
```

Interpretation:

```text
+1 = extreme bid dominance
 0 = balanced
-1 = extreme ask dominance
```

Positive imbalance represents bid pressure. Negative imbalance represents ask pressure.

---

# 6. LONG Confirmation

At each confirmation depth, LONG requires both tests to pass:

```text
imbalance >= LONG_MIN_IMBALANCE
AND
bidAskRatio >= MIN_BID_ASK_RATIO
```

If both pass:

```text
LONG DEPTH = PASS
```

If either fails:

```text
LONG DEPTH = FAIL
```

---

# 7. SHORT Confirmation

At each confirmation depth, SHORT requires both tests to pass:

```text
imbalance <= SHORT_MAX_IMBALANCE
AND
askBidRatio >= MIN_ASK_BID_RATIO
```

If both pass:

```text
SHORT DEPTH = PASS
```

If either fails:

```text
SHORT DEPTH = FAIL
```

---

# 8. Multi-Depth Confirmation — 15 / 20 / 30 / 60

Current confirmation depths:

```text
15
20
30
60
```

Each depth is evaluated independently from the same 200-level snapshot.

A depth passes only when both its imbalance and ratio tests pass.

Final requirement:

```text
3 OF 4 DEPTHS MUST PASS
```

Example:

```text
15 = PASS
20 = PASS
30 = FAIL
60 = PASS

3 / 4

ENTRY ALLOWED
```

Example blocked result:

```text
15 = PASS
20 = FAIL
30 = FAIL
60 = PASS

2 / 4

ENTRY BLOCKED
```

The current configuration is:

```text
ORDER_BOOK_DEPTH = 200
CONFIRMATION_DEPTHS = [15, 20, 30, 60]
ORDER_BOOK_CONFIRMATION_REQUIRED = 3
CONFIRMATION_RULE = 3_OF_4
```

The exact imbalance/ratio threshold values are controlled by `config.js` and must not be assumed from historical documentation.

---

# 9. Entry Filter Only

The order-book filter applies to new LONG/SHORT entries.

It does not decide the TradingView direction.

```text
TradingView says LONG
        |
        v
Order book asks:
"Does the market depth support LONG?"
```

The filter can therefore block an otherwise valid TradingView signal without changing the TradingView strategy itself.

---

# 10. CLOSE Bypasses Order Book

CLOSE actions never require favorable order-book conditions.

```text
LONG / SHORT ENTRY -> Order-book filter
CLOSE              -> No order-book filter
```

Supported close actions:

```text
CLOSE
CLOSE_LONG
CLOSE_SHORT
```

Reason:

```text
Entry = opportunity
Close = risk reduction
```

The bot must not prevent an exit because the current order book is unfavorable.

---

# 11. Flat → Entry

For a FLAT position receiving a LONG or SHORT signal:

```text
TradingView Signal
        |
        v
Confirm FLAT
        |
        v
Fresh 200-Level Snapshot
        |
        v
15 / 20 / 30 / 60
        |
        v
3 OF 4
        |
        +---- BLOCKED -> Remain FLAT
        |
        v
Check Balance
        |
        v
Get Current Price
        |
        v
Calculate Quantity
        |
        v
Ensure Leverage / Margin
        |
        v
Place MARKET Order
        |
        v
Confirm Live WEEX Position
        |
        v
Protect Confirmed Position with TP/SL
```

A position is not considered successfully opened until WEEX confirms the requested direction.

---

# 12. Reversal Behavior

Reversals are always two-stage operations.

Example:

```text
Current = LONG
Signal  = SHORT
```

Correct sequence:

```text
LONG
 |
 v
CLOSE LONG
 |
 v
CONFIRM FLAT
 |
 v
FRESH 200-LEVEL SNAPSHOT
 |
 v
15 / 20 / 30 / 60
 |
 v
3 OF 4
 |
 +---- BLOCKED -> REMAIN FLAT
 |
 v
OPEN SHORT
 |
 v
CONFIRM SHORT
 |
 v
TP/SL PROTECTION
```

The bot must never open the opposite direction before the old position is confirmed closed.

---

# 13. Reversal Can Finish FLAT

If the old position closes successfully but the new direction fails the order-book confirmation:

```text
Current = LONG
Signal  = SHORT

CLOSE LONG
    |
    v
CONFIRM FLAT
    |
    v
SHORT FILTER = BLOCKED
    |
    v
FINAL STATE = FLAT
```

The bot does not reopen the old direction simply because the new direction was blocked.

This is intentional safety behavior.

---

# 14. TP/SL Protection

When TP/SL is enabled, protection is applied **after the market order has been confirmed as a live WEEX position**.

The important sequence is:

```text
MARKET OPEN
    |
    v
CONFIRM LIVE POSITION
    |
    v
READ ACTUAL avgPrice
    |
    v
PLACE TAKE PROFIT
    |
    v
PLACE STOP LOSS
    |
    v
POSITION FULLY PROTECTED
```

The bot uses the actual confirmed position's average entry price rather than assuming the requested price was the executed price.

---

# 15. TP/SL Configuration

Current configuration keys:

```text
TP_SL_ENABLED
TAKE_PROFIT_PERCENT
STOP_LOSS_PERCENT
TP_SL_TRIGGER_TYPE
```

Exact percentage values are controlled by `config.js`.

Do not silently change them during unrelated code changes because TP/SL values directly affect trading risk.

---

# 16. TP/SL Formulas

For LONG:

```text
Take Profit = avgPrice × (1 + TP%)
Stop Loss   = avgPrice × (1 - SL%)
```

For SHORT:

```text
Take Profit = avgPrice × (1 - TP%)
Stop Loss   = avgPrice × (1 + SL%)
```

The calculation is performed from the confirmed live position's actual `avgPrice`.

---

# 17. WEEX TP/SL Placement Model

The V3 implementation uses WEEX's TP/SL order mechanism after the live position is confirmed.

The logical TP/SL parameters are:

```text
symbol
clientAlgoId
planType
triggerPrice
executePrice
quantity
positionSide
triggerPriceType
reduceOnly
```

The current implementation uses the full confirmed position and market execution behavior for protection.

Conceptually:

```text
executePrice = 0 / market
quantity     = 0 / full position
reduceOnly   = true
```

The implementation checks both HTTP-level success and the WEEX business-level success response.

---

# 18. TP First, SL Second

The protection sequence is intentionally:

```text
1. Place TAKE PROFIT
2. Place STOP LOSS
3. Confirm protection complete
```

If TP placement fails, the position is not considered protected.

If TP succeeds but SL fails, the system treats the position as **not fully protected**.

The failure information must preserve the fact that TP was already placed.

---

# 19. Emergency Close on Protection Failure

If TP/SL protection cannot be completed, the trading controller attempts an emergency close of the confirmed live position.

```text
CONFIRMED POSITION
        |
        v
TP/SL PROTECTION
        |
        +---- SUCCESS -> POSITION FULLY PROTECTED
        |
        +---- FAILURE
                 |
                 v
          EMERGENCY CLOSE
                 |
                 v
          CONFIRM FLAT
```

If the emergency close succeeds, the system intentionally finishes FLAT rather than leaving an unprotected position open.

If the emergency close also fails, the system logs a critical safety failure. This must not be silently ignored.

---

# 20. Entry vs Close

Entries and exits intentionally use different safety gates.

Entry:

```text
Signal
 |
Order Book
 |
15 / 20 / 30 / 60
 |
3 OF 4
 |
Balance
 |
Quantity
 |
Leverage
 |
Open
 |
Confirm
 |
Protect
```

Close:

```text
Signal
 |
Live Position
 |
Reduce-Only MARKET Close
 |
Confirm FLAT
```

No order-book confirmation is required for a close.

---

# 21. Per-Symbol Locks

Trading operations use a lock per symbol.

```text
BTCUSDT  -> locked
MINAUSDT -> independent
SOLUSDT  -> independent
```

The lock prevents simultaneous operations for the same symbol from racing.

It is not a global lock.

---

# 22. Order-Book Statistics

The order-book statistics are diagnostic, in-memory statistics.

Global fields include:

```text
total
accepted
rejected
long.checked
long.accepted
long.rejected
short.checked
short.accepted
short.rejected
reasons
symbols
```

They reset when the statistics are reset or when the server process restarts.

They are not permanent historical performance statistics.

With the multi-depth system, useful diagnostics include:

```text
15-level pass rate
20-level pass rate
30-level pass rate
60-level pass rate
3-of-4 acceptance rate
```

---

# 23. Interpreting Rejection Rates

Example:

```text
Total Signals:      157
Accepted:             6
Rejected:           151
Acceptance Rate:   3.82%
```

This means the filter was highly restrictive during that sample.

It does not automatically mean the filter was good or bad.

The meaningful evaluation is:

```text
TradingView Signals
        |
        +---- Accepted
        |
        +---- Rejected
        |
        +---- Resulting Trades
        |
        +---- Wins / Losses
        |
        +---- P/L
```

The goal is better trade quality, not maximum or minimum acceptance.

---

# 24. Automatic Order-Flow History Trading

The automatic trader acts on **completed history cycles**.

The intended flow is:

```text
ORDER-FLOW HISTORY
        |
        v
CYCLE COMPLETES
        |
        v
FINAL DECISION
        |
        +---- NEUTRAL -> NO ACTION / KEEP CURRENT POSITION
        |
        +---- LONG    -> normal LONG execution
        |
        +---- SHORT   -> normal SHORT execution
```

A partial/in-progress history cycle must not be treated as a completed automatic decision.

---

# 25. NEUTRAL Behavior

A completed-cycle NEUTRAL decision is not a trade.

```text
NEUTRAL
   |
   v
NO NEW ORDER
   |
   v
KEEP CURRENT POSITION STATE
```

If the symbol is currently flat, NEUTRAL does not create a position.

If a position is active, NEUTRAL does not itself close or reverse it.

---

# 26. Automatic Trade Limit Per Cycle

Current configuration:

```js
AUTO_TRADING_MAX_TRADES_PER_CYCLE = 5;
```

This means:

```text
MAXIMUM = 5 EXECUTED TRADES PER COMPLETED CYCLE
```

It does **not** mean:

```text
EXACTLY 5 SYMBOLS
```

It is a cap on executed trades.

A cycle may execute fewer than five trades because decisions can be NEUTRAL, blocked, same-direction, cooldown-limited or otherwise unable to execute.

---

# 27. Final Decision Session vs Bot Gas Tank

These two concepts must remain separate.

## FINAL DECISION SESSION

Tracks historical completed-cycle decisions.

Example:

```text
34 decisions
8 LONG
0 SHORT
26 NEUTRAL
```

Those 34 decisions are not automatically 34 trades.

NEUTRAL is a decision, not a position and not realized P/L.

## BOT GAS TANK

The gas-tank/performance concept is for actual completed positions and realized P/L.

Conceptually:

```text
FINAL DECISION SESSION
= What the completed history cycles decided

BOT GAS TANK
= What the bot actually traded and realized
```

Do not mix decision history with actual completed trade performance.

---

# 28. Managed Symbols Persistence

`managedSymbols` is a persistent monitoring/management list.

Important rule:

```text
LIVE POSITION = FLAT
        |
        X
DO NOT AUTOMATICALLY DELETE managedSymbols
```

A symbol can remain managed/monitored while its live exchange position is temporarily FLAT.

The automatic trader uses **live WEEX positions** to determine whether positions are actually active.

This distinction is important:

```text
managedSymbols
= symbols the bot continues to monitor/manage

live WEEX positions
= symbols that currently have an active position
```

Do not collapse these two concepts into one list.

---

# 29. Automatic Trading and Order-Book Filter

The automatic completed-history process must preserve the current trading-controller behavior.

Where the automatic history engine intentionally supplies an already-decided execution direction to `processSignal`, its current `skipOrderBook` behavior must not be removed or changed casually.

This is a code-level behavior that must be treated as an explicit architecture/strategy decision if changed.

Do not infer from the general TradingView entry flow that every automatic history decision necessarily has identical filtering behavior. Preserve the actual current `trading.js` contract unless the user explicitly requests a change.

---

# 30. Typical LONG / SHORT Entry Flow

```text
SIGNAL
  |
  v
NORMALIZE SYMBOL
  |
  v
VALIDATE SYMBOL
  |
  v
CHECK LIVE WEEX POSITION
  |
  +---- SAME DIRECTION -> NO ACTION
  |
  +---- OPPOSITE -> REVERSAL FLOW
  |
  +---- FLAT -> ENTRY FLOW
```

For a normal FLAT entry:

```text
FLAT
 |
 v
FRESH 200-LEVEL ORDER BOOK
 |
 v
15 / 20 / 30 / 60
 |
 v
3 OF 4
 |
 +---- BLOCK -> FLAT
 |
 v
BALANCE
 |
 v
PRICE
 |
 v
QUANTITY
 |
 v
LEVERAGE / MARGIN
 |
 v
MARKET ORDER
 |
 v
CONFIRM LIVE POSITION
 |
 v
TP/SL PROTECTION
```

---

# 31. Typical CLOSE Flow

```text
CLOSE SIGNAL
     |
     v
LIVE WEEX POSITION
     |
     +---- FLAT -> NOTHING TO CLOSE
     |
     v
REDUCE-ONLY MARKET CLOSE
     |
     v
WAIT
     |
     v
CONFIRM FLAT
```

Order book is not involved.

---

# 32. Typical Reversal Flow

```text
OPPOSITE SIGNAL
      |
      v
CLOSE OLD POSITION
      |
      v
CONFIRM FLAT
      |
      v
FRESH 200-LEVEL SNAPSHOT
      |
      v
15 / 20 / 30 / 60
      |
      v
3 OF 4
      |
      +---- BLOCK -> REMAIN FLAT
      |
      v
CALCULATE QUANTITY
      |
      v
VERIFY LEVERAGE / MARGIN
      |
      v
OPEN NEW DIRECTION
      |
      v
CONFIRM NEW POSITION
      |
      v
TP/SL PROTECTION
```

---

# 33. Logging Requirements

Useful trading logs should expose:

```text
Signal
Symbol
Normalized Symbol
Current Position
Requested Direction
Order-Book Direction
Snapshot Depth
Confirmation Depths
15-Level Result
20-Level Result
30-Level Result
60-Level Result
Passed Depths
Failed Depths
Passed Count
Required Count
Confirmation Decision
Order-Book Measurements
Order-Book Decision
Balance
Price
Quantity
Notional
Margin
Leverage
WEEX Order Result
Final Position
TP/SL Result
Automatic Cycle Status
Automatic Trade Count
```

For example:

```text
LONG ORDER BOOK
15 = PASS
20 = PASS
30 = FAIL
60 = PASS
CONFIRMATION = 3/4
DECISION = ALLOW
```

Blocked example:

```text
SHORT ORDER BOOK
15 = PASS
20 = FAIL
30 = FAIL
60 = PASS
CONFIRMATION = 2/4
DECISION = BLOCK
```

---

# 34. A/B Testing Order-Book Settings

Change one parameter at a time.

```text
TEST A = current settings
TEST B = one changed threshold
```

Compare:

```text
Acceptance Rate
Number of Trades
Winning Trades
Losing Trades
Profit/Loss
Average Trade Quality
```

Important settings include:

```text
ORDER_BOOK_DEPTH
LONG_MIN_IMBALANCE
SHORT_MAX_IMBALANCE
MIN_BID_ASK_RATIO
MIN_ASK_BID_RATIO
CONFIRMATION_DEPTHS
ORDER_BOOK_CONFIRMATION_REQUIRED
```

Current confirmation settings:

```text
[15, 20, 30, 60]
required = 3
```

Do not silently change these during unrelated code work.

---

# 35. Order-Book Rejection Reasons

For blocked entries, the reason should be visible.

Examples:

```text
ORDER_BOOK_DOES_NOT_SUPPORT_LONG
ORDER_BOOK_DOES_NOT_SUPPORT_SHORT
```

The raw measurements and per-depth pass/fail data should also remain available so the exact reason can be diagnosed.

---

# 36. Safety Rules

Never:

```text
- use local position memory as final authority;
- filter CLOSE through order book;
- open a reversal before confirming FLAT;
- remove per-symbol locks casually;
- remove step-size retry casually;
- bypass live position confirmation;
- leave a newly opened position intentionally unprotected when TP/SL is enabled;
- delete managedSymbols just because a live position is FLAT;
- confuse NEUTRAL decisions with actual trades;
- count decision-session history as realized P/L;
- silently change risk settings;
- silently change order-book settings;
- silently change the automatic cycle trade cap.
```

---

# 37. Future Trading Changes

When changing trading behavior, explicitly document:

```text
Date
Change
Affected File(s)
Old Behavior
New Behavior
Reason
Risk/Safety Impact
```

Especially document changes involving:

- order-book thresholds;
- confirmation depths;
- confirmation count;
- automatic history cycles;
- automatic trade limits;
- TP/SL;
- managed-symbol behavior;
- reversal behavior;
- margin/leverage;
- position sizing.

---

# 38. Development Workflow

For a trading change:

```text
1. Identify the owning module.
2. Read the relevant sections of both README files.
3. Make one focused change.
4. Run node --check.
5. Restart V3.
6. Test read-only endpoints first.
7. Inspect actual WEEX position state.
8. Test the intended trading path.
9. Review logs.
10. Only then allow live TradingView execution.
```

---

# 39. Current Trading Baseline

```text
Signal source:
TradingView

Execution:
WEEX V3 USDT-M Futures

Final position authority:
Live WEEX position

Entry order-book snapshot:
200 levels

Confirmation depths:
15 / 20 / 30 / 60

Confirmation requirement:
3 of 4

Close filter:
Bypassed

Reversal:
Close -> Confirm FLAT -> Fresh filter -> Open -> Confirm

Locks:
Per symbol

TP/SL:
After confirmed live position, using actual avgPrice

TP/SL protection failure:
Emergency close attempt

Automatic history trading:
Completed cycles only

NEUTRAL:
No action / keep current position state

Automatic trade cap:
5 trades per completed cycle

Final Decision Session:
Historical completed-cycle decisions

Bot Gas Tank:
Actual completed positions + realized P/L

managedSymbols:
Persistent monitoring/management list
```

---

# 40. Version History

## 2026-08-31 — SERVER V3 Baseline

- Live WEEX position source of truth.
- Fast webhook acknowledgement.
- Automatic contract discovery.
- Entry-only order-book filtering.
- Close-first reversal architecture.
- Per-symbol locks.
- Step-size retry.
- V2 kept separate.

## 2026-09-02 — Multi-Depth Order-Book Update

Changed confirmation depths from:

```text
15 / 30 / 60 / 90
```

to:

```text
15 / 20 / 30 / 60
```

The 90-level test was replaced by 20 levels.

The system still uses one fresh 200-level snapshot and requires 3 of 4 confirmations.

## 2026-09-03 — TP/SL Protection

Added confirmed-position TP/SL protection:

```text
Open
 -> Confirm live position
 -> Use actual avgPrice
 -> TP
 -> SL
 -> Fully protected
```

If protection cannot be completed, emergency close is attempted.

## 2026-09-04 — Automatic History / Dashboard / Managed Symbols

### Automatic History Trading

Automatic trading acts on completed history cycles.

```text
Completed cycle
 -> Final decision
 -> NEUTRAL / LONG / SHORT
```

### Trade Cap

```text
AUTO_TRADING_MAX_TRADES_PER_CYCLE = 5
```

This is a maximum of five executed trades per completed cycle, not five mandatory symbols.

### Dashboard Semantics

```text
FINAL DECISION SESSION
= historical completed-cycle decisions

BOT GAS TANK
= actual completed positions + realized P/L
```

NEUTRAL is a decision and not a trade.

### Managed Symbols

`managedSymbols` remains persistent even when the current WEEX position is FLAT. Live WEEX positions determine active positions; `managedSymbols` remains the monitoring/management list.

### Documentation

Trading-specific documentation was separated into `README_TRADING.md` while architecture/development documentation remains in `README.md`.

---

# 41. Final Trading Architecture

```text
                    TRADINGVIEW
                         |
                         v
                  LONG / SHORT / CLOSE
                         |
                         v
                   trading.js
                         |
          +--------------+--------------+
          |                             |
      ENTRY PATH                    CLOSE PATH
          |                             |
          v                             v
 ONE 200-LEVEL SNAPSHOT             LIVE POSITION
          |                             |
          v                             v
  15 / 20 / 30 / 60              REDUCE-ONLY CLOSE
          |                             |
          v                             v
       3 OF 4                     CONFIRM FLAT
          |
          v
   BALANCE / QUANTITY
          |
          v
  LEVERAGE / MARGIN
          |
          v
    MARKET OPEN
          |
          v
 CONFIRM LIVE POSITION
          |
          v
      TP / SL
          |
          v
 POSITION FULLY PROTECTED
```

Automatic history trading sits above the same controller:

```text
COMPLETED HISTORY CYCLE
          |
          v
FINAL DECISION
          |
          +---- NEUTRAL -> NO ACTION
          |
          +---- LONG/SHORT -> Trading Controller
```

The exchange remains the final authority on actual position state.
