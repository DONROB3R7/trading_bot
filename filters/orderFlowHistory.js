// ============================================================
// ORDER FLOW HISTORY
// TradingView → WEEX Bot V3
//
// LOGIC:
//
//     FULL 200-LEVEL TREND
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
// 200 LEVEL = TREND
//
// 15 / 20 / 30 / 60 = TRIGGER
//
// The 200 trend is calculated independently from the
// confirmation depths.
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
// 200 trend history:
//
//     70% LONG
//     OR
//     70% SHORT
//
// Trigger history:
//
//     60% LONG
//     OR
//     60% SHORT
// ============================================================

const TREND_MIN_PERCENT = 40;
const TRIGGER_MIN_PERCENT = 40;

// ============================================================
// CONFIRMATION DEPTHS
// ============================================================

const CONFIRMATION_DEPTHS = [
    15,
    20,
    30,
    60
];

const REQUIRED_PASSED_DEPTHS = 3;

// ============================================================
// HISTORY STORAGE
//
// symbol -> {
//
//     snapshots: [],
//     lastCollectedAt: timestamp
//
// }
//
// FIXED CYCLE.
// NOT ROLLING.
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
// CALCULATE TRUE 200-LEVEL TREND
//
// IMPORTANT:
//
// This uses ALL levels contained in the snapshot.
//
// It does NOT use:
//     15
//     20
//     30
//     60
//
// Those are separate trigger levels.
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

