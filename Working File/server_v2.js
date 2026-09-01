require("dotenv").config();

const express = require("express");
const crypto = require("crypto");

const app = express();

app.use(express.json());


// ============================================================
// BASE X -> WEEX BOT V2
// ============================================================
//
// IMPORTANT:
//
// This is SERVER_V2.
//
// The original server.js remains untouched.
//
// Features:
//
// 1. Automatic WEEX USDT-M contract discovery
// 2. 1 USDT margin
// 3. 10x leverage
// 4. ISOLATED margin required
// 5. Live WEEX position verification
// 6. LONG / SHORT / CLOSE
// 7. CLOSE_LONG / CLOSE_SHORT
// 8. Automatic reversal
// 9. WEEX order-book filter
// 10. Read-only order-book testing
// 11. TradingView immediate HTTP 200
// 12. Background WEEX processing
// 13. Per-symbol locks
//
// ORDER BOOK:
//
// LONG  -> BID dominance required
// SHORT -> ASK dominance required
// CLOSE -> NEVER filtered
//
// REVERSAL:
//
// CLOSE
//   ↓
// CONFIRM FLAT
//   ↓
// FRESH ORDER BOOK
//   ↓
// OPEN NEW DIRECTION
//
// ============================================================


// ============================================================
// CONFIGURATION
// ============================================================

const PORT =
    Number(process.env.PORT || 3000);

const BASE_URL =
    "https://api-contract.weex.com";


// ============================================================
// DEFAULT TRADING SETTINGS
// ============================================================

const DEFAULT_MARGIN = 1;

const DEFAULT_LEVERAGE = 10;

const REQUIRED_MARGIN_MODE = "ISOLATED";


// ============================================================
// ORDER BOOK SETTINGS
// ============================================================
//
// WEEX depth:
//
// 15 levels are used.
//
// LONG:
//
// imbalance >= +0.20
// bid/ask >= 1.20
//
// SHORT:
//
// imbalance <= -0.20
// ask/bid >= 1.20
//
// Both conditions must pass.
//
// CLOSE is NEVER filtered.
//
// ============================================================

const ORDER_BOOK_DEPTH = 15;

const LONG_MIN_IMBALANCE = 0.03;
const SHORT_MAX_IMBALANCE = -0.03;
const MIN_BID_ASK_RATIO = 1.05;
const MIN_ASK_BID_RATIO = 1.05;

// ============================================================
// LIVE TRADING
// ============================================================

const TRADING_ENABLED =
    process.env.TRADING_ENABLED === "true";


// ============================================================
// API CREDENTIALS
// ============================================================

const API_KEY =
    process.env.WEEX_API_KEY;

const API_SECRET =
    process.env.WEEX_API_SECRET;

const API_PASSPHRASE =
    process.env.WEEX_API_PASSPHRASE;


// ============================================================
// DYNAMIC CONTRACT CACHE
// ============================================================

const CONTRACT_INFO = {};


// ============================================================
// SUPPORTED SYMBOL SET
// ============================================================

const SUPPORTED_SYMBOLS =
    new Set();


// ============================================================
// PER-SYMBOL TRADING LOCK
// ============================================================

const symbolLocks = new Map();


// ============================================================
// SLEEP
// ============================================================

function sleep(ms) {

    return new Promise(
        resolve =>
            setTimeout(
                resolve,
                ms
            )
    );

}


// ============================================================
// ACQUIRE LOCK
// ============================================================

async function acquireTradingLock(symbol) {

    symbol =
        normalizeSymbol(symbol);

    while (
        symbolLocks.get(symbol)
    ) {

        await sleep(25);

    }

    symbolLocks.set(
        symbol,
        true
    );

}


// ============================================================
// RELEASE LOCK
// ============================================================

function releaseTradingLock(symbol) {

    symbol =
        normalizeSymbol(symbol);

    symbolLocks.delete(
        symbol
    );

}


// ============================================================
// SAFE NUMBER
// ============================================================

function safeNumber(
    value,
    fallback = 0
) {

    const number =
        Number(value);

    if (
        Number.isFinite(number)
    ) {

        return number;

    }

    return fallback;

}


// ============================================================
// SAFE INTEGER
// ============================================================

function safeInteger(
    value,
    fallback
) {

    const number =
        Number(value);

    if (
        !Number.isFinite(number)
    ) {

        return fallback;

    }

    if (
        number < 0 ||
        number > 100
    ) {

        return fallback;

    }

    return Math.floor(number);

}


// ============================================================
// STARTUP
// ============================================================

console.log("");

console.log(
    "============================================================"
);

console.log(
    "TRADINGVIEW -> WEEX SERVER V2"
);

console.log(
    "============================================================"
);

console.log(
    "Trading:",
    TRADING_ENABLED
        ? "ENABLED - LIVE"
        : "DISABLED"
);

console.log(
    "API:",
    "WEEX V3 USDT-M FUTURES"
);

console.log(
    "Default margin:",
    DEFAULT_MARGIN,
    "USDT"
);

console.log(
    "Default leverage:",
    DEFAULT_LEVERAGE,
    "x"
);

console.log(
    "Target notional:",
    DEFAULT_MARGIN * DEFAULT_LEVERAGE,
    "USDT"
);

console.log(
    "Required margin mode:",
    REQUIRED_MARGIN_MODE
);

console.log(
    "Order book depth:",
    ORDER_BOOK_DEPTH
);

console.log(
    "LONG:",
    `imbalance >= ${LONG_MIN_IMBALANCE}`,
    `AND bid/ask >= ${MIN_BID_ASK_RATIO}`
);

console.log(
    "SHORT:",
    `imbalance <= ${SHORT_MAX_IMBALANCE}`,
    `AND ask/bid >= ${MIN_ASK_BID_RATIO}`
);

console.log(
    "CLOSE:",
    "NEVER FILTERED"
);

console.log(
    "Symbols:",
    "DISCOVERED AUTOMATICALLY FROM WEEX"
);

console.log(
    "Webhook:",
    "FAST ACK + BACKGROUND PROCESSING"
);

console.log(
    "Concurrency:",
    "PER-SYMBOL LOCKS"
);

console.log(
    "============================================================"
);


// ============================================================
// CREDENTIAL VALIDATION
// ============================================================

if (
    !API_KEY ||
    !API_SECRET ||
    !API_PASSPHRASE
) {

    console.error("");

    console.error(
        "WARNING: WEEX API credentials missing."
    );

    console.error(
        "Required:"
    );

    console.error(
        "WEEX_API_KEY"
    );

    console.error(
        "WEEX_API_SECRET"
    );

    console.error(
        "WEEX_API_PASSPHRASE"
    );

}


// ============================================================
// GET SYMBOL SETTINGS
// ============================================================

function getSymbolSettings(symbol) {

    if (
        !SUPPORTED_SYMBOLS.has(symbol)
    ) {

        throw new Error(
            `Unsupported or unavailable WEEX symbol: ${symbol}`
        );

    }

    return {

        margin:
            DEFAULT_MARGIN,

        leverage:
            DEFAULT_LEVERAGE

    };

}


// ============================================================
// HMAC SHA256 -> BASE64
// ============================================================

function signRequest(
    timestamp,
    method,
    requestPath,
    queryString,
    body
) {

    let message =
        timestamp +
        method.toUpperCase() +
        requestPath;

    if (
        queryString
    ) {

        message +=
            "?" +
            queryString;

    }

    if (
        body
    ) {

        message +=
            body;

    }

    return crypto
        .createHmac(
            "sha256",
            API_SECRET
        )
        .update(
            message,
            "utf8"
        )
        .digest(
            "base64"
        );

}


// ============================================================
// WEEX REQUEST
// ============================================================

async function weexRequest(
    method,
    endpoint,
    params = null
) {

    const upperMethod =
        method.toUpperCase();

    const isPublicMarketEndpoint =
        endpoint.startsWith(
            "/capi/v3/market/"
        );


    if (
        !isPublicMarketEndpoint &&
        (
            !API_KEY ||
            !API_SECRET ||
            !API_PASSPHRASE
        )
    ) {

        throw new Error(
            "WEEX API credentials are missing."
        );

    }


    const timestamp =
        String(Date.now());

    let queryString =
        "";

    let body =
        "";


    // --------------------------------------------------------
    // GET QUERY
    // --------------------------------------------------------

    if (
        upperMethod === "GET" &&
        params &&
        Object.keys(params).length > 0
    ) {

        queryString =
            new URLSearchParams(
                Object.entries(params).map(
                    ([key, value]) => [
                        key,
                        String(value)
                    ]
                )
            )
                .toString();

    }


    // --------------------------------------------------------
    // POST BODY
    // --------------------------------------------------------

    if (
        upperMethod === "POST"
    ) {

        body =
            JSON.stringify(
                params || {}
            );

    }


    // --------------------------------------------------------
    // SIGN
    // --------------------------------------------------------

    const signature =
        signRequest(
            timestamp,
            upperMethod,
            endpoint,
            queryString,
            body
        );


    let url =
        BASE_URL +
        endpoint;


    if (
        queryString
    ) {

        url +=
            "?" +
            queryString;

    }


    console.log("");

    console.log(
        "------------------------------------------------------------"
    );

    console.log(
        "WEEX REQUEST"
    );

    console.log(
        upperMethod,
        endpoint
    );


    if (
        queryString
    ) {

        console.log(
            "QUERY:",
            queryString
        );

    }


    if (
        body
    ) {

        console.log(
            "BODY:",
            body
        );

    }


    const headers = {

        "Content-Type":
            "application/json",

        "User-Agent":
            "TradingView-WEEX-Server-V2/1.0"

    };


    if (
        !isPublicMarketEndpoint
    ) {

        headers["ACCESS-KEY"] =
            API_KEY;

        headers["ACCESS-SIGN"] =
            signature;

        headers["ACCESS-PASSPHRASE"] =
            API_PASSPHRASE;

        headers["ACCESS-TIMESTAMP"] =
            timestamp;

    }


    const response =
        await fetch(
            url,
            {

                method:
                    upperMethod,

                headers,

                body:
                    upperMethod === "POST"
                        ? body
                        : undefined

            }
        );


    const text =
        await response.text();


    console.log(
        "HTTP STATUS:",
        response.status
    );


    let data;


    try {

        data =
            JSON.parse(text);

    } catch {

        data =
            text;

    }


    if (
        !response.ok
    ) {

        console.error("");

        console.error(
            "WEEX ERROR:"
        );

        console.error(
            JSON.stringify(
                data,
                null,
                2
            )
        );


        const error =
            new Error(
                `WEEX HTTP ${response.status}`
            );


        error.status =
            response.status;

        error.data =
            data;

        error.endpoint =
            endpoint;

        error.requestBody =
            body;


        throw error;

    }


    return data;

}


