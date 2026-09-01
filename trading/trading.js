const {
    TRADING_ENABLED,
    DEFAULT_MARGIN,
    DEFAULT_LEVERAGE,
    REQUIRED_MARGIN_MODE,

    ORDER_BOOK_FILTER_ENABLED,
    ORDER_BOOK_DEPTH,

    LONG_MIN_IMBALANCE,
    SHORT_MAX_IMBALANCE,

    MIN_BID_ASK_RATIO,
    MIN_ASK_BID_RATIO,

    ORDER_BOOK_CONFIRMATION_REQUIRED,
} = require("../config/config");


const {
    SUPPORTED_SYMBOLS,

    normalizeSymbol,
    getSymbolSettings,
    getContract,

    getFuturesBalance,
    getPrice,

    getCurrentPosition,

    ensureLeverage,
    calculatePosition,
    printPosition,

    placeOpenOrder,
    closePosition,
    waitForPosition,

    checkMultiDepthOrderBookSupport,
} = require("../weex/weex");


const {
    processOrderFlowHistory
} = require("../filters/orderFlowHistory");


// ============================================================
// SYMBOL LOCKS
// ============================================================

const symbolLocks =
    new Map();


// ============================================================
// SLEEP
// ============================================================

function sleep(ms) {

    return new Promise(
        resolve =>
            setTimeout(resolve, ms)
    );

}


// ============================================================
// ACQUIRE TRADING LOCK
// ============================================================

async function acquireTradingLock(symbol) {

    symbol =
        normalizeSymbol(symbol);

    while (
        symbolLocks.get(symbol)
    ) {

        await sleep(25);

    }

    symbolLocks.set(
        symbol,
        true
    );

}


// ============================================================
// RELEASE TRADING LOCK
// ============================================================

function releaseTradingLock(symbol) {

    symbolLocks.delete(
        normalizeSymbol(symbol)
    );

}


// ============================================================
// ORDER BOOK ENTRY CONFIRMATION
// ============================================================
//
// OLD / MANUAL ENTRY FILTER
//
// This is kept for normal processSignal() usage.
//
// Automatic order-flow trading can skip this check because
// orderFlowHistory.js already performed the complete decision.
//
// Current depths:
//
//     15
//     20
//     30
//     60
//
// Required:
//
//     3 OF 4
//
// ============================================================

async function checkEntryOrderBook(
    symbol,
    direction
) {

    if (
        direction !== "LONG" &&
        direction !== "SHORT"
    ) {

        throw new Error(
            `Invalid entry direction: ${direction}`
        );

    }


    // --------------------------------------------------------
    // FILTER DISABLED
    // --------------------------------------------------------

    if (
        !ORDER_BOOK_FILTER_ENABLED
    ) {

        console.log("");
        console.log(
            `${symbol}: ORDER BOOK FILTER DISABLED`
        );

        return {

            allowed: true,

            confirmationPassed: true,

            confirmationCount: 4,

            required:
                ORDER_BOOK_CONFIRMATION_REQUIRED,

            reason:
                "ORDER_BOOK_FILTER_DISABLED",

        };

    }


    // --------------------------------------------------------
    // CURRENT DEPTHS
    // --------------------------------------------------------

    const depths = [
        15,
        20,
        30,
        60,
    ];


    const result =
        await checkMultiDepthOrderBookSupport(
            symbol,
            direction,
            depths
        );


    // --------------------------------------------------------
    // DISPLAY RESULT
    // --------------------------------------------------------

    console.log("");

    console.log(
        "============================================================"
    );

    console.log(
        `ORDER BOOK ENTRY CONFIRMATION: ${symbol}`
    );

    console.log(
        "Direction:",
        direction
    );

    console.log(
        "15 Levels:",
        result.depth15?.allowed
            ? "PASS"
            : "FAIL"
    );

    console.log(
        "20 Levels:",
        result.depth20?.allowed
            ? "PASS"
            : "FAIL"
    );

    console.log(
        "30 Levels:",
        result.depth30?.allowed
            ? "PASS"
            : "FAIL"
    );

    console.log(
        "60 Levels:",
        result.depth60?.allowed
            ? "PASS"
            : "FAIL"
    );

    console.log(
        "CONFIRMATIONS:",
        `${result.confirmationCount}/4`
    );

    console.log(
        "REQUIRED:",
        `${ORDER_BOOK_CONFIRMATION_REQUIRED}/4`
    );

    console.log(
        "ENTRY:",
        result.confirmationPassed
            ? "ALLOWED"
            : "BLOCKED"
    );

    console.log(
        "============================================================"
    );


    // --------------------------------------------------------
    // BLOCK
    // --------------------------------------------------------

    if (
        !result.confirmationPassed
    ) {

        console.log("");

        console.log(
            `ENTRY BLOCKED: ${symbol} ${direction}`
        );

        console.log(
            `Order book confirmation: ${result.confirmationCount}/4`
        );

        console.log(
            `Required confirmation: ${ORDER_BOOK_CONFIRMATION_REQUIRED}/4`
        );

    }


    return result;

}


