const crypto = require("crypto");

const {
    BASE_URL,
    API_KEY,
    API_SECRET,
    API_PASSPHRASE,

    DEFAULT_MARGIN,
    DEFAULT_LEVERAGE,
    REQUIRED_MARGIN_MODE,

    TP_SL_ENABLED,
    TAKE_PROFIT_PERCENT,
    STOP_LOSS_PERCENT,
    TP_SL_TRIGGER_TYPE,

    ORDER_BOOK_FILTER_ENABLED,
    ORDER_BOOK_DEPTH,
    LONG_MIN_IMBALANCE,
    SHORT_MAX_IMBALANCE,
    MIN_BID_ASK_RATIO,
    MIN_ASK_BID_RATIO,
    ORDER_BOOK_CONFIRMATION_REQUIRED,
} = require("../config/config");

// ============================================================
// INTERNAL HELPERS
// ============================================================

const {
    sleep,
    safeNumber,
    safeInteger,
    decimalPlaces,
    floorToStep,
} = (() => {

    function sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }


    function safeNumber(value, fallback = 0) {
        const number = Number(value);

        return Number.isFinite(number)
            ? number
            : fallback;
    }


    function safeInteger(value, fallback) {
        const number = Number(value);

        if (
            !Number.isFinite(number) ||
            number < 0 ||
            number > 100
        ) {
            return fallback;
        }

        return Math.floor(number);
    }


    function decimalPlaces(value) {
        const stringValue = String(value);

        if (stringValue.includes("e-")) {
            return Number(
                stringValue.split("e-")[1]
            );
        }

        if (stringValue.includes(".")) {
            return stringValue
                .split(".")[1]
                .replace(/0+$/, "")
                .length;
        }

        return 0;
    }


    function floorToStep(value, stepSize) {

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
            Math.pow(10, precision);

        const valueInt =
            Math.floor(
                value * multiplier + 1e-8
            );

        const stepInt =
            Math.round(
                stepSize * multiplier
            );

        if (stepInt <= 0) {
            return value;
        }

        const resultInt =
            Math.floor(
                valueInt / stepInt
            ) * stepInt;

        return resultInt / multiplier;
    }


    return {
        sleep,
        safeNumber,
        safeInteger,
        decimalPlaces,
        floorToStep,
    };

})();


// ============================================================
// CONTRACT STORAGE
// ============================================================

const CONTRACT_INFO = {};

const SUPPORTED_SYMBOLS = new Set();


// ============================================================
// SYMBOL NORMALIZATION
// ============================================================

