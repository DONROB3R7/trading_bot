const crypto = require("crypto");

const {
    BASE_URL,
    API_KEY,
    API_SECRET,
    API_PASSPHRASE,
    DEFAULT_MARGIN,
    DEFAULT_LEVERAGE,
    REQUIRED_MARGIN_MODE
} = require("../config/config");

// ============================================================
// WEEX DATA CACHE
// ============================================================

const CONTRACT_INFO = {};

const SUPPORTED_SYMBOLS = new Set();

// ============================================================
// SLEEP
// ============================================================

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// ============================================================
// SAFE NUMBER
// ============================================================

function safeNumber(value, fallback = 0) {
    const number = Number(value);

    return Number.isFinite(number)
        ? number
        : fallback;
}

// ============================================================
// SAFE INTEGER
// ============================================================

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

// ============================================================
// NORMALIZE SYMBOL
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
        value = value.split(":").pop();
    }

    value = value.replace(/\//g, "");

    value = value.replace(/\.P$/i, "");

    value = value.replace(/:PERP$/i, "");

    value = value.replace(/\s+/g, "");

    return value;
}

// ============================================================
// DECIMAL PLACES
// ============================================================

function decimalPlaces(value) {
    const stringValue = String(value);

    if (stringValue.includes("e-")) {
        return Number(
            stringValue.split("e-")[1]
        );
    }

    if (stringValue.includes(".")) {
        return (
            stringValue
                .split(".")[1]
                .replace(/0+$/, "")
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

    if (stepInt <= 0) {
        return value;
    }

    const resultInt =
        Math.floor(
            valueInt / stepInt
        ) * stepInt;

    return (
        resultInt /
        multiplier
    );
}

// ============================================================
// CONFIGURED SYMBOL SETTINGS
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
        String(method)
            .toUpperCase();

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
                Object.entries(params)
                    .map(
                        ([key, value]) => [
                            key,
                            String(value)
                        ]
                    )
            ).toString();
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
    // SIGNATURE
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

    const headers = {
        "Content-Type":
            "application/json",

        "User-Agent":
            "TradingView-WEEX-Server-V3/1.0"
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
// GET CONTRACT
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
            Array.isArray(apiTradingData)
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

        console.warn(
            error.message
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
            )
                .toUpperCase();

        const marginAsset =
            String(
                contract?.marginAsset || ""
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

    return {
        count:
            SUPPORTED_SYMBOLS.size,

        symbols:
            Array.from(
                SUPPORTED_SYMBOLS
            ).sort()
    };
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
// GET ORDER BOOK
// ============================================================
//
// READ ONLY.
// NEVER places an order.
// ============================================================

async function getOrderBook(
    symbol,
    limit = 15
) {
    const data =
        await weexRequest(
            "GET",
            "/capi/v3/market/depth",
            {
                symbol,
                limit
            }
        );

    return data;
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
        marginMode !==
        REQUIRED_MARGIN_MODE
    ) {
        throw new Error(
            `${symbol}: WEEX margin mode is ` +
            `${marginMode || "UNKNOWN"}, expected ` +
            `${REQUIRED_MARGIN_MODE}. ` +
            `Change the margin mode on WEEX first.`
        );
    }

    const current =
        getConfiguredLeverages(
            config
        );

    console.log("");

    console.log(
        `${symbol}: ISOLATED leverage currently ` +
        `LONG=${current.isolatedLong}x ` +
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

    const result =
        await weexRequest(
            "POST",
            "/capi/v3/account/leverage",
            {
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
                    )
            }
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
            `exceeds market-open limit ` +
            `${contract.marketOpenLimitSize}`
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
// STEP SIZE FROM WEEX ERROR
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

        if (!step) {
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

        if (!step) {
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
// EXPORTS
// ============================================================
//
// IMPORTANT:
//
// Nothing in this file requires trading.js,
// orderBook.js, or server_v3.js.
//
// ============================================================

module.exports = {
    CONTRACT_INFO,

    SUPPORTED_SYMBOLS,

    normalizeSymbol,

    weexRequest,

    getSymbolSettings,

    getContract,

    loadAllContracts,

    getPrice,

    getOrderBook,

    getFuturesBalance,

    getCurrentPosition,

    getSymbolConfig,

    ensureLeverage,

    calculatePosition,

    printPosition,

    formatQuantity,

    extractStepSizeFromError,

    placeOpenOrder,

    closePosition,

    waitForPosition
};