// ============================================================
// OPEN MARKET POSITION
// ============================================================
//
// options.skipOrderBook = true
//
// Used by the new 10-minute history system.
//
// When false:
//
//     Fresh order-book check
//
// When true:
//
//     History already approved the trade
//
// ============================================================

async function openMarketPosition(
    symbol,
    direction,
    options = {}
) {

    if (
        direction !== "LONG" &&
        direction !== "SHORT"
    ) {

        throw new Error(
            `Invalid direction: ${direction}`
        );

    }


    symbol =
        normalizeSymbol(symbol);


    getSymbolSettings(
        symbol
    );


    // ========================================================
    // ORDER BOOK CHECK
    // ========================================================

    let orderBookCheck = {

        allowed: true,

        confirmationPassed: true,

        confirmationCount: 4,

        required:
            ORDER_BOOK_CONFIRMATION_REQUIRED,

        reason:
            "ORDER_FLOW_HISTORY_CONFIRMED",

    };


    // --------------------------------------------------------
    // NORMAL ENTRY
    // --------------------------------------------------------

    if (
        !options.skipOrderBook
    ) {

        orderBookCheck =
            await checkEntryOrderBook(
                symbol,
                direction
            );

    } else {

        console.log("");

        console.log(
            `${symbol}: ORDER BOOK CHECK SKIPPED`
        );

        console.log(
            "Reason:",
            "10-MINUTE ORDER FLOW HISTORY ALREADY CONFIRMED"
        );

    }


    // ========================================================
    // BLOCK
    // ========================================================

    if (
        !orderBookCheck.allowed
    ) {

        console.log("");

        console.log(
            "############################################################"
        );

        console.log(
            "ORDER BLOCKED"
        );

        console.log(
            "############################################################"
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
            "Reason:",
            orderBookCheck.reason
        );

        console.log(
            "############################################################"
        );


        return {

            success: false,

            blocked: true,

            reason:
                "ORDER_BOOK_3_OF_4_NOT_CONFIRMED",

            orderBook:
                orderBookCheck,

        };

    }


    // ========================================================
    // ORDER BOOK PASSED
    // ========================================================

    console.log("");

    console.log(
        `${symbol}: ENTRY CONFIRMED`
    );

    console.log(
        `Direction: ${direction}`
    );


    // ========================================================
    // BALANCE
    // ========================================================

    const balance =
        await getFuturesBalance();


    if (
        balance.available <
        DEFAULT_MARGIN
    ) {

        throw new Error(
            `${symbol}: insufficient available balance. ` +
            `Available ${balance.available} USDT, ` +
            `required approximately ${DEFAULT_MARGIN} USDT`
        );

    }


    // ========================================================
    // PRICE
    // ========================================================

    const price =
        await getPrice(
            symbol
        );


    // ========================================================
    // POSITION SIZE
    // ========================================================

    const calculation =
        calculatePosition(
            symbol,
            price
        );


    printPosition(
        symbol,
        price,
        calculation
    );


    // ========================================================
    // LEVERAGE
    // ========================================================

    await ensureLeverage(
        symbol
    );


    // ========================================================
    // OPEN MARKET ORDER
    // ========================================================

    console.log("");

    console.log(
        "============================================================"
    );

    console.log(
        "OPEN MARKET ORDER"
    );

    console.log(
        "============================================================"
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
        "Side:",
        direction === "LONG"
            ? "BUY"
            : "SELL"
    );

    console.log(
        "Position side:",
        direction
    );

    console.log(
        "Quantity:",
        calculation.quantity
    );

    console.log(
        "Step size:",
        getContract(symbol).stepSize
    );

    console.log(
        "Entry confirmation:",
        options.skipOrderBook
            ? "10-MINUTE HISTORY"
            : `${orderBookCheck.confirmationCount}/4`
    );


    const result =
        await placeOpenOrder(
            symbol,
            direction,
            calculation
        );


    console.log("");

    console.log(
        "OPEN ORDER RESPONSE:"
    );

    console.log(
        JSON.stringify(
            result,
            null,
            2
        )
    );


    return {

        success: true,

        blocked: false,

        result,

        calculation,

        orderBook:
            orderBookCheck,

    };

}


