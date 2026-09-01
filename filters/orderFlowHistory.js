// ============================================================
// ORDER FLOW HISTORY
// TradingView → WEEX Bot V3
//
// Purpose:
//
// - Keep a rolling 10-minute order-flow history per symbol
// - Collect one snapshot every minute
// - Use the 200-level order book as the TREND FILTER
// - Use 15 / 20 / 30 / 60 levels as the TRIGGER
// - Require 3 OF 4 trigger depths
// - Prevent temporary order-book walls/spoofing from
//   immediately changing the final decision
//
// IMPORTANT:
//
// This module does NOT communicate with WEEX directly.
//
// It receives the already-calculated result from:
//
//     filters/orderBook.js
//
// The same 200-level snapshot is reused.
// No second order-book request is made here.
// ============================================================

const {
    calculateOrderBookPressure
} = require("./orderBook");

const {
    LONG_MIN_IMBALANCE,
    SHORT_MAX_IMBALANCE,
    MIN_BID_ASK_RATIO,
    MIN_ASK_BID_RATIO
} = require("../config/config");


// ============================================================
// HISTORY CONFIGURATION
// ============================================================

const HISTORY_INTERVAL_MS =
    60 * 1000; // 1 minute

const HISTORY_WINDOW_MS =
    10 * 60 * 1000; // 10 minutes

// Do not make a final trading decision until
// enough historical snapshots have been collected.
const MIN_HISTORY_SNAPSHOTS =
    5;

// Percentage required for 200-level trend history.
const TREND_MIN_PERCENT =
    70;

// Percentage required for trigger history.
const TRIGGER_MIN_PERCENT =
    60;

// Current confirmation depths.
const CONFIRMATION_DEPTHS =
    [15, 20, 30, 60];

// Current trigger requirement.
const REQUIRED_PASSED_DEPTHS =
    3;


// ============================================================
// INTERNAL STORAGE
//
// symbol -> {
//
//     snapshots: [],
//     lastCollectedAt: timestamp
//
// }
// ============================================================

const historyBySymbol =
    new Map();


// ============================================================
// HELPERS
// ============================================================

function normalizeSymbol(symbol) {

    return String(symbol || "")
        .trim()
        .toUpperCase();

}


function normalizeDirection(direction) {

    if (!direction) {
        return "NEUTRAL";
    }

    const value =
        String(direction)
            .trim()
            .toUpperCase();

    if (value === "LONG") {
        return "LONG";
    }

    if (value === "SHORT") {
        return "SHORT";
    }

    return "NEUTRAL";
}


function calculatePercentage(count, total) {

    if (!total) {
        return 0;
    }

    return Number(
        ((count / total) * 100).toFixed(2)
    );

}


// ============================================================
// GET / CREATE SYMBOL HISTORY
// ============================================================

function getSymbolHistory(symbol) {

    const normalizedSymbol =
        normalizeSymbol(symbol);

    if (!normalizedSymbol) {
        throw new Error(
            "Order-flow history symbol is required."
        );
    }

    if (!historyBySymbol.has(normalizedSymbol)) {

        historyBySymbol.set(
            normalizedSymbol,
            {
                snapshots: [],
                lastCollectedAt: 0
            }
        );

    }

    return historyBySymbol.get(
        normalizedSymbol
    );

}


// ============================================================
// CLEAN OLD SNAPSHOTS
// ============================================================

function cleanupHistory(
    symbol,
    now = Date.now()
) {

    const history =
        getSymbolHistory(symbol);

    const cutoff =
        now - HISTORY_WINDOW_MS;

    history.snapshots =
        history.snapshots.filter(
            snapshot =>
                snapshot.timestamp >= cutoff
        );

    return history.snapshots;

}


// ============================================================
// CHECK IF NEW SNAPSHOT SHOULD BE COLLECTED
// ============================================================

function shouldCollectSnapshot(
    symbol,
    now = Date.now()
) {

    const history =
        getSymbolHistory(symbol);

    if (!history.lastCollectedAt) {
        return true;
    }

    return (
        now - history.lastCollectedAt
        >= HISTORY_INTERVAL_MS
    );

}


