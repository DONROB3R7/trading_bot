// ============================================================
// ORDER FLOW HISTORY
// TradingView → WEEX Bot V3
//
// Purpose:
//
// - Collect one fresh order-flow snapshot every automatic scan
// - Build a configurable history cycle
// - Use the 200-level order book as the TREND FILTER
// - Use 15 / 20 / 30 / 60 levels as the TRIGGER
// - Require 3 OF 4 trigger depths
// - Wait until the configured history cycle is complete
// - Calculate ONE FINAL DECISION
// - Reset the history after the final decision
// - Start a completely fresh cycle
//
// IMPORTANT:
//
// The history length is controlled by:
//
//     AUTO_TRADING_HISTORY_MINUTES
//
// Example:
//
//     10 = 10 snapshots
//     20 = 20 snapshots
//     30 = 30 snapshots
//     60 = 60 snapshots
//
// The automatic trader collects approximately one snapshot
// every minute.
//
// Therefore:
//
//     10 minutes = 10 snapshots
//     60 minutes = 60 snapshots
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
    MIN_ASK_BID_RATIO,
    AUTO_TRADING_INTERVAL_MS,
    AUTO_TRADING_HISTORY_MINUTES
} = require("../config/config");


// ============================================================
// HISTORY CONFIGURATION
// ============================================================
//
// One automatic scan approximately every minute.
//
// The actual history size is controlled by:
//
//     AUTO_TRADING_HISTORY_MINUTES
//
// ============================================================

const HISTORY_INTERVAL_MS =
    AUTO_TRADING_INTERVAL_MS;


// ------------------------------------------------------------
// NUMBER OF SNAPSHOTS REQUIRED
// ------------------------------------------------------------
//
// Example:
//
//     AUTO_TRADING_HISTORY_MINUTES = 10
//
// means:
//
//     10 snapshots required.
//
// ============================================================

const REQUIRED_HISTORY_SNAPSHOTS =
    Math.max(
        1,
        Number(
            AUTO_TRADING_HISTORY_MINUTES
        ) || 60
    );


// ------------------------------------------------------------
// TREND / TRIGGER CONFIRMATION
// ------------------------------------------------------------

const TREND_MIN_PERCENT =
    70;

const TRIGGER_MIN_PERCENT =
    60;


// ------------------------------------------------------------
// ORDER BOOK DEPTHS
// ------------------------------------------------------------

const CONFIRMATION_DEPTHS =
    [15, 20, 30, 60];

const REQUIRED_PASSED_DEPTHS =
    3;


// ============================================================
// INTERNAL STORAGE
//
// symbol -> {
//
//     snapshots: [],
//
//     lastCollectedAt: timestamp
//
// }
//
// IMPORTANT:
//
// This is NOT a rolling history.
//
// Once the required number of snapshots is reached:
//
//     calculate final decision
//     reset snapshots
//     start new cycle
//
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