// ============================================================
// PROCESS SIGNAL
// ============================================================
//
// This remains the main execution function.
//
// options.skipOrderBook:
//
//     false = normal fresh order-book check
//
//     true = history system already approved the entry
//
// CLOSE is NEVER order-book filtered.
//
// ============================================================

async function processSignal(
    symbol,
    action,
    options = {}
) {

    symbol =
        normalizeSymbol(
            symbol
        );


    action =
        String(
            action || ""
        )
            .trim()
            .toUpperCase();


    getSymbolSettings(
        symbol
    );


    // ========================================================
    // VALID ACTION
    // ========================================================

    if (
        ![
            "LONG",
            "SHORT",
            "CLOSE",
            "CLOSE_LONG",
            "CLOSE_SHORT",
        ].includes(action)
    ) {

        throw new Error(
            "Action must be LONG, SHORT, CLOSE, CLOSE_LONG or CLOSE_SHORT."
        );

    }


    // ========================================================
    // TRADING SWITCH
    // ========================================================

    if (
        !TRADING_ENABLED
    ) {

        console.log(
            "TRADING DISABLED."
        );


        return {

            success: false,

            reason:
                "TRADING_DISABLED",

            symbol,

            action,

        };

    }


    // ========================================================
    // PER-SYMBOL LOCK
    // ========================================================

    await acquireTradingLock(
        symbol
    );


    try {

        console.log("");

        console.log(
            "############################################################"
        );

        console.log(
            "PROCESSING SIGNAL"
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
            "Lock:",
            `${symbol} ONLY`
        );

        console.log(
            "############################################################"
        );


        // ====================================================
        // ALWAYS READ LIVE WEEX POSITION
        // ====================================================

        const current =
            await getCurrentPosition(
                symbol
            );


        console.log("");

        console.log(
            `${symbol}: LIVE POSITION =`,
            current.direction
        );


        // ====================================================
        // CLOSE / CLOSE_LONG / CLOSE_SHORT
        // ====================================================

        if (
            action === "CLOSE" ||
            action === "CLOSE_LONG" ||
            action === "CLOSE_SHORT"
        ) {


            // ------------------------------------------------
            // ALREADY FLAT
            // ------------------------------------------------

            if (
                current.direction === "FLAT"
            ) {

                console.log(
                    `${symbol}: already FLAT. Nothing to close.`
                );


                return {

                    success: true,

                    symbol,

                    action:
                        "ALREADY_FLAT",

                };

            }


            // ------------------------------------------------
            // CLOSE_LONG SAFETY CHECK
            // ------------------------------------------------

            if (
                action === "CLOSE_LONG" &&
                current.direction !== "LONG"
            ) {

                console.log(
                    `${symbol}: CLOSE_LONG received but current ` +
                    `position is ${current.direction}. No action.`
                );


                return {

                    success: true,

                    symbol,

                    action:
                        "NO_ACTION",

                    reason:
                        `CLOSE_LONG_RECEIVED_BUT_POSITION_IS_${current.direction}`,

                    position:
                        current,

                };

            }


            // ------------------------------------------------
            // CLOSE_SHORT SAFETY CHECK
            // ------------------------------------------------

            if (
                action === "CLOSE_SHORT" &&
                current.direction !== "SHORT"
            ) {

                console.log(
                    `${symbol}: CLOSE_SHORT received but current ` +
                    `position is ${current.direction}. No action.`
                );


                return {

                    success: true,

                    symbol,

                    action:
                        "NO_ACTION",

                    reason:
                        `CLOSE_SHORT_RECEIVED_BUT_POSITION_IS_${current.direction}`,

                    position:
                        current,

                };

            }


            // ------------------------------------------------
            // CLOSE
            // ------------------------------------------------

            console.log("");

            console.log(
                `${symbol}: closing ${current.direction}`
            );

            console.log(
                "Order book filter:",
                "NOT APPLIED"
            );


            const closeResult =
                await closePosition(
                    current
                );


            // ------------------------------------------------
            // CONFIRM FLAT
            // ------------------------------------------------

            const flat =
                await waitForPosition(
                    symbol,
                    "FLAT"
                );


            if (
                !flat
            ) {

                throw new Error(
                    `${symbol}: WEEX did not confirm position closed.`
                );

            }


            console.log(
                `${symbol}: CLOSE CONFIRMED`
            );


            return {

                success: true,

                symbol,

                action:
                    action === "CLOSE_LONG"
                        ? "CLOSED_LONG"
                        : action === "CLOSE_SHORT"
                            ? "CLOSED_SHORT"
                            : "CLOSED",

                result:
                    closeResult,

            };

        }


        // ====================================================
        // SAME DIRECTION
        // ====================================================

        if (
            current.direction ===
            action
        ) {

            console.log(
                `${symbol}: already ${action}. No order.`
            );


            return {

                success: true,

                symbol,

                action:
                    "NO_ACTION",

                reason:
                    `ALREADY_${action}`,

                position:
                    current,

            };

        }


        // ====================================================
        // REVERSAL
        // ====================================================

        if (
            current.direction !== "FLAT" &&
            current.direction !== action
        ) {

            console.log("");

            console.log(
                `${symbol}: REVERSING`
            );

            console.log(
                "Current:",
                current.direction
            );

            console.log(
                "New:",
                action
            );


            // ------------------------------------------------
            // CLOSE OLD POSITION
            // ------------------------------------------------

            console.log("");

            console.log(
                `${symbol}: CLOSING OLD POSITION`
            );

            console.log(
                "Order book filter:",
                "NOT APPLIED"
            );


            const closeResult =
                await closePosition(
                    current
                );


            // ------------------------------------------------
            // CONFIRM FLAT
            // ------------------------------------------------

            const flat =
                await waitForPosition(
                    symbol,
                    "FLAT"
                );


            if (
                !flat
            ) {

                throw new Error(
                    `${symbol}: old position did not close.`
                );

            }


            console.log("");

            console.log(
                `${symbol}: OLD POSITION CLOSED`
            );


            // ------------------------------------------------
            // OPEN NEW DIRECTION
            // ------------------------------------------------

            console.log("");

            console.log(
                `${symbol}: PREPARING NEW ${action}`
            );


            if (
                options.skipOrderBook
            ) {

                console.log(
                    "Entry confirmation:",
                    "10-MINUTE ORDER FLOW HISTORY"
                );

            } else {

                console.log(
                    "Entry confirmation:",
                    "FRESH 15 / 20 / 30 / 60"
                );

            }


            const openResult =
                await openMarketPosition(
                    symbol,
                    action,
                    options
                );


            // ------------------------------------------------
            // NEW ENTRY BLOCKED
            // ------------------------------------------------

            if (
                openResult.blocked
            ) {

                console.log("");

                console.log(
                    `${symbol}: REVERSAL OPEN BLOCKED`
                );

                console.log(
                    `${symbol}: CURRENT POSITION IS FLAT`
                );


                return {

                    success: false,

                    symbol,

                    action:
                        `REVERSAL_TO_${action}_BLOCKED`,

                    reason:
                        openResult.reason,

                    close:
                        closeResult,

                    open:
                        openResult,

                };

            }


            // ------------------------------------------------
            // CONFIRM NEW POSITION
            // ------------------------------------------------

            const verified =
                await waitForPosition(
                    symbol,
                    action
                );


            if (
                !verified
            ) {

                throw new Error(
                    `${symbol}: WEEX did not confirm ${action} after reversal.`
                );

            }


            console.log("");

            console.log(
                `${symbol}: REVERSAL CONFIRMED`
            );


            return {

                success: true,

                symbol,

                action:
                    `REVERSED_TO_${action}`,

                close:
                    closeResult,

                open:
                    openResult,

                position:
                    await getCurrentPosition(
                        symbol
                    ),

            };

        }


        // ====================================================
        // FLAT -> NEW ENTRY
        // ====================================================

        console.log("");

        console.log(
            `${symbol}: FLAT -> ${action}`
        );


        if (
            options.skipOrderBook
        ) {

            console.log(
                "Using 10-minute order-flow history."
            );

        } else {

            console.log(
                "Running fresh 3-of-4 order-book confirmation."
            );

        }


        const openResult =
            await openMarketPosition(
                symbol,
                action,
                options
            );


        // ====================================================
        // ENTRY BLOCKED
        // ====================================================

        if (
            openResult.blocked
        ) {

            console.log("");

            console.log(
                `${symbol}: ENTRY BLOCKED`
            );

            console.log(
                "Direction:",
                action
            );

            console.log(
                "Reason:",
                openResult.reason
            );


            return {

                success: false,

                symbol,

                action:
                    "ENTRY_BLOCKED",

                reason:
                    openResult.reason,

                orderBook:
                    openResult.orderBook,

            };

        }


        // ====================================================
        // CONFIRM OPEN POSITION
        // ====================================================

        const verified =
            await waitForPosition(
                symbol,
                action
            );


        if (
            !verified
        ) {

            throw new Error(
                `${symbol}: WEEX did not confirm ${action} after opening.`
            );

        }


        console.log("");

        console.log(
            `${symbol}: ${action} OPEN CONFIRMED`
        );


        return {

            success: true,

            symbol,

            action:
                `OPENED_${action}`,

            result:
                openResult,

            position:
                await getCurrentPosition(
                    symbol
                ),

        };


    } finally {

        releaseTradingLock(
            symbol
        );

    }

}


