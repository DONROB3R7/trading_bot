require("dotenv").config();

const express = require("express");
const path = require("path");

const {
    PORT,
    DEFAULT_MARGIN,
    DEFAULT_LEVERAGE,
    REQUIRED_MARGIN_MODE,
    ORDER_BOOK_DEPTH,
    LONG_MIN_IMBALANCE,
    SHORT_MAX_IMBALANCE,
    MIN_BID_ASK_RATIO,
    MIN_ASK_BID_RATIO,
    TRADING_ENABLED,
    AUTO_TRADING_ENABLED,
    AUTO_TRADING_INTERVAL_MS,
    API_KEY,
    API_SECRET,
    API_PASSPHRASE
} = require("./config/config");

const {
    SUPPORTED_SYMBOLS,
    CONTRACT_INFO,
    normalizeSymbol,
    loadAllContracts,
    getCurrentPosition,
    getFuturesBalance
} = require("./weex/weex");

const {
    processSignal,
    getStatusConfig
} = require("./trading/trading");

const {
    getMultiDepthSnapshot,
    evaluateMultiDepth,
    CONFIRMATION_DEPTHS,
    WEEX_REQUEST_DEPTH
} = require("./filters/orderBook");

const {
    section,
    pretty
} = require("./utils/logger");

const app = express();

app.use(express.json());

app.use(
    "/dashboard",
    express.static(
        path.join(
            __dirname,
            "dashboard"
        )
    )
);


// ============================================================
// SERVER STATE
// ============================================================

let automaticTraderRunning = false;

let automaticTraderTimer = null;

let automaticTraderLastRun = null;

let automaticTraderNextRun = null;


// ============================================================
// MANAGED SYMBOLS
// ============================================================
//
// IMPORTANT:
//
// managedSymbols is a PERSISTENT WATCH / MANAGEMENT LIST.
//
// It is NOT the same thing as "currently active WEEX
// positions".
//
// A symbol can be:
//
//     managed + LONG
//     managed + SHORT
//     managed + FLAT
//
// When a position closes, the symbol REMAINS managed.
//
// This allows the automatic trader to monitor the symbol and
// re-enter later when 3-of-4 order-flow confirmation appears.
//
// ============================================================

const managedSymbols =
    new Set();


// ============================================================
// ORDER FLOW STATISTICS
// ============================================================
//
// These statistics are maintained by the server.
//
// NOTE:
// The actual entry filter is performed inside trading.js /
// weex.js.
//
// These counters are therefore updated from server-level
// automatic decisions where possible.
//
// They are intentionally kept here so dashboard/status
// endpoints never crash when trading.js does not export the
// old statistics functions.
//
// ============================================================

const orderBookStats = {

    total: 0,

    accepted: 0,

    rejected: 0,

    acceptanceRate: 0,

    rejectionRate: 0,

    long: {

        checked: 0,

        accepted: 0,

        rejected: 0
    },

    short: {

        checked: 0,

        accepted: 0,

        rejected: 0
    },

    reasons: {},

    symbols: {}
};


function resetOrderBookStats() {

    orderBookStats.total = 0;

    orderBookStats.accepted = 0;

    orderBookStats.rejected = 0;

    orderBookStats.acceptanceRate = 0;

    orderBookStats.rejectionRate = 0;

    orderBookStats.long = {

        checked: 0,

        accepted: 0,

        rejected: 0
    };

    orderBookStats.short = {

        checked: 0,

        accepted: 0,

        rejected: 0
    };

    orderBookStats.reasons = {};

    orderBookStats.symbols = {};
}


function getOrderBookStats() {

    return {

        ...orderBookStats,

        long: {
            ...orderBookStats.long
        },

        short: {
            ...orderBookStats.short
        },

        reasons: {
            ...orderBookStats.reasons
        },

        symbols: {
            ...orderBookStats.symbols
        }
    };
}


// ============================================================
// THREE-OF-FOUR CONFIRMATION
// ============================================================
//
// ONE 200-level WEEX snapshot.
//
// Trading confirmation depths:
//
//     15
//     30
//     60
//     90
//
// Requirement:
//
//     AT LEAST 3 OF 4 MUST PASS.
//
// Each depth must pass BOTH:
//
//     - imbalance
//     - ratio
//
// ============================================================

function getThreeOfFourConfirmation(
    multiDepth
) {

const depths = [15, 20, 30, 60];

    const passedDepths =
        depths.filter(
            depth =>
                multiDepth?.results?.[depth]?.filterPass === true
        );

    const failedDepths =
        depths.filter(
            depth =>
                multiDepth?.results?.[depth]?.filterPass !== true
        );

    const passedCount =
        passedDepths.length;

    const confirmationRequired =
        3;

    const confirmationPassed =
        passedCount >= confirmationRequired;

    return {

        confirmationDepths:
            depths,

        confirmationRequired,

        passedDepths,

        failedDepths,

        passedCount,

        failedCount:
            failedDepths.length,

        totalDepths:
            depths.length,

        confirmationPassed,

        confirmationReason:
            confirmationPassed
                ? `THREE_OF_FOUR_CONFIRMED_${passedCount}_OF_4`
                : `THREE_OF_FOUR_FAILED_${passedCount}_OF_4`
    };
}


// ============================================================
// HELPERS
// ============================================================

function getPositionSide(
    position
) {

    if (!position) {
        return "FLAT";
    }


    const size =
        Number(
            position.size ??
            position.positionSize ??
            position.quantity ??
            position.qty ??
            position.total ??
            position.available ??
            0
        );


    // --------------------------------------------------------
    // ZERO SIZE = FLAT
    // --------------------------------------------------------

    if (
        Number.isFinite(size) &&
        Math.abs(size) === 0
    ) {

        return "FLAT";
    }


    // --------------------------------------------------------
    // EXPLICIT DIRECTION
    // --------------------------------------------------------

    const direct =
        String(
            position.direction ||
            position.side ||
            position.positionSide ||
            position.holdSide ||
            ""
        )
            .trim()
            .toUpperCase();


    if (
        direct === "LONG" ||
        direct === "BUY" ||
        direct.includes("LONG")
    ) {

        return "LONG";
    }


    if (
        direct === "SHORT" ||
        direct === "SELL" ||
        direct.includes("SHORT")
    ) {

        return "SHORT";
    }


    if (
        direct === "FLAT" ||
        direct === "NONE"
    ) {

        return "FLAT";
    }


    return "UNKNOWN";
}


function isSupported(
    symbol
) {

    return (
        !!symbol &&
        SUPPORTED_SYMBOLS.has(symbol)
    );
}


function addManagedSymbol(
    symbol
) {

    const normalized =
        normalizeSymbol(
            symbol
        );


    if (
        !isSupported(
            normalized
        )
    ) {

        return false;
    }


    const alreadyManaged =
        managedSymbols.has(
            normalized
        );


    managedSymbols.add(
        normalized
    );


    if (!alreadyManaged) {

        console.log(
            "MANAGED SYMBOL ADDED:",
            normalized
        );
    }


    return true;
}


function managedList() {

    return Array.from(
        managedSymbols
    ).sort();
}


// ============================================================
// DISCOVER LIVE WEEX POSITIONS
// ============================================================
//
// IMPORTANT:
//
// This function uses LIVE WEEX positions to determine which
// symbols currently have positions.
//
// BUT:
//
// It does NOT remove flat symbols from managedSymbols.
//
// Therefore:
//
//     active position -> add/keep
//     flat position   -> KEEP managed symbol
//     unknown         -> KEEP managed symbol
//     API error       -> KEEP managed symbol
//
// ============================================================

