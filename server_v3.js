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
    checkOrderBook,
    getStatusConfig,
    getOrderBookStats,
    resetOrderBookStats
} = require("./trading/trading");

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
    "Automatic hourly trading:",
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
    "Order book depth:",
    ORDER_BOOK_DEPTH
);

console.log(
    "LONG:",
    `imbalance >= ${LONG_MIN_IMBALANCE}`,
    `AND bid/ask >= ${MIN_BID_ASK_RATIO}`
);

console.log(
    "SHORT:",
    `imbalance <= ${SHORT_MAX_IMBALANCE}`,
    `AND ask/bid >= ${MIN_ASK_BID_RATIO}`
);

console.log(
    "CLOSE:",
    "NEVER FILTERED"
);

console.log(
    "Symbols:",
    "DISCOVERED AUTOMATICALLY FROM WEEX"
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
    "Order-flow statistics:",
    "ENABLED"
);

console.log(
    "Automatic trader:",
    "SELECTED COIN ONLY"
);

console.log(
    "============================================================"
);


if (
    !API_KEY ||
    !API_SECRET ||
    !API_PASSPHRASE
) {

    console.error("");

    console.error(
        "WARNING: WEEX API credentials missing."
    );
}


// ============================================================
// AUTOMATIC HOURLY TRADER STATE
// ============================================================
//
// IMPORTANT:
//
// The automatic trader NO LONGER scans SUPPORTED_SYMBOLS.
//
// It only scans symbols selected from the frontend.
//
// Example:
//
// selectedAutoSymbols = ["WIFUSDT"]
//
// Therefore 1000BONKUSDT cannot be traded automatically
// unless it is explicitly selected.
//
// ============================================================

let automaticTraderRunning =
    false;

let automaticTraderTimer =
    null;

let automaticTraderLastRun =
    null;

let automaticTraderNextRun =
    null;


// Current automatic-trading symbols.
//
// Set starts empty.
//
// Frontend must explicitly select a coin.
//
// This prevents the old behaviour where the bot automatically
// scanned the entire WEEX symbol list.
//
const selectedAutoSymbols =
    new Set();


// ============================================================
// VALIDATE AUTOMATIC SYMBOL
// ============================================================

function validateAutomaticSymbol(
    rawSymbol
) {

    const symbol =
        normalizeSymbol(
            rawSymbol
        );


    if (
        !symbol
    ) {

        throw new Error(
            "Automatic trading symbol is required."
        );
    }


    if (
        !SUPPORTED_SYMBOLS.has(
            symbol
        )
    ) {

        throw new Error(
            `Unsupported or unavailable WEEX symbol: ${symbol}`
        );
    }


    return symbol;
}


// ============================================================
// SET AUTOMATIC SYMBOL
// ============================================================
//
// Current frontend uses one selected coin.
//
// POST /automatic-trader/select
//
// {
//     "symbol": "WIFUSDT"
// }
//
// ============================================================

app.post(
    "/automatic-trader/select",
    (req, res) => {

        try {

            const symbol =
                validateAutomaticSymbol(
                    req.body?.symbol
                );


            // IMPORTANT:
            //
            // Replace the current selection.
            //
            // This guarantees that selecting WIFUSDT
            // removes 1000BONKUSDT from automatic trading.
            //
            selectedAutoSymbols.clear();

            selectedAutoSymbols.add(
                symbol
            );


            console.log("");

            console.log(
                "============================================================"
            );

            console.log(
                "AUTOMATIC TRADER SYMBOL CHANGED"
            );

            console.log(
                "Selected coin:",
                symbol
            );

            console.log(
                "Automatic symbols:",
                Array.from(
                    selectedAutoSymbols
                )
            );

            console.log(
                "============================================================"
            );


            return res.json({

                success:
                    true,

                symbol,

                symbols:
                    Array.from(
                        selectedAutoSymbols
                    ),

                message:
                    `Automatic trading selected: ${symbol}`
            });


        } catch (error) {

            console.error(
                "AUTOMATIC SYMBOL SELECTION ERROR:",
                error.message
            );


            return res
                .status(400)
                .json({

                    success:
                        false,

                    error:
                        error.message
                });
        }
    }
);


// ============================================================
// GET AUTOMATIC SYMBOL
// ============================================================

app.get(
    "/automatic-trader/selection",
    (req, res) => {

        return res.json({

            success:
                true,

            symbols:
                Array.from(
                    selectedAutoSymbols
                ),

            symbol:
                Array.from(
                    selectedAutoSymbols
                )[0] || null
        });
    }
);


