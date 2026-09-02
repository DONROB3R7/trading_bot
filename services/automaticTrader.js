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
// LATEST AUTOMATIC DECISION
//
// Stores the latest order-flow history result for each symbol.
//
// IMPORTANT:
// This does NOT process history again.
// It only remembers the result already produced by
// processAutomaticOrderFlow().
//
// Used by the dashboard history API.
// ============================================================

const latestAutomaticDecisions = new Map();


// ============================================================
// PER-SYMBOL TRADE DELAY
// ============================================================

const lastProcessedSymbol = new Map();


// ============================================================
// FINAL DECISION SESSION
//
// One session = one Server V3 runtime.
//
// When Server V3 starts:
//     SESSION 1
//
// When Server V3 is restarted:
//     New session starts from 1 again for this process.
//
// IMPORTANT:
// This is currently IN-MEMORY only.
// Persistence to disk will be added separately.
//
// Only completed FINAL decisions are recorded.
// History collection / previews are NOT recorded.
// ============================================================

const sessionStartedAt = new Date();

const decisionSession = {

    sessionNumber: 1,

    startedAt:
        sessionStartedAt.toISOString(),

    long: 0,

    short: 0,

    neutral: 0,

    total: 0,

    decisions: []
};


// ============================================================
// FINAL DECISION DEDUPLICATION
//
// A symbol can remain cycleComplete for more than one scan
// depending on the history engine behavior.
//
// We therefore remember the last completed cycle signature
// for each symbol.
//
// This prevents:
//
//     POLUSDT LONG
//     POLUSDT LONG
//     POLUSDT LONG
//
// from being counted repeatedly.
//
// A new history cycle produces a new signature.
// ============================================================

const lastRecordedCycle = new Map();


// ============================================================
// BOT RUNTIME
// ============================================================

function getBotRuntime() {

    const elapsed =
        Date.now() -
        sessionStartedAt.getTime();

    const totalSeconds =
        Math.max(
            0,
            Math.floor(elapsed / 1000)
        );

    const hours =
        Math.floor(
            totalSeconds / 3600
        );

    const minutes =
        Math.floor(
            (totalSeconds % 3600) / 60
        );

    const seconds =
        totalSeconds % 60;


    return [
        String(hours).padStart(2, "0"),
        String(minutes).padStart(2, "0"),
        String(seconds).padStart(2, "0")
    ].join(":");
}


// ============================================================
// BUILD CYCLE SIGNATURE
//
// We need a unique identifier for a completed history cycle.
//
// Preferred:
//     First snapshot timestamp
//
// Fallback:
//     Last collected timestamp
//
// Final fallback:
//     History count + latest snapshot timestamp
//
// This is ONLY for dashboard/session bookkeeping.
// It does NOT modify the history engine.
// ============================================================

function getCycleSignature(symbol, result) {

    const normalizedSymbol =
        String(symbol)
            .trim()
            .toUpperCase();


    // processAutomaticOrderFlow() returns the
    // order-flow history inside result.decision.
    const decision =
        result?.decision || result;


    const history =
        decision?.history;


    const snapshots =
        Array.isArray(history?.snapshots)
            ? history.snapshots
            : [];


    // --------------------------------------------------------
    // PREFERRED:
    // First snapshot of the completed cycle
    // --------------------------------------------------------

    if (snapshots.length > 0) {

        const firstSnapshot =
            snapshots[0];

        const firstTimestamp =
            firstSnapshot?.timestamp ||
            firstSnapshot?.collectedAt ||
            firstSnapshot?.time ||
            null;


        if (firstTimestamp) {

            return (
                `${normalizedSymbol}:` +
                `FIRST:${String(firstTimestamp)}`
            );
        }
    }


    // --------------------------------------------------------
    // FALLBACK:
    // Last snapshot / latest snapshot
    // --------------------------------------------------------

    const lastCollectedAt =
        history?.lastCollectedAt ||
        decision?.latestSnapshot?.timestamp ||
        decision?.latestSnapshot?.collectedAt ||
        null;


    if (lastCollectedAt) {

        return (
            `${normalizedSymbol}:` +
            `LAST:${String(lastCollectedAt)}`
        );
    }


    // --------------------------------------------------------
    // FINAL FALLBACK
    // --------------------------------------------------------

    return (
        `${normalizedSymbol}:` +
        `COUNT:${snapshots.length}:` +
        `LATEST:${JSON.stringify(
            decision?.latestSnapshot || null
        )}`
    );
}


// ============================================================
// RECORD FINAL DECISION
//
// IMPORTANT:
//
// This function records ONLY:
//
//     cycleComplete === true
//
// AND:
//
//     LONG / SHORT / NEUTRAL
//
// The dashboard preview while history is collecting is NEVER
// recorded here.
//
// Each completed cycle is counted only once.
// ============================================================

