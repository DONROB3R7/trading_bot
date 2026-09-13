# TradingView → WEEX Bot V3

**Status:** Active Development  
**Version:** SERVER V3  
**Last Updated:** 2026-09-04  
**Main Entry Point:** `server_v3.js`  
**Execution Exchange:** WEEX V3 USDT-M Futures  
**Position Source of Truth:** Live WEEX account position  
**Order-Book Source:** WEEX REST market depth via `weex.js`

---

## 1. Documentation Split

This project documentation is intentionally split into two files:

- **`README.md`** — architecture, modules, server/API behavior, configuration, development and safety rules.
- **`README_TRADING.md`** — detailed trading behavior, order-flow confirmation, entries, reversals, TP/SL protection, automatic history trading and dashboard concepts.

Both files describe the same SERVER V3 baseline and should be updated together when a major behavior or architecture change is introduced.

---

# 2. Project Overview

This project receives trading signals from a TradingView Pine strategy through webhooks and executes them on WEEX V3 USDT-M futures.

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

Core principle:

```text
TradingView = SIGNAL GENERATOR
WEEX BOT    = EXECUTION + SAFETY LAYER
```

TradingView determines the requested trading direction. The bot validates and executes that request against the real exchange state.

The bot is responsible for:

- validating signals;
- normalizing symbols;
- checking the real exchange position;
- filtering new entries using order-book data;
- calculating position size;
- checking margin/leverage configuration;
- executing orders;
- confirming resulting exchange positions;
- protecting confirmed positions with TP/SL when enabled;
- safely handling reversals;
- preventing duplicate/racing operations;
- running the automatic managed-symbol/history-cycle process.

The bot does **not** use local position memory as the final source of truth. The actual WEEX account position is authoritative.

---

# 3. Project Structure

```text
toobit-bot/
|
├── server_v3.js
│   └── Main Express server / TradingView webhook receiver
|
├── config/
│   └── config.js
│       └── Central configuration and environment variables
|
├── weex/
│   └── weex.js
│       └── WEEX API communication and execution
|
├── filters/
│   └── orderBook.js
│       └── Order-book analysis and entry filtering
|
├── trading/
│   └── trading.js
│       └── Signal processing, position logic, automatic trading and statistics
|
├── utils/
│   └── logger.js
│       └── Console/log helpers
|
├── .env
│   └── API credentials and runtime configuration
|
├── README.md
│   └── Main architecture/development documentation
|
└── README_TRADING.md
    └── Detailed trading/execution documentation
```

The architecture should remain simple. Do not split `weex.js` or `trading.js` into many additional files unless there is a real technical or maintenance reason.

---

# 4. Module Responsibilities

| Module | Main Responsibility | Must Not Own |
|---|---|---|
| `server_v3.js` | HTTP, webhook, endpoints, automatic trader orchestration | Low-level WEEX order logic |
| `config/config.js` | Configuration | Trading execution |
| `weex/weex.js` | WEEX API, authentication, market/account data and execution | Strategy decisions |
| `filters/orderBook.js` | Order-book analysis and multi-depth confirmation | Order placement |
| `trading/trading.js` | Signal orchestration, position logic, reversals, locks, automatic trading and statistics | Low-level API signing |
| `utils/logger.js` | Logging | Trading decisions |

This responsibility boundary is a core V3 design rule.

---

# 5. server_v3.js

`server_v3.js` is the main HTTP application and entry point.

It is responsible for:

- starting Express;
- loading configuration;
- receiving TradingView webhooks;
- normalizing incoming symbols/actions;
- validating incoming signals;
- returning an immediate HTTP `200`;
- passing valid signals to `trading.js`;
- exposing status endpoints;
- exposing position endpoints;
- exposing symbol information;
- exposing manual trading endpoints;
- exposing read-only order-book testing;
- loading available WEEX USDT-M contracts at startup;
- running the automatic managed-symbol trading cycle.

## Architecture Rule

`server_v3.js` must stay thin.

It should not contain:

- detailed WEEX order placement logic;
- quantity calculation logic;
- HMAC/API signing implementation;
- order-book calculation logic;
- detailed reversal logic.

Those responsibilities belong to the appropriate modules.

---

# 6. TradingView Webhook Flow

```text
TradingView
    |
    v
POST /webhook
    |
    +----> Immediate HTTP 200
    |
    v
Background processing
    |
    v
trading.js
    |
    v
WEEX
```

The webhook acknowledgement should happen quickly. Slow WEEX requests must not unnecessarily delay TradingView's HTTP response.