function normalizeSymbol(symbol) {

    let value =
        String(symbol || "")
            .trim()
            .toUpperCase();

    if (!value) {
        return "";
    }

    if (value.includes(":")) {
        value =
            value
                .split(":")
                .pop();
    }

    value =
        value.replace(/\//g, "");

    value =
        value.replace(/\.P$/i, "");

    value =
        value.replace(/:PERP$/i, "");

    value =
        value.replace(/\s+/g, "");

    return value;
}


// ============================================================
// WEEX SIGNATURE
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
        message += "?" + queryString;
    }

    if (body) {
        message += body;
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
        .digest("base64");
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


    let queryString = "";

    let body = "";


    if (
        upperMethod === "GET" &&
        params &&
        Object.keys(params).length > 0
    ) {

        queryString =
            new URLSearchParams(
                Object.entries(params)
                    .map(
                        ([key, value]) =>
                            [
                                key,
                                String(value)
                            ]
                    )
            ).toString();
    }


    if (upperMethod === "POST") {
        body =
            JSON.stringify(
                params || {}
            );
    }


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
        url += "?" + queryString;
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


    const headers = {
        "Content-Type":
            "application/json",

        "User-Agent":
            "TradingView-WEEX-Server-V3/1.0",
    };


    if (!isPublicMarketEndpoint) {

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
                method: upperMethod,
                headers,
                body:
                    upperMethod === "POST"
                        ? body
                        : undefined,
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
// CONTRACT NORMALIZATION
// ============================================================

function normalizeContract(contract) {

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

        maxLeverage,
    };
}


// ============================================================
// SYMBOL SETTINGS
// ============================================================

function getSymbolSettings(symbol) {

    if (
        !SUPPORTED_SYMBOLS.has(
            symbol
        )
    ) {

        throw new Error(
            `Unsupported or unavailable WEEX symbol: ${symbol}`
        );
    }


    return {
        margin:
            DEFAULT_MARGIN,

        leverage:
            DEFAULT_LEVERAGE,
    };
}


// ============================================================
// LOAD ALL CONTRACTS
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


    if (contracts.length === 0) {

        throw new Error(
            "WEEX returned no contracts from exchangeInfo."
        );
    }


    let apiTradingSet = null;


    try {

        const apiTradingData =
            await weexRequest(
                "GET",
                "/capi/v3/market/apiTradingSymbols"
            );


        const apiSymbols =
            Array.isArray(apiTradingData)
                ? apiTradingData
                : Array.isArray(
                    apiTradingData?.symbols
                )
                    ? apiTradingData.symbols
                    : [];


        if (apiSymbols.length > 0) {

            apiTradingSet =
                new Set(
                    apiSymbols.map(
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


        if (!symbol) {
            continue;
        }


        const quoteAsset =
            String(
                contract?.quoteAsset || ""
            ).toUpperCase();


        const marginAsset =
            String(
                contract?.marginAsset || ""
            ).toUpperCase();


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
        `Target notional = ${
            DEFAULT_MARGIN *
            DEFAULT_LEVERAGE
        } USDT`
    );

    console.log(
        "============================================================"
    );
}


// ============================================================
// GET CONTRACT
// ============================================================

function getContract(symbol) {

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
// REFRESH CONTRACT
// ============================================================

async function refreshContract(symbol) {

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


    if (contract) {

        CONTRACT_INFO[symbol] =
            normalizeContract(
                contract
            );
    }


    return CONTRACT_INFO[symbol];
}


// ============================================================
// GET PRICE
// ============================================================

async function getPrice(symbol) {

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
// GET ORDER BOOK
// ============================================================
//
// ORDER_BOOK_DEPTH comes from config.js.
//
// The automatic multi-depth analyzer fetches one 200-level
// snapshot and calculates 15 / 30 / 60 / 90 from it.
//

async function getOrderBook(
    symbol,
    depth = ORDER_BOOK_DEPTH
) {

    let requestedDepth =
        Number(depth);


    if (
        !Number.isFinite(
            requestedDepth
        )
    ) {

        requestedDepth =
            ORDER_BOOK_DEPTH;
    }


    requestedDepth =
        Math.max(
            1,
            Math.min(
                ORDER_BOOK_DEPTH,
                Math.floor(
                    requestedDepth
                )
            )
        );


    return weexRequest(
        "GET",
        "/capi/v3/market/depth",
        {
            symbol,
            limit:
                requestedDepth,
        }
    );
}


// ============================================================
// NORMALIZE ORDER BOOK LEVEL
// ============================================================

function normalizeOrderBookLevel(
    level
) {

    if (
        Array.isArray(level)
    ) {

        const price =
            Number(
                level[0]
            );

        const quantity =
            Number(
                level[1]
            );


        if (
            !Number.isFinite(price) ||
            !Number.isFinite(quantity) ||
            price <= 0 ||
            quantity <= 0
        ) {

            return null;
        }


        return {
            price,
            quantity,
        };
    }


    if (
        level &&
        typeof level === "object"
    ) {

        const price =
            Number(
                level.price ??
                level.p ??
                level[0]
            );


        const quantity =
            Number(
                level.quantity ??
                level.qty ??
                level.size ??
                level.amount ??
                level.q ??
                level[1]
            );


        if (
            !Number.isFinite(price) ||
            !Number.isFinite(quantity) ||
            price <= 0 ||
            quantity <= 0
        ) {

            return null;
        }


        return {
            price,
            quantity,
        };
    }


    return null;
}


// ============================================================
// EXTRACT ORDER BOOK SIDES
// ============================================================

function extractOrderBookSides(
    data
) {

    const root =
        data?.data &&
        typeof data.data === "object"
            ? data.data
            : data;


    const bidsRaw =
        root?.bids ??
        root?.bid ??
        [];


    const asksRaw =
        root?.asks ??
        root?.ask ??
        [];


    const bids =
        Array.isArray(bidsRaw)
            ? bidsRaw
                .map(
                    normalizeOrderBookLevel
                )
                .filter(Boolean)
            : [];


    const asks =
        Array.isArray(asksRaw)
            ? asksRaw
                .map(
                    normalizeOrderBookLevel
                )
                .filter(Boolean)
            : [];


    return {
        bids,
        asks,
    };
}


// ============================================================
// CALCULATE ORDER BOOK LIQUIDITY
// ============================================================

function calculateOrderBookLiquidity(
    levels
) {

    if (
        !Array.isArray(levels)
    ) {

        return 0;
    }


    return levels.reduce(
        (
            total,
            level
        ) =>
            total +
            Number(
                level?.quantity || 0
            ),
        0
    );
}


// ============================================================
// ANALYZE ONE DEPTH
// ============================================================
//
// A depth passes ONLY when:
//
// LONG:
//
//     imbalance >= LONG_MIN_IMBALANCE
//     AND
//     bid/ask >= MIN_BID_ASK_RATIO
//
// SHORT:
//
//     imbalance <= SHORT_MAX_IMBALANCE
//     AND
//     ask/bid >= MIN_ASK_BID_RATIO
//
// Therefore a ratio failure blocks the depth.
//

function analyzeOrderBookDepth(
    data,
    direction,
    depth
) {

    const normalizedDirection =
        String(
            direction || ""
        )
            .trim()
            .toUpperCase();


    const effectiveDepth =
        Math.max(
            1,
            Math.min(
                ORDER_BOOK_DEPTH,
                Math.floor(
                    Number(depth) ||
                    ORDER_BOOK_DEPTH
                )
            )
        );


    // --------------------------------------------------------
    // CLOSE BYPASS
    // --------------------------------------------------------

    if (
        normalizedDirection === "CLOSE" ||
        normalizedDirection === "CLOSE_LONG" ||
        normalizedDirection === "CLOSE_SHORT"
    ) {

        return {

            allowed:
                true,

            supported:
                true,

            direction:
                normalizedDirection,

            depth:
                effectiveDepth,

            reason:
                "CLOSE_NOT_FILTERED",

            tests: {

                imbalance:
                    true,

                ratio:
                    true,

                final:
                    true,
            },
        };
    }


    // --------------------------------------------------------
    // GET SIDES
    // --------------------------------------------------------

    const {
        bids,
        asks
    } =
        extractOrderBookSides(
            data
        );


    const depthBids =
        bids.slice(
            0,
            effectiveDepth
        );


    const depthAsks =
        asks.slice(
            0,
            effectiveDepth
        );


    if (
        depthBids.length === 0 ||
        depthAsks.length === 0
    ) {

        return {

            allowed:
                false,

            supported:
                false,

            direction:
                normalizedDirection,

            depth:
                effectiveDepth,

            reason:
                "ORDER_BOOK_DATA_MISSING",

            bidLevels:
                depthBids.length,

            askLevels:
                depthAsks.length,

            imbalance:
                0,

            bidLiquidity:
                0,

            askLiquidity:
                0,

            bidAskRatio:
                0,

            askBidRatio:
                0,

            tests: {

                imbalance:
                    false,

                ratio:
                    false,

                final:
                    false,
            },
        };
    }


    // --------------------------------------------------------
    // LIQUIDITY
    // --------------------------------------------------------

    const bidLiquidity =
        calculateOrderBookLiquidity(
            depthBids
        );


    const askLiquidity =
        calculateOrderBookLiquidity(
            depthAsks
        );


    const totalLiquidity =
        bidLiquidity +
        askLiquidity;


    if (
        totalLiquidity <= 0
    ) {

        return {

            allowed:
                false,

            supported:
                false,

            direction:
                normalizedDirection,

            depth:
                effectiveDepth,

            reason:
                "ORDER_BOOK_LIQUIDITY_ZERO",

            imbalance:
                0,

            bidLiquidity,

            askLiquidity,

            bidAskRatio:
                0,

            askBidRatio:
                0,

            tests: {

                imbalance:
                    false,

                ratio:
                    false,

                final:
                    false,
            },
        };
    }


    // --------------------------------------------------------
    // IMBALANCE
    // --------------------------------------------------------

    const imbalance =
        (
            bidLiquidity -
            askLiquidity
        ) /
        totalLiquidity;


    // --------------------------------------------------------
    // RATIOS
    // --------------------------------------------------------

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


    // --------------------------------------------------------
    // DIRECTION TESTS
    // --------------------------------------------------------

    let imbalancePass =
        false;

    let ratioPass =
        false;

    let allowed =
        false;

    let reason =
        "";


    if (
        normalizedDirection === "LONG"
    ) {

        imbalancePass =
            imbalance >=
            LONG_MIN_IMBALANCE;


        ratioPass =
            bidAskRatio >=
            MIN_BID_ASK_RATIO;


        // BOTH MUST PASS
        allowed =
            imbalancePass &&
            ratioPass;


        reason =
            allowed
                ? "ORDER_BOOK_SUPPORTS_LONG"
                : "ORDER_BOOK_DOES_NOT_SUPPORT_LONG";

    } else if (
        normalizedDirection === "SHORT"
    ) {

        imbalancePass =
            imbalance <=
            SHORT_MAX_IMBALANCE;


        ratioPass =
            askBidRatio >=
            MIN_ASK_BID_RATIO;


        // BOTH MUST PASS
        allowed =
            imbalancePass &&
            ratioPass;


        reason =
            allowed
                ? "ORDER_BOOK_SUPPORTS_SHORT"
                : "ORDER_BOOK_DOES_NOT_SUPPORT_SHORT";

    } else {

        reason =
            "INVALID_DIRECTION";
    }


    // --------------------------------------------------------
    // RESULT
    // --------------------------------------------------------

    return {

        allowed,

        supported:
            allowed,

        direction:
            normalizedDirection,

        depth:
            effectiveDepth,

        bidLevels:
            depthBids.length,

        askLevels:
            depthAsks.length,

        bestBid:
            depthBids[0]?.price ??
            null,

        bestAsk:
            depthAsks[0]?.price ??
            null,

        bidLiquidity,

        askLiquidity,

        totalLiquidity,

        imbalance,

        bidAskRatio,

        askBidRatio,

        reason,

        tests: {

            imbalance:
                imbalancePass,

            ratio:
                ratioPass,

            final:
                allowed,
        },

        thresholds: {

            longImbalance:
                LONG_MIN_IMBALANCE,

            shortImbalance:
                SHORT_MAX_IMBALANCE,

            bidAskRatio:
                MIN_BID_ASK_RATIO,

            askBidRatio:
                MIN_ASK_BID_RATIO,
        },
    };
}


// ============================================================
// ANALYZE 15 / 30 / 60 / 90
// ============================================================
//
// ONE 200-level WEEX snapshot.
//
// No additional WEEX request for each depth.
//

function analyzeOrderBookMultiDepth(
    data,
    direction,
    depths = [15, 30, 60, 90]
) {

    const results = {};


    const validDepths =
        [
            ...new Set(
                depths
                    .map(
                        depth =>
                            Number(depth)
                    )
                    .filter(
                        depth =>
                            Number.isFinite(depth) &&
                            depth > 0 &&
                            depth <= ORDER_BOOK_DEPTH
                    )
                    .map(
                        depth =>
                            Math.floor(depth)
                    )
            )
        ]
            .sort(
                (a, b) =>
                    a - b
            );


    for (
        const depth of validDepths
    ) {

        results[String(depth)] =
            analyzeOrderBookDepth(
                data,
                direction,
                depth
            );
    }


    const passed =
        validDepths.filter(
            depth =>
                results[
                    String(depth)
                ]?.allowed === true
        ).length;


    const failed =
        validDepths.length -
        passed;


    const total =
        validDepths.length;


    // --------------------------------------------------------
    // 3-OF-4
    // --------------------------------------------------------

    const confirmationPassed =
        passed >=
        ORDER_BOOK_CONFIRMATION_REQUIRED;


    return {

        direction:
            String(
                direction || ""
            )
                .trim()
                .toUpperCase(),

        sourceDepth:
            ORDER_BOOK_DEPTH,

        depths:
            validDepths,

        results,

        depth15:
            results["15"] ||
            null,

        depth30:
            results["30"] ||
            null,

        depth60:
            results["60"] ||
            null,

        depth90:
            results["90"] ||
            null,

        passed,

        failed,

        total,

        confirmationRequired:
            ORDER_BOOK_CONFIRMATION_REQUIRED,

        confirmationCount:
            passed,

        confirmationPassed,

        allowed:
            confirmationPassed,

        reason:
            confirmationPassed
                ? "ORDER_BOOK_3_OF_4_CONFIRMED"
                : "ORDER_BOOK_3_OF_4_NOT_CONFIRMED",
    };
}


// ============================================================
// CHECK MULTI-DEPTH ORDER BOOK
// ============================================================

async function checkMultiDepthOrderBookSupport(
    symbol,
    direction,
    depths = [15, 30, 60, 90]
) {

    const normalizedSymbol =
        normalizeSymbol(
            symbol
        );


    const normalizedDirection =
        String(
            direction || ""
        )
            .trim()
            .toUpperCase();


    // --------------------------------------------------------
    // CLOSE NEVER FILTERED
    // --------------------------------------------------------

    if (
        normalizedDirection === "CLOSE" ||
        normalizedDirection === "CLOSE_LONG" ||
        normalizedDirection === "CLOSE_SHORT"
    ) {

        return {

            symbol:
                normalizedSymbol,

            direction:
                normalizedDirection,

            allowed:
                true,

            confirmationPassed:
                true,

            confirmationRequired:
                ORDER_BOOK_CONFIRMATION_REQUIRED,

            confirmationCount:
                4,

            passed:
                4,

            total:
                4,

            reason:
                "CLOSE_NOT_FILTERED",
        };
    }


    // --------------------------------------------------------
    // FILTER DISABLED
    // --------------------------------------------------------

    if (
        !ORDER_BOOK_FILTER_ENABLED
    ) {

        return {

            symbol:
                normalizedSymbol,

            direction:
                normalizedDirection,

            allowed:
                true,

            confirmationPassed:
                true,

            confirmationRequired:
                ORDER_BOOK_CONFIRMATION_REQUIRED,

            confirmationCount:
                4,

            passed:
                4,

            total:
                4,

            reason:
                "ORDER_BOOK_FILTER_DISABLED",
        };
    }


    // --------------------------------------------------------
    // ONE 200-LEVEL REQUEST
    // --------------------------------------------------------

    const data =
        await getOrderBook(
            normalizedSymbol,
            ORDER_BOOK_DEPTH
        );


    // --------------------------------------------------------
    // ANALYZE
    // --------------------------------------------------------

    const analysis =
        analyzeOrderBookMultiDepth(
            data,
            normalizedDirection,
            depths
        );


    // --------------------------------------------------------
    // LOG
    // --------------------------------------------------------

    console.log("");

    console.log(
        "============================================================"
    );

    console.log(
        `ORDER BOOK 3-OF-4: ${normalizedSymbol}`
    );

    console.log(
        "============================================================"
    );

    console.log(
        "Direction:",
        normalizedDirection
    );

    console.log(
        "Source depth:",
        ORDER_BOOK_DEPTH
    );

    console.log(
        "Confirmation:",
        `${analysis.passed}/${analysis.total}`
    );

    console.log(
        "Required:",
        `${ORDER_BOOK_CONFIRMATION_REQUIRED}/${analysis.total}`
    );


    for (
        const depth of analysis.depths
    ) {

        const result =
            analysis.results[
                String(depth)
            ];


        console.log("");

        console.log(
            `${depth} LEVELS`
        );

        console.log(
            "Imbalance:",
            result.imbalance
        );

        console.log(
            "Bid/Ask:",
            result.bidAskRatio
        );

        console.log(
            "Ask/Bid:",
            result.askBidRatio
        );

        console.log(
            "Imbalance:",
            result.tests.imbalance
                ? "PASS"
                : "FAIL"
        );

        console.log(
            "Ratio:",
            result.tests.ratio
                ? "PASS"
                : "FAIL"
        );

        console.log(
            "FINAL:",
            result.allowed
                ? "PASS"
                : "BLOCKED"
        );
    }


    console.log("");

    console.log(
        "3-OF-4 RESULT:",
        analysis.confirmationPassed
            ? "PASS"
            : "BLOCKED"
    );

    console.log(
        "============================================================"
    );


    return {

        symbol:
            normalizedSymbol,

        direction:
            normalizedDirection,

        allowed:
            analysis.allowed,

        confirmationPassed:
            analysis.confirmationPassed,

        confirmationRequired:
            analysis.confirmationRequired,

        confirmationCount:
            analysis.confirmationCount,

        passed:
            analysis.passed,

        failed:
            analysis.failed,

        total:
            analysis.total,

        depths:
            analysis.depths,

        results:
            analysis.results,

        depth15:
            analysis.depth15,

        depth30:
            analysis.depth30,

        depth60:
            analysis.depth60,

        depth90:
            analysis.depth90,

        sourceDepth:
            analysis.sourceDepth,

        reason:
            analysis.reason,
    };
}


// ============================================================
// ORDER BOOK LEVEL NORMALIZATION
// ============================================================

function normalizeOrderBookLevel(
    level
) {

    if (
        Array.isArray(level)
    ) {

        const price =
            Number(level[0]);

        const quantity =
            Number(level[1]);


        if (
            !Number.isFinite(price) ||
            !Number.isFinite(quantity) ||
            price <= 0 ||
            quantity <= 0
        ) {
            return null;
        }


        return {
            price,
            quantity,
        };
    }


    if (
        level &&
        typeof level === "object"
    ) {

        const price =
            Number(
                level.price ??
                level.p ??
                level[0]
            );


        const quantity =
            Number(
                level.quantity ??
                level.qty ??
                level.size ??
                level.amount ??
                level.q ??
                level[1]
            );


        if (
            !Number.isFinite(price) ||
            !Number.isFinite(quantity) ||
            price <= 0 ||
            quantity <= 0
        ) {
            return null;
        }


        return {
            price,
            quantity,
        };
    }


    return null;
}


// ============================================================
// EXTRACT ORDER BOOK SIDES
// ============================================================

function extractOrderBookSides(
    data
) {

    const root =
        data?.data &&
        typeof data.data === "object"
            ? data.data
            : data;


    const bidsRaw =
        root?.bids ??
        root?.bid ??
        [];


    const asksRaw =
        root?.asks ??
        root?.ask ??
        [];


    const bids =
        Array.isArray(bidsRaw)
            ? bidsRaw
                .map(
                    normalizeOrderBookLevel
                )
                .filter(Boolean)
            : [];


    const asks =
        Array.isArray(asksRaw)
            ? asksRaw
                .map(
                    normalizeOrderBookLevel
                )
                .filter(Boolean)
            : [];


    return {
        bids,
        asks,
    };
}


// ============================================================
// CALCULATE ORDER BOOK LIQUIDITY
// ============================================================

function calculateOrderBookLiquidity(
    levels
) {

    if (
        !Array.isArray(levels)
    ) {
        return 0;
    }


    return levels.reduce(
        (
            total,
            level
        ) =>
            total +
            safeNumber(
                level?.quantity,
                0
            ),
        0
    );
}


// ============================================================
// ANALYZE SINGLE ORDER BOOK DEPTH
// ============================================================
//
// IMPORTANT:
//
// Both tests are mandatory.
//
// LONG:
//
//     imbalance >= LONG_MIN_IMBALANCE
//     AND
//     bid/ask >= MIN_BID_ASK_RATIO
//
// SHORT:
//
//     imbalance <= SHORT_MAX_IMBALANCE
//     AND
//     ask/bid >= MIN_ASK_BID_RATIO
//
// CLOSE:
//
//     NEVER BLOCKED
//

function analyzeOrderBookDepth(
    data,
    direction,
    depth
) {

    const normalizedDirection =
        String(
            direction || ""
        )
            .trim()
            .toUpperCase();


    const normalizedDepth =
        Number(depth);


    // --------------------------------------------------------
    // CLOSE BYPASS
    // --------------------------------------------------------

    if (
        normalizedDirection === "CLOSE" ||
        normalizedDirection === "CLOSE_LONG" ||
        normalizedDirection === "CLOSE_SHORT"
    ) {

        return {

            allowed: true,

            supported: true,

            direction:
                normalizedDirection,

            depth:
                normalizedDepth,

            reason:
                "CLOSE_NOT_FILTERED",

            imbalance:
                0,

            bidLiquidity:
                0,

            askLiquidity:
                0,

            bidPercentage:
                0,

            askPercentage:
                0,

            bidAskRatio:
                0,

            askBidRatio:
                0,

            tests: {

                imbalance:
                    true,

                ratio:
                    true,

                final:
                    true,
            },

            thresholds: {

                longImbalance:
                    LONG_MIN_IMBALANCE,

                shortImbalance:
                    SHORT_MAX_IMBALANCE,

                bidAskRatio:
                    MIN_BID_ASK_RATIO,

                askBidRatio:
                    MIN_ASK_BID_RATIO,
            },
        };
    }


    // --------------------------------------------------------
    // DIRECTION VALIDATION
    // --------------------------------------------------------

    if (
        normalizedDirection !== "LONG" &&
        normalizedDirection !== "SHORT"
    ) {

        return {

            allowed: false,

            supported: false,

            direction:
                normalizedDirection,

            depth:
                normalizedDepth,

            reason:
                "INVALID_DIRECTION",

            imbalance:
                0,

            bidLiquidity:
                0,

            askLiquidity:
                0,

            bidPercentage:
                0,

            askPercentage:
                0,

            bidAskRatio:
                0,

            askBidRatio:
                0,

            tests: {

                imbalance:
                    false,

                ratio:
                    false,

                final:
                    false,
            },
        };
    }


    // --------------------------------------------------------
    // EXTRACT SIDES
    // --------------------------------------------------------

    const {
        bids,
        asks,
    } =
        extractOrderBookSides(
            data
        );


    if (
        bids.length === 0 ||
        asks.length === 0
    ) {

        return {

            allowed: false,

            supported: false,

            direction:
                normalizedDirection,

            depth:
                normalizedDepth,

            reason:
                "ORDER_BOOK_DATA_MISSING",

            bidLevels:
                bids.length,

            askLevels:
                asks.length,

            imbalance:
                0,

            bidLiquidity:
                0,

            askLiquidity:
                0,

            bidPercentage:
                0,

            askPercentage:
                0,

            bidAskRatio:
                0,

            askBidRatio:
                0,

            tests: {

                imbalance:
                    false,

                ratio:
                    false,

                final:
                    false,
            },

            thresholds: {

                longImbalance:
                    LONG_MIN_IMBALANCE,

                shortImbalance:
                    SHORT_MAX_IMBALANCE,

                bidAskRatio:
                    MIN_BID_ASK_RATIO,

                askBidRatio:
                    MIN_ASK_BID_RATIO,
            },
        };
    }


    // --------------------------------------------------------
    // DEPTH SLICE
    // --------------------------------------------------------

    const effectiveDepth =
        Math.max(
            1,
            Math.min(
                Number.isFinite(
                    normalizedDepth
                )
                    ? Math.floor(
                        normalizedDepth
                    )
                    : ORDER_BOOK_DEPTH,
                ORDER_BOOK_DEPTH
            )
        );


    const depthBids =
        bids.slice(
            0,
            effectiveDepth
        );


    const depthAsks =
        asks.slice(
            0,
            effectiveDepth
        );


    // --------------------------------------------------------
    // LIQUIDITY
    // --------------------------------------------------------

    const bidLiquidity =
        calculateOrderBookLiquidity(
            depthBids
        );


    const askLiquidity =
        calculateOrderBookLiquidity(
            depthAsks
        );


    const totalLiquidity =
        bidLiquidity +
        askLiquidity;


    if (
        totalLiquidity <= 0
    ) {

        return {

            allowed: false,

            supported: false,

            direction:
                normalizedDirection,

            depth:
                effectiveDepth,

            reason:
                "ORDER_BOOK_LIQUIDITY_ZERO",

            bidLevels:
                depthBids.length,

            askLevels:
                depthAsks.length,

            imbalance:
                0,

            bidLiquidity,

            askLiquidity,

            bidPercentage:
                0,

            askPercentage:
                0,

            bidAskRatio:
                0,

            askBidRatio:
                0,

            tests: {

                imbalance:
                    false,

                ratio:
                    false,

                final:
                    false,
            },
        };
    }


    // --------------------------------------------------------
    // CALCULATIONS
    // --------------------------------------------------------

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


    // --------------------------------------------------------
    // DIRECTIONAL TESTS
    // --------------------------------------------------------

    let imbalancePass =
        false;


    let ratioPass =
        false;


    let allowed =
        false;


    let reason =
        "";


    if (
        normalizedDirection === "LONG"
    ) {

        imbalancePass =
            imbalance >=
            LONG_MIN_IMBALANCE;


        ratioPass =
            bidAskRatio >=
            MIN_BID_ASK_RATIO;


        allowed =
            imbalancePass &&
            ratioPass;


        reason =
            allowed
                ? "ORDER_BOOK_SUPPORTS_LONG"
                : "ORDER_BOOK_DOES_NOT_SUPPORT_LONG";

    } else {

        imbalancePass =
            imbalance <=
            SHORT_MAX_IMBALANCE;


        ratioPass =
            askBidRatio >=
            MIN_ASK_BID_RATIO;


        allowed =
            imbalancePass &&
            ratioPass;


        reason =
            allowed
                ? "ORDER_BOOK_SUPPORTS_SHORT"
                : "ORDER_BOOK_DOES_NOT_SUPPORT_SHORT";
    }


    // --------------------------------------------------------
    // RESULT
    // --------------------------------------------------------

    return {

        allowed,

        supported:
            allowed,

        direction:
            normalizedDirection,

        depth:
            effectiveDepth,

        requestedDepth:
            effectiveDepth,

        bidLevels:
            depthBids.length,

        askLevels:
            depthAsks.length,

        bestBid:
            depthBids[0]?.price ?? null,

        bestAsk:
            depthAsks[0]?.price ?? null,

        bidLiquidity,

        askLiquidity,

        totalLiquidity,

        bidPercentage,

        askPercentage,

        imbalance,

        bidAskRatio,

        askBidRatio,

        reason,

        tests: {

            imbalance:
                imbalancePass,

            ratio:
                ratioPass,

            final:
                allowed,
        },

        thresholds: {

            longImbalance:
                LONG_MIN_IMBALANCE,

            shortImbalance:
                SHORT_MAX_IMBALANCE,

            bidAskRatio:
                MIN_BID_ASK_RATIO,

            askBidRatio:
                MIN_ASK_BID_RATIO,
        },
    };
}


// ============================================================
// ANALYZE MULTI DEPTH ORDER BOOK
// ============================================================
//
// One WEEX 200-level snapshot.
//
// From the SAME snapshot we calculate:
//
//     15 levels
//     30 levels
//     60 levels
//     90 levels
//
// This avoids four separate API requests.
//

function analyzeOrderBookMultiDepth(
    data,
    direction,
    depths = [15, 30, 60, 90]
) {

    const requestedDepths =
        Array.isArray(depths)
            ? depths
            : [15, 30, 60, 90];


    const uniqueDepths =
        [
            ...new Set(
                requestedDepths
                    .map(
                        depth =>
                            Number(depth)
                    )
                    .filter(
                        depth =>
                            Number.isFinite(depth) &&
                            depth > 0
                    )
                    .map(
                        depth =>
                            Math.floor(depth)
                    )
            )
        ]
            .sort(
                (a, b) =>
                    a - b
            );


    const results = {};


    for (
        const depth of uniqueDepths
    ) {

        results[String(depth)] =
            analyzeOrderBookDepth(
                data,
                direction,
                depth
            );
    }


    const depthResults =
        uniqueDepths.map(
            depth =>
                results[String(depth)]
        );


    const passed =
        depthResults.filter(
            result =>
                result?.allowed === true
        ).length;


    const failed =
        depthResults.filter(
            result =>
                result?.allowed !== true
        ).length;


    // --------------------------------------------------------
    // 2 OF 3 / 3 OF 4 SUPPORT
    // --------------------------------------------------------
    //
    // The generic confirmation count is returned here.
    //
    // The trading layer decides how many confirmations
    // are required.
    //
    // With [15,30,60,90]:
    //
    // confirmationCount = number of passed depths
    //
    // --------------------------------------------------------

    return {

        direction:
            String(
                direction || ""
            )
                .trim()
                .toUpperCase(),

        requestedDepth:
            ORDER_BOOK_DEPTH,

        depths:
            uniqueDepths,

        results,

        passed,

        failed,

        total:
            uniqueDepths.length,

        confirmationCount:
            passed,

        allPassed:
            uniqueDepths.length > 0 &&
            passed === uniqueDepths.length,

        atLeastTwoPassed:
            passed >= 2,

        // Explicit 15 / 30 / 60 / 90 references
        depth15:
            results["15"] || null,

        depth30:
            results["30"] || null,

        depth60:
            results["60"] || null,

        depth90:
            results["90"] || null,
    };
}


// ============================================================
// CHECK ORDER BOOK SUPPORT
// ============================================================
//
// This is the normal single-direction check.
//
// It uses ORDER_BOOK_DEPTH from config.js.
//
// IMPORTANT:
//
// Both imbalance AND ratio must pass.
//

async function checkOrderBookSupport(
    symbol,
    direction,
    depth = ORDER_BOOK_DEPTH
) {

    const normalizedSymbol =
        normalizeSymbol(
            symbol
        );


    const normalizedDirection =
        String(
            direction || ""
        )
            .trim()
            .toUpperCase();


    // --------------------------------------------------------
    // CLOSE IS NEVER FILTERED
    // --------------------------------------------------------

    if (
        normalizedDirection === "CLOSE" ||
        normalizedDirection === "CLOSE_LONG" ||
        normalizedDirection === "CLOSE_SHORT"
    ) {

        return {

            allowed: true,

            supported: true,

            symbol:
                normalizedSymbol,

            direction:
                normalizedDirection,

            reason:
                "CLOSE_NOT_FILTERED",
        };
    }


    // --------------------------------------------------------
    // FILTER DISABLED
    // --------------------------------------------------------

    if (
        !ORDER_BOOK_FILTER_ENABLED
    ) {

        return {

            allowed: true,

            supported: true,

            symbol:
                normalizedSymbol,

            direction:
                normalizedDirection,

            reason:
                "ORDER_BOOK_FILTER_DISABLED",
        };
    }


    // --------------------------------------------------------
    // FETCH FRESH ORDER BOOK
    // --------------------------------------------------------

    const data =
        await getOrderBook(
            normalizedSymbol,
            depth
        );


    // --------------------------------------------------------
    // ANALYZE
    // --------------------------------------------------------

    const result =
        analyzeOrderBookDepth(
            data,
            normalizedDirection,
            depth
        );


    // --------------------------------------------------------
    // ATTACH SYMBOL
    // --------------------------------------------------------

    result.symbol =
        normalizedSymbol;


    // --------------------------------------------------------
    // LOG
    // --------------------------------------------------------

    console.log("");

    console.log(
        "============================================================"
    );

    console.log(
        `WEEX ORDER BOOK FILTER: ${normalizedSymbol}`
    );

    console.log(
        "============================================================"
    );

    console.log(
        "Requested direction:",
        normalizedDirection
    );

    console.log(
        "Filter enabled:",
        ORDER_BOOK_FILTER_ENABLED
    );

    console.log(
        "Depth levels:",
        result.depth
    );

    console.log(
        "LONG threshold: >=",
        LONG_MIN_IMBALANCE
    );

    console.log(
        "SHORT threshold: <=",
        SHORT_MAX_IMBALANCE
    );

    console.log(
        "Minimum BID/ASK ratio:",
        MIN_BID_ASK_RATIO
    );

    console.log(
        "Minimum ASK/BID ratio:",
        MIN_ASK_BID_RATIO
    );

    console.log(
        "Best bid:",
        result.bestBid
    );

    console.log(
        "Best ask:",
        result.bestAsk
    );

    console.log(
        "Bid liquidity:",
        result.bidLiquidity
    );

    console.log(
        "Ask liquidity:",
        result.askLiquidity
    );

    console.log(
        "Bid percentage:",
        (
            safeNumber(
                result.bidPercentage,
                0
            ) * 100
        ).toFixed(2) + "%"
    );

    console.log(
        "Ask percentage:",
        (
            safeNumber(
                result.askPercentage,
                0
            ) * 100
        ).toFixed(2) + "%"
    );

    console.log(
        "Imbalance:",
        result.imbalance
    );

    console.log(
        "Bid/Ask ratio:",
        result.bidAskRatio
    );

    console.log(
        "Ask/Bid ratio:",
        result.askBidRatio
    );


    console.log("");

    console.log(
        `${normalizedDirection} ORDER BOOK CHECK`
    );


    if (
        normalizedDirection === "LONG"
    ) {

        console.log(
            "Required imbalance >= ",
            LONG_MIN_IMBALANCE
        );

        console.log(
            "Actual imbalance:",
            result.imbalance
        );

        console.log(
            "Imbalance:",
            result.tests?.imbalance
                ? "PASS"
                : "FAIL"
        );

        console.log(
            "Bid/Ask ratio:",
            result.bidAskRatio
        );

        console.log(
            "Ratio requirement:",
            MIN_BID_ASK_RATIO
        );

        console.log(
            "Ratio:",
            result.tests?.ratio
                ? "PASS"
                : "FAIL"
        );

    } else {

        console.log(
            "Required imbalance <= ",
            SHORT_MAX_IMBALANCE
        );

        console.log(
            "Actual imbalance:",
            result.imbalance
        );

        console.log(
            "Imbalance:",
            result.tests?.imbalance
                ? "PASS"
                : "FAIL"
        );

        console.log(
            "Ask/Bid ratio:",
            result.askBidRatio
        );

        console.log(
            "Ratio requirement:",
            MIN_ASK_BID_RATIO
        );

        console.log(
            "Ratio:",
            result.tests?.ratio
                ? "PASS"
                : "FAIL"
        );
    }


    console.log(
        "FINAL ORDER BOOK FILTER:",
        result.allowed
            ? "PASSED"
            : "BLOCKED"
    );

    console.log(
        "============================================================"
    );


    return result;
}


// ============================================================
// CHECK MULTI DEPTH ORDER BOOK SUPPORT
// ============================================================
//
// Fetches ONE 200-level book.
//
// Calculates:
//
//     15
//     30
//     60
//     90
//
// from the same snapshot.
//

async function checkMultiDepthOrderBookSupport(
    symbol,
    direction,
    depths = [15, 30, 60, 90]
) {

    const normalizedSymbol =
        normalizeSymbol(
            symbol
        );


    const normalizedDirection =
        String(
            direction || ""
        )
            .trim()
            .toUpperCase();


    // --------------------------------------------------------
    // CLOSE BYPASS
    // --------------------------------------------------------

    if (
        normalizedDirection === "CLOSE" ||
        normalizedDirection === "CLOSE_LONG" ||
        normalizedDirection === "CLOSE_SHORT"
    ) {

        return {

            symbol:
                normalizedSymbol,

            direction:
                normalizedDirection,

            filterEnabled:
                ORDER_BOOK_FILTER_ENABLED,

            requestedDepth:
                ORDER_BOOK_DEPTH,

            depths,

            results: {},

            passed: 0,

            failed: 0,

            total:
                Array.isArray(depths)
                    ? depths.length
                    : 0,

            confirmationCount:
                0,

            confirmationPassed:
                true,

            allowed:
                true,

            reason:
                "CLOSE_NOT_FILTERED",
        };
    }


    // --------------------------------------------------------
    // FILTER DISABLED
    // --------------------------------------------------------

    if (
        !ORDER_BOOK_FILTER_ENABLED
    ) {

        return {

            symbol:
                normalizedSymbol,

            direction:
                normalizedDirection,

            filterEnabled:
                false,

            requestedDepth:
                ORDER_BOOK_DEPTH,

            depths,

            results: {},

            passed: 0,

            failed: 0,

            total:
                Array.isArray(depths)
                    ? depths.length
                    : 0,

            confirmationCount:
                0,

            confirmationPassed:
                true,

            allowed:
                true,

            reason:
                "ORDER_BOOK_FILTER_DISABLED",
        };
    }


    // --------------------------------------------------------
    // ONE 200-LEVEL REQUEST
    // --------------------------------------------------------

    const data =
        await getOrderBook(
            normalizedSymbol,
            ORDER_BOOK_DEPTH
        );


    // --------------------------------------------------------
    // ANALYZE 15 / 30 / 60 / 90
    // --------------------------------------------------------

    const analysis =
        analyzeOrderBookMultiDepth(
            data,
            normalizedDirection,
            depths
        );


    // --------------------------------------------------------
    // DEFAULT CONFIRMATION
    // --------------------------------------------------------
    //
    // The raw multi-depth result exposes the number of
    // passed confirmations.
    //
    // The trading layer can decide whether it wants:
    //
    //     2 OF 3
    //
    // or:
    //
    //     3 OF 4
    //
    // etc.
    //
    // For the four-depth set [15,30,60,90], we expose
    // both the raw count and a 3-of-4 confirmation.
    //

    const confirmationPassed =
        analysis.passed >= 3;


    // --------------------------------------------------------
    // LOG
    // --------------------------------------------------------

    console.log("");

    console.log(
        "============================================================"
    );

    console.log(
        `WEEX MULTI-DEPTH ORDER BOOK: ${normalizedSymbol}`
    );

    console.log(
        "============================================================"
    );

    console.log(
        "Direction:",
        normalizedDirection
    );

    console.log(
        "Source depth:",
        ORDER_BOOK_DEPTH
    );

    console.log(
        "Levels:",
        analysis.depths.join(" / ")
    );

    console.log(
        "Long imbalance threshold:",
        LONG_MIN_IMBALANCE
    );

    console.log(
        "Short imbalance threshold:",
        SHORT_MAX_IMBALANCE
    );

    console.log(
        "Bid/Ask ratio threshold:",
        MIN_BID_ASK_RATIO
    );

    console.log(
        "Ask/Bid ratio threshold:",
        MIN_ASK_BID_RATIO
    );


    for (
        const depth of analysis.depths
    ) {

        const result =
            analysis.results[
                String(depth)
            ];


        console.log("");

        console.log(
            `${depth} LEVELS`
        );

        console.log(
            "Imbalance:",
            result?.imbalance
        );

        console.log(
            "Bid/Ask:",
            result?.bidAskRatio
        );

        console.log(
            "Ask/Bid:",
            result?.askBidRatio
        );

        console.log(
            "Imbalance test:",
            result?.tests?.imbalance
                ? "PASS"
                : "FAIL"
        );

        console.log(
            "Ratio test:",
            result?.tests?.ratio
                ? "PASS"
                : "FAIL"
        );

        console.log(
            "FINAL:",
            result?.allowed
                ? "PASS"
                : "BLOCKED"
        );
    }


    console.log("");

    console.log(
        "MULTI-DEPTH CONFIRMATIONS:",
        analysis.passed,
        "/",
        analysis.total
    );

    console.log(
        "3 OF 4 CONFIRMATION:",
        confirmationPassed
            ? "PASSED"
            : "BLOCKED"
    );

    console.log(
        "============================================================"
    );


    return {

        symbol:
            normalizedSymbol,

        direction:
            normalizedDirection,

        filterEnabled:
            ORDER_BOOK_FILTER_ENABLED,

        requestedDepth:
            ORDER_BOOK_DEPTH,

        depths:
            analysis.depths,

        results:
            analysis.results,

        depth15:
            analysis.depth15,

        depth30:
            analysis.depth30,

        depth60:
            analysis.depth60,

        depth90:
            analysis.depth90,

        passed:
            analysis.passed,

        failed:
            analysis.failed,

        total:
            analysis.total,

        confirmationCount:
            analysis.confirmationCount,

        confirmationPassed,

        // Useful when the caller wants a generic
        // "at least 2 confirmations" test.
        atLeastTwoPassed:
            analysis.atLeastTwoPassed,

        allPassed:
            analysis.allPassed,

        allowed:
            confirmationPassed,

        reason:
            confirmationPassed
                ? "MULTI_DEPTH_ORDER_BOOK_CONFIRMED"
                : "MULTI_DEPTH_ORDER_BOOK_NOT_CONFIRMED",
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
            : Array.isArray(
                data?.data
            )
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
            : Array.isArray(
                data?.data
            )
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
                0,
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
            "",
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


    const configs =
        Array.isArray(data)
            ? data
            : Array.isArray(
                data?.data
            )
                ? data.data
                : [data];


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

        config?.marginModeType,

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
            ),
    };
}


// ============================================================
// ENSURE LEVERAGE
// ============================================================

async function ensureLeverage(
    symbol
) {

    const settings =
        getSymbolSettings(
            symbol
        );


    const contract =
        getContract(
            symbol
        );


    if (
        contract.maxLeverage > 0 &&
        settings.leverage >
        contract.maxLeverage
    ) {

        throw new Error(
            `${symbol}: ${settings.leverage}x exceeds WEEX maximum leverage ${contract.maxLeverage}x`
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
        marginMode !==
        REQUIRED_MARGIN_MODE
    ) {

        throw new Error(
            `${symbol}: WEEX margin mode is ${marginMode || "UNKNOWN"}, expected ${REQUIRED_MARGIN_MODE}. Change the margin mode on WEEX first.`
        );
    }


    const current =
        getConfiguredLeverages(
            config
        );


    console.log("");

    console.log(
        `${symbol}: ISOLATED leverage currently LONG=${current.isolatedLong}x SHORT=${current.isolatedShort}x`
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
                settings.leverage,
        };
    }


    const params = {

        symbol,

        marginType:
            "ISOLATED",

        isolatedLongLeverage:
            String(
                settings.leverage
            ),

        isolatedShortLeverage:
            String(
                settings.leverage
            ),
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
            settings.leverage,
    };
}


// ============================================================
// EXTRACT STEP SIZE FROM WEEX ERROR
// ============================================================

function extractStepSizeFromError(
    error
) {

    const text =
        JSON.stringify(
            error?.data || ""
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


    return Number.isFinite(step) &&
        step > 0
        ? step
        : null;
}


// ============================================================
// FORMAT QUANTITY
// ============================================================

function formatQuantity(
    symbol,
    quantity
) {

    const contract =
        getContract(
            symbol
        );


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
        getSymbolSettings(
            symbol
        );


    const contract =
        getContract(
            symbol
        );


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


    if (quantity <= 0) {

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
            `${symbol}: quantity ${quantity} is below WEEX minimum ${contract.minOrderSize}`
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
            `${symbol}: quantity ${quantity} exceeds WEEX maximum ${contract.maxOrderSize}`
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
            `${symbol}: quantity ${quantity} exceeds market-open limit ${contract.marketOpenLimitSize}`
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
            contract.stepSize,
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
            clientOrderId,
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


        if (!step) {
            throw error;
        }


        console.warn("");

        console.warn(
            `${symbol}: WEEX reported required stepSize = ${step}`
        );


        getContract(
            symbol
        ).stepSize =
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


        return weexRequest(
            "POST",
            "/capi/v3/order",
            order
        );
    }
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
            true,
    };
}


// ============================================================
// CLOSE POSITION
// ============================================================
//
// CLOSE NEVER USES ORDER BOOK FILTER.
//

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
                "ALREADY_FLAT",
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

            result,
        };

    } catch (error) {

        const step =
            extractStepSizeFromError(
                error
            );


        if (!step) {
            throw error;
        }


        console.warn("");

        console.warn(
            `${symbol}: close order reported stepSize ${step}`
        );


        getContract(
            symbol
        ).stepSize =
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

            result,
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
            expectedDirection === "FLAT"
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

        } else if (
            position.direction ===
            expectedDirection
        ) {

            console.log(
                `${symbol}: confirmed ${expectedDirection}`
            );

            return true;
        }


        console.log(
            `${symbol}: waiting for ${expectedDirection} ${attempt}/${maxAttempts}`
        );
    }


    return false;
}