// ============================================================
// CALCULATE 200-LEVEL TREND
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
// Otherwise:
//
//     NEUTRAL
// ============================================================

function calculateCurrentTrend200(
    snapshot
) {

    if (
        !snapshot ||
        !Array.isArray(snapshot.bids) ||
        !Array.isArray(snapshot.asks)
    ) {

        return {
            direction: "NEUTRAL",
            available: false,
            reason: "INVALID_ORDER_BOOK_SNAPSHOT"
        };

    }

    const pressure =
        calculateOrderBookPressure({
            bids: snapshot.bids,
            asks: snapshot.asks
        });

    let direction =
        "NEUTRAL";

    if (
        pressure.imbalance
            >= Number(LONG_MIN_IMBALANCE) &&

        pressure.bidAskRatio
            >= Number(MIN_BID_ASK_RATIO)
    ) {

        direction =
            "LONG";

    } else if (
        pressure.imbalance
            <= Number(SHORT_MAX_IMBALANCE) &&

        pressure.askBidRatio
            >= Number(MIN_ASK_BID_RATIO)
    ) {

        direction =
            "SHORT";

    }

    return {

        direction,

        available: true,

        imbalance:
            pressure.imbalance,

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

        bidAskRatio:
            pressure.bidAskRatio,

        askBidRatio:
            pressure.askBidRatio

    };

}


// ============================================================
// CONVERT CURRENT ORDER-BOOK ANALYSIS
// INTO A HISTORY SNAPSHOT
//
// Expected input:
//
// result from:
//
//     checkOrderBook(symbol)
//
// Which contains:
//
//     result.analysis
//     result.analysis.snapshot
//     result.analysis.long
//     result.analysis.short
//
// ============================================================

function createHistorySnapshot(
    orderBookResult,
    now = Date.now()
) {

    if (
        !orderBookResult ||
        !orderBookResult.analysis
    ) {

        throw new Error(
            "Valid order-book analysis is required."
        );

    }

    const analysis =
        orderBookResult.analysis;

    const snapshot =
        analysis.snapshot;

    if (!snapshot) {

        throw new Error(
            "Order-book analysis does not contain a snapshot."
        );

    }


    // --------------------------------------------------------
    // 200 LEVEL TREND
    // --------------------------------------------------------

    const trend200 =
        calculateCurrentTrend200(
            snapshot
        );


    // --------------------------------------------------------
    // DEPTH DIRECTIONS
    //
    // Each depth can support LONG,
    // SHORT or NEUTRAL.
    // --------------------------------------------------------

    const depthDirections = {};

    for (
        const depth of CONFIRMATION_DEPTHS
    ) {

        const longResult =
            analysis.long?.results?.[depth];

        const shortResult =
            analysis.short?.results?.[depth];

        const longPass =
            longResult?.filterPass === true;

        const shortPass =
            shortResult?.filterPass === true;


        if (
            longPass &&
            !shortPass
        ) {

            depthDirections[
                `depth${depth}`
            ] = "LONG";

        } else if (
            shortPass &&
            !longPass
        ) {

            depthDirections[
                `depth${depth}`
            ] = "SHORT";

        } else {

            depthDirections[
                `depth${depth}`
            ] = "NEUTRAL";

        }

    }


    // --------------------------------------------------------
    // CURRENT TRIGGER
    //
    // 3 OF 4 depths required.
    // --------------------------------------------------------

    const longPassedCount =
        analysis.long?.passedDepths ?? 0;

    const shortPassedCount =
        analysis.short?.passedDepths ?? 0;

    let triggerDirection =
        "NEUTRAL";


    if (
        longPassedCount
            >= REQUIRED_PASSED_DEPTHS &&

        shortPassedCount
            < REQUIRED_PASSED_DEPTHS
    ) {

        triggerDirection =
            "LONG";

    } else if (
        shortPassedCount
            >= REQUIRED_PASSED_DEPTHS &&

        longPassedCount
            < REQUIRED_PASSED_DEPTHS
    ) {

        triggerDirection =
            "SHORT";

    }


    return {

        timestamp: now,

        trend200:
            trend200.direction,

        trend200Data:
            trend200,

        depth15:
            depthDirections.depth15,

        depth20:
            depthDirections.depth20,

        depth30:
            depthDirections.depth30,

        depth60:
            depthDirections.depth60,

        triggerDirection,

        longPassedDepths:
            analysis.long?.passedDepths ?? 0,

        shortPassedDepths:
            analysis.short?.passedDepths ?? 0

    };

}