---

# 7. Supported TradingView Actions

```text
LONG
SHORT
CLOSE
CLOSE_LONG
CLOSE_SHORT
```

The direction is generated by TradingView. The WEEX bot does not attempt to replace the TradingView strategy.

---

# 8. config/config.js

`config/config.js` is the central configuration layer.

Important configuration values include:

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
ORDER_BOOK_CONFIRMATION_REQUIRED
TP_SL_ENABLED
TAKE_PROFIT_PERCENT
STOP_LOSS_PERCENT
TP_SL_TRIGGER_TYPE
AUTO_TRADING_MAX_TRADES_PER_CYCLE
```

Current order-book architecture:

```text
ORDER_BOOK_DEPTH = 200
CONFIRMATION_DEPTHS = [15, 20, 30, 60]
ORDER_BOOK_CONFIRMATION_REQUIRED = 3
CONFIRMATION_RULE = 3_OF_4
```

The exact numeric thresholds are controlled by the current `config.js`. Do not copy historical threshold values into documentation and treat them as current configuration unless verified.

---

# 9. Risk Model

Position sizing follows:

```text
Target Notional = Configured Margin × Configured Leverage

Raw Quantity = Target Notional / Current Price

Final Quantity = Raw Quantity adjusted/floored to WEEX step size
```

The final calculation also checks contract limits, minimum order size, maximum order size, valid price and valid step size.

Current execution model requires the configured margin mode, with the baseline using ISOLATED margin. Exact margin and leverage values are controlled by `config.js`.

Changing these values is an explicit trading-risk change:

```text
DEFAULT_MARGIN
DEFAULT_LEVERAGE
REQUIRED_MARGIN_MODE
```

They must not be changed silently during unrelated code modifications.

---

# 10. weex/weex.js

`weex/weex.js` contains direct communication with WEEX.

Responsibilities include:

- HMAC SHA256 request signing;
- Base64 signatures;
- public market requests;
- authenticated account requests;
- symbol normalization;
- contract discovery;
- contract information caching;
- ticker/price lookup;
- order-book retrieval;
- futures balance lookup;
- live position lookup;
- symbol configuration lookup;
- margin-mode verification;
- leverage verification/update;
- quantity calculation;
- quantity step-size handling;
- market opening orders;
- market closing orders;
- TP/SL placement;
- position verification;
- waiting for exchange state changes.

API communication remains centralized here.

---

# 11. WEEX API Authentication

Authenticated requests use the configured WEEX API credentials and signing implementation in `weex.js`.

```text
ACCESS-KEY
ACCESS-SIGN
ACCESS-PASSPHRASE
ACCESS-TIMESTAMP
```

The signing implementation must remain inside `weex.js`.

API credentials must never be hard-coded into source files.

---

# 12. Environment Variables

Sensitive credentials are loaded through `.env` / environment configuration.

Typical credentials include:

```text
API_KEY
API_SECRET
API_PASSPHRASE
```

Never:

- commit real API credentials to GitHub;
- put API keys directly into JavaScript;
- paste real credentials into public logs;
- include secrets in this README.

---

# 13. Automatic Contract Discovery

The bot automatically discovers available WEEX USDT-M contracts.

```text
WEEX exchangeInfo
       |
       v
USDT quote/margin contracts
       |
       v
Optional apiTradingSymbols validation
       |
       v
SUPPORTED_SYMBOLS + CONTRACT_INFO
```

The bot does not require a manually maintained list of every supported WEEX coin.

Do not replace automatic contract discovery with a hard-coded coin list unless explicitly requested.

---

# 14. Symbol Normalization

TradingView may send symbols such as:

```text
SPXUSDT.P
FARTCOINUSDT.P
BINANCE:BTCUSDT.P
```

The bot normalizes these into WEEX-compatible symbols:

```text
SPXUSDT
FARTCOINUSDT
BTCUSDT
```

Normalization is handled by `weex.js` and reused by the trading controller.

---

# 15. Quantity Calculation and Step-Size Retry

Quantity follows the current contract's rules and is adjusted to the WEEX step size.

The bot also preserves a one-time step-size retry:

```text
First Order Attempt
        |
        v
WEEX rejects due to stepSize
        |
        v
Extract stepSize from WEEX error
        |
        v
Update CONTRACT_INFO[symbol]
        |
        v
Recalculate quantity
        |
        v