async function discoverLivePositions() {

    const symbols =
        Array.from(
            SUPPORTED_SYMBOLS
        ).sort();


    const activePositions =
        [];


    console.log("");

    console.log(
        "############################################################"
    );

    console.log(
        "DISCOVERING LIVE WEEX POSITIONS"
    );

    console.log(
        "############################################################"
    );

    console.log(
        "Total WEEX symbols available:",
        symbols.length
    );


    for (
        const symbol of symbols
    ) {

        try {

            const position =
                await getCurrentPosition(
                    symbol
                );


            const direction =
                getPositionSide(
                    position
                );


            // ------------------------------------------------
            // ACTIVE POSITION
            // ------------------------------------------------

            if (
                direction === "LONG" ||
                direction === "SHORT"
            ) {

                managedSymbols.add(
                    symbol
                );


                activePositions.push({

                    symbol,

                    direction,

                    quantity:
                        position.quantity ??
                        position.size ??
                        position.positionSize ??
                        0,

                    avgPrice:
                        position.avgPrice ??
                        0,

                    positionValue:
                        position.positionValue ??
                        0,

                    unrealizedPnL:
                        position.unrealizedPnL ??
                        0
                });


                console.log(
                    "ACTIVE WEEX POSITION:",
                    symbol,
                    direction
                );


                continue;
            }


            // ------------------------------------------------
            // FLAT
            // ------------------------------------------------
            //
            // DO NOT REMOVE FROM managedSymbols.
            //
            // The symbol remains under automatic monitoring.
            //
            // ------------------------------------------------

            if (
                direction === "FLAT"
            ) {

                if (
                    managedSymbols.has(
                        symbol
                    )
                ) {

                    console.log(
                        "WEEX POSITION CLOSED - KEEPING IN WATCH:",
                        symbol
                    );
                }

                continue;
            }


            // ------------------------------------------------
            // UNKNOWN
            // ------------------------------------------------

            console.log(
                "POSITION STATUS UNKNOWN - KEEPING MANAGED STATE:",
                symbol
            );

        } catch (error) {

            console.error(
                `POSITION DISCOVERY ERROR ${symbol}:`,
                error.message
            );
        }
    }


    console.log("");

    console.log(
        "LIVE WEEX POSITIONS FOUND:",
        activePositions.length
    );

    console.log(
        "MANAGED SYMBOLS:",
        managedSymbols.size
    );


    if (
        activePositions.length > 0
    ) {

        console.log("");

        for (
            const position of activePositions
        ) {

            console.log(
                `${position.symbol}: ${position.direction}`
            );
        }
    }


    console.log("");

    console.log(
        "CURRENT MANAGED SYMBOLS:"
    );

    console.log(
        managedList()
    );


    console.log(
        "############################################################"
    );


    return {

        totalSymbols:
            symbols.length,

        activePositions,

        activeCount:
            activePositions.length,

        managedSymbols:
            managedList()
    };
}


// ============================================================
// STARTUP
// ============================================================

console.log("");

section(
    "TRADINGVIEW -> WEEX SERVER V3"
);


console.log(
    "Trading:",
    TRADING_ENABLED
        ? "ENABLED - LIVE"
        : "DISABLED"
);


console.log(
    "Automatic trading:",
    AUTO_TRADING_ENABLED
        ? "ENABLED"
        : "DISABLED"
);


console.log(
    "Automatic interval:",
    `${AUTO_TRADING_INTERVAL_MS / 60000} minutes`
);


console.log(
    "API:",
    "WEEX V3 USDT-M FUTURES"
);


console.log(
    "Default margin:",
    DEFAULT_MARGIN,
    "USDT"
);


console.log(
    "Default leverage:",
    DEFAULT_LEVERAGE,
    "x"
);


console.log(
    "Target notional:",
    DEFAULT_MARGIN *
    DEFAULT_LEVERAGE,
    "USDT"
);


console.log(
    "Required margin mode:",
    REQUIRED_MARGIN_MODE
);


console.log(
    "WEEX API order-book request:",
    `${WEEX_REQUEST_DEPTH} levels`
);


console.log(
    "Trading confirmation depths:",
    CONFIRMATION_DEPTHS.join(" + ")
);


console.log(
    "Confirmation rule:",
    "3 OF 4 DEPTHS MUST PASS"
);


console.log(
    "LONG:",
    `imbalance >= ${LONG_MIN_IMBALANCE}`,
    `AND bid/ask >= ${MIN_BID_ASK_RATIO}`,
    "AT LEAST 3 OF 4 DEPTHS"
);


console.log(
    "SHORT:",
    `imbalance <= ${SHORT_MAX_IMBALANCE}`,
    `AND ask/bid >= ${MIN_ASK_BID_RATIO}`,
    "AT LEAST 3 OF 4 DEPTHS"
);


console.log(
    "CLOSE:",
    "NEVER FILTERED"
);


console.log(
    "Webhook:",
    "FAST ACK + BACKGROUND PROCESSING"
);


console.log(
    "Concurrency:",
    "PER-SYMBOL LOCKS"
);


console.log(
    "Automatic trader:",
    "LIVE WEEX POSITIONS -> 3 OF 4 ORDER BOOK -> HOLD / FLIP"
);


console.log(
    "============================================================"
);


if (
    !API_KEY ||
    !API_SECRET ||
    !API_PASSPHRASE
) {

    console.error(
        "WARNING: WEEX API credentials missing."
    );
}


// ============================================================
// MANAGED SYMBOLS
// ============================================================

app.get(
    "/managed-symbols",
    (req, res) => {

        const symbols =
            managedList();


        res.json({

            success:
                true,

            count:
                symbols.length,

            symbols
        });
    }
);


app.post(
    "/automatic-trader/select",
    (req, res) => {

        try {

            const requested =
                Array.isArray(
                    req.body?.symbols
                )
                    ? req.body.symbols
                    : [];


            const valid =
                [];

            const invalidSymbols =
                [];


            for (
                const raw of requested
            ) {

                const symbol =
                    normalizeSymbol(
                        raw
                    );


                if (
                    isSupported(
                        symbol
                    )
                ) {

                    valid.push(
                        symbol
                    );

                } else {

                    invalidSymbols.push(
                        raw
                    );
                }
            }


            managedSymbols.clear();


            for (
                const symbol of new Set(
                    valid
                )
            ) {

                managedSymbols.add(
                    symbol
                );
            }


            console.log(
                "AUTOMATIC TRADER SELECTION UPDATED:",
                managedList()
            );


            res.json({

                success:
                    true,

                count:
                    managedSymbols.size,

                symbols:
                    managedList(),

                invalidSymbols
            });

        } catch (error) {

            res.status(
                500
            ).json({

                success:
                    false,

                error:
                    error.message
            });
        }
    }
);


app.post(
    "/automatic-trader/clear",
    (req, res) => {

        const previous =
            managedList();


        managedSymbols.clear();


        res.json({

            success:
                true,

            message:
                "Managed symbols cleared. Existing WEEX positions were NOT closed.",

            count:
                0,

            symbols:
                [],

            previous
        });
    }
);


// ============================================================
// AUTOMATIC MANAGED POSITION TRADER
// ============================================================

