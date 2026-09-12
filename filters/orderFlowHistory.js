// ============================================================
// ORDER FLOW HISTORY
// TradingView → WEEX Bot V3
//
// LOGIC:
//
//     USER SELECTED TREND DEPTH
//              +
//     15 / 20 / 30 / 60 TRIGGER
//              ↓
//        CURRENT SIGNAL
//              ↓
//        HISTORY CHECK
//              ↓
//        FINAL DECISION
//
// IMPORTANT:
//
// WEEX STILL REQUESTS 200 LEVELS.
//
// The 200-level snapshot is the RAW DATA source.
//
// The TREND depth is now configurable.
//
// Example:
//
//     WEEX REQUEST = 200
//     TREND DEPTH  = 60
//
// Then:
//
//     FIRST 60 LEVELS = TREND
//
//     15 / 20 / 30 / 60 = TRIGGER
//
// The trigger remains completely separate from the trend.
//
// HISTORY IS A FIXED CYCLE:
//
//     10 snapshots → decision → reset
//     20 snapshots → decision → reset
//     30 snapshots → decision → reset
//     60 snapshots → decision → reset
//
// AUTO_TRADING_HISTORY_MINUTES controls the cycle length.
//
// No rolling window.
// No second WEEX request.
// The same order-book snapshot is reused.
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
// CONFIG
// ============================================================

const HISTORY_INTERVAL_MS =
    AUTO_TRADING_INTERVAL_MS;

const REQUIRED_HISTORY_SNAPSHOTS =
    Math.max(
        1,
        Number(AUTO_TRADING_HISTORY_MINUTES) || 60
    );

// ============================================================
// HISTORY CONFIRMATION
//
// TREND HISTORY:
//
//     40% LONG
//     OR
//     40% SHORT
//
// TRIGGER HISTORY:
//
//     40% LONG
//     OR
//     40% SHORT
// ============================================================

const TREND_MIN_PERCENT = 40;
const TRIGGER_MIN_PERCENT = 40;

// ============================================================
// CONFIRMATION DEPTHS
//
// THESE DO NOT CHANGE.
//
// 15 / 20 / 30 / 60 = TRIGGER
//
// 3 OF 4 REQUIRED.
// ============================================================

const CONFIRMATION_DEPTHS = [
    15,
    20,
    30,
    60
];

const REQUIRED_PASSED_DEPTHS = 3;

// ============================================================
// MAX TREND DEPTH
//
// WEEX SNAPSHOT IS 200 LEVELS.
//
// Therefore the trend cannot use more than 200 levels.
//
// IMPORTANT:
//
// This does NOT mean the trend is always 200.
//
// It can be:
//
//     20
//     30
//     60
//     90
//     120
//     150
//     200
//
// etc.
//
// The frontend will eventually provide this value.
// ============================================================

const MAX_TREND_DEPTH = 200;

// ============================================================
// HISTORY STORAGE
//
// symbol -> {
//
//     snapshots: [],
//     lastCollectedAt: timestamp,
//     trendDepth: number
//
// }
//
// FIXED CYCLE.
// NOT ROLLING.
//
// IMPORTANT:
//
// History also remembers the trend depth.
//
// This prevents mixing:
//
//     old 200-depth history
//     with
//     new 60-depth history
//
// in the same cycle.
// ============================================================

const historyBySymbol = new Map();

// ============================================================
// BASIC HELPERS
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

    const value = String(direction)
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
        (
            (count / total) *
            100
        ).toFixed(2)
    );
}

// ============================================================
// NORMALIZE TREND DEPTH
//
// Valid:
//
//     1 → 200
//
// Invalid:
//
//     0
//     negative
//     decimal
//     NaN
//     > 200
//
// IMPORTANT:
//
// This function does NOT silently convert bad values.
//
// If no depth is supplied, the fallback is 200.
//
// That preserves the old behavior until the frontend
// START BOT flow supplies a real trend depth.
// ============================================================