Retry once
```

Do not remove this retry without a strong technical reason.

---

# 16. Margin Mode and Leverage

Before opening a position, the bot verifies the required trading configuration.

General process:

```text
1. Read configured symbol settings.
2. Check maximum leverage when available.
3. Read current WEEX symbol configuration.
4. Verify required margin mode.
5. Verify LONG leverage.
6. Verify SHORT leverage.
7. Update leverage if required.
```

If the required margin mode is ISOLATED and the current mode is CROSS, the operation must fail rather than silently converting the account mode.

---

# 17. Order-Book Module Boundary

`filters/orderBook.js` answers one question:

```text
Does the current WEEX order book support the requested entry direction?
```

It must not:

- place orders;
- close positions;
- calculate position size;
- determine the TradingView signal;
- perform reversal logic.

The detailed order-book rules are documented in `README_TRADING.md`.

---

# 18. Entry Filter Boundary

The order-book system is an additional execution gate, not the strategy itself.

```text
TradingView / Pine
        |
        | LONG / SHORT / CLOSE
        v
server_v3.js
        |
        v
trading.js
        |
        | ENTRY ONLY
        v
orderBook.js
        |
        | PASS / BLOCK
        v
weex.js
        |
        v
WEEX
```

TradingView remains responsible for the strategy signal.

---

# 19. CLOSE Safety

CLOSE actions never require favorable order-book conditions.

```text
OPEN LONG/SHORT -> Order-book filter applies
CLOSE           -> Order-book filter bypassed
```

Supported close actions:

```text
CLOSE
CLOSE_LONG
CLOSE_SHORT
```

Closing risk takes priority over entry filtering.

---

# 20. Live WEEX Position Source of Truth

The bot checks the actual WEEX position before execution decisions.

The exchange position is interpreted as:

```text
FLAT
LONG
SHORT
```

Local variables may be used for orchestration, but they are never the final authority.

This protects against:

- server restarts;
- missed webhooks;
- manually changed exchange positions;
- rejected orders;
- partially completed operations;
- external exchange changes.

---

# 21. Trading Controller

`trading/trading.js` handles:

- LONG / SHORT / CLOSE actions;
- live position checks;
- same-direction suppression;
- reversals;
- fresh entry order-book checks;
- multi-depth confirmation;
- position confirmation;
- per-symbol locks;
- order-book statistics;
- automatic order-flow history decisions;
- confirmed-position TP/SL protection.

Detailed execution behavior is documented in `README_TRADING.md`.

---

# 22. Manual Trading Endpoints

Manual endpoints are routed through the same V3 controller/execution layer.

```text
POST /manual-long?symbol=BTCUSDT
POST /manual-short?symbol=BTCUSDT
POST /manual-close?symbol=BTCUSDT
```

These can create real trades and must be used intentionally.

---

# 23. Read-Only Order-Book Testing

```text
GET /test-orderbook?symbol=BTCUSDT&direction=LONG
GET /test-orderbook?symbol=BTCUSDT&direction=SHORT
```

The endpoint is strictly read-only. It may retrieve data and calculate/report the filter, but must never open, close or reverse a position.

Useful reporting includes:

```text
depth15
depth20
depth30
depth60
passedDepths
failedDepths
passedCount
confirmationRequired
confirmationPassed
confirmationRule
```

---

# 24. Status / Position / Symbols / Refresh Endpoints

```text
GET  /status
GET  /position?symbol=BTCUSDT
GET  /symbols
POST /refresh-symbols
```

`/position` reflects live WEEX state. `/symbols` and `/refresh-symbols` operate on the automatic contract-discovery state.

---

# 25. Testing Workflow

After a code change:

```text
1. Make the smallest change possible.
2. Run syntax checks.
3. Restart server_v3.js.
4. Confirm WEEX contract discovery succeeds.
5. Confirm /status.
6. Test /test-orderbook first.
7. Verify 15 / 20 / 30 / 60.
8. Confirm the 3-of-4 decision.
9. Test /position.
10. Test manual endpoints only when intentionally required.
11. Review logs.
12. Only then allow TradingView live signals.
```

---

# 26. JavaScript Syntax Checks

```powershell
node --check server_v3.js
node --check config/config.js
node --check weex/weex.js
node --check filters/orderBook.js
node --check trading/trading.js
node --check utils/logger.js
```

For important changes, check all V3 JavaScript files.

---

# 27. Debugging Philosophy

Do not immediately rewrite the system when something behaves unexpectedly.

First determine:

```text
1. What signal did TradingView send?
2. What symbol reached the server?
3. How was the symbol normalized?
4. What position did WEEX report?
5. Was the operation an entry, close or reversal?
6. Was the order-book filter executed?
7. What values were returned?
8. What happened at 15 levels?
9. What happened at 20 levels?
10. What happened at 30 levels?
11. What happened at 60 levels?
12. How many confirmations passed?
13. Why did 3-of-4 pass or fail?
14. Was balance sufficient?
15. What quantity was calculated?
16. Was leverage/margin valid?
17. What did WEEX return?
18. What position did WEEX report after execution?
19. If automatic trading was involved, was the history cycle complete?
20. Was the per-cycle trade cap reached?
```

Use actual logs and exchange responses to identify the failing layer before changing code.

---

# 28. Development Principles

1. Read both README files before modifying architecture.
2. Identify which module owns the behavior.
3. Make the smallest practical change.
4. Avoid unnecessary rewrites.
5. Keep `server_v3.js` thin.
6. Keep WEEX API communication in `weex.js`.
7. Keep order-book calculations in `orderBook.js`.
8. Keep signal/trading orchestration in `trading.js`.
9. Keep configuration in `config.js`.
10. Use live WEEX position verification.
11. Preserve per-symbol locks.
12. Preserve fast webhook acknowledgement.
13. Preserve close safety.
14. Preserve step-size retry.
15. Keep `/test-orderbook` read-only.
16. Test order-book behavior before live entries.
17. Do not silently modify trading parameters.
18. Inspect actual logs before changing filters.
19. Prefer incremental changes over rewrites.
20. Keep all confirmation depths derived from one 200-level snapshot.
21. Preserve the 3-of-4 confirmation rule unless explicitly changing strategy behavior.
22. Preserve TP/SL safety behavior.
23. Preserve persistent `managedSymbols` behavior.
24. Update both README files whenever a major intentional behavior or architecture change is introduced.

---

# 29. Safety Rules

The following are protected V3 behaviors:

- Never replace live WEEX position verification with local state.
- Never filter CLOSE through order book.
- Reversals close first, confirm FLAT, then evaluate the new direction.
- Keep per-symbol locks; do not introduce a global lock casually.
- Keep webhook acknowledgement fast.
- Keep `/test-orderbook` read-only.
- Keep automatic contract discovery.
- Keep step-size retry.
- Do not silently change margin, leverage or margin mode.
- Do not silently change order-book thresholds or confirmation depths.
- Keep one 200-level snapshot for 15/20/30/60 confirmation.
- Keep 3-of-4 confirmation.
- Keep V2 separate from V3.
- Do not invent WEEX API behavior.
- Do not remove confirmed-position TP/SL protection when it is enabled.
- Do not delete `managedSymbols` merely because a live position is temporarily FLAT.

---

# 30. V2 Separation

`server_v2.js` is an older/backup implementation.

Do not overwrite, delete or merge V2 into V3 unless explicitly requested.

---

# 31. Future AI / Code Changes Must Not Do

Future modifications must not casually:

```text
- replace WEEX position checks with local state;
- remove per-symbol locks;
- add a global trading lock;
- filter CLOSE through order book;
- open a new direction before closing the old one;
- remove reversal confirmation;
- remove step-size retry;
- replace automatic contract discovery with a static list;
- move HMAC signing into trading.js;
- move order-book calculations into server_v3.js;
- put order placement into orderBook.js;
- make /test-orderbook execute trades;
- silently change margin/leverage/margin mode;
- silently change order-book thresholds;
- silently change confirmation depths;
- silently change the 3-of-4 rule;
- request four separate order books when one 200-level snapshot is sufficient;
- delete managedSymbols merely because a symbol is currently FLAT;
- confuse historical decision counts with actual completed trades/P&L;
- merge V2 into V3;
- perform a large rewrite when a small fix is sufficient.
```

---

# 32. Version History

## SERVER V3 — 2026-08-31

Established the current V3 architecture:

- `server_v3.js` as main entry point;
- fast TradingView HTTP acknowledgement;
- trading controller in `trading.js`;
- WEEX API/execution in `weex.js`;
- order-book calculations in `orderBook.js`;
- centralized configuration;
- live WEEX position as source of truth;
- automatic contract discovery;
- symbol normalization;
- quantity/contract validation;
- step-size retry;
- leverage/margin verification;
- entry-only order-book filtering;
- CLOSE bypass;
- same-direction suppression;
- close-first reversals;
- per-symbol locks;
- in-memory order-book statistics;
- read-only `/test-orderbook`;
- V2 kept separate.

## SERVER V3 — 2026-09-02

### Multi-Depth Order-Book Confirmation

Previous:

```text
15 / 30 / 60 / 90
```

Current:

```text
15 / 20 / 30 / 60
```

The 90-level confirmation was replaced by 20 levels.

The four tests are derived from one fresh 200-level snapshot and require 3 of 4 depth confirmations. CLOSE actions remain unaffected.

## SERVER V3 — 2026-09-03

### Confirmed-Position TP/SL Protection

TP/SL protection was integrated into the confirmed-position workflow.

New safety sequence:

```text
OPEN MARKET ORDER
      |
      v