async function runManagedTrader() {

    if (
        automaticTraderRunning
    ) {

        console.log(
            "AUTOMATIC TRADER: previous scan is still running. Skipping."
        );


        return {

            success:
                false,

            skipped:
                true,

            reason:
                "ALREADY_RUNNING"
        };
    }


    if (
        !AUTO_TRADING_ENABLED
    ) {

        return {

            success:
                false,

            skipped:
                true,

            reason:
                "AUTO_TRADING_DISABLED"
        };
    }


    if (
        !TRADING_ENABLED
    ) {

        return {

            success:
                false,

            skipped:
                true,

            reason:
                "TRADING_DISABLED"
        };
    }


    automaticTraderRunning =
        true;


    automaticTraderLastRun =
        new Date().toISOString();


    const results =
        [];


    let longActions =
        0;

    let shortActions =
        0;

    let stayed =
        0;

    let flatActions =
        0;

    let neutral =
        0;

    let errors =
        0;

    let discovery =
        null;


    try {

        discovery =
            await discoverLivePositions();


        const symbols =
            managedList();


        console.log("");

        section(
            "AUTOMATIC 3-OF-4 ORDER BOOK POSITION CHECK"
        );


        console.log(
            "Total WEEX symbols available:",
            discovery.totalSymbols
        );


        console.log(
            "Active WEEX positions:",
            discovery.activeCount
        );


        console.log(
            "Managed symbols:",
            symbols.length
        );


        console.log(
            "Confirmation depths:",
            CONFIRMATION_DEPTHS.join(" + ")
        );


        console.log(
            "Confirmation required:",
            "3 OF 4"
        );


        if (
            symbols.length === 0
        ) {

            console.log("");

            console.log(
                "NO MANAGED SYMBOLS FOUND."
            );


            return {

                success:
                    true,

                started:
                    automaticTraderLastRun,

                finished:
                    new Date().toISOString(),

                totalSymbolsAvailable:
                    discovery.totalSymbols,

                activePositions:
                    discovery.activeCount,

                managedSymbols:
                    0,

                longActions:
                    0,

                shortActions:
                    0,

                stayedPositions:
                    0,

                flatActions:
                    0,

                neutralSignals:
                    0,

                errors:
                    0,

                confirmationDepths:
                    [...CONFIRMATION_DEPTHS],

                confirmationRequired:
                    3,

                confirmationRule:
                    "3_OF_4",

                results:
                    []
            };
        }


        for (
            const symbol of symbols
        ) {

            try {

                const position =
                    await getCurrentPosition(
                        symbol
                    );


                const positionSide =
                    getPositionSide(
                        position
                    );


                // ====================================================
                // FLAT / WATCHING
                // ====================================================

                if (
                    positionSide !== "LONG" &&
                    positionSide !== "SHORT"
                ) {

                    flatActions++;


                    console.log("");

                    console.log(
                        "WATCH POSITION:",
                        symbol
                    );

                    console.log(
                        "Position:",
                        "FLAT"
                    );

                    console.log(
                        "Action:",
                        "CHECKING ORDER BOOK FOR RE-ENTRY"
                    );


                    // IMPORTANT:
                    // Symbol remains in managedSymbols.

                    const snapshot =
                        await getMultiDepthSnapshot(
                            symbol
                        );


                    const longDepth =
                        evaluateMultiDepth(
                            snapshot.bids,
                            snapshot.asks,
                            "LONG"
                        );


                    const shortDepth =
                        evaluateMultiDepth(
                            snapshot.bids,
                            snapshot.asks,
                            "SHORT"
                        );


                    const longConfirmation =
                        getThreeOfFourConfirmation(
                            longDepth
                        );


                    const shortConfirmation =
                        getThreeOfFourConfirmation(
                            shortDepth
                        );


                    const longAllowed =
                        longConfirmation.confirmationPassed;


                    const shortAllowed =
                        shortConfirmation.confirmationPassed;


                    let decision =
                        "NEUTRAL";


                    if (
                        longAllowed &&
                        !shortAllowed
                    ) {

                        decision =
                            "LONG";

                    } else if (
                        shortAllowed &&
                        !longAllowed
                    ) {

                        decision =
                            "SHORT";
                    }


                    console.log(
                        "WATCH DECISION:",
                        decision
                    );


                    console.log(
                        "LONG 15/30/60/90:",
                        longDepth.results[15]?.filterPass,
                        longDepth.results[30]?.filterPass,
                        longDepth.results[60]?.filterPass,
                        longDepth.results[90]?.filterPass,
                        `=> ${longConfirmation.passedCount}/4 PASS`
                    );


                    console.log(
                        "SHORT 15/30/60/90:",
                        shortDepth.results[15]?.filterPass,
                        shortDepth.results[30]?.filterPass,
                        shortDepth.results[60]?.filterPass,
                        shortDepth.results[90]?.filterPass,
                        `=> ${shortConfirmation.passedCount}/4 PASS`
                    );


                    // ------------------------------------------------
                    // NEUTRAL
                    // ------------------------------------------------

                    if (
                        decision === "NEUTRAL"
                    ) {

                        neutral++;


                        results.push({

                            symbol,

                            position:
                                "FLAT",

                            decision,

                            action:
                                "WATCH",

                            reason:
                                "POSITION_CLOSED_WAITING_FOR_3_OF_4_REENTRY",

                            longConfirmation,

                            shortConfirmation
                        });


                        continue;
                    }


                    // ------------------------------------------------
                    // VALID RE-ENTRY
                    // ------------------------------------------------

                    console.log("");

                    console.log(
                        "AUTOMATIC RE-ENTRY REQUIRED"
                    );

                    console.log(
                        "Symbol:",
                        symbol
                    );

                    console.log(
                        "Current:",
                        "FLAT"
                    );

                    console.log(
                        "New:",
                        decision
                    );


                    const result =
                        await processSignal(
                            symbol,
                            decision
                        );


                    if (
                        decision === "LONG"
                    ) {

                        longActions++;

                    } else {

                        shortActions++;
                    }


                    results.push({

                        symbol,

                        position:
                            "FLAT",

                        decision,

                        action:
                            `REOPEN_${decision}`,

                        longConfirmation,

                        shortConfirmation,

                        result
                    });


                    continue;
                }


                // ====================================================
                // ACTIVE POSITION
                // ====================================================

                const snapshot =
                    await getMultiDepthSnapshot(
                        symbol
                    );


                // ------------------------------------------------
                // LONG
                // ------------------------------------------------

                const longDepth =
                    evaluateMultiDepth(
                        snapshot.bids,
                        snapshot.asks,
                        "LONG"
                    );


                // ------------------------------------------------
                // SHORT
                // ------------------------------------------------

                const shortDepth =
                    evaluateMultiDepth(
                        snapshot.bids,
                        snapshot.asks,
                        "SHORT"
                    );


                // ------------------------------------------------
                // THREE-OF-FOUR CONFIRMATION
                // ------------------------------------------------

                const longConfirmation =
                    getThreeOfFourConfirmation(
                        longDepth
                    );


                const shortConfirmation =
                    getThreeOfFourConfirmation(
                        shortDepth
                    );


                const longAllowed =
                    longConfirmation.confirmationPassed;


                const shortAllowed =
                    shortConfirmation.confirmationPassed;


                let decision =
                    "NEUTRAL";


                if (
                    longAllowed &&
                    !shortAllowed
                ) {

                    decision =
                        "LONG";

                } else if (
                    shortAllowed &&
                    !longAllowed
                ) {

                    decision =
                        "SHORT";
                }


                console.log("");

                console.log(
                    "MANAGED POSITION CHECK:",
                    symbol
                );

                console.log(
                    "Position:",
                    positionSide
                );

                console.log(
                    "Decision:",
                    decision
                );


                console.log(
                    "LONG 15/30/60/90:",
                    longDepth.results[15]?.filterPass,
                    longDepth.results[30]?.filterPass,
                    longDepth.results[60]?.filterPass,
                    longDepth.results[90]?.filterPass,
                    `=> ${longConfirmation.passedCount}/4 PASS`
                );


                console.log(
                    "SHORT 15/30/60/90:",
                    shortDepth.results[15]?.filterPass,
                    shortDepth.results[30]?.filterPass,
                    shortDepth.results[60]?.filterPass,
                    shortDepth.results[90]?.filterPass,
                    `=> ${shortConfirmation.passedCount}/4 PASS`
                );


                // ------------------------------------------------
                // NEUTRAL
                // ------------------------------------------------

                if (
                    decision === "NEUTRAL"
                ) {

                    neutral++;


                    results.push({

                        symbol,

                        position:
                            positionSide,

                        decision,

                        action:
                            "NO_ACTION",

                        reason:
                            "THREE_OF_FOUR_ORDER_BOOK_NEUTRAL",

                        longConfirmation,

                        shortConfirmation
                    });


                    continue;
                }


                // ------------------------------------------------
                // SAME DIRECTION
                // ------------------------------------------------

                if (
                    positionSide === decision
                ) {

                    stayed++;


                    results.push({

                        symbol,

                        position:
                            positionSide,

                        decision,

                        action:
                            `STAY_${decision}`,

                        reason:
                            `THREE_OF_FOUR_ORDER_FLOW_SUPPORTS_EXISTING_${decision}`,

                        longConfirmation,

                        shortConfirmation
                    });


                    continue;
                }


                // ------------------------------------------------
                // OPPOSITE DIRECTION = REVERSAL
                // ------------------------------------------------

                if (
                    positionSide !== decision
                ) {

                    if (
                        decision === "LONG"
                    ) {

                        longActions++;

                    } else {

                        shortActions++;
                    }


                    console.log("");

                    console.log(
                        "AUTOMATIC 3-OF-4 REVERSAL REQUIRED"
                    );

                    console.log(
                        "Symbol:",
                        symbol
                    );

                    console.log(
                        "Current:",
                        positionSide
                    );

                    console.log(
                        "New:",
                        decision
                    );


                    const result =
                        await processSignal(
                            symbol,
                            decision
                        );


                    results.push({

                        symbol,

                        position:
                            positionSide,

                        decision,

                        action:
                            `FLIP_${decision}`,

                        longConfirmation,

                        shortConfirmation,

                        result
                    });


                    continue;
                }

            } catch (error) {

                errors++;


                console.error(
                    `${symbol}: AUTOMATIC POSITION CHECK ERROR`,
                    error.message
                );


                results.push({

                    symbol,

                    action:
                        "ERROR",

                    error:
                        error.message
                });
            }
        }


        const summary = {

            success:
                true,

            started:
                automaticTraderLastRun,

            finished:
                new Date().toISOString(),

            totalSymbolsAvailable:
                discovery.totalSymbols,

            activePositions:
                discovery.activeCount,

            managedSymbols:
                symbols.length,

            confirmationDepths:
                [...CONFIRMATION_DEPTHS],

            confirmationRequired:
                3,

            confirmationRule:
                "3_OF_4",

            longActions,

            shortActions,

            stayedPositions:
                stayed,

            flatActions,

            neutralSignals:
                neutral,

            errors,

            results
        };


        console.log("");

        console.log(
            "############################################################"
        );

        console.log(
            "AUTOMATIC 3-OF-4 POSITION CHECK COMPLETE"
        );

        console.log(
            "############################################################"
        );

        console.log(
            "Confirmation:",
            "3 OF 4"
        );

        console.log(
            "Depths:",
            CONFIRMATION_DEPTHS.join(" + ")
        );

        console.log(
            "Total WEEX symbols:",
            discovery.totalSymbols
        );

        console.log(
            "Active positions:",
            discovery.activeCount
        );

        console.log(
            "Managed symbols:",
            symbols.length
        );

        console.log(
            "LONG actions:",
            longActions
        );

        console.log(
            "SHORT actions:",
            shortActions
        );

        console.log(
            "Stayed:",
            stayed
        );

        console.log(
            "Neutral:",
            neutral
        );

        console.log(
            "Errors:",
            errors
        );

        console.log(
            "############################################################"
        );


        return summary;

    } finally {

        automaticTraderRunning =
            false;


        automaticTraderNextRun =
            new Date(
                Date.now() +
                AUTO_TRADING_INTERVAL_MS
            ).toISOString();
    }
}


