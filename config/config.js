require("dotenv").config();


// ============================================================
// SERVER
// ============================================================

const PORT =
    Number(
        process.env.PORT || 3000
    );


// ============================================================
// WEEX
// ============================================================

const BASE_URL =
    "https://api-contract.weex.com";

const DEFAULT_MARGIN =
    1;

const DEFAULT_LEVERAGE =
    10;

const REQUIRED_MARGIN_MODE =
    "ISOLATED";


// ============================================================
// TP / SL
// ============================================================
//
// IMPORTANT:
//
// false = TradingView remains responsible for TP/SL/CLOSE
//
// true = WEEX bot is allowed to manage TP/SL
//
// Change these values here instead of modifying
// trading.js or weex.js.
//

const TP_SL_ENABLED =
    true;

const TAKE_PROFIT_PERCENT =
    3.0;

const STOP_LOSS_PERCENT =
    2.0;

const TP_SL_TRIGGER_TYPE =
    "MARK_PRICE";


// ============================================================
// ORDER BOOK FILTER
// ============================================================
//
// The order book is checked using:
//
//     (BID - ASK) / (BID + ASK)
//
// Positive imbalance = BID pressure
// Negative imbalance = ASK pressure
//
// LONG requires BOTH:
//
//     imbalance >= LONG_MIN_IMBALANCE
//     AND
//     bid/ask >= MIN_BID_ASK_RATIO
//
// SHORT requires BOTH:
//
//     imbalance <= SHORT_MAX_IMBALANCE
//     AND
//     ask/bid >= MIN_ASK_BID_RATIO
//
// CLOSE is NEVER blocked by the order-book filter.
//

const ORDER_BOOK_FILTER_ENABLED =
    true;

const ORDER_BOOK_DEPTH =
    200;


// ------------------------------------------------------------
// IMBALANCE THRESHOLDS
// ------------------------------------------------------------

const LONG_MIN_IMBALANCE =
    0.005

const SHORT_MAX_IMBALANCE =
    -0.005



// ------------------------------------------------------------
// RATIO THRESHOLDS
// ------------------------------------------------------------
//
// LONG:
//
//     BID / ASK >= 1.005
//
// SHORT:
//
//     ASK / BID >= 1.005
//

const MIN_BID_ASK_RATIO =
    0.90;

const MIN_ASK_BID_RATIO =
    0.90;


// ============================================================
// ORDER BOOK DEPTH CONFIRMATION
// ============================================================
//
// Four independent depth confirmations:
//
//     15 levels
//     20 levels
//     30 levels
//     60 levels
//
// The trade requires:
//
//     3 OF 4
//
// Therefore:
//
//     4/4 = PASS
//     3/4 = PASS
//     2/4 = BLOCK
//     1/4 = BLOCK
//     0/4 = BLOCK
//
// Each individual depth must pass BOTH:
//
//     imbalance test
//     ratio test
//
// before that depth counts as a confirmation.
//

const ORDER_BOOK_CONFIRMATION_REQUIRED =
    3;


// ============================================================
// TRADING
// ============================================================
//
// This is the MASTER LIVE TRADING SWITCH.
//
// false = no real orders
// true  = real WEEX orders allowed
//

const TRADING_ENABLED =
    process.env.TRADING_ENABLED === "true";


// ============================================================
// AUTOMATIC ORDER-BOOK TRADING
// ============================================================
//
// The automatic trader:
//
// 1. Collects order-flow snapshots
// 2. Builds the configured history
// 3. Waits until the history is complete
// 4. Calculates ONE final decision
// 5. Processes LONG / SHORT / NEUTRAL
// 6. Resets the history
// 7. Starts a completely new cycle
//
// Example:
//
//     AUTO_TRADING_HISTORY_MINUTES = 60
//
// means:
//
//     1/60
//     2/60
//     ...
//     60/60
//     ↓
//     FINAL DECISION
//     ↓
//     RESET
//     ↓
//     0/60
//
// You can test:
//
//     10
//     20
//     30
//     60
//

const AUTO_TRADING_ENABLED =
    true;


// ============================================================
// AUTOMATIC SNAPSHOT INTERVAL
// ============================================================
//
// The automatic trader collects one order-book snapshot
// approximately every 1 minute.
//
// Therefore:
//
//     10 history minutes = 10 snapshots
//     20 history minutes = 20 snapshots
//     30 history minutes = 30 snapshots
//     60 history minutes = 60 snapshots
//
// Keep this at 1 minute for the current design.
//

