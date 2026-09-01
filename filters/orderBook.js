const {
    LONG_MIN_IMBALANCE,
    SHORT_MAX_IMBALANCE,
    MIN_BID_ASK_RATIO,
    MIN_ASK_BID_RATIO
} = require("../config/config");

const {
    getOrderBook
} = require("../weex/weex");


// ============================================================
// ORDER BOOK CONFIGURATION
// ============================================================

const WEEX_REQUEST_DEPTH = 200;

const CONFIRMATION_DEPTHS = [15, 20, 30, 60];

const REQUIRED_PASSED_DEPTHS = 3;


// ============================================================
// NORMALIZE ORDER BOOK
// ============================================================

function normalizeOrderBookLevels(orderBook) {

    let bids = [];
    let asks = [];

    if (Array.isArray(orderBook?.bids)) {
        bids = orderBook.bids;
    }

    if (Array.isArray(orderBook?.asks)) {
        asks = orderBook.asks;
    }

    if (
        bids.length === 0 &&
        Array.isArray(orderBook?.data?.bids)
    ) {
        bids = orderBook.data.bids;
    }

    if (
        asks.length === 0 &&
        Array.isArray(orderBook?.data?.asks)
    ) {
        asks = orderBook.data.asks;
    }

    if (
        bids.length === 0 &&
        Array.isArray(orderBook?.data?.data?.bids)
    ) {
        bids = orderBook.data.data.bids;
    }

    if (
        asks.length === 0 &&
        Array.isArray(orderBook?.data?.data?.asks)
    ) {
        asks = orderBook.data.data.asks;
    }

    return {
        bids,
        asks
    };
}


// ============================================================
// CALCULATE PRESSURE
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

    for (const level of bids) {

        if (
            !Array.isArray(level) ||
            level.length < 2
        ) {
            continue;
        }

        const quantity = Number(level[1]);

        if (
            Number.isFinite(quantity) &&
            quantity > 0
        ) {
            bidLiquidity += quantity;
        }
    }

    for (const level of asks) {

        if (
            !Array.isArray(level) ||
            level.length < 2
        ) {
            continue;
        }

        const quantity = Number(level[1]);

        if (
            Number.isFinite(quantity) &&
            quantity > 0
        ) {
            askLiquidity += quantity;
        }
    }

    const totalLiquidity =
        bidLiquidity + askLiquidity;

    if (totalLiquidity <= 0) {
        throw new Error(
            "WEEX order book contains no usable liquidity."
        );
    }

    const bidPercentage =
        bidLiquidity / totalLiquidity;

    const askPercentage =
        askLiquidity / totalLiquidity;

    const imbalance =
        (bidLiquidity - askLiquidity) /
        totalLiquidity;

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
// EVALUATE ONE DEPTH
// ============================================================

function evaluateDepth(
    bids,
    asks,
    depth,
    direction
) {

    const depthBids =
        bids.slice(0, depth);

    const depthAsks =
        asks.slice(0, depth);

    const bidsAvailable =
        depthBids.length;

    const asksAvailable =
        depthAsks.length;

    if (
        bidsAvailable < depth ||
        asksAvailable < depth
    ) {

        return {

            depth,

            available: false,

            levelsAvailable: {
                bids: bidsAvailable,
                asks: asksAvailable
            },

            filterPass: false,

            imbalancePass: false,

            ratioPass: false,

            error:
                `Insufficient order-book levels for depth ${depth}. ` +
                `Required ${depth}, ` +
                `received bids=${bidsAvailable}, ` +
                `asks=${asksAvailable}.`
        };
    }

    const pressure =
        calculateOrderBookPressure({
            bids: depthBids,
            asks: depthAsks
        });

    let imbalancePass = false;
    let ratioPass = false;

    if (direction === "LONG") {

        imbalancePass =
            pressure.imbalance >=
            Number(LONG_MIN_IMBALANCE);

        ratioPass =
            pressure.bidAskRatio >=
            Number(MIN_BID_ASK_RATIO);
    }

    else if (direction === "SHORT") {

        imbalancePass =
            pressure.imbalance <=
            Number(SHORT_MAX_IMBALANCE);

        ratioPass =
            pressure.askBidRatio >=
            Number(MIN_ASK_BID_RATIO);
    }

    const filterPass =
        imbalancePass &&
        ratioPass;

    return {

        depth,

        available: true,

        levelsAvailable: {
            bids: bidsAvailable,
            asks: asksAvailable
        },

        bidLiquidity:
            pressure.bidLiquidity,

        askLiquidity:
            pressure.askLiquidity,

        totalLiquidity:
            pressure.totalLiquidity,

        bidPercentage:
            pressure.bidPercentage,

        askPercentage:
            pressure.askPercentage,

        imbalance:
            pressure.imbalance,

        bidAskRatio:
            pressure.bidAskRatio,

        askBidRatio:
            pressure.askBidRatio,

        imbalancePass,

        ratioPass,

        filterPass
    };
}