function recordFinalDecision(
    symbol,
    result
) {

    if (
        !result ||
        result.cycleComplete !== true
    ) {
        return false;
    }


    const rawDecision =
        result.decision?.decision ||
        result.decision;


    if (!rawDecision) {
        return false;
    }


    const decision =
        String(rawDecision)
            .trim()
            .toUpperCase();


    if (
        decision !== "LONG" &&
        decision !== "SHORT" &&
        decision !== "NEUTRAL"
    ) {

        return false;
    }


    const normalizedSymbol =
        String(symbol)
            .trim()
            .toUpperCase();


    const cycleSignature =
        getCycleSignature(
            normalizedSymbol,
            result
        );


    const previousSignature =
        lastRecordedCycle.get(
            normalizedSymbol
        );


    // --------------------------------------------------------
    // ALREADY RECORDED
    // --------------------------------------------------------

    if (
        previousSignature ===
        cycleSignature
    ) {

        return false;
    }


    // --------------------------------------------------------
    // REMEMBER THIS COMPLETED CYCLE
    // --------------------------------------------------------

    lastRecordedCycle.set(
        normalizedSymbol,
        cycleSignature
    );


    // --------------------------------------------------------
    // CREATE SESSION EVENT
    // --------------------------------------------------------

    const event = {

        timestamp:
            new Date().toISOString(),

        symbol:
            normalizedSymbol,

        decision

    };


    decisionSession.decisions.push(
        event
    );


    // --------------------------------------------------------
    // UPDATE COUNTERS
    // --------------------------------------------------------

    if (decision === "LONG") {

        decisionSession.long++;

    } else if (decision === "SHORT") {

        decisionSession.short++;

    } else if (decision === "NEUTRAL") {

        decisionSession.neutral++;
    }


    decisionSession.total++;


    // --------------------------------------------------------
    // LOG
    // --------------------------------------------------------

    console.log("");

    console.log(
        "============================================================"
    );

    console.log(
        "FINAL DECISION SESSION EVENT"
    );

    console.log(
        "============================================================"
    );

    console.log(
        "SESSION:",
        decisionSession.sessionNumber
    );

    console.log(
        "SYMBOL:",
        normalizedSymbol
    );

    console.log(
        "FINAL DECISION:",
        decision
    );

    console.log(
        "SESSION TOTAL:",
        decisionSession.total
    );

    console.log(
        "LONG:",
        decisionSession.long
    );

    console.log(
        "SHORT:",
        decisionSession.short
    );

    console.log(
        "NEUTRAL:",
        decisionSession.neutral
    );

    console.log(
        "============================================================"
    );

    console.log("");


    return true;
}


// ============================================================
// GET FINAL DECISION SESSION
//
// Dashboard uses this.
//
// Returns a COPY so the dashboard cannot accidentally modify
// the internal session state.
// ============================================================

function getFinalDecisionSession() {

    return {

        sessionNumber:
            decisionSession.sessionNumber,

        startedAt:
            decisionSession.startedAt,

        runtime:
            getBotRuntime(),

        long:
            decisionSession.long,

        short:
            decisionSession.short,

        neutral:
            decisionSession.neutral,

        total:
            decisionSession.total,

        decisions:
            decisionSession.decisions.map(
                event => ({
                    ...event
                })
            )
    };
}


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
                // SAVE LATEST DECISION FOR DASHBOARD
                //
                // IMPORTANT:
                //
                // We store the EXACT result returned by the
                // working order-flow history engine.
                //
                // We DO NOT call processAutomaticOrderFlow()
                // again.
                //
                // We DO NOT collect another snapshot.
                // ------------------------------------------------

                if (
                    result?.decision
                ) {

                    latestAutomaticDecisions.set(
                        symbol,
                        result.decision
                    );
                }


                // ------------------------------------------------
                // FINAL DECISION SESSION TRACKER
                //
                // IMPORTANT:
                //
                // This is completely separate from trading.
                //
                // Only a completed history cycle is recorded.
                //
                // Collection previews such as:
                //
                //     17/20
                //     FINAL DECISION: NEUTRAL
                //
                // are NOT recorded.
                // ------------------------------------------------

                if (
                    result?.cycleComplete === true
                ) {

                    recordFinalDecision(
                        symbol,
                        result
                    );
                }


                // ------------------------------------------------
                // HISTORY STILL COLLECTING
                // ------------------------------------------------

                if (
                    !result
                ) {

                    console.log(
                        `AUTOMATIC NO RESULT: ${symbol}`
                    );

                    continue;
                }


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

    console.log(
        "FINAL DECISION SESSION STARTED"
    );

    console.log(
        "SESSION:",
        decisionSession.sessionNumber
    );

    console.log(
        "SESSION START:",
        decisionSession.startedAt
    );
}


// ============================================================
// GET LATEST AUTOMATIC DECISION
//
// Dashboard uses this.
//
// IMPORTANT:
// No new order-book request.
// No new history snapshot.
// No trading.
//
// It simply returns the latest result already generated
// by processAutomaticOrderFlow().
// ============================================================

function getLatestAutomaticDecision(symbol) {

    if (!symbol) {
        return null;
    }

    return (
        latestAutomaticDecisions.get(
            String(symbol).trim().toUpperCase()
        ) ||
        null
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
            AUTO_TRADING_SYMBOL_DELAY_MS,

        session:
            getFinalDecisionSession()
    };
}


// ============================================================
// EXPORTS
// ============================================================

module.exports = {

    runAutomaticTrader,

    startAutomaticTrader,

    getAutomaticTraderStatus,

    getLatestAutomaticDecision,

    getFinalDecisionSession
};