CONFIRM LIVE WEEX POSITION
      |
      v
USE ACTUAL avgPrice
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

If protection cannot be completed, the controller attempts an emergency close so an unprotected live position is not intentionally left open.

TP/SL behavior is controlled by:

```text
TP_SL_ENABLED
TAKE_PROFIT_PERCENT
STOP_LOSS_PERCENT
TP_SL_TRIGGER_TYPE
```

## SERVER V3 — 2026-09-04

### Automatic History-Cycle Trading / Dashboard Semantics

Automatic order-flow history decisions now operate on **completed history cycles**.

The automatic flow is:

```text
COMPLETED HISTORY CYCLE
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

`AUTO_TRADING_MAX_TRADES_PER_CYCLE` is now configured as:

```text
5
```

This means **maximum executed trades per completed cycle**, not exactly five symbols.

Dashboard semantics are explicitly separated:

```text
FINAL DECISION SESSION
= historical completed-cycle decisions

BOT GAS TANK
= actual completed positions + realized P/L
```

NEUTRAL decisions are not trades and must not be counted as realized P/L.

### Managed Symbol Persistence

`managedSymbols` is a persistent monitoring/management list. A symbol must not be deleted merely because its current WEEX position is FLAT.

The automatic trader uses live WEEX positions to determine whether positions are actually active.

### Documentation Split

The documentation was split into:

```text
README.md
README_TRADING.md
```

The split separates general architecture/development information from detailed trading/execution behavior.

---

# 33. Final Architecture

```text
                         TRADINGVIEW
                              |
                              |
                     LONG / SHORT / CLOSE
                              |
                              v
                     +----------------+
                     | server_v3.js   |
                     |                |
                     | HTTP/Webhook   |
                     +-------+--------+
                             |
                             v
                     +----------------+
                     | trading.js     |
                     |                |
                     | Position logic |
                     | Reversals      |
                     | Locks          |
                     | Auto trading   |
                     | Statistics     |
                     +---+--------+---+
                         |        |
                ENTRY ONLY|        | WEEX
                         v        v
                  +-----------+ +-----------+
                  | orderBook | |  weex.js  |
                  |           | |           |
                  | 15        | | API Auth  |
                  | 20        | | Balance   |
                  | 30        | | Position  |
                  | 60        | | Quantity  |
                  | 3 OF 4    | | Orders    |
                  +-----------+ | TP/SL     |
                                +-----+-----+
                                      |
                                      v
                                +-----------+
                                |  WEEX V3  |
                                | USDT-M     |
                                | FUTURES    |
                                +-----------+
