require("dotenv").config();

const express = require("express");
const crypto = require("crypto");

const app = express();

app.use(express.json());


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
//
// EVERY DISCOVERED WEEX USDT-M CONTRACT USES:
//
// Margin:       3 USDT
// Leverage:     10x
// Target:       ~30 USDT notional
//
// You do NOT need to add coins manually.
//
// WEEX tells the bot which contracts exist.
//

const DEFAULT_MARGIN = 1;

const DEFAULT_LEVERAGE = 10;

const REQUIRED_MARGIN_MODE = "ISOLATED";


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
//
// Different coins can trade simultaneously.
//
// Example:
//
// SOLUSDT  -> independent
// LINKUSDT -> independent
// BONKUSDT -> independent
// POLUSDT  -> independent
//
// But two signals for the same symbol are processed in order.
//
// Example:
//
// LINK LONG
// LINK SHORT
//
// The SHORT waits until the LONG operation is finished.
//
// ============================================================

const symbolLocks = new Map();


function sleep(ms) {

    return new Promise(
        resolve =>
            setTimeout(
                resolve,
                ms
            )
    );

}


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
    "TRADINGVIEW -> WEEX DYNAMIC MULTI-COIN BOT"
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

    if (queryString) {

        message +=
            "?" +
            queryString;

    }

    if (body) {

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

    if (
        !API_KEY ||
        !API_SECRET ||
        !API_PASSPHRASE
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

    const upperMethod =
        method.toUpperCase();


    // --------------------------------------------------------
    // GET
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
    // POST
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


    if (queryString) {

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


    if (queryString) {

        console.log(
            "QUERY:",
            queryString
        );

    }


    if (body) {

        console.log(
            "BODY:",
            body
        );

    }


    const response =
        await fetch(
            url,
            {

                method:
                    upperMethod,

                headers: {

                    "ACCESS-KEY":
                        API_KEY,

                    "ACCESS-SIGN":
                        signature,

                    "ACCESS-PASSPHRASE":
                        API_PASSPHRASE,

                    "ACCESS-TIMESTAMP":
                        timestamp,

                    "Content-Type":
                        "application/json",

                    "User-Agent":
                        "TradingView-WEEX-Dynamic-Bot/1.0"

                },

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


    if (!response.ok) {

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
//
// Handles:
//
// BTCUSDT
// BTCUSDT.P
// BINANCE:BTCUSDT
// WEEX:BTCUSDT.P
// BTC/USDT
// BTCUSDT:PERP
//
// Result:
//
// BTCUSDT
//

function normalizeSymbol(symbol) {

    let value =
        String(symbol || "")
            .trim()
            .toUpperCase();


    if (!value) {

        return "";

    }


    // --------------------------------------------------------
    // Remove exchange prefix
    // --------------------------------------------------------

    if (
        value.includes(":")
    ) {

        value =
            value.split(":").pop();

    }


    // --------------------------------------------------------
    // Remove slash
    // --------------------------------------------------------

    value =
        value.replace(
            /\//g,
            ""
        );


    // --------------------------------------------------------
    // Remove TradingView perpetual suffix
    // --------------------------------------------------------

    value =
        value.replace(
            /\.P$/i,
            ""
        );


    // --------------------------------------------------------
    // Remove common perpetual text
    // --------------------------------------------------------

    value =
        value.replace(
            /:PERP$/i,
            ""
        );


    // --------------------------------------------------------
    // Remove spaces
    // --------------------------------------------------------

    value =
        value.replace(
            /\s+/g,
            ""
        );


    return value;

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


    // --------------------------------------------------------
    // GET ALL CONTRACT INFORMATION
    // --------------------------------------------------------

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


    // --------------------------------------------------------
    // GET API-TRADABLE SYMBOLS
    // --------------------------------------------------------

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


    // --------------------------------------------------------
    // RESET CACHE
    // --------------------------------------------------------

    SUPPORTED_SYMBOLS.clear();


    for (
        const contract of contracts
    ) {

        const symbol =
            normalizeSymbol(
                contract?.symbol
            );


        if (!symbol) {

            continue;

        }


        // ----------------------------------------------------
        // Only USDT-M contracts
        // ----------------------------------------------------

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


        // ----------------------------------------------------
        // API tradability filter
        // ----------------------------------------------------

        if (
            apiTradingSet &&
            !apiTradingSet.has(symbol)
        ) {

            continue;

        }


        // ----------------------------------------------------
        // Normalize contract data
        // ----------------------------------------------------

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


    const sortedSymbols =
        Array.from(
            SUPPORTED_SYMBOLS
        )
            .sort();


    console.log(
        sortedSymbols.join(", ")
    );


    console.log("");

    console.log(
        "All symbols will use:"
    );

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
        Array.isArray(data?.symbols)
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
// GET SYMBOL CONTRACT
// ============================================================

function getContract(
    symbol
) {

    const info =
        CONTRACT_INFO[symbol];


    if (!info) {

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


    if (!ticker) {

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


    if (!usdt) {

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


    if (!config) {

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
// GET CURRENT LEVERAGE
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
        DEFAULT_LEVERAGE >
        contract.maxLeverage
    ) {

        throw new Error(
            `${symbol}: 10x exceeds WEEX maximum leverage ` +
            `${contract.maxLeverage}x`
        );

    }


    const config =
        await getSymbolConfig(symbol);


    const marginMode =
        normalizeMarginMode(config);


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
            value * multiplier +
            1e-8
        );


    const stepInt =
        Math.round(
            stepSize * multiplier
        );


    if (
        stepInt <= 0
    ) {

        return value;

    }


    const resultInt =
        Math.floor(
            valueInt / stepInt
        ) *
        stepInt;


    return (
        resultInt /
        multiplier
    );

}


// ============================================================
// EXTRACT STEP SIZE FROM WEEX -1054 ERROR
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


    if (!match) {

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
            `${symbol}: calculated quantity is zero. ` +
            `Price=${price}, stepSize=${contract.stepSize}`
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
// PRINT POSITION CALCULATION
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
// BUILD ORDER
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
// PLACE OPEN ORDER WITH STEP RETRY
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


    getSymbolSettings(symbol);


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


    const price =
        await getPrice(symbol);


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

        result,

        calculation

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
// FLAT  -> OPEN LONG
// LONG  -> NOTHING
// SHORT -> CLOSE SHORT -> OPEN LONG
//
// SHORT:
//
// FLAT  -> OPEN SHORT
// SHORT -> NOTHING
// LONG  -> CLOSE LONG -> OPEN SHORT
//
// CLOSE:
//
// LONG/SHORT -> CLOSE
//
// IMPORTANT:
//
// Lock is PER SYMBOL.
// Different coins can process simultaneously.
//

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
        action !== "CLOSE"
    ) {

        throw new Error(
            "Action must be LONG, SHORT or CLOSE."
        );

    }


    if (
        !TRADING_ENABLED
    ) {

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


    // ========================================================
    // PER-SYMBOL LOCK
    // ========================================================

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
            action === "CLOSE"
        ) {

            if (
                current.direction ===
                "FLAT"
            ) {

                return {

                    success:
                        true,

                    symbol,

                    action:
                        "ALREADY_FLAT"

                };

            }


            const closeResult =
                await closePosition(
                    current
                );


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
                    "CLOSED",

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
            // CLOSE
            // ------------------------------------------------

            const closeResult =
                await closePosition(
                    current
                );


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
            // OPEN
            // ------------------------------------------------

            const openResult =
                await openMarketPosition(
                    symbol,
                    action
                );


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
// IMPORTANT:
//
// TradingView gets an immediate HTTP 200 response.
//
// We do NOT wait for WEEX here.
//
// The actual trade is processed in the background.
//
// This allows multiple coins to trigger at the same time.
//
// Example:
//
// SOL LONG
// BONK SHORT
// LINK SHORT
// POL LONG
//
// All can be accepted immediately.
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

            // ------------------------------------------------
            // NORMALIZE INPUT
            // ------------------------------------------------

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
                            "Unsupported or unavailable WEEX symbol",

                        symbol,

                        message:
                            "This symbol was not discovered as an API-tradable WEEX USDT-M contract."

                    });

            }


            // ------------------------------------------------
            // VALIDATE ACTION
            // ------------------------------------------------

            if (
                action !== "LONG" &&
                action !== "SHORT" &&
                action !== "CLOSE"
            ) {

                return res
                    .status(400)
                    .json({

                        success:
                            false,

                        error:
                            "action must be LONG, SHORT or CLOSE"

                    });

            }


            // ------------------------------------------------
            // IMMEDIATE ACKNOWLEDGEMENT
            // ------------------------------------------------
            //
            // TradingView receives this immediately.
            //
            // Do not await processSignal().
            //

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
            // BACKGROUND PROCESSING
            // ------------------------------------------------
            //
            // The HTTP request is already finished.
            //
            // processSignal() now handles WEEX.
            //

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

            console.error("");

            console.error(
                "WEBHOOK VALIDATION ERROR"
            );

            console.error(
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
                            error.message,

                        weex:
                            error.data ||
                            null

                    });

            }

        }

    }
);


// ============================================================
// MANUAL SIGNAL HANDLER
// ============================================================
//
// Manual endpoints still WAIT for processSignal().
// This means your manual commands continue to return the
// actual trade result.
//
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

                    symbol,

                    message:
                        "The symbol is not currently available for API trading on WEEX."

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
// LIST AVAILABLE SYMBOLS
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
                "TradingView -> WEEX V3 Dynamic Bot",

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

            discoveredSymbols:
                SUPPORTED_SYMBOLS.size,

            behavior:
                "LONG/SHORT automatic reversal per symbol",

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
            "SERVER STARTED"
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

            console.log("");

            console.log(
                "TradingView:"
            );

            console.log(
                "POST /webhook"
            );

            console.log("");

            console.log(
                "Manual LONG:"
            );

            console.log(
                "POST /manual-long?symbol=ANY_WEEX_SYMBOL"
            );

            console.log("");

            console.log(
                "Manual SHORT:"
            );

            console.log(
                "POST /manual-short?symbol=ANY_WEEX_SYMBOL"
            );

            console.log("");

            console.log(
                "Manual CLOSE:"
            );

            console.log(
                "POST /manual-close?symbol=ANY_WEEX_SYMBOL"
            );

            console.log("");

            console.log(
                "Symbol list:"
            );

            console.log(
                "GET /symbols"
            );

            console.log("");

            console.log(
                "Position:"
            );

            console.log(
                "GET /position?symbol=BTCUSDT"
            );

            console.log("");

            console.log(
                "Refresh:"
            );

            console.log(
                "POST /refresh-symbols"
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
                "Webhook behavior:"
            );

            console.log(
                "TradingView receives HTTP 200 immediately."
            );

            console.log(
                "WEEX processing continues in background."
            );

            console.log(
                "Different symbols can process simultaneously."
            );

            console.log(
                "Same-symbol signals remain serialized."
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