function calculateCurrentTrend200(snapshot) {
    if (
        !snapshot ||
        !Array.isArray(snapshot.bids) ||
        !Array.isArray(snapshot.asks)
    ) {
        console.log(
            "[200 TREND] INVALID SNAPSHOT"
        );

        return {
            direction: "NEUTRAL",
            available: false,
            reason:
                "INVALID_ORDER_BOOK_SNAPSHOT"
        };
    }

    // ========================================================
    // IMPORTANT:
    //
    // Use the COMPLETE snapshot.
    //
    // No slice.
    // No 15/20/30/60.
    // ========================================================

    const bids = snapshot.bids;
    const asks = snapshot.asks;

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
    //
    // This lets us see EXACTLY what the history engine
    // receives for the 200-level calculation.
    // ========================================================

    console.log(
        `[200 TREND] ` +
        `levels=${bids.length}/${asks.length} | ` +
        `imbalance=${imbalance.toFixed(4)} | ` +
        `bidAsk=${bidAskRatio.toFixed(4)} | ` +
        `askBid=${askBidRatio.toFixed(4)}`
    );

    // ========================================================
    // TREND DECISION
    // ========================================================

    let direction = "NEUTRAL";

    if (
        imbalance >= longThreshold &&
        bidAskRatio >= minBidAskRatio
    ) {
        direction = "LONG";
    } else if (
        imbalance <= shortThreshold &&
        askBidRatio >= minAskBidRatio
    ) {
        direction = "SHORT";
    }

    // ========================================================
    // FINAL DEBUG
    // ========================================================

    console.log(
        `[200 TREND] RESULT=${direction}`
    );

    return {
        direction,
        available: true,

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
// CREATE HISTORY SNAPSHOT
//
// One automatic order-book result becomes ONE history
// snapshot.
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

    // ========================================================
    // 200 TREND
    // ========================================================

    const trend200 =
        calculateCurrentTrend200(
            snapshot
        );

    // ========================================================
    // 15 / 20 / 30 / 60
    //
    // These are the TRIGGER.
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

    let triggerDirection = "NEUTRAL";

    if (
        longPassedCount >=
            REQUIRED_PASSED_DEPTHS &&
        shortPassedCount <
            REQUIRED_PASSED_DEPTHS
    ) {
        triggerDirection = "LONG";

    } else if (
        shortPassedCount >=
            REQUIRED_PASSED_DEPTHS &&
        longPassedCount <
            REQUIRED_PASSED_DEPTHS
    ) {
        triggerDirection = "SHORT";
    }

    // ========================================================
    // CURRENT COMBINED
    //
    // 200 TREND + TRIGGER MUST AGREE.
    // ========================================================

    let combinedDirection = "NEUTRAL";

    let combinedReason =
        "TREND_TRIGGER_NOT_CONFIRMED";

    if (
        trend200.direction === "LONG" &&
        triggerDirection === "LONG"
    ) {
        combinedDirection = "LONG";

        combinedReason =
            "200_TREND_AND_TRIGGER_AGREE_LONG";

    } else if (
        trend200.direction === "SHORT" &&
        triggerDirection === "SHORT"
    ) {
        combinedDirection = "SHORT";

        combinedReason =
            "200_TREND_AND_TRIGGER_AGREE_SHORT";

    } else if (
        trend200.direction === "NEUTRAL"
    ) {
        combinedReason =
            "200_TREND_NEUTRAL";

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
        timestamp: now,

        // ----------------------------------------------------
        // TRUE 200 TREND
        // ----------------------------------------------------

        trend200:
            trend200.direction,

        trend200Data:
            trend200,

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
// CALCULATE 200 TREND HISTORY
//
// Requires:
//
//     70% LONG
// OR
//     70% SHORT
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

    let direction = "NEUTRAL";

    if (
        total >=
        REQUIRED_HISTORY_SNAPSHOTS
    ) {
        if (
            longPercent >=
            TREND_MIN_PERCENT
        ) {
            direction = "LONG";

        } else if (
            shortPercent >=
            TREND_MIN_PERCENT
        ) {
            direction = "SHORT";
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
//
// Requires:
//
//     60% LONG
// OR
//     60% SHORT
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

    let direction = "NEUTRAL";

    if (
        total >=
        REQUIRED_HISTORY_SNAPSHOTS
    ) {
        if (
            longPercent >=
            TRIGGER_MIN_PERCENT
        ) {
            direction = "LONG";

        } else if (
            shortPercent >=
            TRIGGER_MIN_PERCENT
        ) {
            direction = "SHORT";
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
// 200 HISTORY + TRIGGER HISTORY
// MUST AGREE.
// ============================================================

function calculateCombinedHistory(
    trend200,
    triggerHistory
) {
    const trendDirection =
        normalizeDirection(
            trend200?.direction
        );

    const triggerDirection =
        normalizeDirection(
            triggerHistory?.direction
        );

    let direction = "NEUTRAL";

    let reason =
        "TREND_TRIGGER_HISTORY_DISAGREEMENT";

    if (
        trendDirection === "LONG" &&
        triggerDirection === "LONG"
    ) {
        direction = "LONG";

        reason =
            "200_HISTORY_AND_TRIGGER_HISTORY_AGREE_LONG";

    } else if (
        trendDirection === "SHORT" &&
        triggerDirection === "SHORT"
    ) {
        direction = "SHORT";

        reason =
            "200_HISTORY_AND_TRIGGER_HISTORY_AGREE_SHORT";

    } else if (
        trendDirection === "NEUTRAL"
    ) {
        reason =
            "200_TREND_HISTORY_NEUTRAL";

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

    let direction = "NEUTRAL";

    if (
        longPassedCount >=
            REQUIRED_PASSED_DEPTHS &&
        shortPassedCount <
            REQUIRED_PASSED_DEPTHS
    ) {
        direction = "LONG";

    } else if (
        shortPassedCount >=
            REQUIRED_PASSED_DEPTHS &&
        longPassedCount <
            REQUIRED_PASSED_DEPTHS
    ) {
        direction = "SHORT";
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
// 2. Current 200 not neutral
// 3. Current trigger not neutral
// 4. Current 200 == current trigger
// 5. Current combined not neutral
// 6. 200 history agrees with current 200
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

    // ========================================================
    // HISTORY
    // ========================================================

    const trend200 =
        calculateTrend200(
            snapshots
        );

    const triggerHistory =
        calculateTriggerHistory(
            snapshots
        );

    const combinedHistory =
        calculateCombinedHistory(
            trend200,
            triggerHistory
        );

    // ========================================================
    // CURRENT
    // ========================================================

    const current200 =
        normalizeDirection(
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

    let decision = "NEUTRAL";

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
    // 2. CURRENT 200 NEUTRAL
    // ========================================================

    } else if (
        current200 === "NEUTRAL"
    ) {
        reason =
            "CURRENT_200_TREND_NEUTRAL";

    // ========================================================
    // 3. CURRENT TRIGGER NEUTRAL
    // ========================================================

    } else if (
        currentTrigger === "NEUTRAL"
    ) {
        reason =
            "CURRENT_TRIGGER_NEUTRAL";

    // ========================================================
    // 4. CURRENT 200 + TRIGGER DISAGREE
    // ========================================================

    } else if (
        current200 !== currentTrigger
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
    // 6. 200 HISTORY
    // ========================================================

    } else if (
        trend200.direction !== current200
    ) {
        reason =
            "200_TREND_HISTORY_NOT_CONFIRMED";

    // ========================================================
    // 7. TRIGGER HISTORY
    // ========================================================

    } else if (
        triggerHistory.direction !== currentTrigger
    ) {
        reason =
            "TRIGGER_HISTORY_NOT_CONFIRMED";

    // ========================================================
    // 8. COMBINED HISTORY
    // ========================================================

    } else if (
        combinedHistory.direction !== currentCombined
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
                REQUIRED_HISTORY_SNAPSHOTS
        },

        // ====================================================
        // 200 HISTORY
        // ====================================================

        trend200,

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
            trend200:
                current200,

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

    // ========================================================
    // ADD EXACTLY ONE SNAPSHOT
    // ========================================================

    addSnapshot(
        normalizedSymbol,
        orderBookResult,
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
        const trend200 =
            calculateTrend200(
                history.snapshots
            );

        const triggerHistory =
            calculateTriggerHistory(
                history.snapshots
            );

        const combinedHistory =
            calculateCombinedHistory(
                trend200,
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
                    REQUIRED_HISTORY_SNAPSHOTS
            },

            trend200,

            triggerHistory,

            combinedHistory,

            current: {
                trend200:
                    currentSnapshot.trend200,

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
        `200 HISTORY: ${decision.trend200.longPercent}% LONG / ${decision.trend200.shortPercent}% SHORT / ${decision.trend200.neutralPercent}% NEUTRAL`
    );

    console.log(
        `TRIGGER HISTORY: ${decision.triggerHistory.longPercent}% LONG / ${decision.triggerHistory.shortPercent}% SHORT / ${decision.triggerHistory.neutralPercent}% NEUTRAL`
    );

    console.log(
        `COMBINED HISTORY: ${decision.combinedHistory.direction}`
    );

    console.log(
        `CURRENT 200: ${decision.current.trend200}`
    );

    console.log(
        `CURRENT TRIGGER: ${decision.current.trigger}`
    );

    console.log(
        `CURRENT COMBINED: ${decision.current.combined}`
    );

    console.log(
        `FINAL DECISION: ${decision.decision}`
    );

    console.log(
        `FINAL REASON: ${decision.reason}`
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
            history.lastCollectedAt
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

    calculateCombinedHistory,

    calculateCurrentTrigger,

    calculateFinalDecision,

    processOrderFlowHistory,

    getHistory,

    clearHistory,

    clearAllHistory,

    getHistoryStatus
};