// ============================================================
// AUTOMATIC ORDER-FLOW TRADING
// ============================================================
//
// New system:
//
//     200 LEVEL
//          +
//     15 / 20 / 30 / 60
//          +
//     10 MIN HISTORY
//          ↓
//     FINAL DECISION
//
// No TradingView.
//
// No second order-book check.
//
// ============================================================

async function processAutomaticOrderFlow(
    symbol,
    orderBookResult
) {

    symbol =
        normalizeSymbol(
            symbol
        );


    // --------------------------------------------------------
    // CREATE / UPDATE HISTORY
    // --------------------------------------------------------

    const decision =
        processOrderFlowHistory(
            symbol,
            orderBookResult
        );


    // --------------------------------------------------------
    // DISPLAY
    // --------------------------------------------------------

    console.log("");

    console.log(
        "============================================================"
    );

    console.log(
        `ORDER FLOW HISTORY: ${symbol}`
    );

    console.log(
        "============================================================"
    );

    console.log(
        "CURRENT 200 TREND:",
        decision.current.trend200
    );

    console.log(
        "CURRENT TRIGGER:",
        decision.current.trigger
    );

    console.log(
        "TREND HISTORY:",
        `${decision.trend200.longCount} LONG / ` +
        `${decision.trend200.shortCount} SHORT / ` +
        `${decision.trend200.neutralCount} NEUTRAL`
    );

    console.log(
        "TREND LONG:",
        `${decision.trend200.longPercent}%`
    );

    console.log(
        "TREND SHORT:",
        `${decision.trend200.shortPercent}%`
    );

    console.log(
        "TRIGGER HISTORY:",
        `${decision.triggerHistory.longCount} LONG / ` +
        `${decision.triggerHistory.shortCount} SHORT / ` +
        `${decision.triggerHistory.neutralCount} NEUTRAL`
    );

    console.log(
        "TRIGGER LONG:",
        `${decision.triggerHistory.longPercent}%`
    );

    console.log(
        "TRIGGER SHORT:",
        `${decision.triggerHistory.shortPercent}%`
    );

    console.log(
        "HISTORY:",
        `${decision.history.snapshots}/10`
    );

    console.log(
        "FINAL DECISION:",
        decision.decision
    );

    console.log(
        "REASON:",
        decision.reason
    );

    console.log(
        "============================================================"
    );


    // --------------------------------------------------------
    // NEUTRAL
    // --------------------------------------------------------

    if (
        decision.decision === "NEUTRAL"
    ) {

        console.log(
            `${symbol}: NEUTRAL - NO TRADE`
        );


        return {

            success: true,

            symbol,

            action:
                "NEUTRAL",

            traded:
                false,

            decision,

        };

    }


    // --------------------------------------------------------
    // PROCESS REAL TRADE
    //
    // IMPORTANT:
    //
    // skipOrderBook = true
    //
    // Because the history system already checked the
    // order book.
    // --------------------------------------------------------

    const result =
        await processSignal(
            symbol,
            decision.decision,
            {
                skipOrderBook: true
            }
        );


    return {

        success:
            result.success,

        symbol,

        action:
            result.action,

        traded:
            result.success === true,

        decision,

        result,

    };

}


