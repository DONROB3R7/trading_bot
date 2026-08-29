# WEEX V3 Trading Bot — Project Architecture & Rules

## Purpose

This project receives TradingView webhook signals and executes:

* LONG
* SHORT
* CLOSE
* CLOSE_LONG
* CLOSE_SHORT

actions on **WEEX V3 USDT-M futures**.

`server_v3.js` is the main entry point.

The project is intentionally split into a small number of files. Keep the architecture simple unless there is a strong reason to add another module.

---

# Project Structure

```text
toobit-bot/

│
├── server_v3.js              # MAIN ENTRY POINT
│
├── config/
│   └── config.js             # Central settings and environment variables
│
├── weex/
│   └── weex.js               # ALL WEEX API communication
│
├── filters/
│   └── orderBook.js          # ONLY order-book analysis/filtering
│
├── trading/
│   └── trading.js            # Signal processing, positions, entries, reversals
│
└── utils/
    └── logger.js             # Small console/log helpers
```

---

# 1. server_v3.js

## Role

This is the main application file and HTTP server.

It is responsible for:

* Loading configuration
* Starting Express
* Receiving TradingView webhooks
* Normalizing symbols/actions
* Validating incoming signals
* Sending an immediate HTTP 200 acknowledgement
* Passing valid signals to `trading/trading.js` for background processing
* Providing read-only/test/status/manual endpoints
* Loading all available WEEX contracts on startup

## Important Rule

`server_v3.js` should stay thin.

It should NOT contain:

* Detailed WEEX order placement logic
* Order-book calculations
* Position-size calculation logic
* Complex trading orchestration

## Intended Flow

```text
TradingView
    |
    v
server_v3.js
    |
    v
trading/trading.js
    |
    +-------> filters/orderBook.js
    |
    v
weex/weex.js
    |
    v
WEEX
```

---

# 2. config/config.js

## Role

This is the central configuration file.

It contains:

* PORT
* WEEX base URL
* Default margin
* Default leverage
* Required margin mode
* Order-book depth
* Trading enabled/disabled state
* WEEX API credentials loaded from `.env`
* Current risk settings

## Current Risk Settings

```text
Margin:          1 USDT
Leverage:        10x
Target notional: ~10 USDT
Margin mode:     ISOLATED
```

## Important

Order-book imbalance thresholds are currently controlled directly inside:

```text
filters/orderBook.js
```

This was intentionally changed to make order-book testing easier.

The following values may still exist in `config.js` for monitoring/compatibility:

```text
MIN_BID_ASK_RATIO
MIN_ASK_BID_RATIO
```

However, under the current LIGHT filter behavior, the ratio values do NOT independently block entries.

---

# 3. weex/weex.js

## Role

This file contains ALL direct WEEX interaction.

It is the single place that knows how to communicate with WEEX.

It handles:

* API signing
* HTTP requests
* Public market requests
* Symbol normalization
* Contract discovery/cache
* Price/ticker lookup
* Order-book retrieval
* Futures balance
* Current position lookup
* Symbol configuration
* Margin/leverage verification
* Quantity calculation
* Quantity step-size handling
* Market opening orders
* Position closing orders
* Position verification/waiting

---

## Automatic Contract Discovery

The bot discovers available USDT-M symbols from WEEX at startup.

The supported symbol set is stored in memory and reused by the rest of the application.

Do not replace this with a hard-coded coin list unless explicitly requested.

---

## Quantity Handling

The bot calculates target quantity from:

```text
Target notional = margin × leverage

Quantity = target notional / current price
```

Quantity is then floored to the known WEEX step size.

If WEEX rejects the order because its real `stepSize` differs from the cached value:

1. The code extracts the real step size from the WEEX error.
2. The cached contract information is updated.
3. The order is retried once.

This retry behavior is intentional and MUST be preserved.

---

## Leverage and Margin

Before opening a position, the bot verifies:

```text
Margin mode = ISOLATED

Configured leverage = available/valid
```

The bot does NOT silently switch the account from cross to isolated.

If the account is configured incorrectly, it throws an error and asks for the account setting to be corrected.

---

## Position Verification

After opening or closing a position, the bot checks the real WEEX position until the expected state is confirmed.

WEEX is the source of truth.

Do NOT replace real WEEX position checks with local position state.

---

# 4. filters/orderBook.js

## Role

This file contains ONLY order-book analysis/filtering.

