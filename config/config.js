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
    2.0;

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
// LONG:
//     imbalance >= LONG_MIN_IMBALANCE
//
// SHORT:
//     imbalance <= SHORT_MAX_IMBALANCE
//
// Ratios are monitored only.
// They DO NOT block trades in trading.js.
//

const ORDER_BOOK_FILTER_ENABLED =
    true;

const ORDER_BOOK_DEPTH =
    200;

const LONG_MIN_IMBALANCE =
    0.02;

const SHORT_MAX_IMBALANCE =
    -0.02;

const MIN_BID_ASK_RATIO =
    1.03;

const MIN_ASK_BID_RATIO =
    1.03;


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
// When enabled:
//
// Every 1 hour:
//
// 1. Load available WEEX symbols
// 2. Read fresh order book
// 3. Calculate imbalance
// 4. Decide LONG / SHORT / NEUTRAL
// 5. Process the signal
// 6. Respect existing-position logic
// 7. Never open both directions
//
// The automatic trader uses the same processSignal()
// used by TradingView.
//

const AUTO_TRADING_ENABLED =
    true;


// ============================================================
// AUTOMATIC TRADING INTERVAL
// ============================================================
//
// 60 minutes = 1 hour
//

const AUTO_TRADING_INTERVAL_MS =
    60 *
    60 *
    1000;


// ============================================================
// MAXIMUM TRADES PER CYCLE
// ============================================================
//
// Prevents one hourly scan from opening/reversing
// too many positions.
//
// Example:
//
// 100 symbols scanned
// 20 signals pass
// MAX_TRADES_PER_CYCLE = 3
//
// Only the first 3 trade decisions are allowed.
//

const AUTO_TRADING_MAX_TRADES_PER_CYCLE =
    3;


// ============================================================
// SYMBOL DELAY
// ============================================================
//
// Small delay between symbols.
//
// Prevents sending too many WEEX requests
// at exactly the same time.
//

const AUTO_TRADING_SYMBOL_DELAY_MS = 60 * 60 * 1000;


// ============================================================
// AUTOMATIC TRADER SAFETY
// ============================================================
//
// Minimum imbalance difference between LONG and SHORT.
//
// Normally LONG and SHORT cannot both pass because
// the thresholds are positive/negative.
//
// These values are kept configurable for future changes.
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


    // --------------------------------------------------------
    // TRADING
    // --------------------------------------------------------

    TRADING_ENABLED,


    // --------------------------------------------------------
    // AUTOMATIC ORDER-BOOK TRADING
    // --------------------------------------------------------

    AUTO_TRADING_ENABLED,

    AUTO_TRADING_INTERVAL_MS,

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