```

Final responsibility boundary:

```text
TRADINGVIEW
    = Signal Generation

SERVER V3
    = HTTP + Webhook Transport + Automatic Cycle Orchestration

TRADING.JS
    = Trading Controller + Safety Logic + Automatic Trading

ORDERBOOK.JS
    = Entry Market-Depth Filter
      15 / 20 / 30 / 60
      3 OF 4 CONFIRMATION

WEEX.JS
    = Exchange API + Execution + Position Protection

WEEX
    = Final Position State
```

---

# 34. Current Baseline

```text
SERVER V3

Main entry point:
server_v3.js

Execution exchange:
WEEX V3 USDT-M Futures

Position source of truth:
WEEX live account position

Order-book source:
WEEX REST market depth via weex.js

Order-book snapshot:
200 levels

Confirmation depths:
15 / 20 / 30 / 60

Confirmation rule:
3 OF 4

Entry filter:
filters/orderBook.js

Configuration:
config/config.js

Trading controller:
trading/trading.js

Logging:
utils/logger.js

TP/SL:
Confirmed live-position protection when enabled

Automatic history trading:
Completed cycles only

Maximum automatic trades per cycle:
5

Managed symbols:
Persistent monitoring/management list

V2:
Kept separate as legacy/backup implementation
```

For detailed trading behavior, see **`README_TRADING.md`**.
