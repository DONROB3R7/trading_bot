# TradingView -> WEEX Bot V3

## Current Project State

This project receives TradingView webhook signals and executes LONG/SHORT/CLOSE actions on WEEX V3 USDT-M futures.

The current architecture is intentionally split into a small number of modules:

```text
TradingView Pine Strategy
        |
        | LONG / SHORT / CLOSE webhook
        v
server_v3.js
        |
        v
trading/trading.js
        |
        +----> filters/orderBook.js
        |
        v
weex/weex.js
        |
        v
WEEX V3 USDT-M Futures
```

`server_v3.js` is the main application entry point.

The bot uses the real WEEX account/position state as the source of truth. It does not depend on a local position-memory variable for execution decisions.

---

# Project Structure

```text
toobit-bot/
|
├── server_v3.js              # Main Express server / TradingView webhook receiver
|
├── config/
│   └── config.js             # Central configuration and environment variables
|
├── weex/
│   └── weex.js               # All direct WEEX API communication and execution
|
├── filters/
│   └── orderBook.js          # Order-book analysis and entry filter only
|
├── trading/
│   └── trading.js            # Signal processing, position logic, reversals, statistics
|
├── utils/
│   └── logger.js             # Console/log helpers
|
├── .env                      # API credentials and runtime configuration
└── README.md                 # This document
```

Keep the architecture simple. Do not split `weex.js` or `trading.js` into many files unless there is a real maintenance or technical reason.

---

# 1. server_v3.js

## Role

`server_v3.js` is the main HTTP application.

It is responsible for:

- Starting Express.
- Loading configuration.
- Receiving TradingView webhooks.
- Normalizing symbols and actions.
- Validating incoming signals.
- Sending an immediate HTTP 200 acknowledgement.
- Passing valid signals to `trading/trading.js` for background processing.
- Exposing status, position, symbol, manual and read-only testing endpoints.
- Loading all available WEEX USDT-M contracts at startup.

## Important rule

`server_v3.js` should stay thin.

It should NOT contain:

- detailed WEEX order placement logic;
- quantity calculation logic;
- HMAC/API implementation;
- order-book calculation logic.

Those responsibilities belong in `weex.js` and `orderBook.js`.

## Webhook behavior

The intended flow is:

```text
TradingView
    |
    v
POST /webhook
    |
    +----> immediate HTTP 200
    |
    v
background processing
    |
    v
trading.js
```

This prevents slow WEEX API calls from unnecessarily delaying TradingView's webhook acknowledgement.

---

# 2. config/config.js

## Role

`config/config.js` is the central configuration layer.

The current trading/execution code reads these important values:

```text
TRADING_ENABLED
DEFAULT_MARGIN
DEFAULT_LEVERAGE
REQUIRED_MARGIN_MODE
ORDER_BOOK_DEPTH
LONG_MIN_IMBALANCE
SHORT_MAX_IMBALANCE
MIN_BID_ASK_RATIO
MIN_ASK_BID_RATIO
```

WEEX API credentials are loaded from environment configuration.

## Risk model

Position size is calculated from:

```text
Target notional = DEFAULT_MARGIN × DEFAULT_LEVERAGE
Quantity        = Target notional / current price
```

The exact values are controlled by `config/config.js` / `.env` and should not be assumed from an old README entry.

The currently documented execution model is:

```text
Margin mode: ISOLATED
Leverage:    configured in config
Margin:      configured in config
```

Before changing risk settings, treat the change as a trading-strategy/risk change, not merely a coding change.

---

# 3. weex/weex.js

## Role

`weex/weex.js` contains ALL direct communication with WEEX.

It is the single module that knows how to authenticate and execute WEEX V3 API requests.

Current responsibilities include:

- HMAC SHA256 request signing.
- Base64 signatures.
- Public market requests.
- Authenticated account requests.
- Symbol normalization.
- Automatic contract discovery.
- Contract information cache.
- Price/ticker lookup.
- REST order-book retrieval.
- Futures balance lookup.
- Current position lookup.
- Symbol configuration lookup.
- Margin-mode verification.
- Leverage verification/update.
- Quantity calculation.
- Quantity step-size handling.
- Market opening orders.
- Market closing orders.
- Position verification/waiting.

## WEEX API authentication

Authenticated requests use:

```text
ACCESS-KEY
ACCESS-SIGN
ACCESS-PASSPHRASE
ACCESS-TIMESTAMP
```