It must NOT:

* Place orders
* Close positions
* Calculate position size
* Decide TradingView signal direction
* Manage positions
* Perform reversals

Its job is:

```text
Get live depth
      |
      v
Calculate bid liquidity
Calculate ask liquidity
      |
      v
Calculate percentages
Calculate imbalance
Calculate bid/ask ratios
      |
      v
Return PASS/BLOCK result
```

---

# Current Order-Book Filter Configuration

The order-book filter now has an easy ON/OFF switch directly inside:

```text
filters/orderBook.js
```

Current setting:

```js
const ORDER_BOOK_FILTER_ENABLED = true;
```

## Filter Switch

```text
true
```

means:

```text
Order-book filter ACTIVE
```

```text
false
```

means:

```text
Order-book filter COMPLETELY BYPASSED
```

When disabled, a LONG or SHORT TradingView signal is allowed through without an order-book block.

This is useful for A/B testing:

```text
TradingView strategy + order book
```

versus:

```text
TradingView strategy only
```

---

# Current Imbalance Setting

The current test configuration is:

```js
const LONG_MIN_IMBALANCE = 0.15;
const SHORT_MAX_IMBALANCE = -0.15;
```

This is considered the:

```text
LIGHT
```

order-book filter.

## Available Presets

These are reference presets, not separate automatic modes.

```text
VERY LIGHT
LONG  >= +0.10
SHORT <= -0.10


LIGHT
LONG  >= +0.15
SHORT <= -0.15


NORMAL
LONG  >= +0.20
SHORT <= -0.20


RESTRICTIVE
LONG  >= +0.25
SHORT <= -0.25


VERY RESTRICTIVE
LONG  >= +0.30
SHORT <= -0.30
```

The bot does NOT automatically change between these presets.

The developer must intentionally change the two threshold values.

---

# Imbalance Calculation

The order-book imbalance is:

```text
(bidLiquidity - askLiquidity)
--------------------------------
(bidLiquidity + askLiquidity)
```

Interpretation:

```text
+1 = extreme bid dominance

 0 = balanced

-1 = extreme ask dominance
```

Examples:

```text
+0.40 = strong bid pressure

+0.15 = moderate bid pressure

 0.00 = balanced

-0.15 = moderate ask pressure

-0.40 = strong ask pressure
```

---

# Current Entry Filter Logic

IMPORTANT:

The current filter was intentionally changed from:

```text
imbalance PASS AND ratio PASS
```

to:

```text
imbalance PASS
```

The reason is that the previous implementation could block too many TradingView entries.

The TradingView strategy already generates the trading signal.

The WEEX order book should act as a LIGHT quality filter rather than another complete trading strategy.

---

# LONG

With the current LIGHT setting:

```text
imbalance >= +0.15
```

means:

```text
PASS
```

while:

```text
imbalance < +0.15
```

means:

```text
BLOCK
```

The bid/ask ratio is still calculated and logged, but it does NOT block the LONG.

Conceptually:

```text
LONG signal
    |
    v
Order-book imbalance
    |
    +---- >= +0.15 ----> PASS
    |
    +---- < +0.15 -----> BLOCK
```

---

# SHORT

With the current LIGHT setting:

```text
imbalance <= -0.15
```

means:

```text
PASS
```

while:

```text
imbalance > -0.15
```

means:

```text
BLOCK
```

The ask/bid ratio is still calculated and logged, but it does NOT block the SHORT.

Conceptually:

```text
SHORT signal
    |
    v
Order-book imbalance
    |
    +---- <= -0.15 -----> PASS
    |
    +---- > -0.15 ------> BLOCK
```

---

# Ratio Behavior

The bot still calculates:

```text
bid/ask ratio
ask/bid ratio
```

and displays them in the logs.

However, the current filter does NOT use:

```text
imbalance PASS AND ratio PASS
```

for the final decision.

Instead:

```text
LONG  = imbalance only

SHORT = imbalance only
```

The ratio is therefore currently a monitoring metric.

This allows future testing to determine whether the ratio actually improves trade quality before making it a hard blocking condition again.

---

# Why the Filter Is Light

The TradingView strategy is the primary signal generator.

The architecture is:

```text
TRADINGVIEW
    |
    | Signal
    v
WEEX BOT
    |
    | Safety / execution
    v
ORDER BOOK
    |
    | Small quality filter
    v
WEEX EXECUTION
```