// ============================================================
// START AUTOMATIC TRADER
// ============================================================

function startAutomaticTrader() {

    if (
        !AUTO_TRADING_ENABLED ||
        !TRADING_ENABLED
    ) {

        console.log(
            "AUTOMATIC TRADER NOT STARTED"
        );


        return;
    }


    if (
        automaticTraderTimer
    ) {

        clearInterval(
            automaticTraderTimer
        );
    }


    automaticTraderNextRun =
        new Date(
            Date.now() +
            AUTO_TRADING_INTERVAL_MS
        ).toISOString();


    automaticTraderTimer =
        setInterval(
            () => {

                runManagedTrader()
                    .catch(
                        error => {

                            console.error(
                                "AUTOMATIC TRADER FATAL ERROR:",
                                error.message
                            );
                        }
                    );

            },
            AUTO_TRADING_INTERVAL_MS
        );


    console.log(
        "AUTOMATIC TRADER STARTED:",
        `${AUTO_TRADING_INTERVAL_MS / 60000} minutes`
    );
}


// ============================================================
// TRADINGVIEW WEBHOOK
// ============================================================

app.post(
    "/webhook",
    (req, res) => {

        section(
            "TRADINGVIEW WEBHOOK RECEIVED"
        );


        console.log(
            pretty(
                req.body
            )
        );


        try {

            const symbol =
                normalizeSymbol(
                    req.body?.symbol
                );


            const action =
                String(
                    req.body?.action ||
                    ""
                )
                    .trim()
                    .toUpperCase();


            const validActions = [
                "LONG",
                "SHORT",
                "CLOSE",
                "CLOSE_LONG",
                "CLOSE_SHORT"
            ];


            console.log(
                "Original symbol:",
                req.body?.symbol
            );

            console.log(
                "Normalized symbol:",
                symbol
            );

            console.log(
                "Action:",
                action
            );


            if (
                !isSupported(
                    symbol
                )
            ) {

                return res.status(
                    400
                ).json({

                    success:
                        false,

                    error:
                        "Unsupported or unavailable WEEX symbol",

                    symbol
                });
            }


            if (
                !validActions.includes(
                    action
                )
            ) {

                return res.status(
                    400
                ).json({

                    success:
                        false,

                    error:
                        "Invalid action"
                });
            }


            // ------------------------------------------------
            // IMMEDIATE ACK
            // ------------------------------------------------

            res.status(
                200
            ).json({

                success:
                    true,

                accepted:
                    true,

                symbol,

                action,

                message:
                    "Signal accepted for background processing."
            });


            console.log(
                `WEBHOOK ACK SENT: ${symbol} ${action}`
            );


            // ------------------------------------------------
            // BACKGROUND PROCESSING
            // ------------------------------------------------

            processSignal(
                symbol,
                action
            )
                .then(
                    result => {

                        // ------------------------------------------------
                        // LONG / SHORT
                        // ------------------------------------------------
                        //
                        // Successful entry signals make the symbol
                        // managed.
                        //
                        // ------------------------------------------------

                        if (
                            action === "LONG" ||
                            action === "SHORT"
                        ) {

                            if (
                                result?.success !== false ||
                                result?.action === "NO_ACTION"
                            ) {

                                addManagedSymbol(
                                    symbol
                                );
                            }
                        }


                        // ------------------------------------------------
                        // CLOSE
                        // ------------------------------------------------
                        //
                        // IMPORTANT:
                        //
                        // DO NOT REMOVE managed symbol.
                        //
                        // The symbol stays watched for future
                        // automatic re-entry.
                        //
                        // ------------------------------------------------

                        if (
                            action === "CLOSE" ||
                            action === "CLOSE_LONG" ||
                            action === "CLOSE_SHORT"
                        ) {

                            if (
                                managedSymbols.has(
                                    symbol
                                )
                            ) {

                                console.log(
                                    "CLOSE COMPLETE - SYMBOL REMAINS MANAGED:",
                                    symbol
                                );
                            }
                        }


                        console.log("");

                        console.log(
                            "============================================================"
                        );

                        console.log(
                            "BACKGROUND SIGNAL COMPLETE"
                        );

                        console.log(
                            "Symbol:",
                            symbol
                        );

                        console.log(
                            "Action:",
                            action
                        );

                        console.log(
                            pretty(
                                result
                            )
                        );

                        console.log(
                            "ORDER FLOW STATISTICS:"
                        );

                        console.log(
                            pretty(
                                getOrderBookStats()
                            )
                        );

                        console.log(
                            "============================================================"
                        );
                    }
                )
                .catch(
                    error => {

                        console.error("");

                        console.error(
                            "============================================================"
                        );

                        console.error(
                            "BACKGROUND SIGNAL ERROR"
                        );

                        console.error(
                            "Symbol:",
                            symbol
                        );

                        console.error(
                            "Action:",
                            action
                        );

                        console.error(
                            "Error:",
                            error.message
                        );


                        if (
                            error.data
                        ) {

                            console.error(
                                pretty(
                                    error.data
                                )
                            );
                        }


                        console.error(
                            "============================================================"
                        );
                    }
                );

        } catch (error) {

            console.error(
                "WEBHOOK VALIDATION ERROR:",
                error.message
            );


            if (
                !res.headersSent
            ) {

                return res.status(
                    500
                ).json({

                    success:
                        false,

                    error:
                        error.message
                });
            }
        }
    }
);


