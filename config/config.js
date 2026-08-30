require("dotenv").config();

const PORT = Number(process.env.PORT || 3000);

const BASE_URL = "https://api-contract.weex.com";

const DEFAULT_MARGIN = 1;
const DEFAULT_LEVERAGE = 10;

const REQUIRED_MARGIN_MODE = "ISOLATED";

// ============================================================
// ORDER BOOK
// ============================================================

const ORDER_BOOK_DEPTH = 200;

const LONG_MIN_IMBALANCE = 0.01;
const SHORT_MAX_IMBALANCE = -0.01;

const MIN_BID_ASK_RATIO = 1.05;
const MIN_ASK_BID_RATIO = 1.05;

// ============================================================
// TRADING
// ============================================================

const TRADING_ENABLED =
    process.env.TRADING_ENABLED === "true";

// ============================================================
// API
// ============================================================

const API_KEY =
    process.env.WEEX_API_KEY;

const API_SECRET =
    process.env.WEEX_API_SECRET;

const API_PASSPHRASE =
    process.env.WEEX_API_PASSPHRASE;

module.exports = {
    PORT,
    BASE_URL,

    DEFAULT_MARGIN,
    DEFAULT_LEVERAGE,
    REQUIRED_MARGIN_MODE,

    ORDER_BOOK_DEPTH,
    LONG_MIN_IMBALANCE,
    SHORT_MAX_IMBALANCE,
    MIN_BID_ASK_RATIO,
    MIN_ASK_BID_RATIO,

    TRADING_ENABLED,

    API_KEY,
    API_SECRET,
    API_PASSPHRASE
};