// ============================================================
// EVALUATE ONE DIRECTION
// ============================================================

function evaluateDirection(
    bids,
    asks,
    direction
) {

    direction =
        String(direction || "")
            .trim()
            .toUpperCase();

    const results = {};

    for (
        const depth of CONFIRMATION_DEPTHS
    ) {

        results[depth] =
            evaluateDepth(
                bids,
                asks,
                depth,
                direction
            );
    }

    const availableResults =
        CONFIRMATION_DEPTHS.map(
            depth =>
                results[depth]
        );

    const allDepthsAvailable =
        availableResults.every(
            result =>
                result &&
                result.available === true
        );

    const passedDepths =
        availableResults.filter(
            result =>
                result?.filterPass === true
        ).length;

    const availableDepths =
        availableResults.filter(
            result =>
                result?.available === true
        ).length;

    const failedDepths =
        availableResults.filter(
            result =>
                result?.available === true &&
                result?.filterPass !== true
        ).length;

    const confirmationPassed =
        allDepthsAvailable &&
        passedDepths >=
        REQUIRED_PASSED_DEPTHS;

    let confirmationReason;

    if (!allDepthsAvailable) {

        confirmationReason =
            "INSUFFICIENT_ORDER_BOOK_DEPTH";

    } else if (confirmationPassed) {

        confirmationReason =
            `MULTI_DEPTH_CONFIRMED_${passedDepths}_OF_${CONFIRMATION_DEPTHS.length}`;

    } else {

        confirmationReason =
            `MULTI_DEPTH_CONFIRMATION_FAILED_${passedDepths}_OF_${CONFIRMATION_DEPTHS.length}`;
    }

    return {

        direction,

        confirmationDepths:
            [...CONFIRMATION_DEPTHS],

        confirmationRequired:
            REQUIRED_PASSED_DEPTHS,

        totalConfirmationDepths:
            CONFIRMATION_DEPTHS.length,

        passedDepths,

        failedDepths,

        availableDepths,

        allDepthsAvailable,

        allDepthsPassed:
            passedDepths ===
            CONFIRMATION_DEPTHS.length,

        confirmationPassed,

        confirmationReason,

        results
    };
}


// ============================================================
// GET ONE WEEX SNAPSHOT
// ============================================================
//
// WEEX request:
//     200 levels
//
// Trading confirmation:
//     15
//     20
//     30
//     60
//
// Final:
//     3 OF 4
//
// ============================================================

async function getMultiDepthSnapshot(symbol) {

    const rawOrderBook =
        await getOrderBook(
            symbol,
            WEEX_REQUEST_DEPTH
        );

    const {
        bids,
        asks
    } =
        normalizeOrderBookLevels(
            rawOrderBook
        );

    if (
        bids.length === 0 ||
        asks.length === 0
    ) {

        throw new Error(
            `${symbol}: WEEX returned an empty order book. ` +
            `bids=${bids.length}, asks=${asks.length}`
        );
    }

    console.log(
        `[ORDER BOOK] ${symbol} | ` +
        `requested=${WEEX_REQUEST_DEPTH} | ` +
        `bids=${bids.length} | ` +
        `asks=${asks.length}`
    );

    return {

        bids,

        asks,

        requestedDepth:
            WEEX_REQUEST_DEPTH,

        availableDepth: {

            bids: bids.length,

            asks: asks.length
        }
    };
}


// ============================================================
// ANALYZE BOTH DIRECTIONS
// ============================================================

function analyzeOrderBookSnapshot(
    snapshot,
    direction
) {

    const long =
        evaluateDirection(
            snapshot.bids,
            snapshot.asks,
            "LONG"
        );

    const short =
        evaluateDirection(
            snapshot.bids,
            snapshot.asks,
            "SHORT"
        );

    let finalDirection =
        "NEUTRAL";

    let finalResult =
        null;

    const longPassed =
        long.confirmationPassed === true;

    const shortPassed =
        short.confirmationPassed === true;

    if (
        longPassed &&
        !shortPassed
    ) {

        finalDirection =
            "LONG";

        finalResult =
            long;
    }

    else if (
        shortPassed &&
        !longPassed
    ) {

        finalDirection =
            "SHORT";

        finalResult =
            short;
    }

    else if (
        longPassed &&
        shortPassed
    ) {

        finalDirection =
            "NEUTRAL";

        finalResult =
            null;
    }

    else {

        finalDirection =
            "NEUTRAL";

        finalResult =
            null;
    }

    return {

        direction:
            finalDirection,

        confirmationPassed:
            finalDirection !== "NEUTRAL",

        passedDepths:
            finalResult?.passedDepths ?? 0,

        requiredPassedDepths:
            REQUIRED_PASSED_DEPTHS,

        confirmationDepths:
            [...CONFIRMATION_DEPTHS],

        requestedDepth:
            WEEX_REQUEST_DEPTH,

        availableDepth:
            snapshot.availableDepth,

        long,

        short,

        final:
            finalResult,

        snapshot
    };
}