// ============================================================
// MANUAL SIGNALS
// ============================================================

async function handleManualSignal(
    req,
    res,
    action
) {

    try {

        const symbol =
            normalizeSymbol(
                req.query?.symbol ||
                req.body?.symbol
            );


        if (
            !isSupported(
                symbol
            )
        ) {

            return res.status(
                400
            ).json({

                success:
                    false,

                error:
                    "Invalid or unavailable WEEX symbol",

                symbol
            });
        }


        console.log(
            "MANUAL SIGNAL:",
            symbol,
            action
        );


        const result =
            await processSignal(
                symbol,
                action
            );


        // ------------------------------------------------
        // LONG / SHORT
        // ------------------------------------------------

        if (
            (
                action === "LONG" ||
                action === "SHORT"
            ) &&
            result?.success !== false
        ) {

            addManagedSymbol(
                symbol
            );
        }


        // ------------------------------------------------
        // CLOSE
        // ------------------------------------------------
        //
        // DO NOT remove managed symbol.
        //
        // ------------------------------------------------

        if (
            action === "CLOSE" ||
            action === "CLOSE_LONG" ||
            action === "CLOSE_SHORT"
        ) {

            console.log(
                "MANUAL CLOSE - SYMBOL REMAINS MANAGED:",
                symbol
            );
        }


        res.json({

            ...result,

            managed:
                managedSymbols.has(
                    symbol
                ),

            managedSymbols:
                managedList()
        });

    } catch (error) {

        console.error(
            `MANUAL ${action} ERROR:`,
            error.message
        );


        if (
            error.data
        ) {

            console.error(
                pretty(
                    error.data
                )
            );
        }


        res.status(
            500
        ).json({

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


app.post(
    "/manual-long",
    (req, res) =>
        handleManualSignal(
            req,
            res,
            "LONG"
        )
);


app.post(
    "/manual-short",
    (req, res) =>
        handleManualSignal(
            req,
            res,
            "SHORT"
        )
);


app.post(
    "/manual-close",
    (req, res) =>
        handleManualSignal(
            req,
            res,
            "CLOSE"
        )
);


// ============================================================
// READ-ONLY MULTI-DEPTH ORDER BOOK TEST
// ============================================================

app.get(
    "/test-orderbook",
    async (
        req,
        res
    ) => {

        try {

            const symbol =
                normalizeSymbol(
                    req.query?.symbol
                );


            const direction =
                String(
                    req.query?.direction ||
                    ""
                )
                    .trim()
                    .toUpperCase();


            if (
                !isSupported(
                    symbol
                )
            ) {

                return res.status(
                    400
                ).json({

                    success:
                        false,

                    error:
                        "Invalid or unavailable WEEX symbol",

                    symbol
                });
            }


            if (
                direction !== "LONG" &&
                direction !== "SHORT"
            ) {

                return res.status(
                    400
                ).json({

                    success:
                        false,

                    error:
                        "direction must be LONG or SHORT",

                    direction
                });
            }


            section(
                "READ-ONLY 3-OF-4 ORDER BOOK TEST",
                "#"
            );


            console.log(
                "Symbol:",
                symbol
            );

            console.log(
                "Direction:",
                direction
            );

            console.log(
                "WEEX request:",
                WEEX_REQUEST_DEPTH
            );

            console.log(
                "Confirmation:",
                CONFIRMATION_DEPTHS.join(" + ")
            );

            console.log(
                "Rule:",
                "3 OF 4"
            );

            console.log(
                "TRADING:",
                "NOT USED"
            );

            console.log(
                "ORDER:",
                "NEVER PLACED"
            );


            const snapshot =
                await getMultiDepthSnapshot(
                    symbol
                );


            const multiDepth =
                evaluateMultiDepth(
                    snapshot.bids,
                    snapshot.asks,
                    direction
                );


            const confirmation =
                getThreeOfFourConfirmation(
                    multiDepth
                );


            return res.json({

                success:
                    true,

                test:
                    true,

                readOnly:
                    true,

                orderPlaced:
                    false,

                countedInStatistics:
                    false,

                symbol,

                direction,

                requestedDepth:
                    WEEX_REQUEST_DEPTH,

                confirmationDepths:
                    [...CONFIRMATION_DEPTHS],

                confirmationRequired:
                    3,

                confirmationRule:
                    "3_OF_4",

                confirmationPassed:
                    confirmation.confirmationPassed,

                passedDepths:
                    confirmation.passedDepths,

                failedDepths:
                    confirmation.failedDepths,

                passedCount:
                    confirmation.passedCount,

                failedCount:
                    confirmation.failedCount,

                confirmationReason:
                    confirmation.confirmationReason,

                results:
                    multiDepth.results
            });

        } catch (error) {

            console.error(
                "ORDER BOOK TEST ERROR:",
                error.message
            );


            if (
                error.data
            ) {

                console.error(
                    pretty(
                        error.data
                    )
                );
            }


            return res.status(
                500
            ).json({

                success:
                    false,

                readOnly:
                    true,

                orderPlaced:
                    false,

                countedInStatistics:
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
// ORDER FLOW STATISTICS
// ============================================================

app.get(
    "/orderflow-stats",
    (
        req,
        res
    ) => {

        res.json({

            success:
                true,

            statistics:
                getOrderBookStats()
        });
    }
);


app.post(
    "/orderflow-stats/reset",
    (
        req,
        res
    ) => {

        resetOrderBookStats();


        res.json({

            success:
                true,

            message:
                "Order-flow statistics reset.",

            statistics:
                getOrderBookStats()
        });
    }
);


// ============================================================
// SYMBOLS
// ============================================================

app.get(
    "/symbols",
    (
        req,
        res
    ) => {

        const symbols =
            Array.from(
                SUPPORTED_SYMBOLS
            )
                .sort()
                .map(
                    symbol => ({

                        symbol,

                        margin:
                            DEFAULT_MARGIN,

                        leverage:
                            DEFAULT_LEVERAGE,

                        targetNotional:
                            DEFAULT_MARGIN *
                            DEFAULT_LEVERAGE,

                        stepSize:
                            CONTRACT_INFO[
                                symbol
                            ]?.stepSize,

                        quantityPrecision:
                            CONTRACT_INFO[
                                symbol
                            ]?.quantityPrecision,

                        minOrderSize:
                            CONTRACT_INFO[
                                symbol
                            ]?.minOrderSize,

                        maxOrderSize:
                            CONTRACT_INFO[
                                symbol
                            ]?.maxOrderSize,

                        managed:
                            managedSymbols.has(
                                symbol
                            )
                    })
                );


        res.json({

            count:
                symbols.length,

            margin:
                DEFAULT_MARGIN,

            leverage:
                DEFAULT_LEVERAGE,

            targetNotional:
                DEFAULT_MARGIN *
                DEFAULT_LEVERAGE,

            orderBook:
                getStatusConfig().orderBook,

            multiDepth: {

                apiRequestDepth:
                    WEEX_REQUEST_DEPTH,

                confirmationDepths:
                    [...CONFIRMATION_DEPTHS],

                confirmationRequired:
                    3,

                confirmationRule:
                    "3_OF_4"
            },

            orderFlowStatistics:
                getOrderBookStats(),

            automaticTrader: {

                enabled:
                    AUTO_TRADING_ENABLED,

                intervalMs:
                    AUTO_TRADING_INTERVAL_MS,

                intervalMinutes:
                    AUTO_TRADING_INTERVAL_MS /
                    60000,

                running:
                    automaticTraderRunning,

                lastRun:
                    automaticTraderLastRun,

                nextRun:
                    automaticTraderNextRun,

                managedSymbols:
                    managedList(),

                managedCount:
                    managedSymbols.size
            },

            symbols
        });
    }
);


// ============================================================
// REFRESH SYMBOLS
// ============================================================

app.post(
    "/refresh-symbols",
    async (
        req,
        res
    ) => {

        try {

            await loadAllContracts();


            res.json({

                success:
                    true,

                count:
                    SUPPORTED_SYMBOLS.size,

                symbols:
                    Array.from(
                        SUPPORTED_SYMBOLS
                    ).sort()
            });

        } catch (error) {

            res.status(
                500
            ).json({

                success:
                    false,

                error:
                    error.message
            });
        }
    }
);


// ============================================================
// AUTOMATIC TRADER CONTROL
// ============================================================

app.post(
    "/automatic-trader/run",
    (
        req,
        res
    ) => {

        if (
            !AUTO_TRADING_ENABLED
        ) {

            return res.status(
                400
            ).json({

                success:
                    false,

                error:
                    "Automatic trader is disabled in config.js"
            });
        }


        if (
            !TRADING_ENABLED
        ) {

            return res.status(
                400
            ).json({

                success:
                    false,

                error:
                    "Trading is disabled in config.js"
            });
        }


        if (
            automaticTraderRunning
        ) {

            return res.status(
                409
            ).json({

                success:
                    false,

                error:
                    "Automatic trader is already running."
            });
        }


        runManagedTrader()
            .catch(
                error => {

                    console.error(
                        "MANUAL AUTOMATIC TRADER ERROR:",
                        error.message
                    );
                }
            );


        res.json({

            success:
                true,

            accepted:
                true,

            message:
                "Automatic 3-of-4 live-position scan started in background."
        });
    }
);


app.get(
    "/automatic-trader/status",
    (
        req,
        res
    ) => {

        res.json({

            success:
                true,

            enabled:
                AUTO_TRADING_ENABLED,

            tradingEnabled:
                TRADING_ENABLED,

            intervalMs:
                AUTO_TRADING_INTERVAL_MS,

            intervalMinutes:
                AUTO_TRADING_INTERVAL_MS /
                60000,

            running:
                automaticTraderRunning,

            lastRun:
                automaticTraderLastRun,

            nextRun:
                automaticTraderNextRun,

            managedSymbols:
                managedList(),

            managedCount:
                managedSymbols.size,

            totalAvailableSymbols:
                SUPPORTED_SYMBOLS.size,

            multiDepthConfirmation:
                [...CONFIRMATION_DEPTHS],

            multiDepthConfirmationRequired:
                3,

            multiDepthConfirmationRule:
                "3_OF_4",

            orderBookStats:
                getOrderBookStats()
        });
    }
);


// ============================================================
// AUTOMATIC ORDER-FLOW MODULE
// ============================================================
//
// This endpoint now uses the SAME automatic trader.
//
// There is no second automatic trading engine.
//
// ============================================================

app.post(
    "/automatic-orderflow/run",
    async (
        req,
        res
    ) => {

        try {

            const result =
                await runManagedTrader();


            res.json(
                result
            );

        } catch (error) {

            console.error(
                "AUTOMATIC ORDER-FLOW ERROR:",
                error.message
            );


            res.status(
                500
            ).json({

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
// LIVE ORDER BOOK
// ============================================================
//
// ONE WEEX 200-LEVEL SNAPSHOT.
//
// Trading confirmation:
//
//     15
//     30
//     60
//     90
//
// AT LEAST 3 OF 4 MUST PASS.
//
// ============================================================

app.get(
    "/live-orderbook",
    async (
        req,
        res
    ) => {

        try {

            const symbol =
                normalizeSymbol(
                    req.query?.symbol
                );


            if (
                !isSupported(
                    symbol
                )
            ) {

                return res.status(
                    400
                ).json({

                    success:
                        false,

                    error:
                        "Invalid or unavailable WEEX symbol",

                    symbol
                });
            }


            // ------------------------------------------------
            // ONE WEEX REQUEST
            // ------------------------------------------------

            const snapshot =
                await getMultiDepthSnapshot(
                    symbol
                );


            // ------------------------------------------------
            // LONG
            // ------------------------------------------------

            const longDepth =
                evaluateMultiDepth(
                    snapshot.bids,
                    snapshot.asks,
                    "LONG"
                );


            // ------------------------------------------------
            // SHORT
            // ------------------------------------------------

            const shortDepth =
                evaluateMultiDepth(
                    snapshot.bids,
                    snapshot.asks,
                    "SHORT"
                );


            // ------------------------------------------------
            // THREE-OF-FOUR
            // ------------------------------------------------

            const longConfirmation =
                getThreeOfFourConfirmation(
                    longDepth
                );


            const shortConfirmation =
                getThreeOfFourConfirmation(
                    shortDepth
                );


            const longAllowed =
                longConfirmation.confirmationPassed;


            const shortAllowed =
                shortConfirmation.confirmationPassed;


            let decision =
                "NEUTRAL";


            if (
                longAllowed &&
                !shortAllowed
            ) {

                decision =
                    "LONG";

            } else if (
                shortAllowed &&
                !longAllowed
            ) {

                decision =
                    "SHORT";
            }


            const primaryLong =
                longDepth.results[15];


            res.json({

                success:
                    true,

                readOnly:
                    true,

                orderPlaced:
                    false,

                symbol,

                managed:
                    managedSymbols.has(
                        symbol
                    ),

                decision,

                requestedDepth:
                    WEEX_REQUEST_DEPTH,

                confirmationDepths:
                    [...CONFIRMATION_DEPTHS],

                confirmationRequired:
                    3,

                confirmationRule:
                    "3_OF_4",

                multiDepth: {

                    long:
                        longDepth,

                    short:
                        shortDepth
                },

                confirmation: {

                    long:
                        longConfirmation,

                    short:
                        shortConfirmation
                },

                orderBook: {

                    bidLiquidity:
                        primaryLong?.bidLiquidity ?? 0,

                    askLiquidity:
                        primaryLong?.askLiquidity ?? 0,

                    totalLiquidity:
                        primaryLong?.totalLiquidity ?? 0,

                    bidPercentage:
                        primaryLong?.bidPercentage ?? 0,

                    askPercentage:
                        primaryLong?.askPercentage ?? 0,

                    imbalance:
                        primaryLong?.imbalance ?? 0,

                    bidAskRatio:
                        primaryLong?.bidAskRatio ?? 0,

                    askBidRatio:
                        primaryLong?.askBidRatio ?? 0,

                    longAllowed,

                    shortAllowed,

                    longPassedDepths:
                        longConfirmation.passedDepths,

                    shortPassedDepths:
                        shortConfirmation.passedDepths,

                    longPassedCount:
                        longConfirmation.passedCount,

                    shortPassedCount:
                        shortConfirmation.passedCount,

                    longMinImbalance:
                        LONG_MIN_IMBALANCE,

                    shortMaxImbalance:
                        SHORT_MAX_IMBALANCE,

                    minBidAskRatio:
                        MIN_BID_ASK_RATIO,

                    minAskBidRatio:
                        MIN_ASK_BID_RATIO,

                    depth:
                        WEEX_REQUEST_DEPTH
                },

                depths: {

                    long:
                        longDepth.results,

                    short:
                        shortDepth.results
                },

    dashboard: {

    depth15: {

        long:
            longDepth.results[15],

        short:
            shortDepth.results[15]
    },

    depth20: {

        long:
            longDepth.results[20],

        short:
            shortDepth.results[20]
    },

    depth30: {

        long:
            longDepth.results[30],

        short:
            shortDepth.results[30]
    },

    depth60: {

        long:
            longDepth.results[60],

        short:
            shortDepth.results[60]
    },

    depths: {

        15: {

            long:
                longDepth.results[15],

            short:
                shortDepth.results[15]
        },

        20: {

            long:
                longDepth.results[20],

            short:
                shortDepth.results[20]
        },

        30: {

            long:
                longDepth.results[30],

            short:
                shortDepth.results[30]
        },

        60: {

            long:
                longDepth.results[60],

            short:
                shortDepth.results[60]
        }
    },

    decision,

    longAllowed,

    shortAllowed,

    longPassedDepths:
        longConfirmation.passedDepths,

    shortPassedDepths:
        shortConfirmation.passedDepths,

    longPassedCount:
        longConfirmation.passedCount,

    shortPassedCount:
        shortConfirmation.passedCount,

    confirmationDepths:
        [...CONFIRMATION_DEPTHS],

    confirmationRequired:
        3,

    confirmationRule:
        "3_OF_4",

    timestamp:
        new Date().toISOString()
}
            });

        } catch (error) {

            console.error("");

            console.error(
                "============================================================"
            );

            console.error(
                "LIVE ORDER BOOK ERROR"
            );

            console.error(
                "============================================================"
            );

            console.error(
                "Symbol:",
                req.query?.symbol
            );

            console.error(
                "Error:",
                error.message
            );


            if (
                error.data
            ) {

                console.error(
                    "WEEX DATA:"
                );

                console.error(
                    pretty(
                        error.data
                    )
                );
            }


            console.error(
                "============================================================"
            );


            res.status(
                500
            ).json({

                success:
                    false,

                readOnly:
                    true,

                orderPlaced:
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


            res.json({

                online:
                    true,

                tradingEnabled:
                    TRADING_ENABLED,

                mode:
                    TRADING_ENABLED
                        ? "LIVE"
                        : "DISABLED",

                automaticTrading: {

                    enabled:
                        AUTO_TRADING_ENABLED,

                    intervalMs:
                        AUTO_TRADING_INTERVAL_MS,

                    intervalMinutes:
                        AUTO_TRADING_INTERVAL_MS /
                        60000,

                    running:
                        automaticTraderRunning,

                    lastRun:
                        automaticTraderLastRun,

                    nextRun:
                        automaticTraderNextRun,

                    managedSymbols:
                        managedList(),

                    managedCount:
                        managedSymbols.size
                },

                api:
                    "WEEX V3 USDT-M",

                marginMode:
                    REQUIRED_MARGIN_MODE,

                defaultRisk: {

                    margin:
                        DEFAULT_MARGIN,

                    leverage:
                        DEFAULT_LEVERAGE,

                    positionNotional:
                        DEFAULT_MARGIN *
                        DEFAULT_LEVERAGE
                },

                orderBookFilter:
                    getStatusConfig().orderBook,

                multiDepth: {

                    apiRequestDepth:
                        WEEX_REQUEST_DEPTH,

                    confirmationDepths:
                        [...CONFIRMATION_DEPTHS],

                    confirmationRequired:
                        3,

                    confirmationRule:
                        "3_OF_4"
                },

                orderFlowStatistics:
                    getOrderBookStats(),

                reversal:
                    "CLOSE -> CONFIRM FLAT -> FRESH 200-LEVEL SNAPSHOT -> 3 OF 4 -> OPEN",

                automaticStrategy:
                    "LIVE WEEX POSITIONS -> 3 OF 4 ORDER BOOK -> HOLD / FLIP",

                discoveredSymbols:
                    SUPPORTED_SYMBOLS.size,

                balance:
                    balance.available,

                symbols:
                    Array.from(
                        SUPPORTED_SYMBOLS
                    ).sort()
            });

        } catch (error) {

            res.status(
                500
            ).json({

                online:
                    true,

                error:
                    error.message
            });
        }
    }
);


// ============================================================
// INDIVIDUAL POSITION
// ============================================================

app.get(
    "/position",
    async (
        req,
        res
    ) => {

        try {

            const symbol =
                normalizeSymbol(
                    req.query?.symbol
                );


            if (
                !isSupported(
                    symbol
                )
            ) {

                return res.status(
                    400
                ).json({

                    success:
                        false,

                    error:
                        "Invalid or unavailable symbol",

                    symbol
                });
            }


            const position =
                await getCurrentPosition(
                    symbol
                );


            res.json({

                ...position,

                symbol,

                managed:
                    managedSymbols.has(
                        symbol
                    )
            });

        } catch (error) {

            res.status(
                500
            ).json({

                success:
                    false,

                error:
                    error.message
            });
        }
    }
);


// ============================================================
// DASHBOARD
// ============================================================

app.get(
    "/",
    (
        req,
        res
    ) => {

        res.sendFile(
            path.join(
                __dirname,
                "dashboard",
                "dashboard.html"
            )
        );
    }
);


// ============================================================
// START SERVER
// ============================================================

app.listen(
    PORT,
    async () => {

        console.log("");

        section(
            "SERVER V3 STARTED"
        );


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
            "Automatic trading:",
            AUTO_TRADING_ENABLED
                ? "ENABLED"
                : "DISABLED"
        );

        console.log(
            "Automatic interval:",
            `${AUTO_TRADING_INTERVAL_MS / 60000} minutes`
        );

        console.log(
            "API:",
            "WEEX V3 USDT-M Futures"
        );

        console.log(
            "Default margin:",
            DEFAULT_MARGIN,
            "USDT"
        );

        console.log(
            "Default leverage:",
            DEFAULT_LEVERAGE,
            "x"
        );

        console.log(
            "Target notional:",
            DEFAULT_MARGIN *
            DEFAULT_LEVERAGE,
            "USDT"
        );

        console.log(
            "Margin mode:",
            REQUIRED_MARGIN_MODE
        );

        console.log(
            "WEEX order-book request:",
            `${WEEX_REQUEST_DEPTH} levels`
        );

        console.log(
            "Trading depths:",
            CONFIRMATION_DEPTHS.join(" + ")
        );

        console.log(
            "Confirmation rule:",
            "3 OF 4"
        );

        console.log(
            "LONG:",
            "3 OF 4 DEPTHS PASS"
        );

        console.log(
            "SHORT:",
            "3 OF 4 DEPTHS PASS"
        );

        console.log(
            "CLOSE:",
            "NEVER FILTERED"
        );

        console.log(
            "Reversal:",
            "CLOSE -> FLAT -> FRESH 200 -> 3 OF 4 -> OPEN"
        );

        console.log(
            "Symbol discovery:",
            "AUTOMATIC"
        );

        console.log(
            "Webhook:",
            "IMMEDIATE ACK"
        );

        console.log(
            "Concurrency:",
            "PER-SYMBOL"
        );

        console.log(
            "Automatic trader:",
            AUTO_TRADING_ENABLED
                ? "EVERY INTERVAL - LIVE WEEX POSITION DISCOVERY"
                : "DISABLED"
        );

        console.log(
            "Managed symbols at startup:",
            managedSymbols.size
        );

        console.log(
            "============================================================"
        );


        try {

            await loadAllContracts();


            if (
                API_KEY &&
                API_SECRET &&
                API_PASSPHRASE
            ) {

                const balance =
                    await getFuturesBalance();


                section(
                    "BOT READY"
                );


                console.log(
                    "Available WEEX USDT-M symbols:",
                    SUPPORTED_SYMBOLS.size
                );


                console.log(
                    "Available balance:",
                    balance.available,
                    "USDT"
                );

            } else {

                console.log("");

                console.log(
                    "BOT STARTED WITHOUT PRIVATE API CREDENTIALS."
                );

                console.log(
                    "Public order-book testing is still available."
                );
            }


            // ------------------------------------------------
            // INITIAL LIVE POSITION DISCOVERY
            // ------------------------------------------------

            if (
                AUTO_TRADING_ENABLED &&
                TRADING_ENABLED &&
                API_KEY &&
                API_SECRET &&
                API_PASSPHRASE
            ) {

                console.log("");

                console.log(
                    "INITIAL LIVE POSITION DISCOVERY..."
                );


                try {

                    await discoverLivePositions();

                } catch (error) {

                    console.error(
                        "INITIAL POSITION DISCOVERY ERROR:",
                        error.message
                    );
                }
            }


            startAutomaticTrader();


            console.log("");

            console.log(
                "READ-ONLY 3-OF-4 TEST:"
            );

            console.log(
                "GET /test-orderbook?symbol=BTCUSDT&direction=LONG"
            );

            console.log(
                "Depths:",
                CONFIRMATION_DEPTHS.join(" + ")
            );

            console.log(
                "Rule:",
                "3 OF 4"
            );

            console.log(
                "WEEX request:",
                WEEX_REQUEST_DEPTH
            );


            console.log(
                "ORDER FLOW STATISTICS:"
            );

            console.log(
                "GET /orderflow-stats"
            );


            console.log(
                "RESET ORDER FLOW STATISTICS:"
            );

            console.log(
                "POST /orderflow-stats/reset"
            );


            console.log(
                "STATUS:"
            );

            console.log(
                "GET /status"
            );


            console.log(
                "AUTOMATIC TRADER STATUS:"
            );

            console.log(
                "GET /automatic-trader/status"
            );


            console.log(
                "MANAGED SYMBOLS:"
            );

            console.log(
                "GET /managed-symbols"
            );


            console.log(
                "SELECT MANAGED SYMBOLS:"
            );

            console.log(
                "POST /automatic-trader/select"
            );


            console.log(
                "CLEAR MANAGED SYMBOLS:"
            );

            console.log(
                "POST /automatic-trader/clear"
            );


            console.log(
                "FORCE AUTOMATIC CHECK:"
            );

            console.log(
                "POST /automatic-trader/run"
            );


            console.log(
                "AUTOMATIC ORDER-FLOW MODULE:"
            );

            console.log(
                "POST /automatic-orderflow/run"
            );


            console.log(
                "MANUAL LONG:"
            );

            console.log(
                "POST /manual-long?symbol=BTCUSDT"
            );


            console.log(
                "MANUAL SHORT:"
            );

            console.log(
                "POST /manual-short?symbol=BTCUSDT"
            );


            console.log(
                "MANUAL CLOSE:"
            );

            console.log(
                "POST /manual-close?symbol=BTCUSDT"
            );


            console.log(
                "LIVE 3-OF-4 ORDER BOOK:"
            );

            console.log(
                "GET /live-orderbook?symbol=BTCUSDT"
            );


            console.log(
                "POSITION:"
            );

            console.log(
                "GET /position?symbol=BTCUSDT"
            );


            console.log(
                "Risk:",
                `${DEFAULT_MARGIN} USDT margin / ${DEFAULT_LEVERAGE}x / ~${DEFAULT_MARGIN * DEFAULT_LEVERAGE} USDT notional`
            );


            console.log(
                "============================================================"
            );

        } catch (error) {

            console.error("");

            console.error(
                "============================================================"
            );

            console.error(
                "STARTUP FAILED"
            );

            console.error(
                "============================================================"
            );


            console.error(
                error.message
            );


            if (
                error.data
            ) {

                console.error(
                    pretty(
                        error.data
                    )
                );
            }
        }
    }
);