function normalizeTrendDepth(
    trendDepth
) {
    // --------------------------------------------------------
    // No value supplied = old behavior
    // --------------------------------------------------------

    if (
        trendDepth === undefined ||
        trendDepth === null ||
        trendDepth === ""
    ) {
        return MAX_TREND_DEPTH;
    }

    const depth =
        Number(trendDepth);

    if (
        !Number.isFinite(depth) ||
        !Number.isInteger(depth) ||
        depth < 1 ||
        depth > MAX_TREND_DEPTH
    ) {
        throw new Error(
            `Invalid trend depth: ${trendDepth}. ` +
            `Trend depth must be an integer from 1 to ${MAX_TREND_DEPTH}.`
        );
    }

    return depth;
}

// ============================================================
// GET / CREATE HISTORY
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
                lastCollectedAt: 0,

                // ------------------------------------------------
                // Current trend depth for this history.
                //
                // Default 200 preserves old behavior.
                // ------------------------------------------------

                trendDepth:
                    MAX_TREND_DEPTH
            }
        );
    }

    return historyBySymbol.get(
        normalizedSymbol
    );
}

// ============================================================
// APPLY TREND DEPTH TO HISTORY
//
// If the selected trend depth changes while a symbol already
// has history, we MUST NOT mix the old and new trend.
//
// Example:
//
//     History:
//     60 depth
//
// User changes:
//
//     30 depth
//
// Result:
//
//     old history cleared
//     new cycle starts with 30
// ============================================================

function prepareHistoryTrendDepth(
    symbol,
    trendDepth
) {
    const normalizedSymbol =
        normalizeSymbol(symbol);

    const depth =
        normalizeTrendDepth(
            trendDepth
        );

    const history =
        getSymbolHistory(
            normalizedSymbol
        );

    const existingDepth =
        Number(
            history.trendDepth
        ) || MAX_TREND_DEPTH;

    if (
        existingDepth !== depth &&
        history.snapshots.length > 0
    ) {
        console.log(
            `[ORDER FLOW HISTORY] ` +
            `${normalizedSymbol}: ` +
            `TREND DEPTH CHANGED ` +
            `${existingDepth} → ${depth}`
        );

        console.log(
            `[ORDER FLOW HISTORY] ` +
            `${normalizedSymbol}: ` +
            `CLEARING OLD HISTORY`
        );

        history.snapshots = [];

        history.lastCollectedAt =
            0;
    }

    history.trendDepth =
        depth;

    return history;
}

// ============================================================
// CLEAN HISTORY
//
// Safety only.
//
// Does NOT remove history based on time.
// ============================================================

