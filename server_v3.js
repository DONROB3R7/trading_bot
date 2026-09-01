require("dotenv").config();

const express = require("express");
const path = require("path");

const dashboardRoutes = require("./routes/dashboard");

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
    managedSymbols,
    isSupported,
    addManagedSymbol,
    managedList,
    getPositionSide,
    discoverLivePositions
} = require("./services/managedSymbols");

const {
    processSignal,
    getStatusConfig
} = require("./trading/trading");

const {
    runAutomaticTrader,
    startAutomaticTrader,
    getAutomaticTraderStatus
} = require("./services/automaticTrader");

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

app.use("/", dashboardRoutes);

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
// ORDER FLOW STATISTICS
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
// 3 OF 4 CONFIRMATION
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
// STARTUP INFO
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
    "LIVE WEEX POSITIONS -> ORDER FLOW HISTORY"
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
// WEBHOOK
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

            // Send TradingView response immediately.

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

            // Process the signal in the background.

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
                        }

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
                    }
                )
                .catch(
                    error => {

                        console.error("");

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
// ORDER BOOK TEST
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

        const automaticStatus =
            getAutomaticTraderStatus();

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

                ...automaticStatus,

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
// AUTOMATIC TRADER
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

        const status =
            getAutomaticTraderStatus();

        if (
            status.running
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

        runAutomaticTrader()
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
                "Automatic order-flow scan started in background."
        });
    }
);


app.get(
    "/automatic-trader/status",
    (
        req,
        res
    ) => {

        const status =
            getAutomaticTraderStatus();

        res.json({

            success:
                true,

            enabled:
                AUTO_TRADING_ENABLED,

            tradingEnabled:
                TRADING_ENABLED,

            ...status,

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
// AUTOMATIC ORDER-FLOW
// ============================================================

app.post(
    "/automatic-orderflow/run",
    async (
        req,
        res
    ) => {

        try {

            const result =
                await runAutomaticTrader();

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

            console.error(
                "LIVE ORDER BOOK ERROR:",
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

            const automaticStatus =
                getAutomaticTraderStatus();

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

                    ...automaticStatus,

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
                    "CLOSE -> CONFIRM FLAT -> FRESH 200-LEVEL SNAPSHOT -> ORDER FLOW -> OPEN",

                automaticStrategy:
                    "MANAGED SYMBOLS -> LIVE WEEX POSITION -> ORDER FLOW HISTORY",

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
// POSITION
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
            "CLOSE -> FLAT -> FRESH 200 -> ORDER FLOW -> OPEN"
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
                ? "ENABLED"
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

            // Load current live positions.

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

            // Start automatic trader.

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
                "LIVE ORDER BOOK:"
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
                "STARTUP FAILED"
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