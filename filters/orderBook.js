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
// WEEX ORDER BOOK CONFIGURATION
// ============================================================
//
// WEEX API:
//     Request up to 200 levels.
//
// Confirmation depths:
//     15 + 20 + 30 + 60
//
// Final confirmation:
//     3 OF 4
//
// IMPORTANT:
//     All four calculations use ONE WEEX snapshot.
//
// ============================================================

const WEEX_REQUEST_DEPTH = 200;

const CONFIRMATION_DEPTHS = [15, 20, 30, 60];

const REQUIRED_PASSED_DEPTHS = 3;


// ============================================================
// NORMALIZE ORDER BOOK
// ============================================================
//
// Supports:
//
//     {
//         bids: [...],
//         asks: [...]
//     }
//
// and:
//
//     {
//         data: {
//             bids: [...],
//             asks: [...]
//         }
//     }
//
// ============================================================

function normalizeOrderBookLevels(orderBook) {

    let bids = [];
    let asks = [];


    // --------------------------------------------------------
    // DIRECT FORMAT
    // --------------------------------------------------------

    if (Array.isArray(orderBook?.bids)) {
        bids = orderBook.bids;
    }

    if (Array.isArray(orderBook?.asks)) {
        asks = orderBook.asks;
    }


    // --------------------------------------------------------
    // DATA FORMAT
    // --------------------------------------------------------

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


    // --------------------------------------------------------
    // SOME API RESPONSES MAY NEST DATA DEEPER
    // --------------------------------------------------------

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


    // --------------------------------------------------------
    // BID LIQUIDITY
    // --------------------------------------------------------

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


    // --------------------------------------------------------
    // ASK LIQUIDITY
    // --------------------------------------------------------

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
        (
            bidLiquidity - askLiquidity
        ) / totalLiquidity;


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


    // --------------------------------------------------------
    // NOT ENOUGH DATA
    // --------------------------------------------------------

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


    // --------------------------------------------------------
    // CALCULATE PRESSURE
    // --------------------------------------------------------

    const pressure =
        calculateOrderBookPressure({

            bids: depthBids,

            asks: depthAsks
        });


    let imbalancePass = false;

    let ratioPass = false;


    // --------------------------------------------------------
    // LONG
    // --------------------------------------------------------

    if (
        direction === "LONG"
    ) {

        imbalancePass =
            pressure.imbalance >=
            Number(LONG_MIN_IMBALANCE);

        ratioPass =
            pressure.bidAskRatio >=
            Number(MIN_BID_ASK_RATIO);
    }


    // --------------------------------------------------------
    // SHORT
    // --------------------------------------------------------

    else if (
        direction === "SHORT"
    ) {

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


    // --------------------------------------------------------
    // CALCULATE ALL FOUR DEPTHS
    // --------------------------------------------------------

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


    // --------------------------------------------------------
    // CHECK AVAILABILITY
    // --------------------------------------------------------

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


    // --------------------------------------------------------
    // FINAL 3 OF 4
    // --------------------------------------------------------
    //
    // IMPORTANT:
    //
    // We require all four confirmation depths to exist.
    //
    // Therefore:
    //
    // 15 PASS
    // 30 PASS
    // 60 FAIL
    // 90 PASS
    //
    // = 3 OF 4 = PASS
    //
    // But:
    //
    // 15 PASS
    // 30 PASS
    // 60 FAIL
    // 90 NO DATA
    //
    // = BLOCKED
    //
    // because the 4-depth confirmation is incomplete.
    //
    // --------------------------------------------------------

    const confirmationPassed =
        allDepthsAvailable &&
        passedDepths >=
        REQUIRED_PASSED_DEPTHS;


    let confirmationReason;


    if (
        !allDepthsAvailable
    ) {

        confirmationReason =
            "INSUFFICIENT_ORDER_BOOK_DEPTH";

    } else if (
        confirmationPassed
    ) {

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
// ONE API REQUEST.
//
// The returned snapshot is then reused for:
//
//     15
//     30
//     60
//     90
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


    // --------------------------------------------------------
    // EMPTY ORDER BOOK
    // --------------------------------------------------------

    if (
        bids.length === 0 ||
        asks.length === 0
    ) {

        throw new Error(
            `${symbol}: WEEX returned an empty order book. ` +
            `bids=${bids.length}, asks=${asks.length}`
        );
    }


    // --------------------------------------------------------
    // IMPORTANT DIAGNOSTIC
    // --------------------------------------------------------
    //
    // This tells us exactly how many levels WEEX returned.
    //
    // If this prints:
    //
    //     bids=200 asks=200
    //
    // 90-level calculations can work.
    //
    // If it prints:
    //
    //     bids=60 asks=60
    //
    // 90-level calculations cannot work.
    //
    // --------------------------------------------------------

    console.log(
        `[ORDER BOOK] ${symbol} | ` +
        `requested=${WEEX_REQUEST_DEPTH} | ` +
        `bids=${bids.length} | ` +
        `asks=${asks.length}`
    );


    // --------------------------------------------------------
    // 90-LEVEL DIAGNOSTIC
    // --------------------------------------------------------

    if (
        bids.length < 90 ||
        asks.length < 90
    ) {

        console.warn(
            `[ORDER BOOK WARNING] ${symbol} | ` +
            `90 levels unavailable | ` +
            `bids=${bids.length}/90 | ` +
            `asks=${asks.length}/90`
        );
    }


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
//
// Both LONG and SHORT use the SAME snapshot.
//
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


    // --------------------------------------------------------
    // LONG
    // --------------------------------------------------------

    if (
        longPassed &&
        !shortPassed
    ) {

        finalDirection =
            "LONG";

        finalResult =
            long;
    }


    // --------------------------------------------------------
    // SHORT
    // --------------------------------------------------------

    else if (
        shortPassed &&
        !longPassed
    ) {

        finalDirection =
            "SHORT";

        finalResult =
            short;
    }


    // --------------------------------------------------------
    // CONFLICT
    // --------------------------------------------------------

    else if (
        longPassed &&
        shortPassed
    ) {

        finalDirection =
            "NEUTRAL";

        finalResult =
            null;
    }


    // --------------------------------------------------------
    // NEUTRAL
    // --------------------------------------------------------

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
//
// MAIN FUNCTION USED BY trading.js.
//
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


    // --------------------------------------------------------
    // NORMALIZE DIRECTION
    // --------------------------------------------------------

    if (
        direction !== null
    ) {

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


    // --------------------------------------------------------
    // ONE WEEX SNAPSHOT
    // --------------------------------------------------------

    const snapshot =
        await getMultiDepthSnapshot(
            symbol
        );


    // --------------------------------------------------------
    // ANALYZE
    // --------------------------------------------------------

    const analysis =
        analyzeOrderBookSnapshot(
            snapshot
        );


    // ========================================================
    // SPECIFIC DIRECTION REQUESTED
    // ========================================================

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


            // ------------------------------------------------
            // LEGACY 15-LEVEL VALUES
            // ------------------------------------------------

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


            // ------------------------------------------------
            // CONFIRMATION
            // ------------------------------------------------

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


            // ------------------------------------------------
            // EXPLICIT DEPTH RESULTS
            // ------------------------------------------------

            depth15:
                selected.results[15],

            depth30:
                selected.results[30],

            depth60:
                selected.results[60],

            depth90:
                selected.results[90],


            // ------------------------------------------------
            // ALL DEPTHS
            // ------------------------------------------------

            depths:
                selected.results,


            requestedDepth:
                WEEX_REQUEST_DEPTH,


            availableDepth:
                snapshot.availableDepth,


            analysis
        };
    }


    // ========================================================
    // NO SPECIFIC DIRECTION
    // ========================================================

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


    // --------------------------------------------------------
    // EACH DEPTH
    // --------------------------------------------------------

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


        if (
            r?.error
        ) {

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
//
// server_v3.js expects:
//
//     evaluateMultiDepth()
//
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