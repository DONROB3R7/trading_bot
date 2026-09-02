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
// Scanner:
//     Every 1 minute
//
// History:
//     One fresh snapshot every minute
//
// FINAL DECISION:
//     ONLY when history cycle is complete
//
// Trade delay:
//     1 hour per symbol
//
// IMPORTANT:
//     The 1-hour delay does NOT stop history collection.
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

                const analysis =
                    analyzeOrderBookSnapshot(
                        snapshot
                    );


                // ------------------------------------------------
                // BUILD COMPLETE ORDER-BOOK RESULT
                // ------------------------------------------------

                const orderBookResult = {

                    symbol,

                    snapshot,

                    analysis

                };


                // ------------------------------------------------
                // CHECK WHETHER THIS SYMBOL MAY TRADE
                //
                // IMPORTANT:
                //
                // History collection ALWAYS continues.
                //
                // This only controls whether a completed cycle
                // is allowed to execute a new trade.
                // ------------------------------------------------

                const tradeAllowed =
                    symbolIsReady(symbol);


                if (!tradeAllowed) {

                    console.log(
                        `TRADE COOLDOWN ACTIVE: ${symbol}`
                    );

                    console.log(
                        "HISTORY WILL CONTINUE COLLECTING"
                    );
                }


                // ------------------------------------------------
                // PROCESS HISTORY
                //
                // processAutomaticOrderFlow() is responsible for:
                //
                // 1. Adding snapshot
                // 2. Checking cycle completion
                // 3. Making final decision only at N/N
                // 4. Executing only when allowed
                // ------------------------------------------------

                const result =
                    await processAutomaticOrderFlow(
                        symbol,
                        orderBookResult,
                        {
                            tradeAllowed
                        }
                    );


                symbolsProcessed++;


                // ------------------------------------------------
                // RESULT INFORMATION
                // ------------------------------------------------

                if (!result) {

                    console.log(
                        `AUTOMATIC NO RESULT: ${symbol}`
                    );

                    continue;
                }


                // ------------------------------------------------
                // HISTORY STILL COLLECTING
                // ------------------------------------------------

                if (
                    result.cycleComplete !== true
                ) {

                    console.log(
                        `AUTOMATIC HISTORY COLLECTING: ${symbol}`
                    );

                    continue;
                }


                // ------------------------------------------------
                // FINAL CYCLE DECISION
                // ------------------------------------------------

                console.log(
                    `FINAL CYCLE COMPLETE: ${symbol}`
                );

                console.log(
                    `FINAL DECISION: ${result.decision?.decision || result.decision}`
                );


                // ------------------------------------------------
                // ACTUAL TRADE
                //
                // Only count a trade when the automatic
                // processing explicitly says it traded.
                // ------------------------------------------------

                if (
                    result.traded === true
                ) {

                    tradesProcessed++;

                    lastProcessedSymbol.set(
                        symbol,
                        Date.now()
                    );


                    console.log(
                        `AUTOMATIC TRADE EXECUTED: ${symbol}`
                    );

                } else {

                    console.log(
                        `AUTOMATIC FINAL DECISION - NO NEW TRADE: ${symbol}`
                    );
                }


                // ------------------------------------------------
                // MAX TRADES PER SCAN
                //
                // IMPORTANT:
                //
                // We check this AFTER processing the symbol so
                // history is not accidentally stopped.
                // ------------------------------------------------

                if (
                    tradesProcessed >=
                    AUTO_TRADING_MAX_TRADES_PER_CYCLE
                ) {

                    console.log(
                        "MAX TRADES PER SCAN REACHED"
                    );

                    break;
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
// Scanner:
//     Every 1 minute
//
// History:
//     Continues every minute
//
// Trade delay:
//     1 hour per symbol
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