function calculatePercentage(
    count,
    total
) {
    if (!total) {
        return 0;
    }

    return Number(
        (
            (count / total) *
            100
        ).toFixed(2)
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

    if (
        !historyBySymbol.has(
            normalizedSymbol
        )
    ) {
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
// CLEAN HISTORY
//
// IMPORTANT:
//
// There is NO time-based cleanup anymore.
//
// We use a fixed-size cycle:
//
//     1 → 2 → 3 → ... → N
//
// Once N is reached:
//
//     calculate decision
//     reset
//
// ============================================================

function cleanupHistory(symbol) {

    const history =
        getSymbolHistory(symbol);

    // --------------------------------------------------------
    // Safety protection only.
    //
    // Never allow history to grow beyond the configured
    // cycle size.
    // --------------------------------------------------------

    if (
        history.snapshots.length >
        REQUIRED_HISTORY_SNAPSHOTS
    ) {
        history.snapshots =
            history.snapshots.slice(
                -REQUIRED_HISTORY_SNAPSHOTS
            );
    }

    return history.snapshots;
}


// ============================================================
// SNAPSHOT COLLECTION
//
// The automatic trader controls the scan interval.
//
// Every call = one snapshot.
//
// ============================================================

function shouldCollectSnapshot() {
    return true;
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
            reason:
                "INVALID_ORDER_BOOK_SNAPSHOT"
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
        pressure.imbalance >=
            Number(
                LONG_MIN_IMBALANCE
            ) &&
        pressure.bidAskRatio >=
            Number(
                MIN_BID_ASK_RATIO
            )
    ) {

        direction =
            "LONG";

    } else if (
        pressure.imbalance <=
            Number(
                SHORT_MAX_IMBALANCE
            ) &&
        pressure.askBidRatio >=
            Number(
                MIN_ASK_BID_RATIO
            )
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
    // Each depth can support:
    //
    //     LONG
    //     SHORT
    //     NEUTRAL
    //
    // --------------------------------------------------------

    const depthDirections = {};


    for (
        const depth of CONFIRMATION_DEPTHS
    ) {

        const longResult =
            analysis.long
                ?.results
                ?.[depth];


        const shortResult =
            analysis.short
                ?.results
                ?.[depth];


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
        analysis.long
            ?.passedDepths ??
        0;


    const shortPassedCount =
        analysis.short
            ?.passedDepths ??
        0;


    let triggerDirection =
        "NEUTRAL";


    if (
        longPassedCount >=
            REQUIRED_PASSED_DEPTHS &&
        shortPassedCount <
            REQUIRED_PASSED_DEPTHS
    ) {

        triggerDirection =
            "LONG";

    } else if (
        shortPassedCount >=
            REQUIRED_PASSED_DEPTHS &&
        longPassedCount <
            REQUIRED_PASSED_DEPTHS
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
            longPassedCount,

        shortPassedDepths:
            shortPassedCount
    };
}


// ============================================================
// ADD SNAPSHOT
//
// Every automatic scan adds exactly ONE snapshot.
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
        normalizedSymbol
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

            direction:
                "NEUTRAL",

            longCount:
                0,

            shortCount:
                0,

            neutralCount:
                0,

            longPercent:
                0,

            shortPercent:
                0,

            neutralPercent:
                0,

            total:
                0,

            enoughHistory:
                false
        };
    }


    let longCount = 0;
    let shortCount = 0;
    let neutralCount = 0;


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
        total >=
        REQUIRED_HISTORY_SNAPSHOTS
    ) {

        if (
            longPercent >=
            TREND_MIN_PERCENT
        ) {

            direction =
                "LONG";

        } else if (
            shortPercent >=
            TREND_MIN_PERCENT
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
            total >=
            REQUIRED_HISTORY_SNAPSHOTS
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

            direction:
                "NEUTRAL",

            longCount:
                0,

            shortCount:
                0,

            neutralCount:
                0,

            longPercent:
                0,

            shortPercent:
                0,

            neutralPercent:
                0,

            total:
                0,

            enoughHistory:
                false
        };
    }


    let longCount = 0;
    let shortCount = 0;
    let neutralCount = 0;


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
        total >=
        REQUIRED_HISTORY_SNAPSHOTS
    ) {

        if (
            longPercent >=
            TRIGGER_MIN_PERCENT
        ) {

            direction =
                "LONG";

        } else if (
            shortPercent >=
            TRIGGER_MIN_PERCENT
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
            total >=
            REQUIRED_HISTORY_SNAPSHOTS
    };
}


// ============================================================
// CALCULATE CURRENT TRIGGER
//
// Uses the already-calculated 15/20/30/60 results.
// ============================================================