The goal is NOT to reject every trade that does not have perfect order-book conditions.

The goal is to remove some lower-quality entries while allowing most valid TradingView signals to execute.

This is especially important because the bot may trade many different altcoins and order-book behavior can vary significantly between contracts.

---

# CLOSE Safety Rule

CLOSE actions are NEVER passed through the order-book filter.

This is mandatory.

Closing risk must always be allowed.

The following actions bypass order-book filtering:

```text
CLOSE
CLOSE_LONG
CLOSE_SHORT
```

The order-book filter only applies to NEW LONG/SHORT entries.

---

# 5. trading/trading.js

## Role

This is the trading controller.

It connects the TradingView signal to:

```text
Order-book filter
        +
WEEX execution
        +
Real position verification
```

It handles:

* LONG
* SHORT
* CLOSE
* CLOSE_LONG
* CLOSE_SHORT
* Current position checks
* Same-direction suppression
* Reversals
* Fresh order-book checks before new entries
* Position verification
* Per-symbol concurrency locks

---

# LONG Behavior

## If Account Is FLAT

```text
LONG signal
    |
    v
Fresh order book
    |
    +---- BLOCK ----> stay FLAT
    |
    +---- PASS
            |
            v
       calculate size
            |
            v
       verify leverage
            |
            v
        open LONG
            |
            v
      verify LONG
```

## If Already LONG

```text
LONG -> NO ACTION
```

Do not add another LONG position unless explicitly supported/requested.

## If Already SHORT

```text
LONG
 |
 v
CLOSE SHORT
 |
 v
CONFIRM FLAT
 |
 v
FRESH ORDER BOOK FOR LONG
 |
 +---- BLOCK -> remain FLAT
 |
 +---- PASS -> OPEN LONG
                  |
                  v
             CONFIRM LONG
```

---

# SHORT Behavior

Mirror of LONG.

## If FLAT

```text
SHORT
  |
  v
Fresh order book
  |
  +---- BLOCK -> stay FLAT
  |
  +---- PASS
          |
          v
      calculate size
          |
          v
      verify leverage
          |
          v
       open SHORT
          |
          v
      verify SHORT
```

## If Already SHORT

```text
SHORT -> NO ACTION
```

## If Already LONG

```text
SHORT
 |
 v
CLOSE LONG
 |
 v
CONFIRM FLAT
 |
 v
FRESH ORDER BOOK FOR SHORT
 |
 +---- BLOCK -> remain FLAT
 |
 +---- PASS -> OPEN SHORT
                  |
                  v
             CONFIRM SHORT
```

---

# CLOSE Behavior

CLOSE does NOT use the order-book filter.

```text
CLOSE
  |
  v
Read real position
  |
  +---- FLAT ----> nothing
  |
  +---- LONG/SHORT
          |
          v
        CLOSE
          |
          v
      CONFIRM FLAT
```

---

# CLOSE_LONG Behavior

Only closes a real LONG position.

```text
Actual position = LONG
    |
    v
CLOSE LONG
```

If the actual position is:

```text
SHORT
```

or:

```text
FLAT
```

no close order is sent.

---

# CLOSE_SHORT Behavior

Only closes a real SHORT position.

```text
Actual position = SHORT
    |
    v
CLOSE SHORT
```

If the actual position is:

```text
LONG
```

or:

```text
FLAT
```

no close order is sent.

---

# 6. utils/logger.js

## Role

Small helper functions for readable console output.

Keep this file simple.

Do not move:

* Trading logic
* WEEX logic
* Order-book logic

into the logger.

---

# Webhook Contract

TradingView sends actions in this format:

```json
{
    "action": "LONG",
    "symbol": "BTCUSDT.P",
    "price": "100000",
    "time": "1780000000000"
}
```

Supported actions:

```text
LONG
SHORT
CLOSE
CLOSE_LONG
CLOSE_SHORT
```

Symbols are normalized before processing.

Examples:

```text
MINAUSDT.P -> MINAUSDT

BTCUSDT.P  -> BTCUSDT
```

---

# Webhook Acknowledgement

The signal is acknowledged immediately with HTTP 200.

The slow WEEX operation runs in the background.

This is important because TradingView should not wait for:

* WEEX API calls
* Order-book retrieval
* Position verification
* Order execution
* Reversal processing

Conceptually:

```text
TradingView
    |
    v
POST /webhook
    |
    +---- HTTP 200 immediately
    |
    v
Background trading processing
```