// ============================================================
// ADD SNAPSHOT
//
// This is the main history storage function.
//
// Pass the result from checkOrderBook().
//
// ============================================================

function addSnapshot(
    symbol,
    orderBookResult,
    now = Date.now()
) {

    const normalizedSymbol =
        normalizeSymbol(symbol);

    const history =
        getSymbolHistory(
            normalizedSymbol
        );


    const historySnapshot =
        createHistorySnapshot(
            orderBookResult,
            now
        );


    history.snapshots.push(
        historySnapshot
    );

    history.lastCollectedAt =
        now;

    cleanupHistory(
        normalizedSymbol,
        now
    );

    return history.snapshots;

}


// ============================================================
// CALCULATE 200-LEVEL HISTORY
// ============================================================

function calculateTrend200(
    snapshots
) {

    if (
        !Array.isArray(snapshots) ||
        !snapshots.length
    ) {

        return {

            direction: "NEUTRAL",

            longCount: 0,

            shortCount: 0,

            neutralCount: 0,

            longPercent: 0,

            shortPercent: 0,

            neutralPercent: 0,

            total: 0,

            enoughHistory: false

        };

    }


    let longCount =
        0;

    let shortCount =
        0;

    let neutralCount =
        0;


    for (
        const snapshot of snapshots
    ) {

        const direction =
            normalizeDirection(
                snapshot.trend200
            );


        if (
            direction === "LONG"
        ) {

            longCount++;

        } else if (
            direction === "SHORT"
        ) {

            shortCount++;

        } else {

            neutralCount++;

        }

    }


    const total =
        snapshots.length;


    const longPercent =
        calculatePercentage(
            longCount,
            total
        );

    const shortPercent =
        calculatePercentage(
            shortCount,
            total
        );

    const neutralPercent =
        calculatePercentage(
            neutralCount,
            total
        );


    let direction =
        "NEUTRAL";


    if (
        total >= MIN_HISTORY_SNAPSHOTS
    ) {

        if (
            longPercent
                >= TREND_MIN_PERCENT
        ) {

            direction =
                "LONG";

        } else if (
            shortPercent
                >= TREND_MIN_PERCENT
        ) {

            direction =
                "SHORT";

        }

    }


    return {

        direction,

        longCount,

        shortCount,

        neutralCount,

        longPercent,

        shortPercent,

        neutralPercent,

        total,

        enoughHistory:
            total >= MIN_HISTORY_SNAPSHOTS

    };

}


// ============================================================
// CALCULATE TRIGGER HISTORY
// ============================================================

function calculateTriggerHistory(
    snapshots
) {

    if (
        !Array.isArray(snapshots) ||
        !snapshots.length
    ) {

        return {

            direction: "NEUTRAL",

            longCount: 0,

            shortCount: 0,

            neutralCount: 0,

            longPercent: 0,

            shortPercent: 0,

            neutralPercent: 0,

            total: 0,

            enoughHistory: false

        };

    }


    let longCount =
        0;

    let shortCount =
        0;

    let neutralCount =
        0;


    for (
        const snapshot of snapshots
    ) {

        const direction =
            normalizeDirection(
                snapshot.triggerDirection
            );


        if (
            direction === "LONG"
        ) {

            longCount++;

        } else if (
            direction === "SHORT"
        ) {

            shortCount++;

        } else {

            neutralCount++;

        }

    }


    const total =
        snapshots.length;


    const longPercent =
        calculatePercentage(
            longCount,
            total
        );

    const shortPercent =
        calculatePercentage(
            shortCount,
            total
        );

    const neutralPercent =
        calculatePercentage(
            neutralCount,
            total
        );


    let direction =
        "NEUTRAL";


    if (
        total >= MIN_HISTORY_SNAPSHOTS
    ) {

        if (
            longPercent
                >= TRIGGER_MIN_PERCENT
        ) {

            direction =
                "LONG";

        } else if (
            shortPercent
                >= TRIGGER_MIN_PERCENT
        ) {

            direction =
                "SHORT";

        }

    }


    return {

        direction,

        longCount,

        shortCount,

        neutralCount,

        longPercent,

        shortPercent,

        neutralPercent,

        total,

        enoughHistory:
            total >= MIN_HISTORY_SNAPSHOTS

    };

}


