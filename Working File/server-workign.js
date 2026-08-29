require("dotenv").config();

const express = require("express");
const crypto = require("crypto");

const app = express();

app.use(express.json());


// ============================================================
// WEEX V3 CONFIGURATION
// ============================================================

const PORT = Number(
    process.env.PORT || 3000
);

const BASE_URL =
    "https://api-contract.weex.com";

const SYMBOL =
    "BTCUSDT";


// ============================================================
// LIVE TRADING
// ============================================================
//
// .env:
//
// WEEX_API_KEY=...
// WEEX_API_SECRET=...
// WEEX_API_PASSPHRASE=...
// TRADING_ENABLED=true
//
// IMPORTANT:
//
// TRADING_ENABLED=true = REAL/LIVE TRADING
//
// WEEX also has separate V3 demo endpoints under:
// /capi/v3/sim/...
//
// This script uses LIVE endpoints:
// /capi/v3/...
//
// ============================================================

const TRADING_ENABLED =
    process.env.TRADING_ENABLED === "true";


// ============================================================
// RISK SETTINGS
// ============================================================

const MAX_MARGIN_USDT =
    Number(
        process.env.MAX_MARGIN_USDT || 3
    );

const LEVERAGE =
    Number(
        process.env.LEVERAGE || 10
    );

const MARGIN_TYPE =
    "ISOLATED";


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
// CONTRACT INFORMATION
// ============================================================
//
// WEEX V3 exchangeInfo gives:
//
// contractVal
// quantityPrecision
// minOrderSize
// maxOrderSize
//
// We retrieve this automatically at startup.
//
// ============================================================

let CONTRACT_INFO = null;


// ============================================================
// REQUEST LOCK
// ============================================================

let tradingLock = false;


function sleep(ms) {

    return new Promise(
        resolve =>
            setTimeout(
                resolve,
                ms
            )
    );
}


async function acquireTradingLock() {

    while (
        tradingLock
    ) {

        await sleep(100);
    }

    tradingLock = true;
}


function releaseTradingLock() {

    tradingLock = false;
}


// ============================================================
// STARTUP
// ============================================================

console.log("");
console.log("=================================");
console.log("TRADINGVIEW -> WEEX BOT");
console.log("=================================");

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
    "Symbol:",
    SYMBOL
);

console.log(
    "Maximum margin:",
    MAX_MARGIN_USDT,
    "USDT"
);

console.log(
    "Leverage:",
    LEVERAGE,
    "x"
);

console.log(
    "Margin type:",
    MARGIN_TYPE
);

console.log(
    "API Key:",
    API_KEY
        ? "FOUND"
        : "MISSING"
);

console.log(
    "API Secret:",
    API_SECRET
        ? "FOUND"
        : "MISSING"
);

console.log(
    "API Passphrase:",
    API_PASSPHRASE
        ? "FOUND"
        : "MISSING"
);

console.log("=================================");


// ============================================================
// VALIDATION
// ============================================================