// ============================================================
// NORMALIZE SYMBOL
// ============================================================

function normalizeSymbol(symbol) {

    let value =
        String(symbol || "")
            .trim()
            .toUpperCase();


    if (
        !value
    ) {

        return "";

    }


    if (
        value.includes(":")
    ) {

        value =
            value.split(":").pop();

    }


    value =
        value.replace(
            /\//g,
            ""
        );


    value =
        value.replace(
            /\.P$/i,
            ""
        );


    value =
        value.replace(
            /:PERP$/i,
            ""
        );


    value =
        value.replace(
            /\s+/g,
            ""
        );


    return value;

}


// ============================================================
// NORMALIZE CONTRACT
// ============================================================

function normalizeContract(
    contract
) {

    const quantityPrecision =
        safeInteger(
            contract?.quantityPrecision,
            6
        );


    const pricePrecision =
        safeInteger(
            contract?.pricePrecision,
            8
        );


    const minOrderSize =
        safeNumber(
            contract?.minOrderSize ??
            contract?.minQty ??
            0,
            0
        );


    const maxOrderSize =
        safeNumber(
            contract?.maxOrderSize ??
            contract?.maxQty ??
            Infinity,
            Infinity
        );


    const maxPositionSize =
        safeNumber(
            contract?.maxPositionSize,
            Infinity
        );


    const marketOpenLimitSize =
        safeNumber(
            contract?.marketOpenLimitSize,
            Infinity
        );


    const maxLeverage =
        safeNumber(
            contract?.maxLeverage,
            0
        );


    let stepSize =
        Number(
            contract?.stepSize ??
            contract?.quantityStepSize ??
            contract?.qtyStepSize ??
            contract?.orderStepSize ??
            contract?.sizeStep ??
            NaN
        );


    if (
        !Number.isFinite(stepSize) ||
        stepSize <= 0
    ) {

        stepSize =
            Math.pow(
                10,
                -quantityPrecision
            );

    }


    return {

        symbol:
            normalizeSymbol(
                contract?.symbol
            ),

        rawSymbol:
            contract?.symbol,

        baseAsset:
            contract?.baseAsset,

        quoteAsset:
            contract?.quoteAsset,

        marginAsset:
            contract?.marginAsset,

        contractVal:
            safeNumber(
                contract?.contractVal,
                0
            ),

        quantityPrecision,

        pricePrecision,

        stepSize,

        minOrderSize,

        maxOrderSize,

        maxPositionSize,

        marketOpenLimitSize,

        maxLeverage

    };

}


// ============================================================
// LOAD ALL WEEX CONTRACTS
// ============================================================

async function loadAllContracts() {

    console.log("");

    console.log(
        "============================================================"
    );

    console.log(
        "LOADING ALL WEEX USDT-M CONTRACTS"
    );

    console.log(
        "============================================================"
    );


    const exchangeInfo =
        await weexRequest(
            "GET",
            "/capi/v3/market/exchangeInfo"
        );


    const contracts =
        Array.isArray(
            exchangeInfo?.symbols
        )
            ? exchangeInfo.symbols
            : [];


    if (
        contracts.length === 0
    ) {

        throw new Error(
            "WEEX returned no contracts from exchangeInfo."
        );

    }


    let apiTradingSet =
        null;


    try {

        const apiTradingData =
            await weexRequest(
                "GET",
                "/capi/v3/market/apiTradingSymbols"
            );


        const apiSymbols =
            Array.isArray(
                apiTradingData
            )
                ? apiTradingData
                : Array.isArray(
                    apiTradingData?.symbols
                )
                    ? apiTradingData.symbols
                    : [];


        if (
            apiSymbols.length > 0
        ) {

            apiTradingSet =
                new Set(
                    apiSymbols
                        .map(
                            symbol =>
                                normalizeSymbol(
                                    symbol
                                )
                        )
                );

        }

    } catch (error) {

        console.warn("");

        console.warn(
            "Could not retrieve apiTradingSymbols."
        );

        console.warn(
            "Falling back to exchangeInfo."
        );

    }


    SUPPORTED_SYMBOLS.clear();


    for (
        const contract of contracts
    ) {

        const symbol =
            normalizeSymbol(
                contract?.symbol
            );


        if (
            !symbol
        ) {

            continue;

        }


        const quoteAsset =
            String(
                contract?.quoteAsset ||
                ""
            )
                .toUpperCase();


        const marginAsset =
            String(
                contract?.marginAsset ||
                ""
            )
                .toUpperCase();


        if (
            quoteAsset !== "USDT" &&
            marginAsset !== "USDT"
        ) {

            continue;

        }


        if (
            apiTradingSet &&
            !apiTradingSet.has(symbol)
        ) {

            continue;

        }


        CONTRACT_INFO[symbol] =
            normalizeContract(
                contract
            );


        SUPPORTED_SYMBOLS.add(
            symbol
        );

    }


    if (
        SUPPORTED_SYMBOLS.size === 0
    ) {

        throw new Error(
            "No API-tradable USDT-M contracts were discovered."
        );

    }


    console.log("");

    console.log(
        "WEEX AVAILABLE USDT-M SYMBOLS:",
        SUPPORTED_SYMBOLS.size
    );


    console.log(
        Array.from(
            SUPPORTED_SYMBOLS
        )
            .sort()
            .join(", ")
    );


    console.log("");

    console.log(
        `Margin = ${DEFAULT_MARGIN} USDT`
    );

    console.log(
        `Leverage = ${DEFAULT_LEVERAGE}x`
    );

    console.log(
        `Target notional = ${DEFAULT_MARGIN * DEFAULT_LEVERAGE} USDT`
    );


    console.log(
        "============================================================"
    );

}


// ============================================================
// REFRESH SINGLE CONTRACT
// ============================================================

async function refreshContract(
    symbol
) {

    const data =
        await weexRequest(
            "GET",
            "/capi/v3/market/exchangeInfo",
            {
                symbol
            }
        );


    const contracts =
        Array.isArray(
            data?.symbols
        )
            ? data.symbols
            : [];


    const contract =
        contracts.find(
            item =>
                normalizeSymbol(
                    item?.symbol
                ) === symbol
        );


    if (
        contract
    ) {

        CONTRACT_INFO[symbol] =
            normalizeContract(
                contract
            );

    }


    return CONTRACT_INFO[symbol];

}


// ============================================================
// GET CONTRACT
// ============================================================

function getContract(
    symbol
) {

    const info =
        CONTRACT_INFO[symbol];


    if (
        !info
    ) {

        throw new Error(
            `Contract information not loaded for ${symbol}`
        );

    }


    return info;

}


// ============================================================
// GET PRICE
// ============================================================

async function getPrice(
    symbol
) {

    const data =
        await weexRequest(
            "GET",
            "/capi/v3/market/ticker/bookTicker",
            {
                symbol
            }
        );


    const ticker =
        Array.isArray(data)
            ? (
                data.find(
                    item =>
                        normalizeSymbol(
                            item?.symbol
                        ) === symbol
                ) ||
                data[0]
            )
            : data;


    if (
        !ticker
    ) {

        throw new Error(
            `WEEX ticker not found for ${symbol}`
        );

    }


    const bid =
        Number(
            ticker.bidPrice
        );


    const ask =
        Number(
            ticker.askPrice
        );


    if (
        !Number.isFinite(bid) ||
        !Number.isFinite(ask) ||
        bid <= 0 ||
        ask <= 0
    ) {

        throw new Error(
            `Invalid WEEX bid/ask for ${symbol}`
        );

    }


    const price =
        (bid + ask) / 2;


    console.log("");

    console.log(
        `${symbol} PRICE`
    );

    console.log(
        "Bid:",
        bid
    );

    console.log(
        "Ask:",
        ask
    );

    console.log(
        "Mid:",
        price
    );


    return price;

}


// ============================================================
// GET WEEX ORDER BOOK
// ============================================================
//
// IMPORTANT:
//
// This function is READ ONLY.
//
// It NEVER places an order.
//
// ============================================================

async function getOrderBook(
    symbol
) {

    const data =
        await weexRequest(
            "GET",
            "/capi/v3/market/depth",
            {

                symbol,

                limit:
                    ORDER_BOOK_DEPTH

            }
        );


    let bids = [];

    let asks = [];


    // --------------------------------------------------------
    // Standard WEEX response
    // --------------------------------------------------------

    if (
        Array.isArray(data?.bids)
    ) {

        bids =
            data.bids;

    }


    if (
        Array.isArray(data?.asks)
    ) {

        asks =
            data.asks;

    }


    // --------------------------------------------------------
    // Some API responses may wrap data
    // --------------------------------------------------------

    if (
        bids.length === 0 &&
        Array.isArray(data?.data?.bids)
    ) {

        bids =
            data.data.bids;

    }


    if (
        asks.length === 0 &&
        Array.isArray(data?.data?.asks)
    ) {

        asks =
            data.data.asks;

    }


    if (
        bids.length === 0 ||
        asks.length === 0
    ) {

        throw new Error(
            `${symbol}: WEEX returned an empty order book.`
        );

    }


    return {

        bids,

        asks,

        raw:
            data

    };

}