// ============================================================
// CHECK ORDER BOOK
// ============================================================

async function checkOrderBook(
    symbol,
    direction = null
) {

    symbol =
        String(symbol || "")
            .trim()
            .toUpperCase();

    if (!symbol) {

        throw new Error(
            "Order-book symbol is required."
        );
    }

    if (direction !== null) {

        direction =
            String(direction)
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
    }

    const snapshot =
        await getMultiDepthSnapshot(
            symbol
        );

    const analysis =
        analyzeOrderBookSnapshot(
            snapshot
        );

    if (
        direction === "LONG" ||
        direction === "SHORT"
    ) {

        const selected =
            analysis[
                direction.toLowerCase()
            ];

        const allowed =
            selected.confirmationPassed === true;

        return {

            allowed,

            direction,

            reason:
                allowed
                    ? (
                        direction === "LONG"
                            ? "MULTI_DEPTH_SUPPORTS_LONG"
                            : "MULTI_DEPTH_SUPPORTS_SHORT"
                    )
                    : (
                        direction === "LONG"
                            ? "MULTI_DEPTH_DOES_NOT_SUPPORT_LONG"
                            : "MULTI_DEPTH_DOES_NOT_SUPPORT_SHORT"
                    ),

            imbalance:
                selected.results[15]?.imbalance ?? 0,

            bidLiquidity:
                selected.results[15]?.bidLiquidity ?? 0,

            askLiquidity:
                selected.results[15]?.askLiquidity ?? 0,

            totalLiquidity:
                selected.results[15]?.totalLiquidity ?? 0,

            bidPercentage:
                selected.results[15]?.bidPercentage ?? 0,

            askPercentage:
                selected.results[15]?.askPercentage ?? 0,

            bidAskRatio:
                selected.results[15]?.bidAskRatio ?? 0,

            askBidRatio:
                selected.results[15]?.askBidRatio ?? 0,

            imbalancePass:
                selected.results[15]?.imbalancePass ?? false,

            ratioPass:
                selected.results[15]?.ratioPass ?? false,

            confirmationDepths:
                [...CONFIRMATION_DEPTHS],

            confirmationRequired:
                REQUIRED_PASSED_DEPTHS,

            confirmationPassed:
                selected.confirmationPassed,

            allDepthsPassed:
                selected.allDepthsPassed,

            allDepthsAvailable:
                selected.allDepthsAvailable,

            availableDepths:
                selected.availableDepths,

            passedDepths:
                selected.passedDepths,

            failedDepths:
                selected.failedDepths,

            depth15:
                selected.results[15],

            depth20:
                selected.results[20],

            depth30:
                selected.results[30],

            depth60:
                selected.results[60],

            depths:
                selected.results,

            requestedDepth:
                WEEX_REQUEST_DEPTH,

            availableDepth:
                snapshot.availableDepth,

            analysis
        };
    }

    return {

        allowed:
            analysis.direction !== "NEUTRAL",

        direction:
            analysis.direction,

        reason:
            analysis.direction === "LONG"
                ? "MULTI_DEPTH_SUPPORTS_LONG"
                : analysis.direction === "SHORT"
                    ? "MULTI_DEPTH_SUPPORTS_SHORT"
                    : "MULTI_DEPTH_CONFIRMATION_FAILED",

        confirmationPassed:
            analysis.confirmationPassed,

        passedDepths:
            analysis.passedDepths,

        requiredPassedDepths:
            REQUIRED_PASSED_DEPTHS,

        confirmationDepths:
            [...CONFIRMATION_DEPTHS],

        requestedDepth:
            WEEX_REQUEST_DEPTH,

        availableDepth:
            snapshot.availableDepth,

        long:
            analysis.long,

        short:
            analysis.short,

        analysis
    };
}


// ============================================================
// COMPARE ORDER BOOK DEPTHS
// ============================================================