// ============================================================
// CALCULATE CURRENT TRIGGER
//
// Uses the already-calculated 15/20/30/60 results.
//
// ============================================================

function calculateCurrentTrigger(
    snapshot
) {

    if (!snapshot) {

        return {

            direction: "NEUTRAL",

            longPassedCount: 0,

            shortPassedCount: 0,

            longPassedDepths: [],

            shortPassedDepths: []

        };

    }


    const longPassedDepths =
        [];

    const shortPassedDepths =
        [];


    for (
        const depth of CONFIRMATION_DEPTHS
    ) {

        const direction =
            normalizeDirection(
                snapshot[
                    `depth${depth}`
                ]
            );


        if (
            direction === "LONG"
        ) {

            longPassedDepths.push(
                depth
            );

        }


        if (
            direction === "SHORT"
        ) {

            shortPassedDepths.push(
                depth
            );

        }

    }


    const longPassedCount =
        longPassedDepths.length;

    const shortPassedCount =
        shortPassedDepths.length;


    let direction =
        "NEUTRAL";


    if (
        longPassedCount
            >= REQUIRED_PASSED_DEPTHS &&

        shortPassedCount
            < REQUIRED_PASSED_DEPTHS
    ) {

        direction =
            "LONG";

    } else if (
        shortPassedCount
            >= REQUIRED_PASSED_DEPTHS &&

        longPassedCount
            < REQUIRED_PASSED_DEPTHS
    ) {

        direction =
            "SHORT";

    }


    return {

        direction,

        longPassedCount,

        shortPassedCount,

        longPassedDepths,

        shortPassedDepths

    };

}


// ============================================================
// FINAL DECISION
//
// LONG requires:
//
//     200 history       LONG
//     trigger history   LONG
//     current 200       LONG
//     current trigger   LONG
//     enough history
//
// SHORT requires the same conditions in SHORT.
//
// Otherwise:
//
//     NEUTRAL
// ============================================================

function calculateFinalDecision(
    symbol,
    currentSnapshot
) {

    const normalizedSymbol =
        normalizeSymbol(symbol);

    const history =
        getSymbolHistory(
            normalizedSymbol
        );


    cleanupHistory(
        normalizedSymbol
    );


    const snapshots =
        history.snapshots;


    const trend200 =
        calculateTrend200(
            snapshots
        );


    const triggerHistory =
        calculateTriggerHistory(
            snapshots
        );


    const current200 =
        normalizeDirection(
            currentSnapshot?.trend200
        );


    const currentTrigger =
        normalizeDirection(
            currentSnapshot?.triggerDirection
        );


    let decision =
        "NEUTRAL";

    let reason =
        "HISTORY_NOT_CONFIRMED";


    if (
        snapshots.length
            < MIN_HISTORY_SNAPSHOTS
    ) {

        reason =
            "COLLECTING_HISTORY";

    } else if (
        current200 === "NEUTRAL"
    ) {

        reason =
            "CURRENT_200_TREND_NEUTRAL";

    } else if (
        currentTrigger === "NEUTRAL"
    ) {

        reason =
            "CURRENT_TRIGGER_NEUTRAL";

    } else if (
        current200 !== currentTrigger
    ) {

        reason =
            "TREND_TRIGGER_DISAGREEMENT";

    } else if (
        trend200.direction !== current200
    ) {

        reason =
            "200_TREND_HISTORY_NOT_CONFIRMED";

    } else if (
        triggerHistory.direction !== currentTrigger
    ) {

        reason =
            "TRIGGER_HISTORY_NOT_CONFIRMED";

    } else {

        decision =
            current200;

        reason =
            decision === "LONG"
                ? "LONG_CONFIRMED"
                : "SHORT_CONFIRMED";

    }


    return {

        symbol:
            normalizedSymbol,

        decision,

        reason,


        history: {

            snapshots:
                snapshots.length,

            windowMinutes:
                10,

            minimumSnapshots:
                MIN_HISTORY_SNAPSHOTS

        },


        trend200,


        triggerHistory,


        current: {

            trend200:
                current200,

            trigger:
                currentTrigger

        },


        thresholds: {

            trendMinPercent:
                TREND_MIN_PERCENT,

            triggerMinPercent:
                TRIGGER_MIN_PERCENT

        },


        confirmation: {

            depths:
                [...CONFIRMATION_DEPTHS],

            required:
                REQUIRED_PASSED_DEPTHS,

            rule:
                `${REQUIRED_PASSED_DEPTHS}_OF_${CONFIRMATION_DEPTHS.length}`

        }

    };

}