// ============================================================
// STATUS CONFIG
// ============================================================

function getStatusConfig() {

    return {

        margin:
            DEFAULT_MARGIN,

        leverage:
            DEFAULT_LEVERAGE,

        targetNotional:
            DEFAULT_MARGIN *
            DEFAULT_LEVERAGE,

        marginMode:
            REQUIRED_MARGIN_MODE,

        orderBook: {

            enabled:
                ORDER_BOOK_FILTER_ENABLED,

            depth:
                ORDER_BOOK_DEPTH,

            confirmationRequired:
                ORDER_BOOK_CONFIRMATION_REQUIRED,

            confirmationDepths: [
                15,
                20,
                30,
                60,
            ],

            longMinImbalance:
                LONG_MIN_IMBALANCE,

            shortMaxImbalance:
                SHORT_MAX_IMBALANCE,

            minBidAskRatio:
                MIN_BID_ASK_RATIO,

            minAskBidRatio:
                MIN_ASK_BID_RATIO,

        },

        orderFlowHistory: {

            enabled: true,

            windowMinutes: 10,

            collectionIntervalMinutes: 1,

            trendMinPercent: 70,

            triggerMinPercent: 60,

            minimumSnapshots: 5,

            confirmationDepths: [
                15,
                20,
                30,
                60,
            ],

            confirmationRequired: 3,

        },

    };

}


// ============================================================
// EXPORTS
// ============================================================

module.exports = {

    processSignal,

    processAutomaticOrderFlow,

    checkEntryOrderBook,

    openMarketPosition,

    getStatusConfig,

    SUPPORTED_SYMBOLS,

};