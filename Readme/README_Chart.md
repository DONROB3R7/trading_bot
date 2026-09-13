# WEEX Bot V3

A modular WEEX trading system where **Server V3 is the controller** and individual trading strategies are independent bot modules.

The goal is to make it possible to test different trading ideas without rebuilding the whole application.

---

# 1. Main Idea

The project has one central controller:

```text
SERVER V3
```

Server V3 does not decide whether a trade should be LONG or SHORT.

Instead, Server V3 controls the selected bot.

Example:

```text
Dashboard
    ↓
Select Bot
    ↓
Price V1
    ↓
Signal
    ↓
Server V3
    ↓
WEEX
```

or:

```text
Dashboard
    ↓
Select Bot
    ↓
Order Book V3
    ↓
Signal
    ↓
Server V3
    ↓
WEEX
```

The important idea is:

> **The bot decides. Server V3 controls. WEEX confirms the real position.**

---

# 2. Current Bots

The project will initially contain two independent strategies.

## Price V1

Price V1 uses WEEX candle/price data.

It is currently the experimental replacement for the old order-book entry system.

Price V1:

```text
WEEX candles
    ↓
200-candle trend
    ↓
15 / 20 / 30 / 60 candle confirmations
    ↓
3 of 4 confirmation
    ↓
LONG / SHORT / NEUTRAL
```

Current basic configuration:

```text
TREND_CANDLES = 200
TREND_REQUIRED = 53%

ENTRY_WINDOWS = 15, 20, 30, 60
ENTRY_REQUIRED = 50%

ENTRY_CONFIRMATIONS_REQUIRED = 3

CYCLE_LENGTH = 10 candles
CYCLE_DECISION = 6 of 10
```

Price V1 is currently intended to be used as a **trade signal only**.

No wall system.

No dynamic SL/TP system.

No TradingView.

No additional strategy logic.

The immediate goal is simply:

> Can Price V1 trade successfully as the old order-book signal did?

---

# 3. Order Book V3

The existing order-book strategy remains available as another bot.

Its current architecture uses:

```text
Fresh WEEX 200-level order book
        ↓
15 / 20 / 30 / 60 levels
        ↓
3 of 4 confirmation
        ↓
LONG / SHORT / NEUTRAL
```

The order-book strategy should remain independent from Price V1.

This allows both strategies to be tested separately.

---

# 4. No TradingView

TradingView is NOT part of the new architecture.

The bots receive their information directly from WEEX.

```text
WEEX market data
       ↓
Selected Bot
       ↓
Signal
       ↓
Server V3
       ↓
WEEX execution
```

There is no TradingView webhook requirement.

---

# 5. Server V3 = Control Center

`server_v3.js` should become the stable central controller.

It should handle things such as:

* starting/stopping bots
* selecting the active bot
* receiving dashboard commands
* managing configuration
* exposing status APIs
* coordinating WEEX communication
* checking live WEEX positions
* protecting execution
* logging
* managing bot lifecycle

Server V3 should NOT contain the strategy logic for every bot.

Avoid this:

```text
server_v3.js

if (bot === "price") {
    // 300 lines of Price V1
}

if (bot === "orderbook") {
    // 500 lines of Order Book V3
}

if (bot === "random") {
    // another 400 lines
}
```

That becomes difficult to maintain.

Instead:

```text
server_v3.js
      ↓
Bot Manager
      ↓
Selected Bot
```

---

# 6. Bot Modules

All trading strategies should live inside a `bot/` directory.

Example:

```text
bot/
├── bot_pricev1.js
├── bot_orderbookv3.js
└── bot_random.js
```

Each bot should follow the same basic interface.

Conceptually:

```text
START
STOP
GET STATUS
PROCESS SYMBOL
GET SIGNAL
GET CONFIG
```

The exact implementation can be decided when we build the modules.

The important rule is:

> Every bot speaks the same language to Server V3.

This allows Server V3 to treat different strategies consistently.

---

# 7. Future Bots

Adding another trading idea should eventually be as simple as creating another file.

For example:

```text
bot/
├── bot_pricev1.js
├── bot_orderbookv3.js
├── bot_momentum.js
├── bot_breakout.js
└── bot_random.js
```