// ============================================================
// PROCESS ORDER-BOOK RESULT
//
// Convenience function.
//
// This is what trading.js can eventually call:
//
//     const result = processOrderFlowHistory(
//         symbol,
//         orderBookResult
//     );
//
// It:
//
// 1. Checks whether one minute has passed
// 2. Adds a snapshot if required
// 3. Calculates final decision
// ============================================================

function processOrderFlowHistory(
    symbol,
    orderBookResult,
    now = Date.now()
) {

    const normalizedSymbol =
        normalizeSymbol(symbol);


    const history =
        getSymbolHistory(
            normalizedSymbol
        );


    let collected =
        false;


    if (
        shouldCollectSnapshot(
            normalizedSymbol,
            now
        )
    ) {

        addSnapshot(
            normalizedSymbol,
            orderBookResult,
            now
        );

        collected =
            true;

    } else {

        cleanupHistory(
            normalizedSymbol,
            now
        );

    }


    const latestSnapshot =
        history.snapshots[
            history.snapshots.length - 1
        ];


    const currentSnapshot =
        createHistorySnapshot(
            orderBookResult,
            now
        );


    const decision =
        calculateFinalDecision(
            normalizedSymbol,
            currentSnapshot
        );


    return {

        ...decision,

        collected,

        latestSnapshot:

            latestSnapshot || null

    };

}


// ============================================================
// GET HISTORY
// ============================================================

function getHistory(symbol) {

    const normalizedSymbol =
        normalizeSymbol(symbol);

    cleanupHistory(
        normalizedSymbol
    );

    const history =
        getSymbolHistory(
            normalizedSymbol
        );


    return {

        symbol:
            normalizedSymbol,

        snapshots:
            [...history.snapshots],

        lastCollectedAt:
            history.lastCollectedAt

    };

}


// ============================================================
// CLEAR HISTORY
// ============================================================

function clearHistory(symbol) {

    const normalizedSymbol =
        normalizeSymbol(symbol);

    historyBySymbol.delete(
        normalizedSymbol
    );

    return true;

}


// ============================================================
// CLEAR ALL HISTORY
// ============================================================

function clearAllHistory() {

    historyBySymbol.clear();

    return true;

}


// ============================================================
// STATUS
// ============================================================

function getHistoryStatus() {

    const result = {};

    for (
        const [
            symbol,
            history
        ]
        of historyBySymbol.entries()
    ) {

        cleanupHistory(symbol);

        result[symbol] = {

            snapshots:
                history.snapshots.length,

            lastCollectedAt:
                history.lastCollectedAt

        };

    }

    return result;

}


// ============================================================
// EXPORTS
// ============================================================

module.exports = {

    HISTORY_INTERVAL_MS,

    HISTORY_WINDOW_MS,

    MIN_HISTORY_SNAPSHOTS,

    TREND_MIN_PERCENT,

    TRIGGER_MIN_PERCENT,

    CONFIRMATION_DEPTHS,

    REQUIRED_PASSED_DEPTHS,

    normalizeDirection,

    calculateCurrentTrend200,

    createHistorySnapshot,

    shouldCollectSnapshot,

    addSnapshot,

    calculateTrend200,

    calculateTriggerHistory,

    calculateCurrentTrigger,

    calculateFinalDecision,

    processOrderFlowHistory,

    getHistory,

    clearHistory,

    clearAllHistory,

    getHistoryStatus

};