if (
    !API_KEY ||
    !API_SECRET ||
    !API_PASSPHRASE
) {

    console.error("");
    console.error(
        "WARNING: WEEX API credentials are missing."
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
// HMAC SHA256 -> BASE64
// ============================================================
//
// WEEX V3:
//
// HMAC-SHA256(
//     timestamp +
//     method +
//     requestPath +
//     queryString +
//     body
// )
//
// Result is BASE64.
//
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
// WEEX V3 REQUEST
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
            "WEEX_API_KEY, WEEX_API_SECRET or WEEX_API_PASSPHRASE missing"
        );
    }


    const timestamp =
        String(
            Date.now()
        );


    let queryString =
        "";

    let body =
        "";


    // ========================================================
    // GET
    // ========================================================

    if (
        method === "GET" &&
        params &&
        Object.keys(params).length > 0
    ) {

        queryString =
            new URLSearchParams(
                params
            ).toString();
    }


    // ========================================================
    // POST
    // ========================================================

    if (
        method === "POST"
    ) {

        body =
            JSON.stringify(
                params || {}
            );
    }


    const signature =
        signRequest(
            timestamp,
            method,
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
    console.log("=================================");
    console.log("WEEX V3 REQUEST");
    console.log("=================================");

    console.log(
        method,
        endpoint
    );

    console.log(
        "URL:",
        url
    );


    if (
        body
    ) {

        console.log(
            "BODY:",
            body
        );
    }


    const response =
        await fetch(
            url,
            {

                method,

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
                        "TradingView-WEEX-Bot/1.0"

                },

                body:
                    method === "POST"
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
            JSON.parse(
                text
            );

    } catch {

        data =
            text;
    }


    if (
        !response.ok
    ) {

        console.log("");
        console.log(
            "WEEX ERROR:"
        );

        console.log(
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


        throw error;
    }


    return data;
}


// ============================================================
// GET CONTRACT INFORMATION
// ============================================================

async function getContractInfo() {

    console.log("");
    console.log("=================================");
    console.log("WEEX CONTRACT INFORMATION");
    console.log("=================================");


    const data =
        await weexRequest(
            "GET",
            "/capi/v3/market/exchangeInfo",
            {
                symbol:
                    SYMBOL
            }
        );


    const symbols =
        Array.isArray(
            data?.symbols
        )
            ? data.symbols
            : [];


    const contract =
        symbols.find(
            item =>
                item.symbol === SYMBOL
        );


    if (
        !contract
    ) {

        throw new Error(
            `WEEX contract ${SYMBOL} not found`
        );
    }


    CONTRACT_INFO = {

        symbol:
            contract.symbol,

        contractVal:
            Number(
                contract.contractVal
            ),

        quantityPrecision:
            Number(
                contract.quantityPrecision
            ),

        minOrderSize:
            Number(
                contract.minOrderSize
            ),

        maxOrderSize:
            Number(
                contract.maxOrderSize
            ),

        maxPositionSize:
            Number(
                contract.maxPositionSize
            ),

        marketOpenLimitSize:
            Number(
                contract.marketOpenLimitSize
            ),

        pricePrecision:
            Number(
                contract.pricePrecision
            ),

        maxLeverage:
            Number(
                contract.maxLeverage
            )

    };


    console.log(
        "Contract:",
        CONTRACT_INFO.symbol
    );

    console.log(
        "Contract value:",
        CONTRACT_INFO.contractVal
    );

    console.log(
        "Quantity precision:",
        CONTRACT_INFO.quantityPrecision
    );

    console.log(
        "Minimum order:",
        CONTRACT_INFO.minOrderSize
    );

    console.log(
        "Maximum order:",
        CONTRACT_INFO.maxOrderSize
    );

    console.log(
        "Maximum leverage:",
        CONTRACT_INFO.maxLeverage
    );

    console.log(
        "================================="
    );


    return CONTRACT_INFO;
}


// ============================================================
// GET BTC PRICE
// ============================================================

async function getBTCPrice() {

    const data =
        await weexRequest(
            "GET",
            "/capi/v3/market/ticker/bookTicker",
            {
                symbol:
                    SYMBOL
            }
        );


    const ticker =
        Array.isArray(data)
            ? data.find(
                item =>
                    item.symbol === SYMBOL
            ) || data[0]
            : data;


    if (
        !ticker
    ) {

        throw new Error(
            "WEEX BTC ticker not found"
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
            "Invalid WEEX BTC bid/ask"
        );
    }


    const price =
        (
            bid +
            ask
        ) / 2;


    console.log("");
    console.log("=================================");
    console.log("WEEX BTC PRICE");
    console.log("=================================");

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
        price.toFixed(2)
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
            : [];


    const usdt =
        balances.find(
            item =>
                String(
                    item.asset
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
        Number(
            usdt.balance ||
            0
        );


    const available =
        Number(
            usdt.availableBalance ||
            0
        );


    console.log("");
    console.log("=================================");
    console.log("WEEX FUTURES BALANCE");
    console.log("=================================");

    console.log(
        "Balance:",
        balance.toFixed(8),
        "USDT"
    );

    console.log(
        "Available:",
        available.toFixed(8),
        "USDT"
    );

    console.log(
        "Unrealized PnL:",
        Number(
            usdt.unrealizePnl ||
            0
        ).toFixed(8)
    );


    return {

        balance,

        available

    };
}


// ============================================================
// GET CURRENT POSITION
// ============================================================

async function getCurrentPosition() {

    const data =
        await weexRequest(
            "GET",
            "/capi/v3/account/position/singlePosition",
            {
                symbol:
                    SYMBOL
            }
        );


    const positions =
        Array.isArray(data)
            ? data
            : [];


    const validPositions =
        positions.filter(
            item =>
                item.symbol === SYMBOL &&
                Number(
                    item.size ||
                    0
                ) > 0
        );


    if (
        validPositions.length === 0
    ) {

        console.log(
            "POSITION: FLAT"
        );


        return {

            direction:
                "FLAT",

            quantity:
                0,

            available:
                0

        };
    }


    // ========================================================
    // COMBINED MODE
    //
    // Normally there should only be one direction.
    //
    // If separated mode somehow returns both directions,
    // we refuse to guess.
    // ========================================================

    if (
        validPositions.length > 1
    ) {

        throw new Error(
            "WEEX reports multiple BTCUSDT positions. " +
            "Bot expected one active direction."
        );
    }


    const position =
        validPositions[0];


    const side =
        String(
            position.side ||
            ""
        )
            .trim()
            .toUpperCase();


    if (
        side !== "LONG" &&
        side !== "SHORT"
    ) {

        throw new Error(
            `Unknown WEEX position side: ${side}`
        );
    }


    const quantity =
        Number(
            position.size ||
            0
        );


    const result = {

        direction:
            side,

        quantity,

        available:
            quantity,

        avgPrice:
            Number(
                position.openValue || 0
            ) /
            (
                quantity || 1
            ),

        positionValue:
            Number(
                position.openValue ||
                0
            ),

        leverage:
            Number(
                position.leverage ||
                0
            ),

        margin:
            Number(
                position.marginSize ||
                0
            ),

        unrealizedPnL:
            Number(
                position.unrealizePnl ||
                0
            ),

        liquidationPrice:
            Number(
                position.liquidatePrice ||
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
    console.log("=================================");
    console.log("CURRENT WEEX POSITION");
    console.log("=================================");

    console.log(
        "Direction:",
        result.direction
    );

    console.log(
        "Quantity:",
        result.quantity
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

    console.log(
        "Position mode:",
        result.separatedMode
    );

    console.log(
        "================================="
    );


    return result;
}


// ============================================================
// SET LEVERAGE + ISOLATED
// ============================================================

async function setLeverage() {

    const leverageString =
        String(
            LEVERAGE
        );


    const result =
        await weexRequest(
            "POST",
            "/capi/v3/account/leverage",
            {

                symbol:
                    SYMBOL,

                marginType:
                    MARGIN_TYPE,

                isolatedLongLeverage:
                    leverageString,

                isolatedShortLeverage:
                    leverageString

            }
        );


    console.log("");
    console.log("=================================");
    console.log("WEEX LEVERAGE RESPONSE");
    console.log("=================================");

    console.log(
        JSON.stringify(
            result,
            null,
            2
        )
    );


    return result;
}


// ============================================================
// QUANTITY HELPERS
// ============================================================

function decimalPlaces(
    number
) {

    if (
        !Number.isFinite(number)
    ) {

        return 0;
    }


    const text =
        String(
            number
        );


    if (
        text.includes("e-")
    ) {

        const parts =
            text.split("e-");

        return Number(
            parts[1]
        );
    }


    const parts =
        text.split(".");


    return parts[1]
        ? parts[1].length
        : 0;
}


function floorToPrecision(
    value,
    precision
) {

    const multiplier =
        Math.pow(
            10,
            precision
        );


    return (
        Math.floor(
            value *
            multiplier
        ) /
        multiplier
    );
}


function formatQuantity(
    quantity
) {

    const precision =
        CONTRACT_INFO
            ?.quantityPrecision ??
        6;


    return floorToPrecision(
        quantity,
        precision
    ).toFixed(
        precision
    );
}


// ============================================================
// CALCULATE POSITION
// ============================================================
//
// Position size:
//
// margin × leverage = notional
//
// WEEX V3 uses quantity in base asset for BTCUSDT.
//
// Therefore:
//
// BTC quantity = notional / BTC price
//
// The exact precision/minimum is taken from exchangeInfo.
//
// ============================================================

function calculatePosition(
    price
) {

    if (
        !CONTRACT_INFO
    ) {

        throw new Error(
            "Contract information has not been loaded."
        );
    }


    const targetNotional =
        MAX_MARGIN_USDT *
        LEVERAGE;


    const targetBTC =
        targetNotional /
        price;


    let quantity =
        targetBTC;


    quantity =
        floorToPrecision(
            quantity,
            CONTRACT_INFO.quantityPrecision
        );


    if (
        quantity <
        CONTRACT_INFO.minOrderSize
    ) {

        throw new Error(
            `Calculated quantity ${quantity} ` +
            `is below WEEX minimum order size ` +
            `${CONTRACT_INFO.minOrderSize}`
        );
    }


    if (
        quantity >
        CONTRACT_INFO.maxOrderSize
    ) {

        throw new Error(
            `Calculated quantity ${quantity} ` +
            `exceeds WEEX maximum order size ` +
            `${CONTRACT_INFO.maxOrderSize}`
        );
    }


    const actualNotional =
        quantity *
        price;


    const actualMargin =
        actualNotional /
        LEVERAGE;


    return {

        targetNotional,

        targetBTC,

        quantity,

        actualBTC:
            quantity,

        actualNotional,

        actualMargin

    };
}


// ============================================================
// PRINT POSITION
// ============================================================

function printPosition(
    price,
    position
) {

    console.log("");
    console.log("=================================");
    console.log("POSITION CALCULATION");
    console.log("=================================");

    console.log(
        "BTC PRICE:",
        price.toFixed(2),
        "USDT"
    );

    console.log(
        "MAX MARGIN:",
        MAX_MARGIN_USDT.toFixed(4),
        "USDT"
    );

    console.log(
        "LEVERAGE:",
        LEVERAGE,
        "x"
    );

    console.log(
        "TARGET NOTIONAL:",
        position.targetNotional.toFixed(4),
        "USDT"
    );

    console.log(
        "TARGET BTC:",
        position.targetBTC.toFixed(8)
    );

    console.log(
        "ORDER QUANTITY:",
        position.quantity
    );

    console.log(
        "ACTUAL BTC:",
        position.actualBTC.toFixed(8)
    );

    console.log(
        "ACTUAL NOTIONAL:",
        position.actualNotional.toFixed(4),
        "USDT"
    );

    console.log(
        "ACTUAL MARGIN:",
        position.actualMargin.toFixed(6),
        "USDT"
    );

    console.log(
        "================================="
    );
}


// ============================================================
// OPEN MARKET POSITION
// ============================================================
//
// WEEX V3:
//
// LONG:
//
// side = BUY
// positionSide = LONG
//
// SHORT:
//
// side = SELL
// positionSide = SHORT
//
// type = MARKET
//
// ============================================================

async function openMarketPosition(
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


    const balance =
        await getFuturesBalance();


    if (
        balance.available <
        MAX_MARGIN_USDT
    ) {

        throw new Error(
            `Insufficient WEEX futures balance. ` +
            `Available ${balance.available.toFixed(8)} USDT, ` +
            `required approximately ${MAX_MARGIN_USDT.toFixed(8)} USDT`
        );
    }


    const price =
        await getBTCPrice();


    const position =
        calculatePosition(
            price
        );


    printPosition(
        price,
        position
    );


    await setLeverage();


    const side =
        direction === "LONG"
            ? "BUY"
            : "SELL";


    const clientOrderId =
        `TV_${direction}_${Date.now()}`;


    console.log("");
    console.log("=================================");
    console.log("SENDING WEEX MARKET ORDER");
    console.log("=================================");

    console.log(
        "Symbol:",
        SYMBOL
    );

    console.log(
        "Side:",
        side
    );

    console.log(
        "Position Side:",
        direction
    );

    console.log(
        "Type:",
        "MARKET"
    );

    console.log(
        "Quantity:",
        formatQuantity(
            position.quantity
        )
    );

    console.log(
        "Client ID:",
        clientOrderId
    );


    const result =
        await weexRequest(
            "POST",
            "/capi/v3/order",
            {

                symbol:
                    SYMBOL,

                side:
                    side,

                positionSide:
                    direction,

                type:
                    "MARKET",

                quantity:
                    formatQuantity(
                        position.quantity
                    ),

                newClientOrderId:
                    clientOrderId

            }
        );


    console.log("");
    console.log("=================================");
    console.log("WEEX OPEN ORDER RESPONSE");
    console.log("=================================");

    console.log(
        JSON.stringify(
            result,
            null,
            2
        )
    );


    if (
        result &&
        result.success === false
    ) {

        throw new Error(
            result.errorMessage ||
            result.errorCode ||
            "WEEX order rejected"
        );
    }


    return {

        order:
            result,

        calculated:
            position

    };
}


// ============================================================
// CLOSE POSITION
// ============================================================
//
// To close a LONG:
//
// side = SELL
// positionSide = LONG
// reduceOnly = true
//
// To close a SHORT:
//
// side = BUY
// positionSide = SHORT
// reduceOnly = true
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

        console.log(
            "No position to close."
        );


        return {

            success:
                true,

            reason:
                "ALREADY_FLAT"

        };
    }


    const side =
        position.direction === "LONG"
            ? "SELL"
            : "BUY";


    const clientOrderId =
        `TV_CLOSE_${Date.now()}`;


    console.log("");
    console.log("=================================");
    console.log("WEEX CLOSE MARKET ORDER");
    console.log("=================================");

    console.log(
        "Direction:",
        position.direction
    );

    console.log(
        "Side:",
        side
    );

    console.log(
        "Position Side:",
        position.direction
    );

    console.log(
        "Quantity:",
        formatQuantity(
            position.quantity
        )
    );


    const result =
        await weexRequest(
            "POST",
            "/capi/v3/order",
            {

                symbol:
                    SYMBOL,

                side:
                    side,

                positionSide:
                    position.direction,

                type:
                    "MARKET",

                quantity:
                    formatQuantity(
                        position.quantity
                    ),

                newClientOrderId:
                    clientOrderId,

                reduceOnly:
                    true

            }
        );


    console.log("");
    console.log(
        "WEEX CLOSE RESPONSE:"
    );

    console.log(
        JSON.stringify(
            result,
            null,
            2
        )
    );


    if (
        result &&
        result.success === false
    ) {

        throw new Error(
            result.errorMessage ||
            result.errorCode ||
            "WEEX close order rejected"
        );
    }


    return {

        success:
            true,

        result

    };
}


// ============================================================
// WAIT FOR POSITION
// ============================================================

async function waitForPosition(
    expectedDirection,
    maxAttempts = 12
) {

    for (
        let attempt = 1;
        attempt <= maxAttempts;
        attempt++
    ) {

        await sleep(500);


        const position =
            await getCurrentPosition();


        if (
            expectedDirection ===
            "FLAT"
        ) {

            if (
                position.direction ===
                "FLAT"
            ) {

                return true;
            }

        } else {

            if (
                position.direction ===
                expectedDirection
            ) {

                return true;
            }
        }


        console.log(
            `Waiting for ${expectedDirection}... ` +
            `${attempt}/${maxAttempts}`
        );
    }


    return false;
}


// ============================================================
// PROCESS SIGNAL
// ============================================================
//
// LONG
//
// FLAT  -> OPEN LONG
// LONG  -> NOTHING
// SHORT -> CLOSE SHORT -> OPEN LONG
//
// SHORT
//
// FLAT  -> OPEN SHORT
// SHORT -> NOTHING
// LONG  -> CLOSE LONG -> OPEN SHORT
//
// CLOSE
//
// LONG/SHORT -> CLOSE
//
// ============================================================

async function processSignal(
    action
) {

    action =
        String(
            action || ""
        )
            .trim()
            .toUpperCase();


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

            action

        };
    }


    await acquireTradingLock();


    try {

        console.log("");
        console.log("#################################");
        console.log("PROCESSING SIGNAL");
        console.log("#################################");

        console.log(
            "SIGNAL:",
            action
        );


        let current =
            await getCurrentPosition();


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
                    "FLAT"
                );


            if (
                !flat
            ) {

                throw new Error(
                    "WEEX did not confirm that the position closed."
                );
            }


            return {

                success:
                    true,

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

            console.log("");
            console.log(
                "SAME POSITION ALREADY OPEN."
            );

            console.log(
                "NO NEW ORDER."
            );


            return {

                success:
                    true,

                action:
                    "NO_ACTION",

                reason:
                    `ALREADY_${action}`,

                position:
                    current

            };
        }


        // ====================================================
        // OPPOSITE POSITION
        // ====================================================

        if (
            current.direction !==
            "FLAT" &&
            current.direction !==
            action
        ) {

            console.log("");
            console.log("=================================");
            console.log("REVERSING POSITION");
            console.log("=================================");

            console.log(
                "Current:",
                current.direction
            );

            console.log(
                "New signal:",
                action
            );


            // ------------------------------------------------
            // FIRST CLOSE CURRENT POSITION
            // ------------------------------------------------

            const closeResult =
                await closePosition(
                    current
                );


            const flat =
                await waitForPosition(
                    "FLAT"
                );


            if (
                !flat
            ) {

                throw new Error(
                    "WEEX did not confirm the old position closed."
                );
            }


            // ------------------------------------------------
            // THEN OPEN NEW POSITION
            // ------------------------------------------------

            const openResult =
                await openMarketPosition(
                    action
                );


            const verified =
                await waitForPosition(
                    action
                );


            if (
                !verified
            ) {

                throw new Error(
                    `WEEX did not confirm ${action} after reversal.`
                );
            }


            return {

                success:
                    true,

                action:
                    `REVERSED_TO_${action}`,

                close:
                    closeResult,

                open:
                    openResult,

                position:
                    await getCurrentPosition()

            };
        }


        // ====================================================
        // FLAT -> OPEN
        // ====================================================

        const openResult =
            await openMarketPosition(
                action
            );


        const verified =
            await waitForPosition(
                action
            );


        if (
            !verified
        ) {

            console.log("");
            console.log(
                "WARNING:"
            );

            console.log(
                `WEEX did not yet report ${action}.`
            );

            console.log(
                "The order may still be processing."
            );
        }


        return {

            success:
                true,

            action:
                `OPENED_${action}`,

            result:
                openResult,

            position:
                await getCurrentPosition()

        };

    } finally {

        releaseTradingLock();
    }
}


// ============================================================
// TRADINGVIEW WEBHOOK
// ============================================================

app.post(
    "/webhook",
    async (
        req,
        res
    ) => {

        console.log("");
        console.log("=================================");
        console.log("TRADINGVIEW SIGNAL");
        console.log("=================================");


        console.log(
            JSON.stringify(
                req.body,
                null,
                2
            )
        );


        try {

            const action =
                String(
                    req.body.action ||
                    ""
                )
                    .trim()
                    .toUpperCase();


            let symbol =
                String(
                    req.body.symbol ||
                    ""
                )
                    .trim()
                    .toUpperCase();


            console.log(
                "Action:",
                action
            );

            console.log(
                "TradingView Symbol:",
                symbol
            );


            // =================================================
            // ACCEPT COMMON BTC SYMBOLS
            // =================================================

            if (
                symbol ===
                "BTCUSDT"
            ) {

                symbol =
                    SYMBOL;
            }


            if (
                symbol ===
                "BTC/USDT"
            ) {

                symbol =
                    SYMBOL;
            }


            if (
                symbol ===
                "BINANCE:BTCUSDT"
            ) {

                symbol =
                    SYMBOL;
            }


            if (
                symbol ===
                "COINBASE:BTCUSDT"
            ) {

                symbol =
                    SYMBOL;
            }


            console.log(
                "WEEX Symbol:",
                symbol
            );


            // =================================================
            // BTC ONLY
            // =================================================

            if (
                symbol !==
                SYMBOL
            ) {

                return res
                    .status(400)
                    .json({

                        success:
                            false,

                        error:
                            `This bot only trades ${SYMBOL}`,

                        receivedSymbol:
                            symbol

                    });
            }


            // =================================================
            // ACTION
            // =================================================

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


            const result =
                await processSignal(
                    action
                );


            return res.json(
                result
            );


        } catch (error) {

            console.error("");
            console.error("=================================");
            console.error("WEBHOOK ERROR");
            console.error("=================================");

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
// MANUAL LONG
// ============================================================

app.post(
    "/manual-long",
    async (
        req,
        res
    ) => {

        try {

            const result =
                await processSignal(
                    "LONG"
                );


            return res.json(
                result
            );

        } catch (error) {

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
// MANUAL SHORT
// ============================================================

app.post(
    "/manual-short",
    async (
        req,
        res
    ) => {

        try {

            const result =
                await processSignal(
                    "SHORT"
                );


            return res.json(
                result
            );

        } catch (error) {

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
// MANUAL CLOSE
// ============================================================

app.post(
    "/manual-close",
    async (
        req,
        res
    ) => {

        try {

            const result =
                await processSignal(
                    "CLOSE"
                );


            return res.json(
                result
            );

        } catch (error) {

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


            const position =
                await getCurrentPosition();


            res.json({

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

                symbol:
                    SYMBOL,

                maxMargin:
                    MAX_MARGIN_USDT,

                leverage:
                    LEVERAGE,

                marginType:
                    MARGIN_TYPE,

                balance:
                    balance.available,

                contract:
                    CONTRACT_INFO,

                position

            });

        } catch (error) {

            res
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
// HEALTH CHECK
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
                "TradingView -> WEEX",

            trading:
                TRADING_ENABLED,

            mode:
                TRADING_ENABLED
                    ? "LIVE"
                    : "DISABLED",

            api:
                "WEEX V3 USDT-M Futures",

            symbol:
                SYMBOL,

            maxMargin:
                MAX_MARGIN_USDT,

            leverage:
                LEVERAGE,

            marginType:
                MARGIN_TYPE,

            behavior:
                "LONG/SHORT automatic reversal"

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
        console.log("=================================");
        console.log("SERVER STARTED");
        console.log("=================================");

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
            "Symbol:",
            SYMBOL
        );

        console.log(
            "Maximum margin:",
            MAX_MARGIN_USDT,
            "USDT"
        );

        console.log(
            "Leverage:",
            LEVERAGE,
            "x"
        );

        console.log(
            "Margin type:",
            MARGIN_TYPE
        );

        console.log("=================================");


        try {

            // ------------------------------------------------
            // Load actual WEEX contract information
            // ------------------------------------------------

            await getContractInfo();


            // ------------------------------------------------
            // Balance
            // ------------------------------------------------

            const balance =
                await getFuturesBalance();


            // ------------------------------------------------
            // Price
            // ------------------------------------------------

            const price =
                await getBTCPrice();


            // ------------------------------------------------
            // Position
            // ------------------------------------------------

            const position =
                await getCurrentPosition();


            // ------------------------------------------------
            // Calculation
            // ------------------------------------------------

            const calculation =
                calculatePosition(
                    price
                );


            printPosition(
                price,
                calculation
            );


            console.log("");
            console.log("=================================");
            console.log("CURRENT STATE");
            console.log("=================================");

            console.log(
                "Balance:",
                balance.available.toFixed(8),
                "USDT"
            );

            console.log(
                "Position:",
                position.direction
            );


            console.log("");
            console.log("=================================");
            console.log("READY");
            console.log("=================================");

            console.log(
                "TradingView LONG  -> OPEN/REVERSE LONG"
            );

            console.log(
                "TradingView SHORT -> OPEN/REVERSE SHORT"
            );

            console.log(
                "TradingView CLOSE -> CLOSE POSITION"
            );

            console.log(
                "No local position memory."
            );

            console.log(
                "WEEX position checked before every signal."
            );

            console.log(
                "WEEX V3 live futures API."
            );

            console.log(
                "Trading:",
                TRADING_ENABLED
                    ? "LIVE"
                    : "DISABLED"
            );

            console.log("=================================");


        } catch (error) {

            console.error("");
            console.error(
                "STARTUP CHECK FAILED:"
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