// ============================================================
// EXPORTS
// ============================================================

module.exports = {

    // --------------------------------------------------------
    // CONTRACTS
    // --------------------------------------------------------

    CONTRACT_INFO,

    SUPPORTED_SYMBOLS,


    // --------------------------------------------------------
    // SYMBOL
    // --------------------------------------------------------

    normalizeSymbol,


    // --------------------------------------------------------
    // REQUEST
    // --------------------------------------------------------

    weexRequest,


    // --------------------------------------------------------
    // CONTRACT / MARKET
    // --------------------------------------------------------

    getSymbolSettings,

    loadAllContracts,

    refreshContract,

    getContract,

    getPrice,

    getOrderBook,


    // --------------------------------------------------------
    // ORDER BOOK
    // --------------------------------------------------------

    normalizeOrderBookLevel,

    extractOrderBookSides,

    calculateOrderBookLiquidity,

    analyzeOrderBookDepth,

    analyzeOrderBookMultiDepth,

    checkOrderBookSupport,

    checkMultiDepthOrderBookSupport,


    // --------------------------------------------------------
    // ACCOUNT / POSITION
    // --------------------------------------------------------

    getFuturesBalance,

    getCurrentPosition,

    getSymbolConfig,


    // --------------------------------------------------------
    // LEVERAGE
    // --------------------------------------------------------

    ensureLeverage,


    // --------------------------------------------------------
    // POSITION CALCULATION
    // --------------------------------------------------------

    calculatePosition,

    printPosition,


    // --------------------------------------------------------
    // ORDERS
    // --------------------------------------------------------

    placeOpenOrder,

    closePosition,

    waitForPosition,


    // --------------------------------------------------------
    // QUANTITY
    // --------------------------------------------------------

    formatQuantity,

    extractStepSizeFromError,
};