// ============================================================
// CALCULATE ORDER BOOK
// ============================================================
//
// Liquidity is calculated from the quantity at each depth level.
//
// imbalance:
//
// (bid - ask) / (bid + ask)
//
// +1 = completely bid dominated
//  0 = balanced
// -1 = completely ask dominated
//
// ============================================================

function calculateOrderBookPressure(
    orderBook
) {

    const bids =
        Array.isArray(orderBook?.bids)
            ? orderBook.bids
            : [];


    const asks =
        Array.isArray(orderBook?.asks)
            ? orderBook.asks
            : [];


    let bidLiquidity =
        0;

    let askLiquidity =
        0;


    for (
        const level of bids
    ) {

        if (
            !Array.isArray(level) ||
            level.length < 2
        ) {

            continue;

        }


        const quantity =
            Number(
                level[1]
            );


        if (
            Number.isFinite(quantity) &&
            quantity > 0
        ) {

            bidLiquidity +=
                quantity;

        }

    }


    for (
        const level of asks
    ) {

        if (
            !Array.isArray(level) ||
            level.length < 2
        ) {

            continue;

        }


        const quantity =
            Number(
                level[1]
            );


        if (
            Number.isFinite(quantity) &&
            quantity > 0
        ) {

            askLiquidity +=
                quantity;

        }

    }


    const totalLiquidity =
        bidLiquidity +
        askLiquidity;


    if (
        totalLiquidity <= 0
    ) {

        throw new Error(
            "WEEX order book contains no usable liquidity."
        );

    }


    const bidPercentage =
        bidLiquidity /
        totalLiquidity;


    const askPercentage =
        askLiquidity /
        totalLiquidity;


    const imbalance =
        (
            bidLiquidity -
            askLiquidity
        ) /
        totalLiquidity;


    const bidAskRatio =
        askLiquidity > 0
            ? bidLiquidity /
              askLiquidity
            : Infinity;


    const askBidRatio =
        bidLiquidity > 0
            ? askLiquidity /
              bidLiquidity
            : Infinity;


    return {

        bidLiquidity,

        askLiquidity,

        totalLiquidity,

        bidPercentage,

        askPercentage,

        imbalance,

        bidAskRatio,

        askBidRatio

    };

}


// ============================================================
// CHECK ORDER BOOK
// ============================================================
//
// LONG:
//
// BID must dominate.
//
// SHORT:
//
// ASK must dominate.
//
// CLOSE:
//
// Never calls this function.
//
// ============================================================

async function checkOrderBook(
    symbol,
    direction
) {

    direction =
        String(
            direction || ""
        )
            .trim()
            .toUpperCase();


    if (
        direction !== "LONG" &&
        direction !== "SHORT"
    ) {

        throw new Error(
            `Invalid order-book direction: ${direction}`
        );

    }


    const orderBook =
        await getOrderBook(
            symbol
        );


    const pressure =
        calculateOrderBookPressure(
            orderBook
        );


    console.log("");

    console.log(
        "============================================================"
    );

    console.log(
        `WEEX ORDER BOOK FILTER: ${symbol}`
    );

    console.log(
        "============================================================"
    );

    console.log(
        "Requested direction:",
        direction
    );

    console.log(
        "Depth levels:",
        ORDER_BOOK_DEPTH
    );


    const bestBid =
        Number(
            orderBook.bids?.[0]?.[0]
        );


    const bestAsk =
        Number(
            orderBook.asks?.[0]?.[0]
        );


    console.log(
        "Best bid:",
        bestBid
    );

    console.log(
        "Best ask:",
        bestAsk
    );


    console.log(
        "Bid liquidity:",
        pressure.bidLiquidity
    );

    console.log(
        "Ask liquidity:",
        pressure.askLiquidity
    );

    console.log(
        "Bid percentage:",
        (
            pressure.bidPercentage *
            100
        ).toFixed(2) + "%"
    );

    console.log(
        "Ask percentage:",
        (
            pressure.askPercentage *
            100
        ).toFixed(2) + "%"
    );

    console.log(
        "Imbalance:",
        pressure.imbalance
    );

    console.log(
        "Bid/Ask ratio:",
        pressure.bidAskRatio
    );

    console.log(
        "Ask/Bid ratio:",
        pressure.askBidRatio
    );


    // ========================================================
    // LONG
    // ========================================================

    if (
        direction === "LONG"
    ) {

        const imbalancePass =
            pressure.imbalance >=
            LONG_MIN_IMBALANCE;


        const ratioPass =
            pressure.bidAskRatio >=
            MIN_BID_ASK_RATIO;


        console.log("");

        console.log(
            "LONG ORDER BOOK CHECK"
        );

        console.log(
            "Required imbalance >= ",
            LONG_MIN_IMBALANCE
        );

        console.log(
            "Actual imbalance:",
            pressure.imbalance
        );

        console.log(
            "Required bid/ask ratio >= ",
            MIN_BID_ASK_RATIO
        );

        console.log(
            "Actual bid/ask ratio:",
            pressure.bidAskRatio
        );

        console.log(
            "Imbalance:",
            imbalancePass
                ? "PASS"
                : "FAIL"
        );

        console.log(
            "Ratio:",
            ratioPass
                ? "PASS"
                : "FAIL"
        );


        const allowed =
            imbalancePass &&
            ratioPass;


        console.log(
            "FINAL LONG FILTER:",
            allowed
                ? "PASSED"
                : "BLOCKED"
        );

        console.log(
            "============================================================"
        );


        return {

            allowed,

            direction,

            reason:
                allowed
                    ? "ORDER_BOOK_SUPPORTS_LONG"
                    : "ORDER_BOOK_DOES_NOT_SUPPORT_LONG",

            imbalance:
                pressure.imbalance,

            bidLiquidity:
                pressure.bidLiquidity,

            askLiquidity:
                pressure.askLiquidity,

            bidPercentage:
                pressure.bidPercentage,

            askPercentage:
                pressure.askPercentage,

            bidAskRatio:
                pressure.bidAskRatio,

            askBidRatio:
                pressure.askBidRatio,

            imbalancePass,

            ratioPass

        };

    }


    // ========================================================
    // SHORT
    // ========================================================

    const imbalancePass =
        pressure.imbalance <=
        SHORT_MAX_IMBALANCE;


    const ratioPass =
        pressure.askBidRatio >=
        MIN_ASK_BID_RATIO;


    console.log("");

    console.log(
        "SHORT ORDER BOOK CHECK"
    );

    console.log(
        "Required imbalance <= ",
        SHORT_MAX_IMBALANCE
    );

    console.log(
        "Actual imbalance:",
        pressure.imbalance
    );

    console.log(
        "Required ask/bid ratio >= ",
        MIN_ASK_BID_RATIO
    );

    console.log(
        "Actual ask/bid ratio:",
        pressure.askBidRatio
    );

    console.log(
        "Imbalance:",
        imbalancePass
            ? "PASS"
            : "FAIL"
    );

    console.log(
        "Ratio:",
        ratioPass
            ? "PASS"
            : "FAIL"
    );


    const allowed =
        imbalancePass &&
        ratioPass;


    console.log(
        "FINAL SHORT FILTER:",
        allowed
            ? "PASSED"
            : "BLOCKED"
    );

    console.log(
        "============================================================"
    );


    return {

        allowed,

        direction,

        reason:
            allowed
                ? "ORDER_BOOK_SUPPORTS_SHORT"
                : "ORDER_BOOK_DOES_NOT_SUPPORT_SHORT",

        imbalance:
            pressure.imbalance,

        bidLiquidity:
            pressure.bidLiquidity,

        askLiquidity:
            pressure.askLiquidity,

        bidPercentage:
            pressure.bidPercentage,

        askPercentage:
            pressure.askPercentage,

        bidAskRatio:
            pressure.bidAskRatio,

        askBidRatio:
            pressure.askBidRatio,

        imbalancePass,

        ratioPass

    };

}


// ============================================================
// GET FUTURES BALANCE
// ============================================================

async function getFuturesBalance() {

    const data =
        await weexRequest(
            "GET",
            "/capi/v3/account/balance"
        );


    const balances =
        Array.isArray(data)
            ? data
            : Array.isArray(data?.data)
                ? data.data
                : [];


    const usdt =
        balances.find(
            item =>
                String(
                    item?.asset || ""
                )
                    .toUpperCase() ===
                "USDT"
        );


    if (
        !usdt
    ) {

        throw new Error(
            "USDT futures balance not found"
        );

    }


    const balance =
        safeNumber(
            usdt.balance,
            0
        );


    const available =
        safeNumber(
            usdt.availableBalance,
            0
        );


    console.log("");

    console.log(
        "WEEX FUTURES BALANCE"
    );

    console.log(
        "Total:",
        balance,
        "USDT"
    );

    console.log(
        "Available:",
        available,
        "USDT"
    );


    return {

        balance,

        available

    };

}


// ============================================================
// GET CURRENT POSITION
// ============================================================