function calculateCurrentTrigger(
    snapshot
) {

    if (!snapshot) {

        return {

            direction:
                "NEUTRAL",

            longPassedCount:
                0,

            shortPassedCount:
                0,

            longPassedDepths:
                [],

            shortPassedDepths:
                []
        };
    }


    const longPassedDepths = [];
    const shortPassedDepths = [];


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
        longPassedCount >=
            REQUIRED_PASSED_DEPTHS &&
        shortPassedCount <
            REQUIRED_PASSED_DEPTHS
    ) {

        direction =
            "LONG";

    } else if (
        shortPassedCount >=
            REQUIRED_PASSED_DEPTHS &&
        longPassedCount <
            REQUIRED_PASSED_DEPTHS
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
// IMPORTANT:
//
// This function is only considered a REAL final decision
// when the history cycle has reached:
//
//     REQUIRED_HISTORY_SNAPSHOTS
//
// Example:
//
//     10/10 → FINAL DECISION
//
// Otherwise:
//
//     1/10 → COLLECTING_HISTORY
//     2/10 → COLLECTING_HISTORY
//     ...
//
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


    // --------------------------------------------------------
    // NOT ENOUGH HISTORY
    // --------------------------------------------------------

    if (
        snapshots.length <
        REQUIRED_HISTORY_SNAPSHOTS
    ) {

        reason =
            "COLLECTING_HISTORY";


    // --------------------------------------------------------
    // CURRENT 200 NEUTRAL
    // --------------------------------------------------------

    } else if (
        current200 ===
        "NEUTRAL"
    ) {

        reason =
            "CURRENT_200_TREND_NEUTRAL";


    // --------------------------------------------------------
    // CURRENT TRIGGER NEUTRAL
    // --------------------------------------------------------

    } else if (
        currentTrigger ===
        "NEUTRAL"
    ) {

        reason =
            "CURRENT_TRIGGER_NEUTRAL";


    // --------------------------------------------------------
    // CURRENT TREND / TRIGGER DISAGREE
    // --------------------------------------------------------

    } else if (
        current200 !==
        currentTrigger
    ) {

        reason =
            "TREND_TRIGGER_DISAGREEMENT";


    // --------------------------------------------------------
    // 200 HISTORY DOES NOT CONFIRM CURRENT DIRECTION
    // --------------------------------------------------------

    } else if (
        trend200.direction !==
        current200
    ) {

        reason =
            "200_TREND_HISTORY_NOT_CONFIRMED";


    // --------------------------------------------------------
    // TRIGGER HISTORY DOES NOT CONFIRM CURRENT DIRECTION
    // --------------------------------------------------------

    } else if (
        triggerHistory.direction !==
        currentTrigger
    ) {

        reason =
            "TRIGGER_HISTORY_NOT_CONFIRMED";


    // --------------------------------------------------------
    // FINAL CONFIRMED DECISION
    // --------------------------------------------------------

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

            requiredSnapshots:
                REQUIRED_HISTORY_SNAPSHOTS,

            windowMinutes:
                AUTO_TRADING_HISTORY_MINUTES,

            cycleComplete:
                snapshots.length >=
                REQUIRED_HISTORY_SNAPSHOTS,

            minimumSnapshots:
                REQUIRED_HISTORY_SNAPSHOTS
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
                [
                    ...CONFIRMATION_DEPTHS
                ],

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
// Every call = ONE automatic scanner snapshot.
//
// PROCESS:
//
//     1. Create snapshot
//     2. Store snapshot
//     3. Show current history count
//     4. If history incomplete:
//
//            return COLLECTING_HISTORY
//
//     5. If history complete:
//
//            calculate FINAL DECISION
//
//     6. RESET HISTORY
//
//     7. Start fresh cycle
//
// IMPORTANT:
//
// The completed history is included in the returned decision
// even though the internal storage is reset immediately.
//
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


    // --------------------------------------------------------
    // ALWAYS COLLECT THIS SCAN
    // --------------------------------------------------------

    addSnapshot(
        normalizedSymbol,
        orderBookResult,
        now
    );


    // --------------------------------------------------------
    // LATEST SNAPSHOT
    // --------------------------------------------------------

    const latestSnapshot =
        history.snapshots[
            history.snapshots.length - 1
        ];


    // --------------------------------------------------------
    // CURRENT CONDITIONS
    //
    // Recalculate from the SAME fresh order book.
    // --------------------------------------------------------

    const currentSnapshot =
        createHistorySnapshot(
            orderBookResult,
            now
        );


    // --------------------------------------------------------
    // CHECK IF CYCLE IS COMPLETE
    // --------------------------------------------------------

    const cycleComplete =
        history.snapshots.length >=
        REQUIRED_HISTORY_SNAPSHOTS;


    // --------------------------------------------------------
    // HISTORY STILL COLLECTING
    // --------------------------------------------------------

    if (!cycleComplete) {

        return {

            symbol:
                normalizedSymbol,

            decision:
                "NEUTRAL",

            reason:
                "COLLECTING_HISTORY",


            history: {

                snapshots:
                    history.snapshots.length,

                requiredSnapshots:
                    REQUIRED_HISTORY_SNAPSHOTS,

                windowMinutes:
                    AUTO_TRADING_HISTORY_MINUTES,

                cycleComplete:
                    false,

                minimumSnapshots:
                    REQUIRED_HISTORY_SNAPSHOTS
            },


            trend200:
                calculateTrend200(
                    history.snapshots
                ),


            triggerHistory:
                calculateTriggerHistory(
                    history.snapshots
                ),


            current: {

                trend200:
                    normalizeDirection(
                        currentSnapshot.trend200
                    ),

                trigger:
                    normalizeDirection(
                        currentSnapshot.triggerDirection
                    )
            },


            thresholds: {

                trendMinPercent:
                    TREND_MIN_PERCENT,

                triggerMinPercent:
                    TRIGGER_MIN_PERCENT
            },


            confirmation: {

                depths:
                    [
                        ...CONFIRMATION_DEPTHS
                    ],

                required:
                    REQUIRED_PASSED_DEPTHS,

                rule:
                    `${REQUIRED_PASSED_DEPTHS}_OF_${CONFIRMATION_DEPTHS.length}`
            },


            collected:
                true,

            cycleComplete:
                false,

            latestSnapshot:
                latestSnapshot || null
        };
    }


    // ========================================================
    // HISTORY COMPLETE
    //
    // THIS IS THE FINAL DECISION POINT.
    // ========================================================

    console.log("");
    console.log(
        "============================================================"
    );
    console.log(
        `ORDER FLOW HISTORY COMPLETE: ${normalizedSymbol}`
    );
    console.log(
        `HISTORY CYCLE: ${REQUIRED_HISTORY_SNAPSHOTS}/${REQUIRED_HISTORY_SNAPSHOTS}`
    );
    console.log(
        "CALCULATING FINAL DECISION..."
    );
    console.log(
        "============================================================"
    );


    // --------------------------------------------------------
    // CALCULATE FINAL DECISION BEFORE RESET
    // --------------------------------------------------------

    const decision =
        calculateFinalDecision(
            normalizedSymbol,
            currentSnapshot
        );


    // --------------------------------------------------------
    // SAVE COMPLETED HISTORY COUNT
    // --------------------------------------------------------

    const completedSnapshots =
        history.snapshots.length;


    // --------------------------------------------------------
    // RESET HISTORY
    //
    // IMPORTANT:
    //
    // The completed decision above is returned to the caller.
    //
    // Internal history is now completely empty.
    //
    // Next scanner call starts:
    //
    //     1/10
    //
    // or:
    //
    //     1/60
    //
    // depending on config.
    // --------------------------------------------------------

    history.snapshots = [];


    history.lastCollectedAt =
        now;


    console.log(
        `ORDER FLOW HISTORY RESET: ${normalizedSymbol}`
    );

    console.log(
        `COMPLETED SNAPSHOTS: ${completedSnapshots}`
    );

    console.log(
        `NEXT CYCLE: 0/${REQUIRED_HISTORY_SNAPSHOTS}`
    );


    // --------------------------------------------------------
    // RETURN COMPLETED DECISION
    // --------------------------------------------------------

    return {

        ...decision,


        history: {

            ...decision.history,

            snapshots:
                completedSnapshots,

            requiredSnapshots:
                REQUIRED_HISTORY_SNAPSHOTS,

            windowMinutes:
                AUTO_TRADING_HISTORY_MINUTES,

            cycleComplete:
                true,

            reset:
                true
        },


        collected:
            true,

        cycleComplete:
            true,

        historyReset:
            true,

        latestSnapshot:
            latestSnapshot || null
    };
}


// ============================================================
// GET HISTORY
//
// Returns CURRENT unfinished cycle.
//
// After a completed decision:
//
//     snapshots = 0
//
// ============================================================

function getHistory(symbol) {

    const normalizedSymbol =
        normalizeSymbol(symbol);


    const history =
        getSymbolHistory(
            normalizedSymbol
        );


    cleanupHistory(
        normalizedSymbol
    );


    return {

        symbol:
            normalizedSymbol,

        snapshots:
            [
                ...history.snapshots
            ],

        count:
            history.snapshots.length,

        requiredSnapshots:
            REQUIRED_HISTORY_SNAPSHOTS,

        cycleComplete:
            history.snapshots.length >=
            REQUIRED_HISTORY_SNAPSHOTS,

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

            requiredSnapshots:
                REQUIRED_HISTORY_SNAPSHOTS,

            cycleComplete:
                history.snapshots.length >=
                REQUIRED_HISTORY_SNAPSHOTS,

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

    REQUIRED_HISTORY_SNAPSHOTS,

    AUTO_TRADING_HISTORY_MINUTES,

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

