require("dotenv").config();

const express = require("express");

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


const app =
    express();

app.use(
    express.json()
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
    "Statistics:",
    "ORDER BOOK PASS / BLOCK TRACKING"
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
// ORDER BOOK STATISTICS
// ============================================================

app.get(
    "/orderbook-stats",
    (req, res) => {

        try {

            const stats =
                getOrderBookStats();


            return res.json({

                success:
                    true,

                statistics:
                    stats

            });


        } catch (error) {

            console.error("");

            console.error(
                "ORDER BOOK STATS ERROR"
            );

            console.error(
                error.message
            );


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
// RESET ORDER BOOK STATISTICS
// ============================================================

app.post(
    "/orderbook-stats/reset",
    (req, res) => {

        try {

            const result =
                resetOrderBookStats();


            console.log("");

            console.log(
                "============================================================"
            );

            console.log(
                "ORDER BOOK STATISTICS RESET"
            );

            console.log(
                "============================================================"
            );


            return res.json({

                success:
                    true,

                message:
                    "Order book statistics reset.",

                statistics:
                    result

            });


        } catch (error) {

            console.error("");

            console.error(
                "ORDER BOOK STATS RESET ERROR"
            );

            console.error(
                error.message
            );


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

                orderBookStatistics:
                    getOrderBookStats(),

                reversal:
                    "CLOSE -> CONFIRM FLAT -> FRESH ORDER BOOK -> OPEN",

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
// ROOT
// ============================================================

app.get(
    "/",
    (req, res) => {

        res.json({

            status:
                "online",

            service:
                "TradingView -> WEEX V3 Server V3",

            trading:
                TRADING_ENABLED,

            mode:
                TRADING_ENABLED
                    ? "LIVE"
                    : "DISABLED",

            api:
                "WEEX V3 USDT-M Futures",

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

            orderBookStatistics:
                getOrderBookStats(),

            reversal:
                "CLOSE -> CONFIRM FLAT -> FRESH ORDER BOOK -> OPEN",

            discoveredSymbols:
                SUPPORTED_SYMBOLS.size,

            behavior:
                "LONG/SHORT automatic reversal + CLOSE_LONG/CLOSE_SHORT",

            webhookMode:
                "Immediate HTTP 200 + background processing",

            concurrency:
                "Per-symbol locks",

            statistics:
                "Order book PASS / BLOCK tracking",

            automaticSymbolDiscovery:
                true,

            endpoints: {

                webhook:
                    "POST /webhook",

                manualLong:
                    "POST /manual-long?symbol=BTCUSDT",

                manualShort:
                    "POST /manual-short?symbol=BTCUSDT",

                manualClose:
                    "POST /manual-close?symbol=BTCUSDT",

                testOrderBook:
                    "GET /test-orderbook?symbol=BTCUSDT&direction=LONG",

                orderBookStats:
                    "GET /orderbook-stats",

                resetOrderBookStats:
                    "POST /orderbook-stats/reset",

                status:
                    "GET /status",

                symbols:
                    "GET /symbols",

                position:
                    "GET /position?symbol=BTCUSDT",

                refresh:
                    "POST /refresh-symbols"
            }
        });
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
            "Statistics:",
            "PASS / BLOCK TRACKING"
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


            console.log("");

            console.log(
                "READ-ONLY ORDER BOOK TEST:"
            );

            console.log(
                "GET /test-orderbook?symbol=BTCUSDT&direction=LONG"
            );

            console.log("");

            console.log(
                "ORDER BOOK STATISTICS:"
            );

            console.log(
                "GET /orderbook-stats"
            );

            console.log("");

            console.log(
                "RESET STATISTICS:"
            );

            console.log(
                "POST /orderbook-stats/reset"
            );

            console.log("");

            console.log(
                "Example PowerShell:"
            );

            console.log(
                'Invoke-RestMethod -Method GET -Uri "http://localhost:3000/orderbook-stats"'
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