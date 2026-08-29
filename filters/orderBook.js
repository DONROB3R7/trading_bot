// ============================================================
// WEEX ORDER BOOK FILTER - EASY SETTINGS
// ============================================================
//
// Change ONLY these settings when testing.
//
// ------------------------------------------------------------
// ORDER_BOOK_FILTER_ENABLED
// ------------------------------------------------------------
//
// true  = Order book filter is ACTIVE
// false = Order book filter is COMPLETELY BYPASSED
//
// ------------------------------------------------------------
// IMBALANCE PRESETS
// ------------------------------------------------------------
//
// VERY LIGHT
// LONG  >= +0.10
// SHORT <= -0.10
//
// LIGHT  ⭐ CURRENT
// LONG  >= +0.15
// SHORT <= -0.15
//
// NORMAL
// LONG  >= +0.20
// SHORT <= -0.20
//
// RESTRICTIVE
// LONG  >= +0.25
// SHORT <= -0.25
//
// VERY RESTRICTIVE
// LONG  >= +0.30
// SHORT <= -0.30
//
// ============================================================


// ============================================================
// EASY FILTER SWITCH
// ============================================================

const ORDER_BOOK_FILTER_ENABLED = true;


// ============================================================
// EASY IMBALANCE SETTINGS
// ============================================================
//
// CURRENT SETTING:
// LIGHT = +0.15 / -0.15
//
// Change these two numbers directly:
//
// LONG  -> positive value
// SHORT -> negative value
//
// ============================================================

const LONG_MIN_IMBALANCE = 0.15;
const SHORT_MAX_IMBALANCE = -0.15;


// ============================================================
// IMPORT CONFIG
// ============================================================
//
// We still use config.js for:
// - ORDER_BOOK_DEPTH
// - MIN_BID_ASK_RATIO
// - MIN_ASK_BID_RATIO
//
// The imbalance values above are controlled directly here.
//
// ============================================================

const {
    ORDER_BOOK_DEPTH,
    MIN_BID_ASK_RATIO,
    MIN_ASK_BID_RATIO
} = require("../config/config");


// ============================================================
// CALCULATE ORDER BOOK PRESSURE
// ============================================================