async function getCurrentPosition(
    symbol
) {

    const data =
        await weexRequest(
            "GET",
            "/capi/v3/account/position/singlePosition",
            {
                symbol
            }
        );


    const positions =
        Array.isArray(data)
            ? data
            : Array.isArray(data?.data)
                ? data.data
                : [];


    const validPositions =
        positions.filter(
            item =>
                normalizeSymbol(
                    item?.symbol
                ) === symbol &&
                Number(
                    item?.size ?? 0
                ) > 0
        );


    if (
        validPositions.length === 0
    ) {

        console.log(
            `${symbol}: FLAT`
        );


        return {

            symbol,

            direction:
                "FLAT",

            quantity:
                0,

            available:
                0

        };

    }


    if (
        validPositions.length > 1
    ) {

        throw new Error(
            `${symbol}: multiple active positions returned.`
        );

    }


    const position =
        validPositions[0];


    const side =
        String(
            position?.side || ""
        )
            .trim()
            .toUpperCase();


    if (
        side !== "LONG" &&
        side !== "SHORT"
    ) {

        throw new Error(
            `${symbol}: unknown position side ${side}`
        );

    }


    const quantity =
        Number(
            position.size ?? 0
        );


    const openValue =
        Number(
            position.openValue ?? 0
        );


    const result = {

        symbol,

        direction:
            side,

        quantity,

        available:
            quantity,

        avgPrice:
            quantity > 0
                ? openValue / quantity
                : 0,

        positionValue:
            openValue,

        leverage:
            safeNumber(
                position.leverage,
                0
            ),

        margin:
            safeNumber(
                position.marginSize,
                0
            ),

        unrealizedPnL:
            safeNumber(
                position.unrealizePnl,
                0
            ),

        liquidationPrice:
            safeNumber(
                position.liquidatePrice,
                0
            ),

        marginType:
            position.marginType ||
            "",

        separatedMode:
            position.separatedMode ||
            ""

    };


    console.log("");

    console.log(
        `${symbol} POSITION`
    );

    console.log(
        "Direction:",
        result.direction
    );

    console.log(
        "Quantity:",
        result.quantity
    );

    console.log(
        "Average price:",
        result.avgPrice
    );

    console.log(
        "Position value:",
        result.positionValue
    );

    console.log(
        "Leverage:",
        result.leverage
    );

    console.log(
        "Margin:",
        result.margin
    );

    console.log(
        "Unrealized PnL:",
        result.unrealizedPnL
    );

    console.log(
        "Liquidation price:",
        result.liquidationPrice
    );

    console.log(
        "Margin type:",
        result.marginType
    );


    return result;

}


// ============================================================
// GET SYMBOL CONFIG
// ============================================================

async function getSymbolConfig(
    symbol
) {

    const data =
        await weexRequest(
            "GET",
            "/capi/v3/account/symbolConfig",
            {
                symbol
            }
        );


    let configs;


    if (
        Array.isArray(data)
    ) {

        configs =
            data;

    } else if (
        Array.isArray(data?.data)
    ) {

        configs =
            data.data;

    } else {

        configs =
            [data];

    }


    const config =
        configs.find(
            item =>
                normalizeSymbol(
                    item?.symbol
                ) === symbol
        ) ||
        configs[0];


    if (
        !config
    ) {

        throw new Error(
            `WEEX symbol configuration not found for ${symbol}`
        );

    }


    return config;

}


// ============================================================
// NORMALIZE MARGIN MODE
// ============================================================

function normalizeMarginMode(
    config
) {

    const values = [

        config?.marginType,

        config?.marginMode,

        config?.marginModeType

    ];


    for (
        const value of values
    ) {

        if (
            value === undefined ||
            value === null
        ) {

            continue;

        }


        const normalized =
            String(value)
                .trim()
                .toUpperCase();


        if (
            normalized === "CROSS" ||
            normalized === "CROSSED"
        ) {

            return "CROSSED";

        }


        if (
            normalized === "ISOLATED"
        ) {

            return "ISOLATED";

        }

    }


    return "";

}


// ============================================================
// GET CONFIGURED LEVERAGES
// ============================================================

function getConfiguredLeverages(
    config
) {

    return {

        cross:
            safeNumber(
                config?.crossLeverage,
                0
            ),

        isolatedLong:
            safeNumber(
                config?.isolatedLongLeverage,
                0
            ),

        isolatedShort:
            safeNumber(
                config?.isolatedShortLeverage,
                0
            )

    };

}


// ============================================================
// ENSURE LEVERAGE
// ============================================================

async function ensureLeverage(
    symbol
) {

    const settings =
        getSymbolSettings(symbol);


    const contract =
        getContract(symbol);


    if (
        contract.maxLeverage > 0 &&
        settings.leverage >
        contract.maxLeverage
    ) {

        throw new Error(
            `${symbol}: ${settings.leverage}x exceeds WEEX maximum leverage ` +
            `${contract.maxLeverage}x`
        );

    }


    const config =
        await getSymbolConfig(
            symbol
        );


    const marginMode =
        normalizeMarginMode(
            config
        );


    if (
        marginMode !== REQUIRED_MARGIN_MODE
    ) {

        throw new Error(
            `${symbol}: WEEX margin mode is ` +
            `${marginMode || "UNKNOWN"}, expected ${REQUIRED_MARGIN_MODE}. ` +
            `Change the margin mode on WEEX first.`
        );

    }


    const current =
        getConfiguredLeverages(
            config
        );


    console.log("");

    console.log(
        `${symbol}: ISOLATED leverage currently`,
        `LONG=${current.isolatedLong}x`,
        `SHORT=${current.isolatedShort}x`
    );


    if (
        current.isolatedLong ===
            settings.leverage &&
        current.isolatedShort ===
            settings.leverage
    ) {

        console.log(
            `${symbol}: leverage already ${settings.leverage}x`
        );


        return {

            changed:
                false,

            marginMode,

            leverage:
                settings.leverage

        };

    }


    const params = {

        symbol,

        marginType:
            "ISOLATED",

        isolatedLongLeverage:
            String(settings.leverage),

        isolatedShortLeverage:
            String(settings.leverage)

    };


    const result =
        await weexRequest(
            "POST",
            "/capi/v3/account/leverage",
            params
        );


    console.log("");

    console.log(
        `${symbol}: leverage updated`
    );

    console.log(
        JSON.stringify(
            result,
            null,
            2
        )
    );


    return {

        changed:
            true,

        marginMode:
            "ISOLATED",

        leverage:
            settings.leverage

    };

}


// ============================================================
// DECIMAL HELPERS
// ============================================================

function decimalPlaces(
    value
) {

    const stringValue =
        String(value);


    if (
        stringValue.includes("e-")
    ) {

        return Number(
            stringValue
                .split("e-")[1]
        );

    }


    if (
        stringValue.includes(".")
    ) {

        return (
            stringValue
                .split(".")[1]
                .replace(
                    /0+$/,
                    ""
                )
                .length
        );

    }


    return 0;

}


// ============================================================
// FLOOR TO STEP
// ============================================================

function floorToStep(
    value,
    stepSize
) {

    if (
        !Number.isFinite(value) ||
        value <= 0
    ) {

        return 0;

    }


    if (
        !Number.isFinite(stepSize) ||
        stepSize <= 0
    ) {

        return value;

    }


    const precision =
        Math.max(
            decimalPlaces(value),
            decimalPlaces(stepSize),
            12
        );


    const multiplier =
        Math.pow(
            10,
            precision
        );


    const valueInt =
        Math.floor(
            value *
            multiplier +
            1e-8
        );


    const stepInt =
        Math.round(
            stepSize *
            multiplier
        );


    if (
        stepInt <= 0
    ) {

        return value;

    }


    const resultInt =
        Math.floor(
            valueInt /
            stepInt
        ) *
        stepInt;


    return (
        resultInt /
        multiplier
    );

}


// ============================================================
// EXTRACT STEP SIZE FROM WEEX ERROR
// ============================================================