Then the dashboard can expose:

```text
BOT

[ Price V1       ▼ ]

Price V1
Order Book V3
Momentum
Breakout
Random Bot
```

The goal is that adding a new strategy does NOT require rebuilding the entire server.

---

# 8. Dashboard

The dashboard becomes the control panel.

The first important control is:

```text
ACTIVE BOT

[ Price V1 ▼ ]
```

Possible options:

```text
Price V1
Order Book V3
```

Later:

```text
Price V1
Order Book V3
Momentum
Breakout
My New Bot
```

The dashboard should also show:

```text
BOT STATUS
Running / Stopped

ACTIVE BOT
Price V1

SYMBOL
POLUSDT

SIGNAL
LONG

POSITION
LONG

ENTRY
...

SL
...

TP
...

BOT ACTIVITY
...

TRADES
...

WIN / LOSS
...
```

The dashboard is for controlling and observing the system.

The strategy calculations should remain inside the selected bot module.

---

# 9. Proposed Project Structure

The project should gradually move toward:

```text
weex-bot-v3/
│
├── server_v3.js
│
├── config/
│   └── config.js
│
├── bot/
│   ├── bot_pricev1.js
│   ├── bot_orderbookv3.js
│   └── bot_manager.js
│
├── weex/
│   └── weex.js
│
├── trading/
│   └── trading.js
│
├── filters/
│   ├── orderBook.js
│   └── orderFlowHistory.js
│
├── services/
│   ├── managedSymbols.js
│   └── automaticTrader.js
│
├── dashboard/
│   ├── index.html
│   ├── dashboard.css
│   ├── dashboard.js
│   └── dashboard-dynamic.js
│
├── chart/
│   ├── chart.html
│   ├── chart.css
│   └── chart.js
│
├── utils/
│   └── logger.js
│
└── package.json
```

This is the target direction.

We do NOT need to restructure everything immediately.

---

# 10. Important Separation

There are four different responsibilities.

## Server

```text
CONTROL
```

Server V3 manages the application.

---

## Bot

```text
STRATEGY
```

The selected bot decides:

```text
LONG
SHORT
NEUTRAL
```

---

## Trading Controller

```text
EXECUTION SAFETY
```

The trading controller handles:

* live position checking
* same-direction protection
* reversal handling
* position confirmation
* TP/SL protection
* emergency close
* per-symbol locks
* actual WEEX state

---

## WEEX

```text
REALITY
```

WEEX is the source of truth for the actual position.

---

# 11. Example Flow

If the dashboard selects:

```text
Price V1
```

the system becomes:

```text
Dashboard
    ↓
Server V3
    ↓
Bot Manager
    ↓
bot_pricev1.js
    ↓
LONG
    ↓
Trading Controller
    ↓
Check WEEX position
    ↓
Execute LONG
    ↓
Confirm WEEX position
```

If the user changes to:

```text
Order Book V3
```

the flow becomes:

```text
Dashboard
    ↓
Server V3
    ↓
Bot Manager
    ↓
bot_orderbookv3.js
    ↓
LONG / SHORT / NEUTRAL
    ↓
Trading Controller
    ↓
WEEX
```

The execution layer does not care which bot generated the signal.

That is the important part.

---

# 12. Bot Contract

Every bot should eventually return a common signal format.

Example:

```js
{
    signal: "LONG",
    symbol: "POLUSDT",
    reason: "PRICE_V1_TREND_CONFIRMED",
    confidence: 54.21
}
```

Or:

```js
{
    signal: "SHORT",
    symbol: "POLUSDT",
    reason: "ORDERBOOK_3_OF_4",
    confidence: 62.40
}
```

NEUTRAL:

```js
{
    signal: "NEUTRAL",
    symbol: "POLUSDT",
    reason: "NO_CONFIRMATION",
    confidence: 49.20
}
```

The exact fields can evolve.

The important thing is that Server V3 receives a common result.

---

# 13. What We Should NOT Do Yet

Do not add everything at once.

For now:

### DO