---

# Endpoints

## TradingView

```text
POST /webhook
```

---

## Manual Testing

```text
POST /manual-long?symbol=BTCUSDT

POST /manual-short?symbol=BTCUSDT

POST /manual-close?symbol=BTCUSDT
```

These endpoints are intended for controlled manual testing.

---

## Read-Only Order-Book Test

```text
GET /test-orderbook?symbol=BTCUSDT&direction=LONG

GET /test-orderbook?symbol=BTCUSDT&direction=SHORT
```

IMPORTANT:

`/test-orderbook` MUST NEVER place an order.

It is strictly for inspecting:

* Bid liquidity
* Ask liquidity
* Bid percentage
* Ask percentage
* Imbalance
* Bid/ask ratio
* Pass/block result

---

## Status

```text
GET /status
```

---

## Current Position

```text
GET /position?symbol=BTCUSDT
```

---

## Available Symbols

```text
GET /symbols
```

---

## Refresh Contracts

```text
POST /refresh-symbols
```

---

# Safety Rules / Do Not Break

These rules are important for all future AI/code changes.

## 1. Never Remove Real Position Verification

WEEX is the source of truth for current position state.

Do not rely on:

```text
local position = LONG
```

or similar local state as the final source of truth.

Always verify the real WEEX position.

---

## 2. Never Filter CLOSE Actions Through the Order Book

Closing risk is always allowed.

Never make CLOSE depend on favorable order-book conditions.

---

## 3. Reversals Must Close First

Correct order:

```text
OLD POSITION
    |
    v
CLOSE
    |
    v
CONFIRM FLAT
    |
    v
FRESH ORDER BOOK
    |
    v
OPEN NEW DIRECTION
    |
    v
CONFIRM NEW POSITION
```

Never open the opposite position before confirming that the old position is flat.

---

## 4. Keep Per-Symbol Locks

A delayed duplicate webhook must not cause two simultaneous operations for the same symbol.

Locks are:

```text
PER SYMBOL
```

not global.

Therefore:

```text
BTC activity
```

must not block:

```text
MINA activity
```

---

## 5. Keep Fast Webhook Acknowledgement

TradingView should receive HTTP 200 quickly.

Slow WEEX work runs in the background.

---

## 6. Keep Order-Book Testing Read-Only

```text
/test-orderbook
```

must never place an order.

---

## 7. Keep Automatic Symbol Discovery

Do not hard-code the supported coin list unless explicitly requested.

WEEX contracts should continue to be discovered automatically.

---

## 8. Preserve WEEX Step-Size Retry

Some contracts report a real step size only when an order is rejected.

The retry behavior is intentional and must be preserved.

---

## 9. Do Not Silently Change Strategy/Risk Settings

The following are strategy or risk settings.

Do not change them automatically:

```text
ORDER_BOOK_DEPTH

LONG_MIN_IMBALANCE

SHORT_MAX_IMBALANCE

MIN_BID_ASK_RATIO

MIN_ASK_BID_RATIO

DEFAULT_MARGIN

DEFAULT_LEVERAGE
```

Threshold changes must be intentional.

---

## 10. Order-Book Filter Must Remain Independent

Order-book analysis belongs inside:

```text
filters/orderBook.js
```

Do not move it into:

```text
trading/trading.js
```

or:

```text
server_v3.js
```

---

## 11. Do Not Restore Ratio AND Logic Without Testing

The previous order-book implementation used:

```js
const allowed =
    imbalancePass &&
    ratioPass;
```

This could block a very large percentage of TradingView signals.

The current implementation intentionally uses:

```js
const allowed =
    imbalancePass;
```

for LONG and SHORT.

The ratio remains available for monitoring.

Do not restore the `AND` requirement without explicitly testing its impact on trade frequency and quality.

---

# Current Order-Book Test Objective

The current objective is:

```text
Improve trade quality slightly
WITHOUT blocking too many TradingView trades.
```

Current test:

```text
FILTER = ON

LONG threshold  = +0.15

SHORT threshold = -0.15

Ratio = monitoring only
```

This should be considered a LIGHT filter.

The purpose is not to create a second trading strategy.

---

# A/B Testing

The filter can easily be disabled:

```js
const ORDER_BOOK_FILTER_ENABLED = false;
```

This produces:

```text
TradingView signal
       |
       v
Order book bypassed
       |
       v
WEEX execution
```