const AUTO_TRADING_INTERVAL_MS =
    60 * 1000;


// ============================================================
// AUTOMATIC HISTORY LENGTH
// ============================================================
//
// HOW MANY MINUTES / SNAPSHOTS BEFORE A FINAL DECISION?
//
// TEST VALUES:
//
//     10 = 10 minute decision cycle
//     20 = 20 minute decision cycle
//     30 = 30 minute decision cycle
//     60 = 60 minute decision cycle
//
// Recommended live value:
//
//     60
//

const AUTO_TRADING_HISTORY_MINUTES =
    20;


// ============================================================
// MAXIMUM TRADES PER CYCLE
// ============================================================
//
// Prevents one completed history cycle from opening/reversing
// too many positions.
//

const AUTO_TRADING_MAX_TRADES_PER_CYCLE =
    5;


// ============================================================
// SYMBOL DELAY
// ============================================================
//
// Intentional 1-hour delay between actual trades on the
// same symbol.
//
// IMPORTANT:
//
// This does NOT control history collection.
//
// History continues collecting normally.
//
// This only controls how frequently the same symbol can
// execute another trade.
//

const AUTO_TRADING_SYMBOL_DELAY_MS =
    10 * 60 * 1000;


// ============================================================
// AUTOMATIC TRADER SAFETY
// ============================================================
//
// Minimum direction requirement.
//
// true = automatic trader requires a valid LONG or SHORT
//        direction before opening a position.
//

const AUTO_TRADING_REQUIRE_DIRECTION =
    true;


// ============================================================
// LIVE ORDER BOOK DASHBOARD
// ============================================================
//
// Dashboard order book endpoint settings.
//
// The dashboard can request the current order book
// without placing an order.
//

const LIVE_ORDERBOOK_ENABLED =
    true;

const LIVE_ORDERBOOK_DEFAULT_SYMBOL =
    "BTCUSDT";

const LIVE_ORDERBOOK_REFRESH_MS =
    2000;


// ============================================================
// API
// ============================================================

const API_KEY =
    process.env.WEEX_API_KEY;

const API_SECRET =
    process.env.WEEX_API_SECRET;

const API_PASSPHRASE =
    process.env.WEEX_API_PASSPHRASE;


// ============================================================
// EXPORTS
// ============================================================

module.exports = {

    // --------------------------------------------------------
    // SERVER
    // --------------------------------------------------------

    PORT,


    // --------------------------------------------------------
    // WEEX
    // --------------------------------------------------------

    BASE_URL,

    DEFAULT_MARGIN,

    DEFAULT_LEVERAGE,

    REQUIRED_MARGIN_MODE,


    // --------------------------------------------------------
    // TP / SL
    // --------------------------------------------------------

    TP_SL_ENABLED,

    TAKE_PROFIT_PERCENT,

    STOP_LOSS_PERCENT,

    TP_SL_TRIGGER_TYPE,


    // --------------------------------------------------------
    // ORDER BOOK
    // --------------------------------------------------------

    ORDER_BOOK_FILTER_ENABLED,

    ORDER_BOOK_DEPTH,

    LONG_MIN_IMBALANCE,

    SHORT_MAX_IMBALANCE,

    MIN_BID_ASK_RATIO,

    MIN_ASK_BID_RATIO,

    ORDER_BOOK_CONFIRMATION_REQUIRED,


    // --------------------------------------------------------
    // TRADING
    // --------------------------------------------------------

    TRADING_ENABLED,


    // --------------------------------------------------------
    // AUTOMATIC ORDER-BOOK TRADING
    // --------------------------------------------------------

    AUTO_TRADING_ENABLED,

    AUTO_TRADING_INTERVAL_MS,

    AUTO_TRADING_HISTORY_MINUTES,

    AUTO_TRADING_MAX_TRADES_PER_CYCLE,

    AUTO_TRADING_SYMBOL_DELAY_MS,

    AUTO_TRADING_REQUIRE_DIRECTION,


    // --------------------------------------------------------
    // LIVE ORDER BOOK DASHBOARD
    // --------------------------------------------------------

    LIVE_ORDERBOOK_ENABLED,

    LIVE_ORDERBOOK_DEFAULT_SYMBOL,

    LIVE_ORDERBOOK_REFRESH_MS,


    // --------------------------------------------------------
    // API
    // --------------------------------------------------------

    API_KEY,

    API_SECRET,

    API_PASSPHRASE

};

