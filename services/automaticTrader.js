const {
    AUTO_TRADING_ENABLED,
    AUTO_TRADING_INTERVAL_MS,
    AUTO_TRADING_MAX_TRADES_PER_CYCLE,
    AUTO_TRADING_SYMBOL_DELAY_MS
} = require("../config/config");

const {
    getMultiDepthSnapshot,
    analyzeOrderBookSnapshot
} = require("../filters/orderBook");

const {
    processAutomaticOrderFlow
} = require("../trading/trading");

const {
    HISTORY_INTERVAL_MS
} = require("../filters/orderFlowHistory");

const {
    managedList
} = require("./managedSymbols");


// ============================================================
// AUTOMATIC TRADER STATE
// ============================================================

let automaticTraderRunning = false;
let automaticTraderTimer = null;

let automaticTraderLastRun = null;
let automaticTraderNextRun = null;


// ============================================================
// PER-SYMBOL TRADE DELAY
//
// This is the IMPORTANT 1-hour cooldown.
//
// The scanner still runs every minute.
// A symbol can only create a new automatic trade
// once this delay has passed.
// ============================================================

const lastProcessedSymbol = new Map();


// ============================================================
// CHECK SYMBOL TRADE DELAY
// ============================================================

function symbolIsReady(symbol) {

    const lastTrade =
        lastProcessedSymbol.get(symbol);

    if (!lastTrade) {
        return true;
    }

    const elapsed =
        Date.now() - lastTrade;

    return (
        elapsed >=
        AUTO_TRADING_SYMBOL_DELAY_MS
    );
}


// ============================================================
// AUTOMATIC TRADER RUN
//
// IMPORTANT:
//
// This function runs every minute.
//
// History needs one fresh order-book snapshot
// every minute.
//
// The 1-hour delay is handled separately
// by lastProcessedSymbol.
// ============================================================

async function runAutomaticTrader() {

    if (automaticTraderRunning) {

        console.log(
            "AUTOMATIC TRADER ALREADY RUNNING"
        );

        return {
            success: false,
            reason: "ALREADY_RUNNING"
        };
    }


    if (!AUTO_TRADING_ENABLED) {

        console.log(
            "AUTOMATIC TRADER DISABLED"
        );

        return {
            success: false,
            reason: "DISABLED"
        };
    }


    automaticTraderRunning = true;

    automaticTraderLastRun =
        new Date().toISOString();


    let tradesProcessed = 0;
    let symbolsProcessed = 0;


    try {

        const symbols =
            managedList();


        console.log("");

        console.log(
            "============================================================"
        );

        console.log(
            "AUTOMATIC ORDER-FLOW SCAN"
        );

        console.log(
            "============================================================"
        );

        console.log(
            "MANAGED SYMBOLS:",
            symbols.length
        );

        console.log(
            "HISTORY INTERVAL:",
            HISTORY_INTERVAL_MS,
            "ms"
        );

        console.log(
            "TRADE DELAY:",
            AUTO_TRADING_SYMBOL_DELAY_MS,
            "ms"
        );

        console.log(
            "MAX TRADES:",
            AUTO_TRADING_MAX_TRADES_PER_CYCLE
        );


        // ----------------------------------------------------
        // PROCESS MANAGED SYMBOLS
        // ----------------------------------------------------

        for (const symbol of symbols) {

            if (
                tradesProcessed >=
                AUTO_TRADING_MAX_TRADES_PER_CYCLE
            ) {

                console.log(
                    "MAX TRADES PER SCAN REACHED"
                );

                break;
            }


            try {

                console.log("");

                console.log(
                    `AUTOMATIC ORDER FLOW: ${symbol}`
                );


                // ------------------------------------------------
                // FRESH ORDER BOOK
                // ------------------------------------------------

                const snapshot =
                    await getMultiDepthSnapshot(
                        symbol
                    );


                // ------------------------------------------------
                // ANALYZE BOTH DIRECTIONS
                // ------------------------------------------------

                const orderBookResult =
                    analyzeOrderBookSnapshot(
                        snapshot
                    );


                // ------------------------------------------------
                // PROCESS HISTORY + FINAL DECISION
                //
                // This function decides whether enough
                // history exists to trade.
                // ------------------------------------------------

                const result =
                    await processAutomaticOrderFlow(
                        symbol,
                        orderBookResult
                    );


                symbolsProcessed++;


                // ------------------------------------------------
                // TRADE DETECTED
                //
                // Only start the 1-hour symbol delay when
                // LONG or SHORT was actually decided.
                // ------------------------------------------------

                if (
                    result &&
                    (
                        result.decision === "LONG" ||
                        result.decision === "SHORT"
                    )
                ) {

                    tradesProcessed++;

                    lastProcessedSymbol.set(
                        symbol,
                        Date.now()
                    );


                    console.log(
                        `AUTOMATIC TRADE DECISION: ${symbol} ${result.decision}`
                    );

                } else {

                    console.log(
                        `AUTOMATIC NO TRADE: ${symbol}`
                    );
                }


            } catch (error) {

                console.error(
                    `AUTOMATIC TRADER ERROR ${symbol}:`,
                    error.message
                );
            }
        }


        console.log("");

        console.log(
            "AUTOMATIC ORDER-FLOW SCAN COMPLETE"
        );

        console.log(
            "SYMBOLS PROCESSED:",
            symbolsProcessed
        );

        console.log(
            "TRADES PROCESSED:",
            tradesProcessed
        );


        return {

            success: true,

            symbolsProcessed,

            tradesProcessed,

            managedSymbols:
                symbols.length
        };


    } finally {

        automaticTraderRunning = false;


        automaticTraderNextRun =
            new Date(
                Date.now() +
                HISTORY_INTERVAL_MS
            ).toISOString();
    }
}


