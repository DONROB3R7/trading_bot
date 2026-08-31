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
    getStatusConfig,
    getOrderBookStats,
    resetOrderBookStats,
    getAutomaticTradingStatus,
    runAutomaticTradingCycle
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

const managedSymbols =
    new Set();


// ============================================================
// TWO-OF-THREE CONFIRMATION
// ============================================================
//
// WEEX requests 200 levels.
//
// Trading uses only:
//
//     15
//     30
//     60
//
// Requirement:
//
//     AT LEAST 2 OF 3 MUST PASS.
//
// 200 is NOT a trading confirmation depth.
//
// ============================================================

function getTwoOfThreeConfirmation(
    multiDepth
) {

    const depths = [
        15,
        30,
        60
    ];


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
        2;


    const confirmationPassed =
        passedCount >= confirmationRequired;


    return {

        confirmationDepths:
            depths,

        confirmationRequired,

        passedDepths,

        failedDepths,

        passedCount,

        confirmationPassed,

        confirmationReason:
            confirmationPassed
                ? `TWO_OF_THREE_CONFIRMED_${passedCount}_OF_3`
                : `TWO_OF_THREE_FAILED_${passedCount}_OF_3`
    };
}


// ============================================================
// HELPERS
// ============================================================

function getPositionSide(
    position
) {

    if (!position) {
        return "UNKNOWN";
    }


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
        direct === "BUY"
    ) {
        return "LONG";
    }


    if (
        direct === "SHORT" ||
        direct === "SELL"
    ) {
        return "SHORT";
    }


    if (
        direct === "FLAT" ||
        direct === "NONE"
    ) {
        return "FLAT";
    }


    const size =
        Number(
            position.size ??
            position.positionSize ??
            position.quantity ??
            position.qty ??
            0
        );


    if (
        !Number.isFinite(size) ||
        Math.abs(size) === 0
    ) {
        return "FLAT";
    }


    if (
        direct.includes("LONG")
    ) {
        return "LONG";
    }


    if (
        direct.includes("SHORT")
    ) {
        return "SHORT";
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


    managedSymbols.add(
        normalized
    );


    console.log(
        "MANAGED SYMBOL ADDED:",
        normalized
    );


    return true;
}


function removeManagedSymbol(
    symbol
) {

    const normalized =
        normalizeSymbol(
            symbol
        );


    if (!normalized) {
        return false;
    }


    const removed =
        managedSymbols.delete(
            normalized
        );


    if (removed) {

        console.log(
            "MANAGED SYMBOL REMOVED:",
            normalized
        );
    }


    return removed;
}


function managedList() {

    return Array.from(
        managedSymbols
    ).sort();
}


// ============================================================
// DISCOVER LIVE WEEX POSITIONS
// ============================================================