function cleanupHistory(symbol) {
    const history =
        getSymbolHistory(symbol);

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
// Automatic scanner calls this once per scan.
//
// Example:
//
//     1/10
//     2/10
//     ...
//     10/10
// ============================================================

function shouldCollectSnapshot() {
    return true;
}

// ============================================================
// CALCULATE CURRENT TREND
//
// IMPORTANT:
//
// WEEX gives us ONE 200-level snapshot.
//
// We DO NOT request another snapshot.
//
// We simply use the FIRST N levels from the existing snapshot.
//
// Example:
//
//     snapshot = 200 levels
//     trendDepth = 60
//
// Then:
//
//     bids.slice(0, 60)
//     asks.slice(0, 60)
//
// become the TREND.
//
// Trigger remains:
//
//     15 / 20 / 30 / 60
//
// ============================================================

function calculateCurrentTrend(
    snapshot,
    trendDepth = MAX_TREND_DEPTH
) {
    if (
        !snapshot ||
        !Array.isArray(snapshot.bids) ||
        !Array.isArray(snapshot.asks)
    ) {
        console.log(
            "[TREND] INVALID SNAPSHOT"
        );

        return {
            direction: "NEUTRAL",
            available: false,

            depth:
                normalizeTrendDepth(
                    trendDepth
                ),

            reason:
                "INVALID_ORDER_BOOK_SNAPSHOT"
        };
    }

    // ========================================================
    // NORMALIZE DEPTH
    // ========================================================

    const depth =
        normalizeTrendDepth(
            trendDepth
        );

    // ========================================================
    // USE FIRST N LEVELS
    //
    // SAME SNAPSHOT.
    // NO SECOND WEEX REQUEST.
    // ========================================================

    const bids =
        snapshot.bids.slice(
            0,
            depth
        );

    const asks =
        snapshot.asks.slice(
            0,
            depth
        );

    // ========================================================
    // SAFETY
    //
    // If the snapshot contains fewer levels than requested,
    // use what is actually available.
    //
    // Example:
    //
    // requested = 60
    // received  = 50
    //
    // We calculate using 50.
    // ========================================================

    if (
        bids.length === 0 ||
        asks.length === 0
    ) {
        console.log(
            `[TREND] EMPTY DATA | requested=${depth}`
        );

        return {
            direction: "NEUTRAL",
            available: false,

            depth,

            levels: {
                bids: bids.length,
                asks: asks.length
            },

            reason:
                "INSUFFICIENT_ORDER_BOOK_DATA"
        };
    }

    // ========================================================
    // CALCULATE PRESSURE
    // ========================================================

    const pressure =
        calculateOrderBookPressure({
            bids,
            asks
        });

    const imbalance =
        Number(
            pressure.imbalance
        );

    const bidAskRatio =
        Number(
            pressure.bidAskRatio
        );

    const askBidRatio =
        Number(
            pressure.askBidRatio
        );

    const longThreshold =
        Number(
            LONG_MIN_IMBALANCE
        );

    const shortThreshold =
        Number(
            SHORT_MAX_IMBALANCE
        );

    const minBidAskRatio =
        Number(
            MIN_BID_ASK_RATIO
        );

    const minAskBidRatio =
        Number(
            MIN_ASK_BID_RATIO
        );

    // ========================================================
    // DEBUG
    // ========================================================

    console.log(
        `[TREND] ` +
        `depth=${depth} | ` +
        `levels=${bids.length}/${asks.length} | ` +
        `imbalance=${imbalance.toFixed(4)} | ` +
        `bidAsk=${bidAskRatio.toFixed(4)} | ` +
        `askBid=${askBidRatio.toFixed(4)}`
    );

    // ========================================================
    // TREND DECISION
    // ========================================================

    let direction =
        "NEUTRAL";

    if (
        imbalance >= longThreshold &&
        bidAskRatio >= minBidAskRatio
    ) {
        direction =
            "LONG";

    } else if (
        imbalance <= shortThreshold &&
        askBidRatio >= minAskBidRatio
    ) {
        direction =
            "SHORT";
    }

    // ========================================================
    // FINAL DEBUG
    // ========================================================

    console.log(
        `[TREND] ` +
        `depth=${depth} ` +
        `RESULT=${direction}`
    );

    return {
        direction,

        available: true,

        // ----------------------------------------------------
        // IMPORTANT:
        //
        // This tells the dashboard/backend exactly which
        // trend depth produced this result.
        // ----------------------------------------------------

        depth,

        levels: {
            bids: bids.length,
            asks: asks.length
        },

        imbalance,

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

        bidAskRatio,
        askBidRatio,

        thresholds: {
            longImbalance:
                longThreshold,

            shortImbalance:
                shortThreshold,

            minBidAskRatio,
            minAskBidRatio
        }
    };
}

// ============================================================
// BACKWARD COMPATIBILITY
//
// OLD CODE MAY STILL CALL:
//
//     calculateCurrentTrend200(snapshot)
//
// That should continue to work.
//
// It now means:
//
//     calculate trend using 200 levels.
//
// Later, trading.js will use the new dynamic function.
// ============================================================

function calculateCurrentTrend200(
    snapshot
) {
    return calculateCurrentTrend(
        snapshot,
        MAX_TREND_DEPTH
    );
}

// ============================================================
// CREATE HISTORY SNAPSHOT
//
// One automatic order-book result becomes ONE history
// snapshot.
//
// trendDepth is optional.
//
// If omitted:
//
//     200
//
// If supplied:
//
//     60
// ============================================================

function createHistorySnapshot(
    orderBookResult,
    trendDepth = MAX_TREND_DEPTH,
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

    const selectedTrendDepth =
        normalizeTrendDepth(
            trendDepth
        );

    // ========================================================
    // DYNAMIC TREND
    // ========================================================

    const trend =
        calculateCurrentTrend(
            snapshot,
            selectedTrendDepth
        );

    // ========================================================
    // 15 / 20 / 30 / 60
    //
    // THESE ARE THE TRIGGER.
    // ========================================================

    const depthDirections = {};

    for (
        const depth of CONFIRMATION_DEPTHS
    ) {
        const longResult =
            analysis.long
                ?.results?.[depth];

        const shortResult =
            analysis.short
                ?.results?.[depth];

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

    // ========================================================
    // COUNT TRIGGER PASSES
    // ========================================================

    const longPassedCount =
        Number(
            analysis.long
                ?.passedDepths ?? 0
        );

    const shortPassedCount =
        Number(
            analysis.short
                ?.passedDepths ?? 0
        );

    // ========================================================
    // CURRENT TRIGGER
    //
    // 3 OF 4 REQUIRED.
    // ========================================================

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

    // ========================================================
    // CURRENT COMBINED
    //
    // TREND + TRIGGER MUST AGREE.
    // ========================================================

    let combinedDirection =
        "NEUTRAL";

    let combinedReason =
        "TREND_TRIGGER_NOT_CONFIRMED";

    if (
        trend.direction === "LONG" &&
        triggerDirection === "LONG"
    ) {
        combinedDirection =
            "LONG";

        combinedReason =
            "TREND_AND_TRIGGER_AGREE_LONG";

    } else if (
        trend.direction === "SHORT" &&
        triggerDirection === "SHORT"
    ) {
        combinedDirection =
            "SHORT";

        combinedReason =
            "TREND_AND_TRIGGER_AGREE_SHORT";

    } else if (
        trend.direction === "NEUTRAL"
    ) {
        combinedReason =
            "TREND_NEUTRAL";

    } else if (
        triggerDirection === "NEUTRAL"
    ) {
        combinedReason =
            "TRIGGER_NEUTRAL";

    } else {
        combinedReason =
            "TREND_TRIGGER_DISAGREEMENT";
    }

    // ========================================================
    // RETURN SNAPSHOT
    // ========================================================

    return {
        timestamp:
            now,

        // ----------------------------------------------------
        // NEW DYNAMIC TREND
        // ----------------------------------------------------

        trend:
            trend.direction,

        trendDepth:
            selectedTrendDepth,

        trendData:
            trend,

        // ----------------------------------------------------
        // OLD PROPERTY KEPT FOR COMPATIBILITY
        //
        // IMPORTANT:
        //
        // Existing trading.js still expects trend200.
        //
        // For now this alias points to the selected trend.
        //
        // We will clean this up in the NEXT STEP when we
        // modify trading.js.
        // ----------------------------------------------------

        trend200:
            trend.direction,

        trend200Data:
            trend,

        // ----------------------------------------------------
        // DEPTH TRIGGER
        // ----------------------------------------------------

        depth15:
            depthDirections.depth15,

        depth20:
            depthDirections.depth20,

        depth30:
            depthDirections.depth30,

        depth60:
            depthDirections.depth60,

        // ----------------------------------------------------
        // TRIGGER
        // ----------------------------------------------------

        triggerDirection,

        longPassedDepths:
            longPassedCount,

        shortPassedDepths:
            shortPassedCount,

        // ----------------------------------------------------
        // COMBINED
        // ----------------------------------------------------

        combinedDirection,

        combinedReason
    };
}

// ============================================================
// ADD SNAPSHOT
// ============================================================

function addSnapshot(
    symbol,
    orderBookResult,
    trendDepth = MAX_TREND_DEPTH,
    now = Date.now()
) {
    const normalizedSymbol =
        normalizeSymbol(symbol);

    const history =
        prepareHistoryTrendDepth(
            normalizedSymbol,
            trendDepth
        );

    const historySnapshot =
        createHistorySnapshot(
            orderBookResult,
            trendDepth,
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
// CALCULATE TREND HISTORY
//
// This replaces the old 200-specific history calculation.
//
// It reads:
//
//     snapshot.trend
//
// IMPORTANT:
//
// calculateTrend200() remains below as a compatibility
// wrapper.
// ============================================================

function calculateTrend(
    snapshots,
    trendDepth = MAX_TREND_DEPTH
) {
    if (
        !Array.isArray(snapshots) ||
        !snapshots.length
    ) {
        return {
            direction: "NEUTRAL",

            depth:
                normalizeTrendDepth(
                    trendDepth
                ),

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

    const depth =
        normalizeTrendDepth(
            trendDepth
        );

    let longCount = 0;
    let shortCount = 0;
    let neutralCount = 0;

    for (
        const snapshot of snapshots
    ) {
        // ----------------------------------------------------
        // New dynamic property.
        //
        // Fall back to trend200 for old snapshots.
        // ----------------------------------------------------

        const rawDirection =
            snapshot?.trend ??
            snapshot?.trend200;

        const direction =
            normalizeDirection(
                rawDirection
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

        depth,

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
// BACKWARD COMPATIBILITY
//
// Old trading.js currently calls:
//
//     calculateTrend200()
//
// Keep it working.
//
// It simply calculates the trend from the stored snapshots.
//
// The stored snapshots already contain the selected trend.
// ============================================================

function calculateTrend200(
    snapshots
) {
    let trendDepth =
        MAX_TREND_DEPTH;

    if (
        Array.isArray(snapshots) &&
        snapshots.length > 0
    ) {
        const first =
            snapshots[0];

        trendDepth =
            Number(
                first?.trendDepth ??
                first?.trendData?.depth ??
                first?.trend200Data?.depth ??
                MAX_TREND_DEPTH
            );

        if (
            !Number.isFinite(
                trendDepth
            )
        ) {
            trendDepth =
                MAX_TREND_DEPTH;
        }
    }

    return calculateTrend(
        snapshots,
        trendDepth
    );
}

// ============================================================
// CALCULATE TRIGGER HISTORY
//
// Requires:
//
//     40% LONG
// OR
//     40% SHORT
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
// CALCULATE COMBINED HISTORY
//
// TREND HISTORY + TRIGGER HISTORY
// MUST AGREE.
// ============================================================

function calculateCombinedHistory(
    trend,
    triggerHistory
) {
    const trendDirection =
        normalizeDirection(
            trend?.direction
        );

    const triggerDirection =
        normalizeDirection(
            triggerHistory?.direction
        );

    let direction =
        "NEUTRAL";

    let reason =
        "TREND_TRIGGER_HISTORY_DISAGREEMENT";

    if (
        trendDirection === "LONG" &&
        triggerDirection === "LONG"
    ) {
        direction =
            "LONG";

        reason =
            "TREND_HISTORY_AND_TRIGGER_HISTORY_AGREE_LONG";

    } else if (
        trendDirection === "SHORT" &&
        triggerDirection === "SHORT"
    ) {
        direction =
            "SHORT";

        reason =
            "TREND_HISTORY_AND_TRIGGER_HISTORY_AGREE_SHORT";

    } else if (
        trendDirection === "NEUTRAL"
    ) {
        reason =
            "TREND_HISTORY_NEUTRAL";

    } else if (
        triggerDirection === "NEUTRAL"
    ) {
        reason =
            "TRIGGER_HISTORY_NEUTRAL";

    } else {
        reason =
            "TREND_TRIGGER_HISTORY_DISAGREEMENT";
    }

    return {
        direction,
        reason,

        trendDirection,
        triggerDirection,

        agreed:
            direction !== "NEUTRAL"
    };
}

// ============================================================
// CALCULATE CURRENT TRIGGER
//
// Uses the already-calculated depth directions.
//
// 15 / 20 / 30 / 60
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
// CALCULATE FINAL DECISION
//
// ALL CONDITIONS MUST AGREE:
//
// 1. History complete
// 2. Current trend not neutral
// 3. Current trigger not neutral
// 4. Current trend == current trigger
// 5. Current combined not neutral
// 6. Trend history agrees with current trend
// 7. Trigger history agrees with current trigger
// 8. Combined history agrees with current combined
//
// THEN:
//
//     LONG / SHORT
//
// OTHERWISE:
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

    const snapshots =
        history.snapshots;

    const trendDepth =
        normalizeTrendDepth(
            history.trendDepth
        );

    // ========================================================
    // HISTORY
    // ========================================================

    const trend =
        calculateTrend(
            snapshots,
            trendDepth
        );

    const triggerHistory =
        calculateTriggerHistory(
            snapshots
        );

    const combinedHistory =
        calculateCombinedHistory(
            trend,
            triggerHistory
        );

    // ========================================================
    // CURRENT
    // ========================================================

    const currentTrend =
        normalizeDirection(
            currentSnapshot?.trend ??
            currentSnapshot?.trend200
        );

    const currentTrigger =
        normalizeDirection(
            currentSnapshot?.triggerDirection
        );

    const currentCombined =
        normalizeDirection(
            currentSnapshot?.combinedDirection
        );

    let decision =
        "NEUTRAL";

    let reason =
        "HISTORY_NOT_CONFIRMED";

    // ========================================================
    // 1. HISTORY INCOMPLETE
    // ========================================================

    if (
        snapshots.length <
        REQUIRED_HISTORY_SNAPSHOTS
    ) {
        reason =
            "COLLECTING_HISTORY";

    // ========================================================
    // 2. CURRENT TREND NEUTRAL
    // ========================================================

    } else if (
        currentTrend === "NEUTRAL"
    ) {
        reason =
            "CURRENT_TREND_NEUTRAL";

    // ========================================================
    // 3. CURRENT TRIGGER NEUTRAL
    // ========================================================

    } else if (
        currentTrigger === "NEUTRAL"
    ) {
        reason =
            "CURRENT_TRIGGER_NEUTRAL";

    // ========================================================
    // 4. CURRENT TREND + TRIGGER DISAGREE
    // ========================================================

    } else if (
        currentTrend !== currentTrigger
    ) {
        reason =
            "CURRENT_TREND_TRIGGER_DISAGREEMENT";

    // ========================================================
    // 5. CURRENT COMBINED INVALID
    // ========================================================

    } else if (
        currentCombined === "NEUTRAL"
    ) {
        reason =
            "CURRENT_COMBINED_NEUTRAL";

    // ========================================================
    // 6. TREND HISTORY
    // ========================================================

    } else if (
        trend.direction !== currentTrend
    ) {
        reason =
            "TREND_HISTORY_NOT_CONFIRMED";

    // ========================================================
    // 7. TRIGGER HISTORY
    // ========================================================

    } else if (
        triggerHistory.direction !==
        currentTrigger
    ) {
        reason =
            "TRIGGER_HISTORY_NOT_CONFIRMED";

    // ========================================================
    // 8. COMBINED HISTORY
    // ========================================================

    } else if (
        combinedHistory.direction !==
        currentCombined
    ) {
        reason =
            "COMBINED_HISTORY_NOT_CONFIRMED";

    // ========================================================
    // 9. FINAL CONFIRMED
    // ========================================================

    } else {
        decision =
            currentCombined;

        reason =
            decision === "LONG"
                ? "COMBINED_LONG_CONFIRMED"
                : "COMBINED_SHORT_CONFIRMED";
    }

    return {
        symbol:
            normalizedSymbol,

        decision,
        reason,

        // ====================================================
        // HISTORY
        // ====================================================

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
                REQUIRED_HISTORY_SNAPSHOTS,

            trendDepth
        },

        // ====================================================
        // NEW DYNAMIC TREND
        // ====================================================

        trend,

        // ====================================================
        // OLD PROPERTY KEPT FOR COMPATIBILITY
        // ====================================================

        trend200:
            trend,

        // ====================================================
        // TRIGGER HISTORY
        // ====================================================

        triggerHistory,

        // ====================================================
        // COMBINED HISTORY
        // ====================================================

        combinedHistory,

        // ====================================================
        // CURRENT
        // ====================================================

        current: {
            trend:
                currentTrend,

            // ------------------------------------------------
            // Compatibility
            // ------------------------------------------------

            trend200:
                currentTrend,

            trigger:
                currentTrigger,

            combined:
                currentCombined
        },

        // ====================================================
        // THRESHOLDS
        // ====================================================

        thresholds: {
            trendMinPercent:
                TREND_MIN_PERCENT,

            triggerMinPercent:
                TRIGGER_MIN_PERCENT,

            longMinImbalance:
                Number(
                    LONG_MIN_IMBALANCE
                ),

            shortMaxImbalance:
                Number(
                    SHORT_MAX_IMBALANCE
                ),

            minBidAskRatio:
                Number(
                    MIN_BID_ASK_RATIO
                ),

            minAskBidRatio:
                Number(
                    MIN_ASK_BID_RATIO
                )
        },

        // ====================================================
        // CONFIRMATION
        // ====================================================

        confirmation: {
            depths: [
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
// PROCESS ORDER-FLOW HISTORY
//
// EVERY CALL:
//
//     1. Take one snapshot
//     2. Store it
//     3. Check cycle
//
// INCOMPLETE:
//
//     return COLLECTING_HISTORY
//
// COMPLETE:
//
//     calculate final decision
//     reset history
//     return decision
//
// IMPORTANT:
//
// trendDepth is optional.
//
// Old:
//
//     processOrderFlowHistory(
//         symbol,
//         result
//     )
//
// New:
//
//     processOrderFlowHistory(
//         symbol,
//         result,
//         60
//     )
//
// ============================================================

function processOrderFlowHistory(
    symbol,
    orderBookResult,
    trendDepth = MAX_TREND_DEPTH,
    now = Date.now()
) {
    const normalizedSymbol =
        normalizeSymbol(symbol);

    const selectedTrendDepth =
        normalizeTrendDepth(
            trendDepth
        );

    const history =
        prepareHistoryTrendDepth(
            normalizedSymbol,
            selectedTrendDepth
        );

    // ========================================================
    // ADD EXACTLY ONE SNAPSHOT
    // ========================================================

    addSnapshot(
        normalizedSymbol,
        orderBookResult,
        selectedTrendDepth,
        now
    );

    // ========================================================
    // CURRENT SNAPSHOT
    //
    // Same order-book data.
    // NO second WEEX request.
    // ========================================================

    const currentSnapshot =
        createHistorySnapshot(
            orderBookResult,
            selectedTrendDepth,
            now
        );

    const latestSnapshot =
        history.snapshots[
            history.snapshots.length - 1
        ];

    // ========================================================
    // CHECK CYCLE
    // ========================================================

    const cycleComplete =
        history.snapshots.length >=
        REQUIRED_HISTORY_SNAPSHOTS;

    // ========================================================
    // STILL COLLECTING
    // ========================================================

    if (!cycleComplete) {
        const trend =
            calculateTrend(
                history.snapshots,
                selectedTrendDepth
            );

        const triggerHistory =
            calculateTriggerHistory(
                history.snapshots
            );

        const combinedHistory =
            calculateCombinedHistory(
                trend,
                triggerHistory
            );

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
                    REQUIRED_HISTORY_SNAPSHOTS,

                trendDepth:
                    selectedTrendDepth
            },

            // ==================================================
            // DYNAMIC TREND
            // ==================================================

            trend,

            // ==================================================
            // COMPATIBILITY
            // ==================================================

            trend200:
                trend,

            triggerHistory,

            combinedHistory,

            current: {
                trend:
                    currentSnapshot.trend,

                trend200:
                    currentSnapshot.trend,

                trigger:
                    currentSnapshot.triggerDirection,

                combined:
                    currentSnapshot.combinedDirection
            },

            thresholds: {
                trendMinPercent:
                    TREND_MIN_PERCENT,

                triggerMinPercent:
                    TRIGGER_MIN_PERCENT,

                longMinImbalance:
                    Number(
                        LONG_MIN_IMBALANCE
                    ),

                shortMaxImbalance:
                    Number(
                        SHORT_MAX_IMBALANCE
                    ),

                minBidAskRatio:
                    Number(
                        MIN_BID_ASK_RATIO
                    ),

                minAskBidRatio:
                    Number(
                        MIN_ASK_BID_RATIO
                    )
            },

            confirmation: {
                depths: [
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
    // CYCLE COMPLETE
    // ========================================================

    console.log("");

    console.log(
        "============================================================"
    );

    console.log(
        `ORDER FLOW HISTORY COMPLETE: ${normalizedSymbol}`
    );

    console.log(
        `TREND DEPTH: ${selectedTrendDepth}`
    );

    console.log(
        `TRIGGER DEPTHS: ${CONFIRMATION_DEPTHS.join(" / ")}`
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

    // ========================================================
    // FINAL DECISION
    //
    // MUST HAPPEN BEFORE RESET.
    // ========================================================

    const decision =
        calculateFinalDecision(
            normalizedSymbol,
            currentSnapshot
        );

    // ========================================================
    // FINAL LOG
    // ========================================================

    console.log(
        `TREND ${selectedTrendDepth} HISTORY: ` +
        `${decision.trend.longPercent}% LONG / ` +
        `${decision.trend.shortPercent}% SHORT / ` +
        `${decision.trend.neutralPercent}% NEUTRAL`
    );

    console.log(
        `TRIGGER HISTORY: ` +
        `${decision.triggerHistory.longPercent}% LONG / ` +
        `${decision.triggerHistory.shortPercent}% SHORT / ` +
        `${decision.triggerHistory.neutralPercent}% NEUTRAL`
    );

    console.log(
        `COMBINED HISTORY: ` +
        `${decision.combinedHistory.direction}`
    );

    console.log(
        `CURRENT TREND ${selectedTrendDepth}: ` +
        `${decision.current.trend}`
    );

    console.log(
        `CURRENT TRIGGER: ` +
        `${decision.current.trigger}`
    );

    console.log(
        `CURRENT COMBINED: ` +
        `${decision.current.combined}`
    );

    console.log(
        `FINAL DECISION: ` +
        `${decision.decision}`
    );

    console.log(
        `FINAL REASON: ` +
        `${decision.reason}`
    );

    // ========================================================
    // SAVE COMPLETED COUNT
    // ========================================================

    const completedSnapshots =
        history.snapshots.length;

    // ========================================================
    // RESET
    // ========================================================

    history.snapshots = [];

    history.lastCollectedAt =
        now;

    // Keep the selected depth for the next cycle.

    history.trendDepth =
        selectedTrendDepth;

    console.log(
        `ORDER FLOW HISTORY RESET: ${normalizedSymbol}`
    );

    console.log(
        `COMPLETED SNAPSHOTS: ${completedSnapshots}`
    );

    console.log(
        `NEXT CYCLE: 0/${REQUIRED_HISTORY_SNAPSHOTS}`
    );

    console.log(
        `NEXT TREND DEPTH: ${selectedTrendDepth}`
    );

    console.log(
        "============================================================"
    );

    // ========================================================
    // RETURN FINAL DECISION
    // ========================================================

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
                true,

            trendDepth:
                selectedTrendDepth
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
// GET CURRENT HISTORY
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

        snapshots: [
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
            history.lastCollectedAt,

        trendDepth:
            history.trendDepth
    };
}

// ============================================================
// CLEAR ONE HISTORY
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
                history.lastCollectedAt,

            trendDepth:
                history.trendDepth
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

    MAX_TREND_DEPTH,

    normalizeDirection,

    normalizeTrendDepth,

    calculateCurrentTrend,

    calculateCurrentTrend200,

    createHistorySnapshot,

    shouldCollectSnapshot,

    addSnapshot,

    calculateTrend,

    calculateTrend200,

    calculateTriggerHistory,

    calculateCombinedHistory,

    calculateCurrentTrigger,

    calculateFinalDecision,

    processOrderFlowHistory,

    getHistory,

    clearHistory,

    clearAllHistory,

    getHistoryStatus
};