async function compareOrderBookDepths(
    symbol,
    direction
) {

    const result =
        await checkOrderBook(
            symbol,
            direction
        );

    console.log("");

    console.log(
        "============================================================"
    );

    console.log(
        `WEEX MULTI-DEPTH ORDER BOOK: ${symbol}`
    );

    console.log(
        "============================================================"
    );

    console.log(
        "Direction:",
        direction
    );

    console.log(
        "WEEX API REQUEST:",
        `${WEEX_REQUEST_DEPTH} levels`
    );

    console.log(
        "WEEX AVAILABLE:",
        `bids=${result.availableDepth?.bids ?? 0}`,
        `asks=${result.availableDepth?.asks ?? 0}`
    );

    console.log(
        "TRADING DEPTHS:",
        CONFIRMATION_DEPTHS.join(" + ")
    );

    console.log(
        "REQUIRED:",
        `${REQUIRED_PASSED_DEPTHS} OF ${CONFIRMATION_DEPTHS.length}`
    );

    for (
        const depth of CONFIRMATION_DEPTHS
    ) {

        const r =
            result.depths[depth];

        console.log("");

        console.log(
            `DEPTH ${depth}:`,
            r?.available === false
                ? "NO DATA"
                : r?.filterPass
                    ? "PASS"
                    : "BLOCKED"
        );

        console.log(
            "Levels:",
            `${r?.levelsAvailable?.bids ?? 0} bids / ` +
            `${r?.levelsAvailable?.asks ?? 0} asks`
        );

        console.log(
            "Imbalance:",
            r?.imbalance ?? "--"
        );

        console.log(
            "Bid/Ask:",
            r?.bidAskRatio ?? "--"
        );

        console.log(
            "Ask/Bid:",
            r?.askBidRatio ?? "--"
        );

        console.log(
            "Imbalance test:",
            r?.available === false
                ? "--"
                : r?.imbalancePass
                    ? "PASS"
                    : "FAIL"
        );

        console.log(
            "Ratio test:",
            r?.available === false
                ? "--"
                : r?.ratioPass
                    ? "PASS"
                    : "FAIL"
        );

        if (r?.error) {

            console.log(
                "Error:",
                r.error
            );
        }
    }

    console.log("");

    console.log(
        "============================================================"
    );

    console.log(
        "FINAL CONFIRMATION:",
        result.confirmationPassed
            ? "PASSED"
            : "BLOCKED"
    );

    console.log(
        "Passed:",
        result.passedDepths,
        "/",
        result.confirmationDepths.length
    );

    console.log(
        "Available:",
        result.long?.availableDepths ??
        result.analysis?.long?.availableDepths ??
        0,
        "/",
        result.confirmationDepths.length
    );

    console.log(
        "============================================================"
    );

    return result;
}


// ============================================================
// GET FILTER CONFIG
// ============================================================

function getOrderBookFilterConfig() {

    return {

        enabled: true,

        apiRequestDepth:
            WEEX_REQUEST_DEPTH,

        confirmationDepths:
            [...CONFIRMATION_DEPTHS],

        requiredPassedDepths:
            REQUIRED_PASSED_DEPTHS,

        confirmationRule:
            `${REQUIRED_PASSED_DEPTHS}_OF_${CONFIRMATION_DEPTHS.length}`,

        long: {

            minImbalance:
                LONG_MIN_IMBALANCE,

            minBidAskRatio:
                MIN_BID_ASK_RATIO,

            confirmation:
                `${REQUIRED_PASSED_DEPTHS}_OF_${CONFIRMATION_DEPTHS.length}`
        },

        short: {

            maxImbalance:
                SHORT_MAX_IMBALANCE,

            minAskBidRatio:
                MIN_ASK_BID_RATIO,

            confirmation:
                `${REQUIRED_PASSED_DEPTHS}_OF_${CONFIRMATION_DEPTHS.length}`
        },

        close:
            "NEVER_FILTERED"
    };
}


// ============================================================
// MULTI-DEPTH COMPATIBILITY WRAPPER
// ============================================================

function evaluateMultiDepth(
    bids,
    asks,
    direction
) {

    return evaluateDirection(
        bids,
        asks,
        String(direction || "")
            .trim()
            .toUpperCase()
    );
}


// ============================================================
// EXPORTS
// ============================================================

module.exports = {

    calculateOrderBookPressure,

    normalizeOrderBookLevels,

    evaluateDepth,

    evaluateDirection,

    evaluateMultiDepth,

    getMultiDepthSnapshot,

    analyzeOrderBookSnapshot,

    checkOrderBook,

    compareOrderBookDepths,

    getOrderBookFilterConfig,

    WEEX_REQUEST_DEPTH,

    CONFIRMATION_DEPTHS,

    REQUIRED_PASSED_DEPTHS
};