function extractStepSizeFromError(
    error
) {

    const text =
        JSON.stringify(
            error?.data ||
            ""
        );


    const match =
        text.match(
            /stepSize\s*['"]?([0-9]+(?:\.[0-9]+)?)['"]?/i
        );


    if (
        !match
    ) {

        return null;

    }


    const step =
        Number(
            match[1]
        );


    if (
        !Number.isFinite(step) ||
        step <= 0
    ) {

        return null;

    }


    return step;

}


// ============================================================
// FORMAT QUANTITY
// ============================================================

function formatQuantity(
    symbol,
    quantity
) {

    const contract =
        getContract(symbol);


    const adjusted =
        floorToStep(
            quantity,
            contract.stepSize
        );


    if (
        !Number.isFinite(adjusted) ||
        adjusted <= 0
    ) {

        throw new Error(
            `${symbol}: invalid order quantity ${adjusted}`
        );

    }


    const precision =
        Math.max(
            contract.quantityPrecision,
            decimalPlaces(
                contract.stepSize
            )
        );


    return adjusted.toFixed(
        Math.min(
            100,
            precision
        )
    );

}


// ============================================================
// CALCULATE POSITION
// ============================================================

function calculatePosition(
    symbol,
    price
) {

    const settings =
        getSymbolSettings(symbol);


    const contract =
        getContract(symbol);


    if (
        !Number.isFinite(price) ||
        price <= 0
    ) {

        throw new Error(
            `${symbol}: invalid price ${price}`
        );

    }


    const targetNotional =
        settings.margin *
        settings.leverage;


    const rawQuantity =
        targetNotional /
        price;


    const quantity =
        floorToStep(
            rawQuantity,
            contract.stepSize
        );


    if (
        quantity <= 0
    ) {

        throw new Error(
            `${symbol}: calculated quantity is zero.`
        );

    }


    if (
        contract.minOrderSize > 0 &&
        quantity <
        contract.minOrderSize
    ) {

        throw new Error(
            `${symbol}: quantity ${quantity} ` +
            `is below WEEX minimum ${contract.minOrderSize}`
        );

    }


    if (
        Number.isFinite(
            contract.maxOrderSize
        ) &&
        quantity >
        contract.maxOrderSize
    ) {

        throw new Error(
            `${symbol}: quantity ${quantity} ` +
            `exceeds WEEX maximum ${contract.maxOrderSize}`
        );

    }


    if (
        Number.isFinite(
            contract.marketOpenLimitSize
        ) &&
        contract.marketOpenLimitSize > 0 &&
        quantity >
        contract.marketOpenLimitSize
    ) {

        throw new Error(
            `${symbol}: quantity ${quantity} ` +
            `exceeds market-open limit ${contract.marketOpenLimitSize}`
        );

    }


    const actualNotional =
        quantity *
        price;


    const actualMargin =
        actualNotional /
        settings.leverage;


    return {

        margin:
            settings.margin,

        leverage:
            settings.leverage,

        targetNotional,

        rawQuantity,

        quantity,

        actualNotional,

        actualMargin,

        stepSize:
            contract.stepSize

    };

}


// ============================================================
// PRINT POSITION
// ============================================================

function printPosition(
    symbol,
    price,
    calculation
) {

    console.log("");

    console.log(
        "============================================================"
    );

    console.log(
        `POSITION CALCULATION: ${symbol}`
    );

    console.log(
        "============================================================"
    );

    console.log(
        "Price:",
        price
    );

    console.log(
        "Margin:",
        calculation.margin,
        "USDT"
    );

    console.log(
        "Leverage:",
        calculation.leverage,
        "x"
    );

    console.log(
        "Target notional:",
        calculation.targetNotional,
        "USDT"
    );

    console.log(
        "Raw quantity:",
        calculation.rawQuantity
    );

    console.log(
        "WEEX stepSize:",
        calculation.stepSize
    );

    console.log(
        "Final quantity:",
        calculation.quantity
    );

    console.log(
        "Actual notional:",
        calculation.actualNotional,
        "USDT"
    );

    console.log(
        "Actual margin:",
        calculation.actualMargin,
        "USDT"
    );

    console.log(
        "============================================================"
    );

}


// ============================================================
// BUILD OPEN ORDER
// ============================================================

function buildOpenOrder(
    symbol,
    direction,
    quantity,
    clientOrderId
) {

    return {

        symbol,

        side:
            direction === "LONG"
                ? "BUY"
                : "SELL",

        positionSide:
            direction,

        type:
            "MARKET",

        quantity,

        newClientOrderId:
            clientOrderId

    };

}


// ============================================================
// PLACE OPEN ORDER
// ============================================================

async function placeOpenOrder(
    symbol,
    direction,
    calculation
) {

    const clientOrderId =
        `TV_${symbol}_${direction}_${Date.now()}`;


    let quantity =
        formatQuantity(
            symbol,
            calculation.quantity
        );


    let order =
        buildOpenOrder(
            symbol,
            direction,
            quantity,
            clientOrderId
        );


    try {

        return await weexRequest(
            "POST",
            "/capi/v3/order",
            order
        );

    } catch (error) {

        const step =
            extractStepSizeFromError(
                error
            );


        if (
            !step
        ) {

            throw error;

        }


        console.warn("");

        console.warn(
            `${symbol}: WEEX reported required stepSize = ${step}`
        );


        CONTRACT_INFO[symbol].stepSize =
            step;


        const retryQuantity =
            formatQuantity(
                symbol,
                calculation.rawQuantity
            );


        console.log("");

        console.log(
            `${symbol}: RETRYING ORDER`
        );

        console.log(
            "Old quantity:",
            quantity
        );

        console.log(
            "New quantity:",
            retryQuantity
        );


        order =
            buildOpenOrder(
                symbol,
                direction,
                retryQuantity,
                `${clientOrderId}_R`
            );


        return await weexRequest(
            "POST",
            "/capi/v3/order",
            order
        );

    }

}


// ============================================================
// OPEN MARKET POSITION
// ============================================================
//
// ORDER BOOK FILTER IS EXECUTED HERE.
//
// IMPORTANT:
//
// This happens before the actual WEEX order.
//
// ============================================================

async function openMarketPosition(
    symbol,
    direction
) {

    if (
        direction !== "LONG" &&
        direction !== "SHORT"
    ) {

        throw new Error(
            `Invalid direction: ${direction}`
        );

    }


    getSymbolSettings(
        symbol
    );


    // --------------------------------------------------------
    // FRESH ORDER BOOK CHECK
    // --------------------------------------------------------
    //
    // Every fresh OPEN gets a fresh order-book snapshot.
    //
    // Reversals also come here only AFTER the old position
    // has been confirmed FLAT.
    //
    // --------------------------------------------------------

    const orderBookCheck =
        await checkOrderBook(
            symbol,
            direction
        );


    if (
        !orderBookCheck.allowed
    ) {

        console.log("");

        console.log(
            "############################################################"
        );

        console.log(
            "ORDER BLOCKED BY WEEX ORDER BOOK"
        );

        console.log(
            "############################################################"
        );

        console.log(
            "Symbol:",
            symbol
        );

        console.log(
            "Direction:",
            direction
        );

        console.log(
            "Reason:",
            orderBookCheck.reason
        );

        console.log(
            "Imbalance:",
            orderBookCheck.imbalance
        );

        console.log(
            "Bid liquidity:",
            orderBookCheck.bidLiquidity
        );

        console.log(
            "Ask liquidity:",
            orderBookCheck.askLiquidity
        );

        console.log(
            "############################################################"
        );


        return {

            success:
                false,

            blocked:
                true,

            reason:
                orderBookCheck.reason,

            orderBook:
                orderBookCheck

        };

    }


    console.log("");

    console.log(
        `${symbol}: ORDER BOOK PASSED`
    );

    console.log(
        `Direction ${direction} is supported by WEEX order book.`
    );


    // --------------------------------------------------------
    // BALANCE
    // --------------------------------------------------------

    const balance =
        await getFuturesBalance();


    if (
        balance.available <
        DEFAULT_MARGIN
    ) {

        throw new Error(
            `${symbol}: insufficient available balance. ` +
            `Available ${balance.available} USDT, ` +
            `required approximately ${DEFAULT_MARGIN} USDT`
        );

    }


    // --------------------------------------------------------
    // PRICE
    // --------------------------------------------------------

    const price =
        await getPrice(
            symbol
        );


    // --------------------------------------------------------
    // POSITION CALCULATION
    // --------------------------------------------------------

    const calculation =
        calculatePosition(
            symbol,
            price
        );


    printPosition(
        symbol,
        price,
        calculation
    );


    // --------------------------------------------------------
    // LEVERAGE
    // --------------------------------------------------------

    await ensureLeverage(
        symbol
    );


    console.log("");

    console.log(
        "============================================================"
    );

    console.log(
        "OPEN MARKET ORDER"
    );

    console.log(
        "============================================================"
    );

    console.log(
        "Symbol:",
        symbol
    );

    console.log(
        "Direction:",
        direction
    );

    console.log(
        "Side:",
        direction === "LONG"
            ? "BUY"
            : "SELL"
    );

    console.log(
        "Position side:",
        direction
    );

    console.log(
        "Quantity:",
        formatQuantity(
            symbol,
            calculation.quantity
        )
    );

    console.log(
        "Step size:",
        getContract(
            symbol
        ).stepSize
    );


    // --------------------------------------------------------
    // ACTUAL WEEX ORDER
    // --------------------------------------------------------

    const result =
        await placeOpenOrder(
            symbol,
            direction,
            calculation
        );


    console.log("");

    console.log(
        "OPEN ORDER RESPONSE:"
    );

    console.log(
        JSON.stringify(
            result,
            null,
            2
        )
    );


    return {

        success:
            true,

        blocked:
            false,

        result,

        calculation,

        orderBook:
            orderBookCheck

    };

}


// ============================================================
// BUILD CLOSE ORDER
// ============================================================

function buildCloseOrder(
    symbol,
    direction,
    quantity,
    clientOrderId
) {

    return {

        symbol,

        side:
            direction === "LONG"
                ? "SELL"
                : "BUY",

        positionSide:
            direction,

        type:
            "MARKET",

        quantity,

        newClientOrderId:
            clientOrderId,

        reduceOnly:
            true

    };

}


// ============================================================
// CLOSE POSITION
// ============================================================
//
// IMPORTANT:
//
// CLOSE IS NEVER ORDER-BOOK FILTERED.
//
// ============================================================

async function closePosition(
    position
) {

    if (
        !position ||
        position.direction === "FLAT" ||
        position.quantity <= 0
    ) {

        return {

            success:
                true,

            reason:
                "ALREADY_FLAT"

        };

    }


    const symbol =
        position.symbol;


    let quantity =
        formatQuantity(
            symbol,
            position.quantity
        );


    let order =
        buildCloseOrder(
            symbol,
            position.direction,
            quantity,
            `TV_CLOSE_${symbol}_${Date.now()}`
        );


    console.log("");

    console.log(
        "============================================================"
    );

    console.log(
        "CLOSE POSITION"
    );

    console.log(
        "============================================================"
    );

    console.log(
        "Symbol:",
        symbol
    );

    console.log(
        "Direction:",
        position.direction
    );

    console.log(
        "Quantity:",
        quantity
    );

    console.log(
        "ORDER BOOK FILTER:",
        "NOT APPLIED"
    );


    try {

        const result =
            await weexRequest(
                "POST",
                "/capi/v3/order",
                order
            );


        console.log("");

        console.log(
            "CLOSE ORDER RESPONSE:"
        );

        console.log(
            JSON.stringify(
                result,
                null,
                2
            )
        );


        return {

            success:
                true,

            result

        };

    } catch (error) {

        const step =
            extractStepSizeFromError(
                error
            );


        if (
            !step
        ) {

            throw error;

        }


        console.warn("");

        console.warn(
            `${symbol}: close order reported stepSize ${step}`
        );


        CONTRACT_INFO[symbol].stepSize =
            step;


        quantity =
            formatQuantity(
                symbol,
                position.quantity
            );


        order =
            buildCloseOrder(
                symbol,
                position.direction,
                quantity,
                `TV_CLOSE_${symbol}_${Date.now()}_R`
            );


        const result =
            await weexRequest(
                "POST",
                "/capi/v3/order",
                order
            );


        return {

            success:
                true,

            result

        };

    }

}


// ============================================================
// WAIT FOR POSITION
// ============================================================

async function waitForPosition(
    symbol,
    expectedDirection,
    maxAttempts = 20
) {

    for (
        let attempt = 1;
        attempt <= maxAttempts;
        attempt++
    ) {

        await sleep(500);


        const position =
            await getCurrentPosition(
                symbol
            );


        if (
            expectedDirection ===
            "FLAT"
        ) {

            if (
                position.direction ===
                "FLAT"
            ) {

                console.log(
                    `${symbol}: confirmed FLAT`
                );


                return true;

            }

        } else {

            if (
                position.direction ===
                expectedDirection
            ) {

                console.log(
                    `${symbol}: confirmed ${expectedDirection}`
                );


                return true;

            }

        }


        console.log(
            `${symbol}: waiting for ${expectedDirection} ` +
            `${attempt}/${maxAttempts}`
        );

    }


    return false;

}


// ============================================================
// PROCESS SIGNAL
// ============================================================
//
// LONG:
//
// FLAT  -> FRESH ORDER BOOK -> OPEN LONG
// LONG  -> NOTHING
// SHORT -> CLOSE -> FLAT -> FRESH ORDER BOOK -> OPEN LONG
//
// SHORT:
//
// FLAT  -> FRESH ORDER BOOK -> OPEN SHORT
// SHORT -> NOTHING
// LONG  -> CLOSE -> FLAT -> FRESH ORDER BOOK -> OPEN SHORT
//
// CLOSE:
//
// LONG/SHORT -> CLOSE
//
// CLOSE_LONG:
//
// LONG -> CLOSE
// SHORT -> NOTHING
//
// CLOSE_SHORT:
//
// SHORT -> CLOSE
// LONG -> NOTHING
//
// ============================================================

async function processSignal(
    symbol,
    action
) {

    symbol =
        normalizeSymbol(
            symbol
        );


    action =
        String(
            action || ""
        )
            .trim()
            .toUpperCase();


    getSymbolSettings(
        symbol
    );


    if (
        action !== "LONG" &&
        action !== "SHORT" &&
        action !== "CLOSE" &&
        action !== "CLOSE_LONG" &&
        action !== "CLOSE_SHORT"
    ) {

        throw new Error(
            "Action must be LONG, SHORT, CLOSE, CLOSE_LONG or CLOSE_SHORT."
        );

    }


    if (
        !TRADING_ENABLED
    ) {

        console.log(
            "TRADING DISABLED."
        );

        console.log(
            "TRADING DISABLED."
        );


        return {

            success:
                false,

            reason:
                "TRADING_DISABLED",

            symbol,

            action

        };

    }


    // --------------------------------------------------------
    // LOCK
    // --------------------------------------------------------

    await acquireTradingLock(
        symbol
    );


    try {

        console.log("");

        console.log(
            "############################################################"
        );

        console.log(
            "PROCESSING SIGNAL"
        );

        console.log(
            "Symbol:",
            symbol
        );

        console.log(
            "Action:",
            action
        );

        console.log(
            "Lock:",
            `${symbol} ONLY`
        );

        console.log(
            "############################################################"
        );


        // ----------------------------------------------------
        // ALWAYS READ LIVE POSITION
        // ----------------------------------------------------

        const current =
            await getCurrentPosition(
                symbol
            );


        // ====================================================
        // CLOSE
        // ====================================================

        if (
            action === "CLOSE" ||
            action === "CLOSE_LONG" ||
            action === "CLOSE_SHORT"
        ) {

            if (
                current.direction === "FLAT"
            ) {

                console.log(
                    `${symbol}: already FLAT. Nothing to close.`
                );


                return {

                    success:
                        true,

                    symbol,

                    action:
                        "ALREADY_FLAT"

                };

            }


            // ------------------------------------------------
            // CLOSE LONG SAFETY
            // ------------------------------------------------

            if (
                action === "CLOSE_LONG" &&
                current.direction !== "LONG"
            ) {

                return {

                    success:
                        true,

                    symbol,

                    action:
                        "NO_ACTION",

                    reason:
                        `CLOSE_LONG_RECEIVED_BUT_POSITION_IS_${current.direction}`,

                    position:
                        current

                };

            }


            // ------------------------------------------------
            // CLOSE SHORT SAFETY
            // ------------------------------------------------

            if (
                action === "CLOSE_SHORT" &&
                current.direction !== "SHORT"
            ) {

                return {

                    success:
                        true,

                    symbol,

                    action:
                        "NO_ACTION",

                    reason:
                        `CLOSE_SHORT_RECEIVED_BUT_POSITION_IS_${current.direction}`,

                    position:
                        current

                };

            }


            // ------------------------------------------------
            // CLOSE
            // ------------------------------------------------

            console.log("");

            console.log(
                `${symbol}: closing ${current.direction}`
            );

            console.log(
                "Order book filter:",
                "NOT APPLIED"
            );


            const closeResult =
                await closePosition(
                    current
                );


            // ------------------------------------------------
            // CONFIRM FLAT
            // ------------------------------------------------

            const flat =
                await waitForPosition(
                    symbol,
                    "FLAT"
                );


            if (
                !flat
            ) {

                throw new Error(
                    `${symbol}: WEEX did not confirm position closed.`
                );

            }


            return {

                success:
                    true,

                symbol,

                action:
                    action === "CLOSE_LONG"
                        ? "CLOSED_LONG"
                        : action === "CLOSE_SHORT"
                            ? "CLOSED_SHORT"
                            : "CLOSED",

                result:
                    closeResult

            };

        }


        // ====================================================
        // SAME DIRECTION
        // ====================================================

        if (
            current.direction ===
            action
        ) {

            console.log(
                `${symbol}: already ${action}. No order.`
            );


            return {

                success:
                    true,

                symbol,

                action:
                    "NO_ACTION",

                reason:
                    `ALREADY_${action}`,

                position:
                    current

            };

        }


        // ====================================================
        // OPPOSITE DIRECTION
        // ====================================================

        if (
            current.direction !==
                "FLAT" &&
            current.direction !==
                action
        ) {

            console.log("");

            console.log(
                `${symbol}: REVERSING`
            );

            console.log(
                "Current:",
                current.direction
            );

            console.log(
                "New:",
                action
            );


            // ------------------------------------------------
            // STEP 1: CLOSE
            // ------------------------------------------------

            const closeResult =
                await closePosition(
                    current
                );


            // ------------------------------------------------
            // STEP 2: CONFIRM FLAT
            // ------------------------------------------------

            const flat =
                await waitForPosition(
                    symbol,
                    "FLAT"
                );


            if (
                !flat
            ) {

                throw new Error(
                    `${symbol}: old position did not close.`
                );

            }


            // ------------------------------------------------
            // STEP 3:
            //
            // openMarketPosition()
            // performs a FRESH order-book request.
            //
            // ------------------------------------------------

            console.log("");

            console.log(
                `${symbol}: OLD POSITION CLOSED`
            );

            console.log(
                `${symbol}: REQUESTING FRESH ORDER BOOK FOR ${action}`
            );


            const openResult =
                await openMarketPosition(
                    symbol,
                    action
                );


            // ------------------------------------------------
            // IMPORTANT:
            //
            // If order book blocks the new direction,
            // we remain FLAT.
            //
            // ------------------------------------------------

            if (
                openResult.blocked
            ) {

                console.log("");

                console.log(
                    `${symbol}: REVERSAL OPEN BLOCKED BY ORDER BOOK`
                );

                console.log(
                    `${symbol}: CURRENT POSITION IS FLAT`
                );


                return {

                    success:
                        false,

                    symbol,

                    action:
                        `REVERSAL_TO_${action}_BLOCKED`,

                    close:
                        closeResult,

                    open:
                        openResult

                };

            }


            // ------------------------------------------------
            // STEP 4: CONFIRM NEW POSITION
            // ------------------------------------------------

            const verified =
                await waitForPosition(
                    symbol,
                    action
                );


            if (
                !verified
            ) {

                throw new Error(
                    `${symbol}: WEEX did not confirm ${action} after reversal.`
                );

            }


            return {

                success:
                    true,

                symbol,

                action:
                    `REVERSED_TO_${action}`,

                close:
                    closeResult,

                open:
                    openResult,

                position:
                    await getCurrentPosition(
                        symbol
                    )

            };

        }


        // ====================================================
        // FLAT -> OPEN
        // ====================================================

        const openResult =
            await openMarketPosition(
                symbol,
                action
            );


        // ----------------------------------------------------
        // BLOCKED
        // ----------------------------------------------------

        if (
            openResult.blocked
        ) {

            console.log("");

            console.log(
                `${symbol}: ENTRY BLOCKED BY ORDER BOOK`
            );

            console.log(
                "Direction:",
                action
            );

            console.log(
                "Reason:",
                openResult.reason
            );


            return {

                success:
                    false,

                symbol,

                action:
                    "ENTRY_BLOCKED",

                reason:
                    openResult.reason,

                orderBook:
                    openResult.orderBook

            };

        }


        // ----------------------------------------------------
        // CONFIRM POSITION
        // ----------------------------------------------------

        const verified =
            await waitForPosition(
                symbol,
                action
            );


        if (
            !verified
        ) {

            throw new Error(
                `${symbol}: WEEX did not confirm ${action} after opening.`
            );

        }


        return {

            success:
                true,

            symbol,

            action:
                `OPENED_${action}`,

            result:
                openResult,

            position:
                await getCurrentPosition(
                    symbol
                )

        };


    } finally {

        releaseTradingLock(
            symbol
        );

    }

}


// ============================================================
// TRADINGVIEW WEBHOOK
// ============================================================
//
// Immediate HTTP 200.
//
// Actual WEEX processing runs in background.
//
// ============================================================

app.post(
    "/webhook",
    async (
        req,
        res
    ) => {

        console.log("");

        console.log(
            "============================================================"
        );

        console.log(
            "TRADINGVIEW WEBHOOK RECEIVED"
        );

        console.log(
            "============================================================"
        );


        console.log(
            JSON.stringify(
                req.body,
                null,
                2
            )
        );


        try {

            const symbol =
                normalizeSymbol(
                    req.body?.symbol
                );


            const action =
                String(
                    req.body?.action ||
                    ""
                )
                    .trim()
                    .toUpperCase();


            console.log(
                "Original symbol:",
                req.body?.symbol
            );

            console.log(
                "Normalized symbol:",
                symbol
            );

            console.log(
                "Action:",
                action
            );


            if (
                !SUPPORTED_SYMBOLS.has(
                    symbol
                )
            ) {

                return res
                    .status(400)
                    .json({

                        success:
                            false,

                        error:
                            "Unsupported or unavailable WEEX symbol",

                        symbol

                    });

            }


            if (
                action !== "LONG" &&
                action !== "SHORT" &&
                action !== "CLOSE" &&
                action !== "CLOSE_LONG" &&
                action !== "CLOSE_SHORT"
            ) {

                return res
                    .status(400)
                    .json({

                        success:
                            false,

                        error:
                            "Invalid action"

                    });

            }


            // ------------------------------------------------
            // IMMEDIATE ACK
            // ------------------------------------------------

            res
                .status(200)
                .json({

                    success:
                        true,

                    accepted:
                        true,

                    symbol,

                    action,

                    message:
                        "Signal accepted for background processing."

                });


            console.log("");

            console.log(
                `WEBHOOK ACK SENT: ${symbol} ${action}`
            );


            // ------------------------------------------------
            // BACKGROUND
            // ------------------------------------------------

            processSignal(
                symbol,
                action
            )
                .then(
                    result => {

                        console.log("");

                        console.log(
                            "============================================================"
                        );

                        console.log(
                            "BACKGROUND SIGNAL COMPLETE"
                        );

                        console.log(
                            "Symbol:",
                            symbol
                        );

                        console.log(
                            "Action:",
                            action
                        );

                        console.log(
                            JSON.stringify(
                                result,
                                null,
                                2
                            )
                        );

                        console.log(
                            "============================================================"
                        );

                    }
                )
                .catch(
                    error => {

                        console.error("");

                        console.error(
                            "============================================================"
                        );

                        console.error(
                            "BACKGROUND SIGNAL ERROR"
                        );

                        console.error(
                            "Symbol:",
                            symbol
                        );

                        console.error(
                            "Action:",
                            action
                        );

                        console.error(
                            "Error:",
                            error.message
                        );


                        if (
                            error.data
                        ) {

                            console.error(
                                JSON.stringify(
                                    error.data,
                                    null,
                                    2
                                )
                            );

                        }

                        console.error(
                            "============================================================"
                        );

                    }
                );


        } catch (error) {

            console.error(
                "WEBHOOK VALIDATION ERROR:",
                error.message
            );


            if (
                !res.headersSent
            ) {

                return res
                    .status(500)
                    .json({

                        success:
                            false,

                        error:
                            error.message

                    });

            }

        }

    }
);


// ============================================================
// MANUAL SIGNAL HANDLER
// ============================================================

async function handleManualSignal(
    req,
    res,
    action
) {

    try {

        const symbol =
            normalizeSymbol(
                req.query?.symbol ||
                req.body?.symbol
            );


        if (
            !SUPPORTED_SYMBOLS.has(
                symbol
            )
        ) {

            return res
                .status(400)
                .json({

                    success:
                        false,

                    error:
                        "Invalid or unavailable WEEX symbol",

                    symbol

                });

        }


        const result =
            await processSignal(
                symbol,
                action
            );


        return res.json(
            result
        );


    } catch (error) {

        console.error("");

        console.error(
            `MANUAL ${action} ERROR`
        );

        console.error(
            error.message
        );


        if (
            error.data
        ) {

            console.error(
                JSON.stringify(
                    error.data,
                    null,
                    2
                )
            );

        }


        return res
            .status(500)
            .json({

                success:
                    false,

                error:
                    error.message,

                weex:
                    error.data ||
                    null

            });

    }

}


// ============================================================
// MANUAL LONG
// ============================================================

app.post(
    "/manual-long",
    async (
        req,
        res
    ) => {

        return handleManualSignal(
            req,
            res,
            "LONG"
        );

    }
);


// ============================================================
// MANUAL SHORT
// ============================================================

app.post(
    "/manual-short",
    async (
        req,
        res
    ) => {

        return handleManualSignal(
            req,
            res,
            "SHORT"
        );

    }
);


// ============================================================
// MANUAL CLOSE
// ============================================================

app.post(
    "/manual-close",
    async (
        req,
        res
    ) => {

        return handleManualSignal(
            req,
            res,
            "CLOSE"
        );

    }
);


// ============================================================
// READ-ONLY ORDER BOOK TEST
// ============================================================
//
// THIS ENDPOINT NEVER PLACES AN ORDER.
//
// It works even when:
//
// TRADING_ENABLED=false
//
// Example:
//
// GET /test-orderbook?symbol=BTCUSDT&direction=LONG
//
// ============================================================

app.get(
    "/test-orderbook",
    async (
        req,
        res
    ) => {

        try {

            const symbol =
                normalizeSymbol(
                    req.query?.symbol
                );


            const direction =
                String(
                    req.query?.direction ||
                    "LONG"
                )
                    .trim()
                    .toUpperCase();


            if (
                !SUPPORTED_SYMBOLS.has(
                    symbol
                )
            ) {

                return res
                    .status(400)
                    .json({

                        success:
                            false,

                        error:
                            "Invalid or unavailable WEEX symbol",

                        symbol

                    });

            }


            if (
                direction !== "LONG" &&
                direction !== "SHORT"
            ) {

                return res
                    .status(400)
                    .json({

                        success:
                            false,

                        error:
                            "direction must be LONG or SHORT"

                    });

            }


            console.log("");

            console.log(
                "############################################################"
            );

            console.log(
                "READ-ONLY ORDER BOOK TEST"
            );

            console.log(
                "Symbol:",
                symbol
            );

            console.log(
                "Direction:",
                direction
            );

            console.log(
                "TRADING:",
                "NOT USED"
            );

            console.log(
                "ORDER:",
                "NEVER PLACED"
            );

            console.log(
                "############################################################"
            );


            const result =
                await checkOrderBook(
                    symbol,
                    direction
                );


            return res.json({

                success:
                    true,

                readOnly:
                    true,

                orderPlaced:
                    false,

                tradingEnabled:
                    TRADING_ENABLED,

                symbol,

                direction,

                result

            });


        } catch (error) {

            console.error("");

            console.error(
                "ORDER BOOK TEST ERROR"
            );

            console.error(
                error.message
            );


            return res
                .status(500)
                .json({

                    success:
                        false,

                    readOnly:
                        true,

                    orderPlaced:
                        false,

                    error:
                        error.message,

                    weex:
                        error.data ||
                        null

                });

        }

    }
);


// ============================================================
// LIST SYMBOLS
// ============================================================

app.get(
    "/symbols",
    (
        req,
        res
    ) => {

        const symbols =
            Array.from(
                SUPPORTED_SYMBOLS
            )
                .sort()
                .map(
                    symbol => ({

                        symbol,

                        margin:
                            DEFAULT_MARGIN,

                        leverage:
                            DEFAULT_LEVERAGE,

                        targetNotional:
                            DEFAULT_MARGIN *
                            DEFAULT_LEVERAGE,

                        stepSize:
                            CONTRACT_INFO[
                                symbol
                            ]?.stepSize,

                        quantityPrecision:
                            CONTRACT_INFO[
                                symbol
                            ]?.quantityPrecision,

                        minOrderSize:
                            CONTRACT_INFO[
                                symbol
                            ]?.minOrderSize,

                        maxOrderSize:
                            CONTRACT_INFO[
                                symbol
                            ]?.maxOrderSize

                    })
                );


        return res.json({

            count:
                symbols.length,

            margin:
                DEFAULT_MARGIN,

            leverage:
                DEFAULT_LEVERAGE,

            targetNotional:
                DEFAULT_MARGIN *
                DEFAULT_LEVERAGE,

            orderBook: {

                depth:
                    ORDER_BOOK_DEPTH,

                longMinImbalance:
                    LONG_MIN_IMBALANCE,

                shortMaxImbalance:
                    SHORT_MAX_IMBALANCE,

                minBidAskRatio:
                    MIN_BID_ASK_RATIO,

                minAskBidRatio:
                    MIN_ASK_BID_RATIO

            },

            symbols

        });

    }
);


// ============================================================
// REFRESH SYMBOLS
// ============================================================

app.post(
    "/refresh-symbols",
    async (
        req,
        res
    ) => {

        try {

            await loadAllContracts();


            return res.json({

                success:
                    true,

                count:
                    SUPPORTED_SYMBOLS.size,

                symbols:
                    Array.from(
                        SUPPORTED_SYMBOLS
                    )
                        .sort()

            });

        } catch (error) {

            return res
                .status(500)
                .json({

                    success:
                        false,

                    error:
                        error.message

                });

        }

    }
);


// ============================================================
// STATUS
// ============================================================

app.get(
    "/status",
    async (
        req,
        res
    ) => {

        try {

            const balance =
                await getFuturesBalance();


            return res.json({

                online:
                    true,

                tradingEnabled:
                    TRADING_ENABLED,

                mode:
                    TRADING_ENABLED
                        ? "LIVE"
                        : "DISABLED",

                api:
                    "WEEX V3 USDT-M",

                marginMode:
                    REQUIRED_MARGIN_MODE,

                defaultRisk: {

                    margin:
                        DEFAULT_MARGIN,

                    leverage:
                        DEFAULT_LEVERAGE,

                    positionNotional:
                        DEFAULT_MARGIN *
                        DEFAULT_LEVERAGE

                },

                orderBookFilter: {

                    enabled:
                        true,

                    depth:
                        ORDER_BOOK_DEPTH,

                    long:
                        "BID DOMINANCE",

                    short:
                        "ASK DOMINANCE",

                    close:
                        "NEVER FILTERED"

                },

                reversal:
                    "CLOSE -> CONFIRM FLAT -> FRESH ORDER BOOK -> OPEN",

                discoveredSymbols:
                    SUPPORTED_SYMBOLS.size,

                balance:
                    balance.available,

                symbols:
                    Array.from(
                        SUPPORTED_SYMBOLS
                    )
                        .sort()

            });


        } catch (error) {

            return res
                .status(500)
                .json({

                    online:
                        true,

                    error:
                        error.message

                });

        }

    }
);


// ============================================================
// INDIVIDUAL POSITION
// ============================================================

app.get(
    "/position",
    async (
        req,
        res
    ) => {

        try {

            const symbol =
                normalizeSymbol(
                    req.query?.symbol
                );


            if (
                !SUPPORTED_SYMBOLS.has(
                    symbol
                )
            ) {

                return res
                    .status(400)
                    .json({

                        success:
                            false,

                        error:
                            "Invalid or unavailable symbol",

                        symbol

                    });

            }


            const position =
                await getCurrentPosition(
                    symbol
                );


            return res.json(
                position
            );


        } catch (error) {

            return res
                .status(500)
                .json({

                    success:
                        false,

                    error:
                        error.message

                });

        }

    }
);


// ============================================================
// TEST ORDER BOOK
// ============================================================
//
// GET:
// /test-orderbook?symbol=BTCUSDT&direction=LONG
//
// GET:
// /test-orderbook?symbol=BTCUSDT&direction=SHORT
//
// IMPORTANT:
// This endpoint ONLY checks the live WEEX order book.
// It NEVER places an order.
// ============================================================

app.get(
    "/test-orderbook",
    async (
        req,
        res
    ) => {

        try {

            // ------------------------------------------------
            // NORMALIZE SYMBOL
            // ------------------------------------------------

            const symbol =
                normalizeSymbol(
                    req.query?.symbol
                );


            // ------------------------------------------------
            // NORMALIZE DIRECTION
            // ------------------------------------------------

            const direction =
                String(
                    req.query?.direction ||
                    ""
                )
                    .trim()
                    .toUpperCase();


            // ------------------------------------------------
            // VALIDATE SYMBOL
            // ------------------------------------------------

            if (
                !SUPPORTED_SYMBOLS.has(
                    symbol
                )
            ) {

                return res
                    .status(400)
                    .json({

                        success:
                            false,

                        error:
                            "Invalid or unavailable WEEX symbol",

                        symbol

                    });

            }


            // ------------------------------------------------
            // VALIDATE DIRECTION
            // ------------------------------------------------

            if (
                direction !== "LONG" &&
                direction !== "SHORT"
            ) {

                return res
                    .status(400)
                    .json({

                        success:
                            false,

                        error:
                            "direction must be LONG or SHORT",

                        direction

                    });

            }


            // ------------------------------------------------
            // RUN LIVE ORDER BOOK FILTER
            // ------------------------------------------------

            const result =
                await checkOrderBook(
                    symbol,
                    direction
                );


            // ------------------------------------------------
            // RETURN RESULT
            // ------------------------------------------------

            return res.json({

                success:
                    true,

                test:
                    true,

                symbol,

                direction,

                orderBook:
                    result

            });


        } catch (error) {

            console.error("");

            console.error(
                "TEST ORDER BOOK ERROR"
            );

            console.error(
                error.message
            );


            if (
                error.data
            ) {

                console.error(
                    JSON.stringify(
                        error.data,
                        null,
                        2
                    )
                );

            }


            return res
                .status(500)
                .json({

                    success:
                        false,

                    error:
                        error.message,

                    weex:
                        error.data ||
                        null

                });

        }

    }
);

// ============================================================
// ROOT
// ============================================================

app.get(
    "/",
    (
        req,
        res
    ) => {

        res.json({

            status:
                "online",

            service:
                "TradingView -> WEEX V3 Server V2",

            trading:
                TRADING_ENABLED,

            mode:
                TRADING_ENABLED
                    ? "LIVE"
                    : "DISABLED",

            api:
                "WEEX V3 USDT-M Futures",

            marginMode:
                REQUIRED_MARGIN_MODE,

            defaultRisk: {

                margin:
                    DEFAULT_MARGIN,

                leverage:
                    DEFAULT_LEVERAGE,

                positionNotional:
                    DEFAULT_MARGIN *
                    DEFAULT_LEVERAGE

            },

            orderBookFilter: {

                enabled:
                    true,

                depth:
                    ORDER_BOOK_DEPTH,

                long:
                    "BID DOMINANCE REQUIRED",

                short:
                    "ASK DOMINANCE REQUIRED",

                close:
                    "NEVER FILTERED"

            },

            reversal:
                "CLOSE -> CONFIRM FLAT -> FRESH ORDER BOOK -> OPEN",

            discoveredSymbols:
                SUPPORTED_SYMBOLS.size,

            behavior:
                "LONG/SHORT automatic reversal + CLOSE_LONG/CLOSE_SHORT",

            webhookMode:
                "Immediate HTTP 200 + background processing",

            concurrency:
                "Per-symbol locks",

            automaticSymbolDiscovery:
                true,

            endpoints: {

                webhook:
                    "POST /webhook",

                manualLong:
                    "POST /manual-long?symbol=BTCUSDT",

                manualShort:
                    "POST /manual-short?symbol=BTCUSDT",

                manualClose:
                    "POST /manual-close?symbol=BTCUSDT",

                testOrderBook:
                    "GET /test-orderbook?symbol=BTCUSDT&direction=LONG",

                status:
                    "GET /status",

                symbols:
                    "GET /symbols",

                position:
                    "GET /position?symbol=BTCUSDT",

                refresh:
                    "POST /refresh-symbols"

            }

        });

    }
);


// ============================================================
// START SERVER
// ============================================================

app.listen(
    PORT,
    async () => {

        console.log("");

        console.log(
            "============================================================"
        );

        console.log(
            "SERVER V2 STARTED"
        );

        console.log(
            "============================================================"
        );

        console.log(
            `Server running on port ${PORT}`
        );

        console.log(
            "Trading:",
            TRADING_ENABLED
                ? "ENABLED - LIVE"
                : "DISABLED"
        );

        console.log(
            "API:",
            "WEEX V3 USDT-M Futures"
        );

        console.log(
            "Default margin:",
            DEFAULT_MARGIN,
            "USDT"
        );

        console.log(
            "Default leverage:",
            DEFAULT_LEVERAGE,
            "x"
        );

        console.log(
            "Target notional:",
            DEFAULT_MARGIN *
            DEFAULT_LEVERAGE,
            "USDT"
        );

        console.log(
            "Margin mode:",
            REQUIRED_MARGIN_MODE
        );

        console.log(
            "Order-book filter:",
            "ENABLED"
        );

        console.log(
            "LONG:",
            "BID DOMINANCE"
        );

        console.log(
            "SHORT:",
            "ASK DOMINANCE"
        );

        console.log(
            "CLOSE:",
            "NEVER FILTERED"
        );

        console.log(
            "Reversal:",
            "CLOSE -> FLAT -> FRESH ORDER BOOK -> OPEN"
        );

        console.log(
            "Symbol discovery:",
            "AUTOMATIC"
        );

        console.log(
            "Webhook:",
            "IMMEDIATE ACK"
        );

        console.log(
            "Concurrency:",
            "PER-SYMBOL"
        );

        console.log(
            "============================================================"
        );


        try {

            await loadAllContracts();


            // ------------------------------------------------
            // BALANCE ONLY IF CREDENTIALS EXIST
            // ------------------------------------------------

            if (
                API_KEY &&
                API_SECRET &&
                API_PASSPHRASE
            ) {

                const balance =
                    await getFuturesBalance();


                console.log("");

                console.log(
                    "============================================================"
                );

                console.log(
                    "BOT READY"
                );

                console.log(
                    "============================================================"
                );

                console.log(
                    "Available WEEX USDT-M symbols:",
                    SUPPORTED_SYMBOLS.size
                );

                console.log(
                    "Available balance:",
                    balance.available,
                    "USDT"
                );

            } else {

                console.log("");

                console.log(
                    "BOT STARTED WITHOUT PRIVATE API CREDENTIALS."
                );

                console.log(
                    "Public order-book testing is still available."
                );

            }


            console.log("");

            console.log(
                "READ-ONLY ORDER BOOK TEST:"
            );

            console.log(
                "GET /test-orderbook?symbol=BTCUSDT&direction=LONG"
            );

            console.log("");

            console.log(
                "Example PowerShell:"
            );

            console.log(
                'Invoke-RestMethod -Method GET -Uri "http://localhost:3000/test-orderbook?symbol=BTCUSDT&direction=LONG"'
            );

            console.log("");

            console.log(
                "Manual LONG:"
            );

            console.log(
                "POST /manual-long?symbol=BTCUSDT"
            );

            console.log("");

            console.log(
                "Manual SHORT:"
            );

            console.log(
                "POST /manual-short?symbol=BTCUSDT"
            );

            console.log("");

            console.log(
                "Manual CLOSE:"
            );

            console.log(
                "POST /manual-close?symbol=BTCUSDT"
            );

            console.log("");

            console.log(
                "Risk:"
            );

            console.log(
                `${DEFAULT_MARGIN} USDT margin / ` +
                `${DEFAULT_LEVERAGE}x / ` +
                `~${DEFAULT_MARGIN * DEFAULT_LEVERAGE} USDT notional`
            );

            console.log("");

            console.log(
                "============================================================"
            );


        } catch (error) {

            console.error("");

            console.error(
                "============================================================"
            );

            console.error(
                "STARTUP FAILED"
            );

            console.error(
                "============================================================"
            );

            console.error(
                error.message
            );


            if (
                error.data
            ) {

                console.error(
                    JSON.stringify(
                        error.data,
                        null,
                        2
                    )
                );

            }

        }

    }
);