With:

```js
const ORDER_BOOK_FILTER_ENABLED = true;
```

the order book is active.

This makes it possible to compare:

```text
A = TradingView only

B = TradingView + LIGHT order-book filter
```

The comparison should use actual trade results rather than assumptions.

---

# Recommended Development Workflow

When modifying the bot:

## 1. Make the smallest change possible

Avoid unnecessary rewrites.

---

## 2. Run syntax checks

```bash
node --check server_v3.js

node --check config/config.js

node --check weex/weex.js

node --check filters/orderBook.js

node --check trading/trading.js

node --check utils/logger.js
```

---

## 3. Start server_v3.js

Check:

* Startup
* Configuration
* WEEX connection
* Contract discovery

---

## 4. Test Order Book First

Use:

```text
/test-orderbook
```

Confirm:

* Correct symbol
* Correct direction
* Correct depth
* Correct imbalance
* Correct threshold
* Correct PASS/BLOCK result

---

## 5. Test Position

Use:

```text
/position?symbol=BTCUSDT
```

Confirm the real WEEX position is correctly detected.

---

## 6. Test Manual Endpoints Only When Needed

Use manual LONG/SHORT/CLOSE endpoints carefully.

---

## 7. Then Allow TradingView Live Signals

Only after the read-only tests behave correctly.

---

# Future AI Instructions

When another AI works on this project, it should follow these principles.

## Architecture

Treat:

```text
server_v3.js
```

as the main entry point.

Preserve the six-file architecture unless there is a strong technical reason to change it.

Do not create additional modules unnecessarily.

---

## Responsibilities

Keep:

```text
server_v3.js
```

for HTTP/server/webhook responsibilities.

Keep:

```text
config/config.js
```

for configuration.

Keep:

```text
weex/weex.js
```

for ALL WEEX API communication.

Keep:

```text
filters/orderBook.js
```

for order-book analysis/filtering.

Keep:

```text
trading/trading.js
```

for signal processing, positions, reversals, and execution orchestration.

Keep:

```text
utils/logger.js
```

for simple logging helpers.

---

# Critical Trading Rules

Always preserve:

```text
REAL WEEX POSITION CHECKS

PER-SYMBOL LOCKS

FAST WEBHOOK ACK

CLOSE SAFETY

CLOSE-BEFORE-REVERSAL

FRESH ORDER BOOK BEFORE NEW ENTRY

AUTOMATIC CONTRACT DISCOVERY

STEP-SIZE RETRY
```

---

# Strategy vs Execution

The TradingView strategy decides when to send:

```text
LONG

SHORT

CLOSE_LONG

CLOSE_SHORT
```

The WEEX bot decides whether and how to execute those signals safely.

Therefore:

```text
TRADINGVIEW
= SIGNAL GENERATOR
```

and:

```text
WEEX BOT
= EXECUTION + SAFETY LAYER
```

The order-book filter belongs to the execution/safety layer.

It should not be confused with TradingView's entry strategy.

---

# Current Architecture Summary

```text
                         TRADINGVIEW
                              |
                              |
                         Webhook Signal
                              |
                              v
                    +-------------------+
                    |   server_v3.js    |
                    |  HTTP / Webhook   |
                    +---------+---------+
                              |
                              v
                    +-------------------+
                    | trading/trading.js |
                    | Signal Controller  |
                    +---------+---------+
                              |
                +-------------+-------------+
                |                           |
                v                           v
      +-------------------+       +-------------------+
      | filters/          |       | weex/             |
      | orderBook.js      |       | weex.js           |
      |                   |       |                   |
      | Imbalance         |       | API signing       |
      | Liquidity         |       | Positions         |
      | Ratios            |       | Orders            |
      | PASS/BLOCK        |       | Contracts         |
      +-------------------+       | Quantity          |
                                  | Verification      |
                                  +---------+---------+
                                            |
                                            v
                                          WEEX
```

---

# Version

```text
Architecture: SERVER V3

Main entry point:
server_v3.js

Order-book filter:
LIGHT

Current imbalance:
LONG  >= +0.15
SHORT <= -0.15

Order-book filter switch:
ORDER_BOOK_FILTER_ENABLED = true

Ratio:
MONITORING ONLY

CLOSE filtering:
BYPASSED / NEVER FILTERED
```

Keep this README updated whenever a major architectural or behavior change is intentionally introduced.