// ============================================================
// START AUTOMATIC TRADER
//
// Scanner = every 1 minute.
//
// DO NOT use the 1-hour trade delay here.
//
// The 1-hour delay is per symbol.
// ============================================================

function startAutomaticTrader() {

    if (automaticTraderTimer) {

        clearInterval(
            automaticTraderTimer
        );
    }


    automaticTraderTimer =
        setInterval(
            () => {

                runAutomaticTrader()
                    .catch(
                        error => {

                            console.error(
                                "AUTOMATIC TRADER TIMER ERROR:",
                                error.message
                            );

                        }
                    );

            },
            HISTORY_INTERVAL_MS
        );


    automaticTraderNextRun =
        new Date(
            Date.now() +
            HISTORY_INTERVAL_MS
        ).toISOString();


    console.log(
        "AUTOMATIC TRADER STARTED"
    );

    console.log(
        "SCAN INTERVAL:",
        HISTORY_INTERVAL_MS,
        "ms"
    );

    console.log(
        "SYMBOL TRADE DELAY:",
        AUTO_TRADING_SYMBOL_DELAY_MS,
        "ms"
    );
}


// ============================================================
// STATUS
// ============================================================

function getAutomaticTraderStatus() {

    return {

        enabled:
            AUTO_TRADING_ENABLED,

        running:
            automaticTraderRunning,

        lastRun:
            automaticTraderLastRun,

        nextRun:
            automaticTraderNextRun,

        interval:
            HISTORY_INTERVAL_MS,

        historyInterval:
            HISTORY_INTERVAL_MS,

        tradeDelay:
            AUTO_TRADING_SYMBOL_DELAY_MS,

        configTradeInterval:
            AUTO_TRADING_INTERVAL_MS,

        maxTradesPerCycle:
            AUTO_TRADING_MAX_TRADES_PER_CYCLE,

        symbolDelay:
            AUTO_TRADING_SYMBOL_DELAY_MS
    };
}


// ============================================================
// EXPORTS
// ============================================================

module.exports = {

    runAutomaticTrader,

    startAutomaticTrader,

    getAutomaticTraderStatus
};