// ============================================================
// AUTOMATIC HOURLY TRADER
// ============================================================
//
// Every automatic cycle:
//
// 1. Get ONLY frontend-selected symbol(s).
// 2. Get current WEEX position.
// 3. Check LONG order book.
// 4. Check SHORT order book.
// 5. Compare order-book direction with position.
// 6. If opposite -> processSignal() handles reversal.
// 7. If flat -> processSignal() opens supported direction.
// 8. If neutral -> do nothing.
//
// ============================================================

async function runAutomaticTrader(
    forcedSymbol = null
) {

    if (
        automaticTraderRunning
    ) {

        console.log("");

        console.log(
            "AUTOMATIC TRADER:"
        );

        console.log(
            "Previous scan is still running."
        );

        console.log(
            "Skipping to prevent overlapping scans."
        );

        return {

            success:
                false,

            skipped:
                true,

            reason:
                "SCAN_ALREADY_RUNNING"
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

        console.log("");

        console.log(
            "AUTOMATIC TRADER:"
        );

        console.log(
            "TRADING_ENABLED=false"
        );

        return {

            success:
                false,

            skipped:
                true,

            reason:
                "TRADING_DISABLED"
        };
    }


    // --------------------------------------------------------
    // FORCE CHECK
    // --------------------------------------------------------
    //
    // If frontend sends a symbol, use ONLY that symbol.
    //
    // This is what the FORCE CHECK button uses.
    //
    // --------------------------------------------------------

    let symbols = [];


    if (
        forcedSymbol
    ) {

        const symbol =
            validateAutomaticSymbol(
                forcedSymbol
            );


        // Keep backend selection synchronized
        // with the frontend.
        //
        selectedAutoSymbols.clear();

        selectedAutoSymbols.add(
            symbol
        );


        symbols = [
            symbol
        ];

    } else {

        symbols =
            Array.from(
                selectedAutoSymbols
            );
    }


    // --------------------------------------------------------
    // NO SYMBOL SELECTED
    // --------------------------------------------------------

    if (
        symbols.length === 0
    ) {

        console.log("");

        console.log(
            "AUTOMATIC TRADER:"
        );

        console.log(
            "NO COIN SELECTED."
        );

        console.log(
            "No automatic trade will be placed."
        );


        return {

            success:
                true,

            skipped:
                true,

            reason:
                "NO_SYMBOL_SELECTED",

            symbols: []
        };
    }


    automaticTraderRunning =
        true;

    automaticTraderLastRun =
        new Date().toISOString();


    const results = [];


    try {

        console.log("");

        console.log(
            "############################################################"
        );

        console.log(
            forcedSymbol
                ? "AUTOMATIC TRADER - FORCE CHECK"
                : "AUTOMATIC HOURLY TRADER"
        );

        console.log(
            "############################################################"
        );

        console.log(
            "Time:",
            new Date().toISOString()
        );

        console.log(
            "Selected symbols:",
            symbols
        );

        console.log(
            "IMPORTANT:",
            "ONLY SELECTED COINS ARE ALLOWED"
        );

        console.log(
            "############################################################"
        );


        // ====================================================
        // SCAN ONLY SELECTED COINS
        // ====================================================

        for (
            const symbol of symbols
        ) {

            try {

                console.log("");

                console.log(
                    "------------------------------------------------------------"
                );

                console.log(
                    "AUTOMATIC SYMBOL SCAN"
                );

                console.log(
                    "Symbol:",
                    symbol
                );

                console.log(
                    "------------------------------------------------------------"
                );


                // ------------------------------------------------
                // GET CURRENT POSITION
                // ------------------------------------------------

                const position =
                    await getCurrentPosition(
                        symbol
                    );


                console.log("");

                console.log(
                    `${symbol} CURRENT POSITION:`,
                    position.direction
                );


                // ------------------------------------------------
                // CHECK LONG
                // ------------------------------------------------

                const longCheck =
                    await checkOrderBook(
                        symbol,
                        "LONG"
                    );


                // ------------------------------------------------
                // CHECK SHORT
                // ------------------------------------------------

                const shortCheck =
                    await checkOrderBook(
                        symbol,
                        "SHORT"
                    );


                let decision =
                    "NEUTRAL";


                if (
                    longCheck.allowed &&
                    !shortCheck.allowed
                ) {

                    decision =
                        "LONG";

                } else if (
                    shortCheck.allowed &&
                    !longCheck.allowed
                ) {

                    decision =
                        "SHORT";
                }


                console.log("");

                console.log(
                    `${symbol} AUTOMATIC DECISION`
                );

                console.log(
                    "Current position:",
                    position.direction
                );

                console.log(
                    "LONG allowed:",
                    longCheck.allowed
                );

                console.log(
                    "SHORT allowed:",
                    shortCheck.allowed
                );

                console.log(
                    "Decision:",
                    decision
                );


                // ------------------------------------------------
                // NEUTRAL
                // ------------------------------------------------

                if (
                    decision ===
                    "NEUTRAL"
                ) {

                    console.log("");

                    console.log(
                        `${symbol}: NO AUTOMATIC TRADE`
                    );

                    console.log(
                        "Reason:",
                        "ORDER BOOK IS NEUTRAL"
                    );


                    results.push({

                        symbol,

                        currentPosition:
                            position.direction,

                        decision,

                        action:
                            "NONE",

                        result:
                            null
                    });


                    continue;
                }


                // ------------------------------------------------
                // PROCESS SIGNAL
                // ------------------------------------------------
                //
                // processSignal() itself checks the position and
                // performs:
                //
                // FLAT -> OPEN
                //
                // SAME DIRECTION -> NO NEW ORDER
                //
                // OPPOSITE -> CLOSE -> FLAT -> FRESH BOOK -> OPEN
                //
                // ------------------------------------------------

                const result =
                    await processSignal(
                        symbol,
                        decision
                    );


                console.log("");

                console.log(
                    `${symbol}: AUTOMATIC RESULT`
                );

                console.log(
                    pretty(
                        result
                    )
                );


                results.push({

                    symbol,

                    currentPosition:
                        position.direction,

                    decision,

                    action:
                        decision,

                    result
                });


            } catch (error) {

                console.error("");

                console.error(
                    `${symbol}: AUTOMATIC TRADER ERROR`
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


                results.push({

                    symbol,

                    success:
                        false,

                    error:
                        error.message
                });
            }
        }


        console.log("");

        console.log(
            "############################################################"
        );

        console.log(
            forcedSymbol
                ? "FORCE CHECK COMPLETE"
                : "AUTOMATIC HOURLY TRADER COMPLETE"
        );

        console.log(
            "############################################################"
        );

        console.log(
            "Selected symbols:",
            symbols.length
        );

        console.log(
            "Symbols:",
            symbols
        );

        console.log(
            "Completed:",
            new Date().toISOString()
        );

        console.log(
            "############################################################"
        );


        return {

            success:
                true,

            forced:
                Boolean(
                    forcedSymbol
                ),

            symbols,

            results
        };


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
// START AUTOMATIC HOURLY TRADER
// ============================================================

function startAutomaticTrader() {

    if (
        !AUTO_TRADING_ENABLED
    ) {

        console.log("");

        console.log(
            "AUTOMATIC TRADER:"
        );

        console.log(
            "DISABLED in config.js"
        );

        return;
    }


    if (
        !TRADING_ENABLED
    ) {

        console.log("");

        console.log(
            "AUTOMATIC TRADER:"
        );

        console.log(
            "NOT STARTED because TRADING_ENABLED=false"
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


    console.log("");

    section(
        "AUTOMATIC HOURLY TRADER STARTED"
    );

    console.log(
        "Interval:",
        `${AUTO_TRADING_INTERVAL_MS / 60000} minutes`
    );

    console.log(
        "Mode:",
        "SELECTED COIN ONLY"
    );

    console.log(
        "First automatic scan:",
        "1 interval after startup"
    );


    automaticTraderNextRun =
        new Date(
            Date.now() +
            AUTO_TRADING_INTERVAL_MS
        ).toISOString();


    automaticTraderTimer =
        setInterval(
            () => {

                runAutomaticTrader()
                    .catch(
                        error => {

                            console.error("");

                            console.error(
                                "AUTOMATIC TRADER FATAL ERROR"
                            );

                            console.error(
                                error.message
                            );
                        }
                    );

            },
            AUTO_TRADING_INTERVAL_MS
        );
}


// ============================================================
// TRADINGVIEW WEBHOOK
// ============================================================

app.post(
    "/webhook",
    async (req, res) => {

        section(
            "TRADINGVIEW WEBHOOK RECEIVED"
        );


        console.log(
            pretty(req.body)
        );


        try {

            const symbol =
                normalizeSymbol(
                    req.body?.symbol
                );


            const action =
                String(
                    req.body?.action || ""
                )
                    .trim()
                    .toUpperCase();


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
                !SUPPORTED_SYMBOLS.has(
                    symbol
                )
            ) {

                return res
                    .status(400)
                    .json({

                        success:
                            false,

                        error:
                            "Unsupported or unavailable WEEX symbol",

                        symbol
                    });
            }


            const validActions = [
                "LONG",
                "SHORT",
                "CLOSE",
                "CLOSE_LONG",
                "CLOSE_SHORT"
            ];


            if (
                !validActions.includes(
                    action
                )
            ) {

                return res
                    .status(400)
                    .json({

                        success:
                            false,

                        error:
                            "Invalid action"
                    });
            }


            // ------------------------------------------------
            // IMMEDIATE ACK
            // ------------------------------------------------

            res
                .status(200)
                .json({

                    success:
                        true,

                    accepted:
                        true,

                    symbol,

                    action,

                    message:
                        "Signal accepted for background processing."
                });


            console.log("");

            console.log(
                `WEBHOOK ACK SENT: ${symbol} ${action}`
            );


            // ------------------------------------------------
            // BACKGROUND PROCESS
            // ------------------------------------------------

            processSignal(
                symbol,
                action
            )
                .then(
                    result => {

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
                            pretty(result)
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

                return res
                    .status(500)
                    .json({

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
// MANUAL SIGNAL HANDLER
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
            !SUPPORTED_SYMBOLS.has(
                symbol
            )
        ) {

            return res
                .status(400)
                .json({

                    success:
                        false,

                    error:
                        "Invalid or unavailable WEEX symbol",

                    symbol
                });
        }


        const result =
            await processSignal(
                symbol,
                action
            );


        return res.json(
            result
        );


    } catch (error) {

        console.error("");

        console.error(
            `MANUAL ${action} ERROR`
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


        return res
            .status(500)
            .json({

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
// TEST ORDER BOOK
// ============================================================

app.get(
    "/test-orderbook",
    async (req, res) => {

        try {

            const symbol =
                normalizeSymbol(
                    req.query?.symbol
                );


            const direction =
                String(
                    req.query?.direction || ""
                )
                    .trim()
                    .toUpperCase();


            if (
                !SUPPORTED_SYMBOLS.has(
                    symbol
                )
            ) {

                return res
                    .status(400)
                    .json({

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

                return res
                    .status(400)
                    .json({

                        success:
                            false,

                        error:
                            "direction must be LONG or SHORT",

                        direction
                    });
            }


            section(
                "READ-ONLY ORDER BOOK TEST",
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
                "TRADING:",
                "NOT USED"
            );

            console.log(
                "ORDER:",
                "NEVER PLACED"
            );


            const result =
                await checkOrderBook(
                    symbol,
                    direction
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

                symbol,

                direction,

                orderBook:
                    result
            });


        } catch (error) {

            console.error("");

            console.error(
                "ORDER BOOK TEST ERROR"
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


            return res
                .status(500)
                .json({

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
// ORDER FLOW STATISTICS
// ============================================================

app.get(
    "/orderflow-stats",
    (req, res) => {

        return res.json({

            success:
                true,

            statistics:
                getOrderBookStats()
        });
    }
);


// ============================================================
// RESET ORDER FLOW STATISTICS
// ============================================================

app.post(
    "/orderflow-stats/reset",
    (req, res) => {

        resetOrderBookStats();


        console.log("");

        console.log(
            "ORDER FLOW STATISTICS RESET"
        );


        return res.json({

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
    (req, res) => {

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
                            ]?.maxOrderSize
                    })
                );


        return res.json({

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
                getStatusConfig()
                    .orderBook,

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

                selectedSymbols:
                    Array.from(
                        selectedAutoSymbols
                    ),

                selectedSymbol:
                    Array.from(
                        selectedAutoSymbols
                    )[0] || null
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
    async (req, res) => {

        try {

            await loadAllContracts();


            return res.json({

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

            return res
                .status(500)
                .json({

                    success:
                        false,

                    error:
                        error.message
                });
        }
    }
);


// ============================================================
// AUTOMATIC TRADER MANUAL / FORCE RUN
// ============================================================
//
// POST /automatic-trader/run
//
// Body:
//
// {
//     "symbol": "WIFUSDT"
// }
//
// If symbol is supplied:
//   -> force check WIFUSDT
//
// If no symbol:
//   -> check backend-selected symbol
//
// ============================================================

app.post(
    "/automatic-trader/run",
    async (req, res) => {

        if (
            !AUTO_TRADING_ENABLED
        ) {

            return res
                .status(400)
                .json({

                    success:
                        false,

                    error:
                        "Automatic trader is disabled in config.js"
                });
        }


        if (
            automaticTraderRunning
        ) {

            return res
                .status(409)
                .json({

                    success:
                        false,

                    error:
                        "Automatic trader is already running."
                });
        }


        let symbol =
            null;


        try {

            if (
                req.body?.symbol
            ) {

                symbol =
                    validateAutomaticSymbol(
                        req.body.symbol
                    );
            }


            runAutomaticTrader(
                symbol
            )
                .catch(
                    error => {

                        console.error("");

                        console.error(
                            "MANUAL AUTOMATIC TRADER ERROR"
                        );

                        console.error(
                            error.message
                        );
                    }
                );


            return res.json({

                success:
                    true,

                accepted:
                    true,

                symbol,

                message:
                    symbol
                        ? `Force check started for ${symbol}.`
                        : "Automatic trader scan started."
            });


        } catch (error) {

            return res
                .status(400)
                .json({

                    success:
                        false,

                    error:
                        error.message
                });
        }
    }
);


// ============================================================
// AUTOMATIC TRADER STATUS
// ============================================================

app.get(
    "/automatic-trader/status",
    (req, res) => {

        return res.json({

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

            selectedSymbols:
                Array.from(
                    selectedAutoSymbols
                ),

            selectedSymbol:
                Array.from(
                    selectedAutoSymbols
                )[0] || null,

            symbols:
                SUPPORTED_SYMBOLS.size
        });
    }
);


// ============================================================
// AUTOMATIC TRADER POSITIONS
// ============================================================
//
// Returns positions ONLY for the selected automatic coins.
//
// This avoids requesting 200+ position endpoints.
//
// ============================================================

app.get(
    "/automatic-trader/positions",
    async (req, res) => {

        try {

            const symbols =
                Array.from(
                    selectedAutoSymbols
                );


            const positions = [];


            for (
                const symbol of symbols
            ) {

                try {

                    const position =
                        await getCurrentPosition(
                            symbol
                        );


                    positions.push(
                        position
                    );

                } catch (error) {

                    positions.push({

                        symbol,

                        direction:
                            "ERROR",

                        quantity:
                            0,

                        error:
                            error.message
                    });
                }
            }


            return res.json({

                success:
                    true,

                symbols,

                positions
            });


        } catch (error) {

            return res
                .status(500)
                .json({

                    success:
                        false,

                    error:
                        error.message
                });
        }
    }
);


// ============================================================
// LIVE ORDER BOOK
// ============================================================

app.get(
    "/live-orderbook",
    async (req, res) => {

        try {

            const symbol =
                normalizeSymbol(
                    req.query?.symbol
                );


            if (
                !SUPPORTED_SYMBOLS.has(
                    symbol
                )
            ) {

                return res
                    .status(400)
                    .json({

                        success:
                            false,

                        error:
                            "Invalid or unavailable WEEX symbol",

                        symbol
                    });
            }


            const longCheck =
                await checkOrderBook(
                    symbol,
                    "LONG"
                );


            const shortCheck =
                await checkOrderBook(
                    symbol,
                    "SHORT"
                );


            let decision =
                "NEUTRAL";


            if (
                longCheck.allowed &&
                !shortCheck.allowed
            ) {

                decision =
                    "LONG";

            } else if (
                shortCheck.allowed &&
                !longCheck.allowed
            ) {

                decision =
                    "SHORT";
            }


            return res.json({

                success:
                    true,

                readOnly:
                    true,

                orderPlaced:
                    false,

                symbol,

                decision,

                orderBook: {

                    bidLiquidity:
                        longCheck.bidLiquidity,

                    askLiquidity:
                        longCheck.askLiquidity,

                    totalLiquidity:
                        longCheck.bidLiquidity +
                        longCheck.askLiquidity,

                    bidPercentage:
                        longCheck.bidPercentage,

                    askPercentage:
                        longCheck.askPercentage,

                    imbalance:
                        longCheck.imbalance,

                    bidAskRatio:
                        longCheck.bidAskRatio,

                    askBidRatio:
                        longCheck.askBidRatio,

                    longAllowed:
                        longCheck.allowed,

                    shortAllowed:
                        shortCheck.allowed,

                    longMinImbalance:
                        LONG_MIN_IMBALANCE,

                    shortMaxImbalance:
                        SHORT_MAX_IMBALANCE,

                    depth:
                        ORDER_BOOK_DEPTH
                }

            });


        } catch (error) {

            console.error("");

            console.error(
                "LIVE ORDER BOOK ERROR"
            );

            console.error(
                error.message
            );


            return res
                .status(500)
                .json({

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
    async (req, res) => {

        try {

            const balance =
                await getFuturesBalance();


            return res.json({

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

                    selectedSymbols:
                        Array.from(
                            selectedAutoSymbols
                        ),

                    selectedSymbol:
                        Array.from(
                            selectedAutoSymbols
                        )[0] || null
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
                    getStatusConfig()
                        .orderBook,

                orderFlowStatistics:
                    getOrderBookStats(),

                reversal:
                    "CLOSE -> CONFIRM FLAT -> FRESH ORDER BOOK -> OPEN",

                automaticStrategy:
                    "SELECTED COIN -> EVERY 1 HOUR -> ORDER BOOK -> LONG / SHORT",

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

            return res
                .status(500)
                .json({

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
    async (req, res) => {

        try {

            const symbol =
                normalizeSymbol(
                    req.query?.symbol
                );


            if (
                !SUPPORTED_SYMBOLS.has(
                    symbol
                )
            ) {

                return res
                    .status(400)
                    .json({

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


            return res.json(
                position
            );


        } catch (error) {

            return res
                .status(500)
                .json({

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
    (req, res) => {

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
            "Automatic hourly trading:",
            AUTO_TRADING_ENABLED
                ? "ENABLED"
                : "DISABLED"
        );

        console.log(
            "Automatic interval:",
            `${AUTO_TRADING_INTERVAL_MS / 60000} minutes`
        );

        console.log(
            "Automatic mode:",
            "SELECTED COIN ONLY"
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
            "Order-book filter:",
            "ENABLED"
        );

        console.log(
            "LONG:",
            "BID DOMINANCE"
        );

        console.log(
            "SHORT:",
            "ASK DOMINANCE"
        );

        console.log(
            "CLOSE:",
            "NEVER FILTERED"
        );

        console.log(
            "Order-flow statistics:",
            "ENABLED"
        );

        console.log(
            "Reversal:",
            "CLOSE -> FLAT -> FRESH ORDER BOOK -> OPEN"
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
                ? "EVERY 1 HOUR - SELECTED COIN ONLY"
                : "DISABLED"
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


                console.log("");

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
            // START AUTOMATIC TRADER
            // ------------------------------------------------

            startAutomaticTrader();


            console.log("");

            console.log(
                "READ-ONLY ORDER BOOK TEST:"
            );

            console.log(
                "GET /test-orderbook?symbol=BTCUSDT&direction=LONG"
            );

            console.log("");

            console.log(
                "ORDER FLOW STATISTICS:"
            );

            console.log(
                "GET /orderflow-stats"
            );

            console.log("");

            console.log(
                "STATUS:"
            );

            console.log(
                "GET /status"
            );

            console.log("");

            console.log(
                "AUTOMATIC TRADER STATUS:"
            );

            console.log(
                "GET /automatic-trader/status"
            );

            console.log("");

            console.log(
                "AUTOMATIC TRADER SELECTION:"
            );

            console.log(
                "POST /automatic-trader/select"
            );

            console.log("");

            console.log(
                "FORCE CHECK:"
            );

            console.log(
                "POST /automatic-trader/run"
            );

            console.log("");

            console.log(
                "AUTOMATIC POSITIONS:"
            );

            console.log(
                "GET /automatic-trader/positions"
            );

            console.log("");

            console.log(
                "Manual LONG:"
            );

            console.log(
                "POST /manual-long?symbol=BTCUSDT"
            );

            console.log("");

            console.log(
                "Manual SHORT:"
            );

            console.log(
                "POST /manual-short?symbol=BTCUSDT"
            );

            console.log("");

            console.log(
                "Manual CLOSE:"
            );

            console.log(
                "POST /manual-close?symbol=BTCUSDT"
            );

            console.log("");

            console.log(
                "Risk:"
            );

            console.log(
                `${DEFAULT_MARGIN} USDT margin / ` +
                `${DEFAULT_LEVERAGE}x / ` +
                `~${DEFAULT_MARGIN * DEFAULT_LEVERAGE} USDT notional`
            );

            console.log("");

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