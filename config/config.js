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
    4.0;

const STOP_LOSS_PERCENT =
    4.0;

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
    0.04;

const SHORT_MAX_IMBALANCE =
    -0.04;


// ------------------------------------------------------------
// RATIO THRESHOLDS
// ------------------------------------------------------------
//
// LONG:
//
//     BID / ASK >= 1.03
//
// SHORT:
//
//     ASK / BID >= 1.03
//

const MIN_BID_ASK_RATIO =
    1.03;

const MIN_ASK_BID_RATIO =
    1.03;


// ============================================================
// ORDER BOOK DEPTH CONFIRMATION
// ============================================================
//
// Four independent depth confirmations:
//
//     15 levels
//     30 levels
//     60 levels
//     90 levels
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

const AUTO_TRADING_ENABLED =
    true;


// ============================================================
// AUTOMATIC TRADING INTERVAL
// ============================================================
//
// 60 minutes = 1 hour
//

const AUTO_TRADING_INTERVAL_MS =
    60 * 60 * 1000;


// ============================================================
// MAXIMUM TRADES PER CYCLE
// ============================================================
//
// Prevents one hourly scan from opening/reversing
// too many positions.
//

const AUTO_TRADING_MAX_TRADES_PER_CYCLE =
    3;


// ============================================================
// SYMBOL DELAY
// ============================================================
//
// Intentional 1-hour delay between symbols.
//

const AUTO_TRADING_SYMBOL_DELAY_MS =
    60 * 60 * 1000;


// ============================================================
// AUTOMATIC TRADER SAFETY
// ============================================================
//
// Minimum imbalance difference between LONG and SHORT.
//
// Normally LONG and SHORT cannot both pass because
// the thresholds are positive/negative.
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