async function discoverLivePositions() {

    const symbols =
        Array.from(
            SUPPORTED_SYMBOLS
        ).sort();


    const activePositions =
        [];

    const discoveredActive =
        new Set();


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


            if (
                direction === "LONG" ||
                direction === "SHORT"
            ) {

                discoveredActive.add(
                    symbol
                );


                activePositions.push({

                    symbol,

                    direction,

                    quantity:
                        position.quantity ??
                        position.size ??
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
            }

        } catch (error) {

            console.error(
                `POSITION DISCOVERY ERROR ${symbol}:`,
                error.message
            );
        }
    }


    const previousManaged =
        new Set(
            managedSymbols
        );


    for (
        const symbol of discoveredActive
    ) {

        managedSymbols.add(
            symbol
        );
    }


    for (
        const symbol of previousManaged
    ) {

        if (
            !discoveredActive.has(
                symbol
            )
        ) {

            managedSymbols.delete(
                symbol
            );


            console.log(
                "WEEX POSITION NO LONGER ACTIVE:",
                symbol
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
    "2 OF 3 DEPTHS MUST PASS"
);

console.log(
    "LONG:",
    `imbalance >= ${LONG_MIN_IMBALANCE}`,
    `AND bid/ask >= ${MIN_BID_ASK_RATIO}`,
    "AT LEAST 2 OF 3 DEPTHS"
);

console.log(
    "SHORT:",
    `imbalance <= ${SHORT_MAX_IMBALANCE}`,
    `AND ask/bid >= ${MIN_ASK_BID_RATIO}`,
    "AT LEAST 2 OF 3 DEPTHS"
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
    "LIVE WEEX POSITIONS -> 2 OF 3 ORDER BOOK -> HOLD / FLIP"
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
            "AUTOMATIC 2-OF-3 ORDER BOOK POSITION CHECK"
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
            "2 OF 3"
        );


        if (
            symbols.length === 0
        ) {

            console.log("");

            console.log(
                "NO ACTIVE WEEX POSITIONS FOUND."
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


                if (
                    positionSide !== "LONG" &&
                    positionSide !== "SHORT"
                ) {

                    managedSymbols.delete(
                        symbol
                    );


                    flatActions++;


                    results.push({

                        symbol,

                        position:
                            "FLAT",

                        decision:
                            "NONE",

                        action:
                            "POSITION_CLOSED",

                        reason:
                            "WEEX_POSITION_NO_LONGER_ACTIVE"
                    });


                    continue;
                }


                // ------------------------------------------------
                // ONE 200-LEVEL SNAPSHOT
                // ------------------------------------------------

                const snapshot =
                    await getMultiDepthSnapshot(
                        symbol
                    );


                // ------------------------------------------------
                // LONG EVALUATION
                // ------------------------------------------------

                const longDepth =
                    evaluateMultiDepth(
                        snapshot.bids,
                        snapshot.asks,
                        "LONG"
                    );


                // ------------------------------------------------
                // SHORT EVALUATION
                // ------------------------------------------------

                const shortDepth =
                    evaluateMultiDepth(
                        snapshot.bids,
                        snapshot.asks,
                        "SHORT"
                    );


                // ------------------------------------------------
                // TWO-OF-THREE CONFIRMATION
                // ------------------------------------------------

                const longConfirmation =
                    getTwoOfThreeConfirmation(
                        longDepth
                    );


                const shortConfirmation =
                    getTwoOfThreeConfirmation(
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
                    "LONG 15/30/60:",
                    longDepth.results[15]?.filterPass,
                    longDepth.results[30]?.filterPass,
                    longDepth.results[60]?.filterPass,
                    `=> ${longConfirmation.passedCount}/3 PASS`
                );

                console.log(
                    "SHORT 15/30/60:",
                    shortDepth.results[15]?.filterPass,
                    shortDepth.results[30]?.filterPass,
                    shortDepth.results[60]?.filterPass,
                    `=> ${shortConfirmation.passedCount}/3 PASS`
                );


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
                            "TWO_OF_THREE_ORDER_BOOK_NEUTRAL",

                        longConfirmation,

                        shortConfirmation
                    });


                    continue;
                }


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
                            `TWO_OF_THREE_ORDER_FLOW_SUPPORTS_EXISTING_${decision}`,

                        longConfirmation,

                        shortConfirmation
                    });


                    continue;
                }


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
                        "AUTOMATIC 2-OF-3 REVERSAL REQUIRED"
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
                2,

            confirmationRule:
                "2_OF_3",

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
            "AUTOMATIC 2-OF-3 POSITION CHECK COMPLETE"
        );

        console.log(
            "############################################################"
        );

        console.log(
            "Confirmation:",
            "2 OF 3"
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


            processSignal(
                symbol,
                action
            )
                .then(
                    result => {

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

                        } else {

                            removeManagedSymbol(
                                symbol
                            );
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


        if (
            action === "CLOSE" ||
            action === "CLOSE_LONG" ||
            action === "CLOSE_SHORT"
        ) {

            removeManagedSymbol(
                symbol
            );
        }


        res.json({

            ...result,

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
                "READ-ONLY 2-OF-3 ORDER BOOK TEST",
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
                "2 OF 3"
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
                getTwoOfThreeConfirmation(
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
                    2,

                confirmationRule:
                    "2_OF_3",

                confirmationPassed:
                    confirmation.confirmationPassed,

                passedDepths:
                    confirmation.passedDepths,

                failedDepths:
                    confirmation.failedDepths,

                passedCount:
                    confirmation.passedCount,

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


        const automatic =
            getAutomaticTradingStatus();


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
                    2,

                confirmationRule:
                    "2_OF_3"
            },

            orderFlowStatistics:
                getOrderBookStats(),

            automaticTrader: {

                ...automatic,

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
                    managedList()
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
                "Automatic 2-of-3 live-position scan started in background."
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
                2,

            multiDepthConfirmationRule:
                "2_OF_3",

            tradingModuleAutomaticStatus:
                getAutomaticTradingStatus()
        });
    }
);


// ============================================================
// EXISTING AUTOMATIC ORDER-FLOW MODULE
// ============================================================

app.post(
    "/automatic-orderflow/run",
    async (
        req,
        res
    ) => {

        try {

            const result =
                await runAutomaticTradingCycle();


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
//
// AT LEAST 2 OF 3 MUST PASS.
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
            // TWO-OF-THREE
            // ------------------------------------------------

            const longConfirmation =
                getTwoOfThreeConfirmation(
                    longDepth
                );


            const shortConfirmation =
                getTwoOfThreeConfirmation(
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
                    2,

                confirmationRule:
                    "2_OF_3",

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
                        2,

                    confirmationRule:
                        "2_OF_3",

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
                        2,

                    confirmationRule:
                        "2_OF_3"
                },

                orderFlowStatistics:
                    getOrderBookStats(),

                reversal:
                    "CLOSE -> CONFIRM FLAT -> FRESH 200-LEVEL SNAPSHOT -> 2 OF 3 -> OPEN",

                automaticStrategy:
                    "LIVE WEEX POSITIONS -> 2 OF 3 ORDER BOOK -> HOLD / FLIP",

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
            "2 OF 3"
        );

        console.log(
            "LONG:",
            "2 OF 3 DEPTHS PASS"
        );

        console.log(
            "SHORT:",
            "2 OF 3 DEPTHS PASS"
        );

        console.log(
            "CLOSE:",
            "NEVER FILTERED"
        );

        console.log(
            "Reversal:",
            "CLOSE -> FLAT -> FRESH 200 -> 2 OF 3 -> OPEN"
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
                "READ-ONLY 2-OF-3 TEST:"
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
                "2 OF 3"
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
                "LIVE 2-OF-3 ORDER BOOK:"
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