The signature is generated from timestamp, HTTP method, request path, query string and POST body according to the implementation in `weex.js`.

Do not move API signing into `trading.js` or `server_v3.js`.

---

# 4. Automatic contract discovery

At startup the bot calls WEEX market contract information and builds an in-memory supported-symbol set.

The current discovery process:

```text
WEEX exchangeInfo
       |
       v
USDT quote/margin contracts
       |
       v
optional apiTradingSymbols validation
       |
       v
SUPPORTED_SYMBOLS + CONTRACT_INFO
```

This means the bot does not need a manually maintained list of every WEEX coin.

A symbol must be discovered and available before normal trading functions accept it.

Do not replace automatic discovery with a hard-coded coin list unless explicitly requested.

---

# 5. Symbol normalization

TradingView may send symbols such as:

```text
SPXUSDT.P
FARTCOINUSDT.P
BINANCE:BTCUSDT.P
```

The bot normalizes these into the WEEX symbol format, for example:

```text
SPXUSDT
FARTCOINUSDT
BTCUSDT
```

Normalization is handled by `weex.js` and reused by the trading controller.

This is important because TradingView symbols and WEEX symbols do not always use exactly the same notation.

---

# 6. Quantity calculation

The current position-sizing logic is:

```text
Target notional = configured margin × configured leverage
Raw quantity    = target notional / current price
Final quantity  = raw quantity floored to WEEX step size
```

The calculation also checks:

- minimum order size;
- maximum order size;
- maximum market-open size;
- valid price;
- valid step size.

The result includes:

```text
margin
leverage
targetNotional
rawQuantity
quantity
actualNotional
actualMargin
stepSize
```

---

# 7. WEEX step-size retry

The bot intentionally has a retry mechanism for quantity step-size errors.

Some contracts can report a real required `stepSize` through a rejected-order response even when the cached contract information does not match it.

Current behavior:

```text
First order attempt
       |
       v
WEEX rejects because of stepSize
       |
       v
Extract stepSize from WEEX error
       |
       v
Update CONTRACT_INFO[symbol]
       |
       v
Recalculate/format quantity
       |
       v
Retry once
```

Do not remove this retry without a strong reason.

---

# 8. Margin mode and leverage

Before opening a position, `ensureLeverage()`:

1. Reads the configured symbol settings.
2. Checks the WEEX maximum leverage when available.
3. Reads the current WEEX symbol configuration.
4. Verifies that the account is using the required margin mode.
5. Verifies configured isolated LONG/SHORT leverage.
6. Updates leverage when necessary.

The bot does NOT silently convert CROSS to ISOLATED.

If the account is in the wrong margin mode, the operation fails and the account setting must be corrected.

---

# 9. filters/orderBook.js

## Role

This module contains ONLY order-book analysis/filtering.

It must NOT:

- place orders;
- close positions;
- calculate position size;
- decide the TradingView signal direction.

TradingView decides whether the requested action is LONG or SHORT.

The order-book filter only answers:

```text
Does the current WEEX order book support this requested direction?
```

## Current data source

The current `trading.js` integration calls `checkOrderBook()` with the `getOrderBook()` function from `weex.js`.

`weex.js` retrieves the live order book through the WEEX REST market-depth endpoint.

Current execution path:

```text
TradingView LONG/SHORT
        |
        v
trading.js
        |
        v
checkOrderBook()
        |
        v
weex.getOrderBook()
        |
        v
WEEX market/depth
```

Do not document the old WebSocket order-book implementation as the current execution path unless that implementation is actually restored.

---

# 10. Current order-book calculation

The current filter reads bid and ask levels from the WEEX depth response.

It calculates:

```text
Bid liquidity
Ask liquidity
Total liquidity
Bid percentage
Ask percentage
Imbalance
Bid/Ask ratio
Ask/Bid ratio
```

The imbalance formula is:

```text
                  bidLiquidity - askLiquidity
Imbalance = -------------------------------------------
                  bidLiquidity + askLiquidity
```

Interpretation:

```text
+1  = extreme bid dominance
 0  = balanced
-1  = extreme ask dominance
```

The filter therefore treats positive imbalance as bid pressure and negative imbalance as ask pressure.

---

# 11. LONG order-book filter

For a LONG signal, the current implementation checks:

```text
imbalance >= LONG_MIN_IMBALANCE
AND
bidAskRatio >= MIN_BID_ASK_RATIO
```