* create clean bot structure
* preserve working Server V3
* preserve working WEEX communication
* preserve working trading safety
* add Price V1 as a bot
* keep Order Book V3 as a bot
* add dashboard bot selector
* test one bot at a time

### DO NOT

* add React
* add wall detection
* add dynamic SL/TP
* add complicated portfolio management
* rewrite the entire backend
* mix Price V1 and Order Book V3 together
* add more indicators just because they exist
* redesign working execution code unnecessarily

---

# 14. React

React is intentionally postponed.

The current dashboard already works with:

```text
HTML
CSS
JavaScript
```

That is enough for now.

React would introduce:

```text
React
Node build system
components
state management
API integration
new project structure
```

That is unnecessary complexity while the trading architecture itself is still changing.

If the dashboard eventually becomes large enough, React can be introduced later.

It should be a UI decision, not a trading-architecture requirement.

---

# 15. Development Strategy

We build this one step at a time.

## Step 1

Freeze the current working version in Git.

This becomes:

```text
WORKING BASELINE
```

Do not modify it until it is safely committed.

---

## Step 2

Create the bot directory.

```text
bot/
```

No major behavior changes yet.

---

## Step 3

Create the common bot interface.

```text
bot_manager.js
```

Server V3 asks the manager:

```text
Which bot is active?
```

---

## Step 4

Move/implement Price V1 as:

```text
bot/bot_pricev1.js
```

The bot produces:

```text
LONG
SHORT
NEUTRAL
```

---

## Step 5

Put the existing Order Book V3 logic behind:

```text
bot/bot_orderbookv3.js
```

Do not rewrite its logic unnecessarily.

---

## Step 6

Add dashboard selector:

```text
[ Price V1 ▼ ]
```

The dashboard tells Server V3 which bot to use.

---

## Step 7

Test:

```text
Price V1 → trade
```

Then:

```text
Order Book V3 → trade
```

Separately.

---

# 16. Long-Term Architecture

Eventually the project should look like:

```text
                    ┌────────────────────┐
                    │     DASHBOARD      │
                    │                    │
                    │  Select Bot        │
                    │  Start / Stop      │
                    │  Configure         │
                    │  Statistics        │
                    └─────────┬──────────┘
                              │
                              ▼
                    ┌────────────────────┐
                    │     SERVER V3      │
                    │                    │
                    │   CONTROL CENTER   │
                    └─────────┬──────────┘
                              │
                         BOT MANAGER
                              │
             ┌────────────────┼────────────────┐
             │                │                │
             ▼                ▼                ▼
      ┌────────────┐   ┌──────────────┐   ┌────────────┐
      │ Price V1   │   │ Order Book   │   │ Future Bot │
      │            │   │ V3           │   │            │
      └─────┬──────┘   └──────┬───────┘   └─────┬──────┘
            │                 │                 │
            └─────────────────┼─────────────────┘
                              ▼
                    LONG / SHORT / NEUTRAL
                              │
                              ▼
                    ┌────────────────────┐
                    │  TRADING CONTROLLER│
                    │                    │
                    │  Safety            │
                    │  Position checks   │
                    │  Reversal          │
                    │  TP / SL           │
                    └─────────┬──────────┘
                              │
                              ▼
                         ┌─────────┐
                         │  WEEX   │
                         └─────────┘
```

---

# 17. Main Philosophy

The project should not become one giant bot.

Instead:

```text
SERVER = CONTROL
BOT = IDEA
TRADING = SAFETY
WEEX = REAL STATE
DASHBOARD = CONTROL PANEL
```

Adding a new trading idea should eventually mean:

```text
create:

bot/bot_newidea.js
```

implement the common bot interface,

add it to the bot list,

and select it from the dashboard.

That is the architecture we are aiming for.

---

# 18. Current Priority

For the next development phase:

```text
1. Save current working version to Git
2. Create modular bot structure
3. Keep Server V3 as controller
4. Add Price V1 bot
5. Add Order Book V3 bot
6. Add dashboard bot dropdown
7. Test Price V1 trading independently
8. Test Order Book V3 independently
```

Everything else can wait.

The immediate objective is **not to build the perfect trading system**.

The immediate objective is:

> **Make it easy to plug in different trading ideas without breaking the rest of the system.**