function calculateOrderBookPressure(orderBook) {

    const bids =
        Array.isArray(orderBook?.bids)
            ? orderBook.bids
            : [];

    const asks =
        Array.isArray(orderBook?.asks)
            ? orderBook.asks
            : [];

    let bidLiquidity = 0;
    let askLiquidity = 0;


    // ========================================================
    // BID LIQUIDITY
    // ========================================================

    for (const level of bids) {

        if (
            !Array.isArray(level) ||
            level.length < 2
        ) {
            continue;
        }

        const quantity =
            Number(level[1]);

        if (
            Number.isFinite(quantity) &&
            quantity > 0
        ) {
            bidLiquidity += quantity;
        }
    }


    // ========================================================
    // ASK LIQUIDITY
    // ========================================================

    for (const level of asks) {

        if (
            !Array.isArray(level) ||
            level.length < 2
        ) {
            continue;
        }

        const quantity =
            Number(level[1]);

        if (
            Number.isFinite(quantity) &&
            quantity > 0
        ) {
            askLiquidity += quantity;
        }
    }


    // ========================================================
    // TOTAL LIQUIDITY
    // ========================================================

    const totalLiquidity =
        bidLiquidity +
        askLiquidity;


    if (totalLiquidity <= 0) {

        throw new Error(
            "WEEX order book contains no usable liquidity."
        );
    }


    // ========================================================
    // PERCENTAGES
    // ========================================================

    const bidPercentage =
        bidLiquidity /
        totalLiquidity;

    const askPercentage =
        askLiquidity /
        totalLiquidity;


    // ========================================================
    // IMBALANCE
    // ========================================================
    //
    // Positive = more bid liquidity
    // Negative = more ask liquidity
    //
    // Example:
    //
    // +0.15 = moderate LONG pressure
    //  0.00 = balanced
    // -0.15 = moderate SHORT pressure
    //
    // ========================================================

    const imbalance =
        (
            bidLiquidity -
            askLiquidity
        ) /
        totalLiquidity;


    // ========================================================
    // RATIOS
    // ========================================================

    const bidAskRatio =
        askLiquidity > 0
            ? bidLiquidity / askLiquidity
            : Infinity;

    const askBidRatio =
        bidLiquidity > 0
            ? askLiquidity / bidLiquidity
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
// getOrderBook is passed into this function.
//
// This prevents orderBook.js from importing weex.js,
// which removes the circular dependency.
//
// ============================================================

async function checkOrderBook(
    symbol,
    direction,
    getOrderBook
) {

    if (
        typeof getOrderBook !== "function"
    ) {

        throw new Error(
            "checkOrderBook requires a valid getOrderBook function."
        );
    }


    // ========================================================
    // NORMALIZE DIRECTION
    // ========================================================

    direction =
        String(direction || "")
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


    // ========================================================
    // FILTER DISABLED
    // ========================================================
    //
    // If false:
    //
    // TradingView signal
    //        ↓
    // ORDER BOOK BYPASSED
    //        ↓
    // TRADE ALLOWED
    //
    // This is useful for A/B testing.
    //
    // ========================================================

    if (!ORDER_BOOK_FILTER_ENABLED) {

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
            "ORDER BOOK FILTER:",
            "DISABLED"
        );

        console.log(
            "Result:",
            "BYPASSED - TRADE ALLOWED"
        );

        console.log(
            "============================================================"
        );


        return {

            allowed: true,

            direction,

            reason:
                "ORDER_BOOK_FILTER_DISABLED",

            imbalance: null,

            bidLiquidity: null,
            askLiquidity: null,

            bidPercentage: null,
            askPercentage: null,

            bidAskRatio: null,
            askBidRatio: null,

            imbalancePass: true,
            ratioPass: true
        };
    }


    // ========================================================
    // GET ORDER BOOK
    // ========================================================

    const orderBook =
        await getOrderBook(
            symbol,
            ORDER_BOOK_DEPTH
        );


    // ========================================================
    // GET BIDS
    // ========================================================

    let bids =
        Array.isArray(orderBook?.bids)
            ? orderBook.bids
            : [];


    // ========================================================
    // GET ASKS
    // ========================================================

    let asks =
        Array.isArray(orderBook?.asks)
            ? orderBook.asks
            : [];


    // ========================================================
    // WEEX ALTERNATIVE RESPONSE FORMAT
    // ========================================================

    if (
        bids.length === 0 &&
        Array.isArray(orderBook?.data?.bids)
    ) {

        bids =
            orderBook.data.bids;
    }


    if (
        asks.length === 0 &&
        Array.isArray(orderBook?.data?.asks)
    ) {

        asks =
            orderBook.data.asks;
    }


    // ========================================================
    // VALIDATE ORDER BOOK
    // ========================================================

    if (
        bids.length === 0 ||
        asks.length === 0
    ) {

        throw new Error(
            `${symbol}: WEEX returned an empty order book.`
        );
    }


    // ========================================================
    // CALCULATE PRESSURE
    // ========================================================

    const pressure =
        calculateOrderBookPressure({

            bids,
            asks
        });


    // ========================================================
    // GENERAL ORDER BOOK LOG
    // ========================================================

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
        "Filter enabled:",
        ORDER_BOOK_FILTER_ENABLED
    );

    console.log(
        "Depth levels:",
        ORDER_BOOK_DEPTH
    );

    console.log(
        "LONG threshold:",
        `>= ${LONG_MIN_IMBALANCE}`
    );

    console.log(
        "SHORT threshold:",
        `<= ${SHORT_MAX_IMBALANCE}`
    );

    console.log(
        "Best bid:",
        Number(bids[0]?.[0])
    );

    console.log(
        "Best ask:",
        Number(asks[0]?.[0])
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

        // ====================================================
        // IMBALANCE CHECK
        // ====================================================

        const imbalancePass =
            pressure.imbalance >=
            LONG_MIN_IMBALANCE;


        // ====================================================
        // RATIO CHECK
        // ====================================================
        //
        // IMPORTANT:
        //
        // Ratio is ONLY monitored.
        //
        // It does NOT block the trade.
        //
        // This keeps the order-book filter LIGHT.
        //
        // ====================================================

        const ratioPass =
            pressure.bidAskRatio >=
            MIN_BID_ASK_RATIO;


        // ====================================================
        // FINAL DECISION
        // ====================================================
        //
        // ONLY imbalance can block LONG.
        //
        // ====================================================

        const allowed =
            imbalancePass;


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
            "Imbalance:",
            imbalancePass
                ? "PASS"
                : "FAIL"
        );

        console.log(
            "Bid/Ask ratio:",
            pressure.bidAskRatio
        );

        console.log(
            "Ratio requirement:",
            MIN_BID_ASK_RATIO
        );

        console.log(
            "Ratio:",
            ratioPass
                ? "PASS"
                : "FAIL - NOT BLOCKING"
        );

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


    // ========================================================
    // RATIO CHECK
    // ========================================================
    //
    // Ratio is ONLY monitored.
    //
    // It does NOT block the trade.
    //
    // ========================================================

    const ratioPass =
        pressure.askBidRatio >=
        MIN_ASK_BID_RATIO;


    // ========================================================
    // FINAL DECISION
    // ========================================================
    //
    // ONLY imbalance can block SHORT.
    //
    // ========================================================

    const allowed =
        imbalancePass;


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
        "Imbalance:",
        imbalancePass
            ? "PASS"
            : "FAIL"
    );

    console.log(
        "Ask/Bid ratio:",
        pressure.askBidRatio
    );

    console.log(
        "Ratio requirement:",
        MIN_ASK_BID_RATIO
    );

    console.log(
        "Ratio:",
        ratioPass
            ? "PASS"
            : "FAIL - NOT BLOCKING"
    );

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
// EXPORTS
// ============================================================

module.exports = {

    calculateOrderBookPressure,

    checkOrderBook
};