When both conditions pass:

```text
ORDER_BOOK_SUPPORTS_LONG
```

Otherwise:

```text
ORDER_BOOK_DOES_NOT_SUPPORT_LONG
```

The returned result also contains the raw measurements and individual pass/fail values.

---

# 12. SHORT order-book filter

For a SHORT signal, the current implementation checks:

```text
imbalance <= SHORT_MAX_IMBALANCE
AND
askBidRatio >= MIN_ASK_BID_RATIO
```

When both conditions pass:

```text
ORDER_BOOK_SUPPORTS_SHORT
```

Otherwise:

```text
ORDER_BOOK_DOES_NOT_SUPPORT_SHORT
```

---

# 13. Important distinction: filter vs execution

The order-book filter is an entry gate.

It is NOT the strategy itself.

The architecture is:

```text
Pine Strategy
    |
    | decides LONG / SHORT / CLOSE
    v
TradingView webhook
    |
    v
trading.js
    |
    | asks order-book filter for LONG/SHORT entries
    v
orderBook.js
    |
    | PASS / BLOCK
    v
weex.js
    |
    v
WEEX execution
```

This separation makes it possible to tune order-flow thresholds without changing WEEX execution logic.

---

# 14. CLOSE actions and order-book safety

CLOSE actions are never passed through the order-book filter.

Supported close actions:

```text
CLOSE
CLOSE_LONG
CLOSE_SHORT
```

This is intentional.

If a position needs to be closed, the bot must not require the order book to be favorable before allowing the close.

The rule is:

```text
OPEN LONG/SHORT -> order-book filter applies
CLOSE          -> order-book filter does not apply
```

---

# 15. trading/trading.js

## Role

`trading/trading.js` is the trading controller between TradingView and WEEX.

It handles:

- LONG;
- SHORT;
- CLOSE;
- CLOSE_LONG;
- CLOSE_SHORT;
- live position checks;
- same-direction suppression;
- reversals;
- fresh order-book checks before opening;
- position verification;
- per-symbol concurrency locks;
- order-book statistics.

---

# 16. Same-direction behavior

If TradingView sends LONG while WEEX is already LONG:

```text
LONG signal
    |
    v
Current position = LONG
    |
    v
NO ACTION
```

Likewise, SHORT while already SHORT produces no additional entry order.

This prevents duplicate same-direction positions/orders from repeated alerts.

---

# 17. Flat -> entry behavior

When WEEX reports FLAT and TradingView sends LONG or SHORT:

```text
TradingView signal
       |
       v
Confirm FLAT
       |
       v
Fresh order-book check
       |
       +---- BLOCKED -> remain FLAT
       |
       v
Check balance
       |
       v
Get current price
       |
       v
Calculate quantity
       |
       v
Ensure leverage/margin configuration
       |
       v
Place MARKET order
       |
       v
Confirm WEEX position
```

The position is only considered successfully opened after WEEX confirms the requested direction.

---

# 18. Reversal behavior

When the bot receives the opposite direction while a position is already open, it does NOT immediately open the opposite position.

Correct sequence:

```text
CURRENT POSITION
       |
       v
CLOSE OLD POSITION
       |
       v
WAIT FOR WEEX = FLAT
       |
       v
FRESH ORDER-BOOK CHECK
       |
       +---- BLOCKED -> remain FLAT
       |
       v
OPEN NEW DIRECTION
       |
       v
WAIT FOR WEEX = NEW DIRECTION
```

Example:

```text
Current = LONG
Signal  = SHORT

LONG
 |
v
CLOSE LONG
 |
v
CONFIRM FLAT
 |
v
FRESH SHORT ORDER-BOOK CHECK
 |
v
OPEN SHORT
 |
v
CONFIRM SHORT
```

This is a critical safety behavior and should not be changed casually.

---

# 19. Per-symbol trading locks

`trading.js` uses a lock per symbol.

Example:

```text
BTCUSDT  -> locked
MINAUSDT -> can still process independently
SOLUSDT  -> can still process independently
```

The lock prevents two simultaneous operations for the same symbol from racing with each other.

The lock is intentionally NOT global.

A BTC operation should not block an unrelated MINA or SOL signal.

---

# 20. Real WEEX position is the source of truth

Every trading signal checks the real WEEX position through:

```text
/capi/v3/account/position/singlePosition
```

The bot uses that live result to determine whether the symbol is:

```text
FLAT
LONG
SHORT
```

Do not replace this with local position memory as the final execution authority.

The exchange is the source of truth.

---

# 21. Order-book statistics

`trading.js` records order-book filter results.

Global statistics include:

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

Per-symbol statistics include the same direction breakdown and rejection reasons.

This is useful for measuring how aggressive the filter is in live testing.

For example, the statistics can answer:

```text
How many LONG signals were checked?
How many passed?
How many were blocked?
Which rejection reason caused the blocks?
Which coins are being blocked most often?
```

The statistics reset when `resetOrderBookStats()` is called or when the process restarts, because they are kept in memory.

---

# 22. Order-book rejection behavior

A blocked entry does NOT close an existing position in the normal flat-entry case.

For a FLAT -> LONG/SHORT signal:

```text
Signal
  |
  v
Order book BLOCK
  |
  v
No opening order
  |
  v
Remain FLAT
```

For a reversal:

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
Order book BLOCK
  |
  v
Remain FLAT
```

Therefore a reversal can intentionally end with no position if the fresh order book does not support the new direction.

---

# 23. Current REST request flow

Typical LONG entry flow:

```text
GET  /capi/v3/account/position/singlePosition
GET  /capi/v3/market/depth
GET  /capi/v3/account/balance
GET  /capi/v3/market/ticker/bookTicker
GET  /capi/v3/account/symbolConfig
POST /capi/v3/account/leverage        # only when needed
POST /capi/v3/order                    # MARKET open
GET  /capi/v3/account/position/singlePosition
```

The exact sequence can vary depending on the current position and whether leverage already matches configuration.

Closing uses the live position and a reduce-only MARKET order.

---

# 24. API credentials and security

Do not place WEEX credentials directly into source files.

Use `.env` / configuration variables for:

```text
API_KEY
API_SECRET
API_PASSPHRASE
```

Never commit real credentials to GitHub or paste them into public logs.

The README intentionally does not contain actual credentials.

---

# 25. Useful endpoints

The current V3 server exposes these main operations:

## TradingView webhook

```text
POST /webhook
```

Expected actions include:

```text
LONG
SHORT
CLOSE
CLOSE_LONG
CLOSE_SHORT
```

## Manual LONG

```text
POST /manual-long?symbol=BTCUSDT
```

## Manual SHORT

```text
POST /manual-short?symbol=BTCUSDT
```

## Manual CLOSE

```text
POST /manual-close?symbol=BTCUSDT
```

## Read-only order-book test

```text
GET /test-orderbook?symbol=BTCUSDT&direction=LONG
GET /test-orderbook?symbol=BTCUSDT&direction=SHORT
```

This endpoint must remain read-only.

It must NEVER place an order.

## Status

```text
GET /status
```

## Current position

```text
GET /position?symbol=BTCUSDT
```

## Available symbols

```text
GET /symbols
```

## Refresh contracts

```text
POST /refresh-symbols
```

---

# 26. Testing workflow

When making a code change:

```text
1. Make the smallest change possible.
2. Run syntax checks.
3. Restart server_v3.js.
4. Confirm WEEX contract discovery succeeds.
5. Confirm server status.
6. Test /test-orderbook first.
7. Test /position.
8. Test manual endpoints only when intentionally needed.
9. Then allow TradingView live signals.
```

Recommended syntax checks:

```powershell
node --check server_v3.js
node --check config/config.js
node --check weex/weex.js
node --check filters/orderBook.js
node --check trading/trading.js
node --check utils/logger.js
```

---

# 27. Debugging order-book behavior

When an entry is blocked, inspect the actual logged values:

```text
Direction
Depth levels
Best bid
Best ask
Bid liquidity
Ask liquidity
Bid percentage
Ask percentage
Imbalance
Bid/Ask ratio
Ask/Bid ratio
```

For LONG:

```text
imbalance >= LONG_MIN_IMBALANCE
bidAskRatio >= MIN_BID_ASK_RATIO
```

For SHORT:

```text
imbalance <= SHORT_MAX_IMBALANCE
askBidRatio >= MIN_ASK_BID_RATIO
```

Do not judge the filter only from the final `allowed` value. Look at the individual measurements and pass/fail fields.

---

# 28. Strategy tuning notes

The order-book filter can become too restrictive if its thresholds are too demanding.

A high rejection rate does not automatically mean the filter is working well. It can also mean that valid TradingView setups are being discarded.

When tuning it, compare:

```text
TradingView signals
        |
        +---- accepted by order book
        |
        +---- rejected by order book
        |
        +---- resulting trades
        |
        +---- win/loss outcome
```

Do not change several thresholds simultaneously when trying to understand the effect of one parameter.

Recommended A/B testing approach:

```text
Test A -> current settings
Test B -> change ONE threshold
Compare -> acceptance rate + trade quality
```

The order-book filter should remain a supporting execution filter, not replace the TradingView strategy logic.

---

# 29. Safety rules / Do not break

These rules are important for future code changes.

## 1. Never remove real position verification

WEEX is the source of truth.

## 2. Never filter CLOSE actions through the order book

Closing risk must remain executable even when the order book is unfavorable.

## 3. Reversals must close first

Always:

```text
CLOSE -> CONFIRM FLAT -> FRESH ORDER BOOK -> OPEN -> CONFIRM
```

## 4. Keep per-symbol locks

Prevent duplicate/racing operations for the same symbol without creating a global lock.

## 5. Keep the fast webhook acknowledgement

TradingView should receive HTTP 200 quickly.

## 6. Keep order-book tests read-only

`/test-orderbook` must never place an order.

## 7. Keep automatic symbol discovery

Do not hard-code the full WEEX coin list.

## 8. Preserve step-size retry

WEEX-reported step sizes can differ from cached contract data.

## 9. Do not silently change trading risk

Treat these as explicit strategy/risk changes:

```text
DEFAULT_MARGIN
DEFAULT_LEVERAGE
REQUIRED_MARGIN_MODE
```

## 10. Do not silently change order-book thresholds

Treat these as explicit strategy changes:

```text
ORDER_BOOK_DEPTH
LONG_MIN_IMBALANCE
SHORT_MAX_IMBALANCE
MIN_BID_ASK_RATIO
MIN_ASK_BID_RATIO
```

## 11. Keep V3 separate from V2

`server_v2.js` is an older/backup implementation. Do not overwrite or remove it while working on V3 unless explicitly requested.

## 12. Do not invent WEEX API behavior

Use the actual implementation and WEEX responses when debugging API behavior.

---

# 30. Development principles for future AI/code changes

When another AI works on this project, it should:

1. Read this README before changing architecture.
2. Treat `server_v3.js` as the main entry point.
3. Keep direct WEEX API communication in `weex/weex.js`.
4. Keep order-book calculations in `filters/orderBook.js`.
5. Keep signal orchestration and reversal logic in `trading/trading.js`.
6. Keep configuration in `config/config.js`.
7. Use live WEEX position checks.
8. Preserve per-symbol locks.
9. Preserve fast webhook acknowledgement.
10. Preserve close safety.
11. Preserve step-size retry.
12. Test order-book behavior before live entries.
13. Prefer the smallest testable change over a complete rewrite.
14. Do not silently change trading parameters.
15. Inspect real logs before changing code.

---

# 31. Strategy vs execution boundary

The system has a clear separation:

```text
TRADINGVIEW / PINE
------------------
Generates the trading signal.

        |
        | LONG / SHORT / CLOSE
        v

WEEX BOT
--------
Validates the signal.
Checks the real position.
Applies the entry order-book filter.
Calculates quantity.
Checks leverage/margin configuration.
Places/closes the WEEX order.
Confirms the resulting position.
```

Therefore:

```text
TradingView = SIGNAL GENERATOR
WEEX BOT    = EXECUTION + SAFETY LAYER
```

The order-book filter is part of the WEEX execution/safety layer.

---

# 32. Current architecture baseline

As of the latest update, the baseline files are:

```text
server_v3.js
config/config.js
weex/weex.js
filters/orderBook.js
trading/trading.js
utils/logger.js
```

The current `weex.js` implementation is responsible for WEEX API communication and market execution.

The current `trading.js` implementation is responsible for signal processing, live-position logic, reversal handling, order-book entry checks, and order-book statistics.

The current order-book integration uses the `getOrderBook()` function supplied by `weex.js` and performs a fresh depth request when an entry is evaluated.

---

# Version

```text
SERVER V3
Updated: 2026-08-31
Main entry point: server_v3.js
Execution exchange: WEEX V3 USDT-M Futures
Position source of truth: WEEX live account position
Order-book source: WEEX market depth via weex.js
```

Keep this README updated whenever a major architectural or behavior change is intentionally introduced.
