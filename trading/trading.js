const {
    TRADING_ENABLED,
    DEFAULT_MARGIN,
    DEFAULT_LEVERAGE,
    REQUIRED_MARGIN_MODE,
    ORDER_BOOK_DEPTH,
    LONG_MIN_IMBALANCE,
    SHORT_MAX_IMBALANCE,
    MIN_BID_ASK_RATIO,
    MIN_ASK_BID_RATIO
} = require("../config/config");

const weex =
    require("../weex/weex");

const {
    checkOrderBook
} = require("../filters/orderBook");

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
    getOrderBook
} = weex;


// ============================================================
// PER SYMBOL LOCKS
// ============================================================

const symbolLocks =
    new Map();


function sleep(ms) {

    return new Promise(
        resolve =>
            setTimeout(
                resolve,
                ms
            )
    );
}


async function acquireTradingLock(
    symbol
) {

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


function releaseTradingLock(
    symbol
) {

    symbolLocks.delete(
        normalizeSymbol(symbol)
    );
}


// ============================================================
// ORDER FLOW STATISTICS
// ============================================================
//
// These statistics measure what happens AFTER a signal reaches
// the server.
//
// ACCEPTED:
//   Order book passed and an entry order was opened.
//
// REJECTED:
//   Order book blocked the requested entry.
//
// NO ACTION:
//   Signal arrived but no new order was necessary because the
//   current position was already in the requested direction.
//
// REVERSAL BLOCKED:
//   Existing position was closed, but the fresh order-book check
//   rejected the new direction.
//
// CLOSE:
//   Close signals are tracked separately and are not included
//   in entry accept/reject rate.
//

const signalStats = {

    startedAt:
        new Date().toISOString(),

    totalSignals:
        0,

    longSignals:
        0,

    shortSignals:
        0,

    accepted:
        0,

    rejected:
        0,

    noAction:
        0,

    reversalBlocked:
        0,

    closeSignals:
        0,

    errors:
        0,

    symbols:
        {}
};


// ============================================================
// CREATE SYMBOL STATISTICS
// ============================================================

function createSymbolStats() {

    return {

        totalSignals:
            0,

        longSignals:
            0,

        shortSignals:
            0,

        accepted:
            0,

        rejected:
            0,

        noAction:
            0,

        reversalBlocked:
            0,

        closeSignals:
            0,

        errors:
            0
    };
}


// ============================================================
// GET SYMBOL STATISTICS
// ============================================================

function getSymbolStats(
    symbol
) {

    symbol =
        normalizeSymbol(symbol);

    if (
        !signalStats.symbols[symbol]
    ) {

        signalStats.symbols[symbol] =
            createSymbolStats();
    }

    return signalStats.symbols[symbol];
}


// ============================================================
// RECORD SIGNAL
// ============================================================

function recordSignal(
    symbol,
    action
) {

    const stats =
        getSymbolStats(symbol);


    signalStats.totalSignals++;
    stats.totalSignals++;


    if (
        action === "LONG"
    ) {

        signalStats.longSignals++;
        stats.longSignals++;

    } else if (
        action === "SHORT"
    ) {

        signalStats.shortSignals++;
        stats.shortSignals++;

    } else if (
        action === "CLOSE" ||
        action === "CLOSE_LONG" ||
        action === "CLOSE_SHORT"
    ) {

        signalStats.closeSignals++;
        stats.closeSignals++;
    }
}


// ============================================================
// RECORD ACCEPTED
// ============================================================

function recordAccepted(
    symbol
) {

    const stats =
        getSymbolStats(symbol);

    signalStats.accepted++;
    stats.accepted++;
}


// ============================================================
// RECORD REJECTED
// ============================================================

function recordRejected(
    symbol
) {

    const stats =
        getSymbolStats(symbol);

    signalStats.rejected++;
    stats.rejected++;
}


// ============================================================
// RECORD NO ACTION
// ============================================================

function recordNoAction(
    symbol
) {

    const stats =
        getSymbolStats(symbol);

    signalStats.noAction++;
    stats.noAction++;
}


// ============================================================
// RECORD REVERSAL BLOCKED
// ============================================================

function recordReversalBlocked(
    symbol
) {

    const stats =
        getSymbolStats(symbol);

    signalStats.reversalBlocked++;
    stats.reversalBlocked++;
}


// ============================================================
// RECORD ERROR
// ============================================================

function recordError(
    symbol
) {

    const stats =
        getSymbolStats(symbol);

    signalStats.errors++;
    stats.errors++;
}


// ============================================================
// PERCENTAGE HELPER
// ============================================================

function percentage(
    value,
    total
) {

    if (
        !total
    ) {

        return 0;
    }

    return Number(
        (
            value /
            total *
            100
        ).toFixed(2)
    );
}


// ============================================================
// BUILD STATISTICS
// ============================================================

function getSignalStats() {

    const entrySignals =
        signalStats.longSignals +
        signalStats.shortSignals;


    const blocked =
        signalStats.rejected +
        signalStats.reversalBlocked;


    const acceptedRate =
        percentage(
            signalStats.accepted,
            entrySignals
        );


    const rejectedRate =
        percentage(
            blocked,
            entrySignals
        );


    const symbols = {};


    for (
        const symbol of Object.keys(
            signalStats.symbols
        )
    ) {

        const stats =
            signalStats.symbols[symbol];


        const symbolEntrySignals =
            stats.longSignals +
            stats.shortSignals;


        const symbolBlocked =
            stats.rejected +
            stats.reversalBlocked;


        symbols[symbol] = {

            ...stats,

            entrySignals:
                symbolEntrySignals,

            acceptedRate:
                percentage(
                    stats.accepted,
                    symbolEntrySignals
                ),

            rejectedRate:
                percentage(
                    symbolBlocked,
                    symbolEntrySignals
                )
        };
    }


    return {

        startedAt:
            signalStats.startedAt,

        totalSignals:
            signalStats.totalSignals,

        entrySignals,

        longSignals:
            signalStats.longSignals,

        shortSignals:
            signalStats.shortSignals,

        accepted:
            signalStats.accepted,

        rejected:
            signalStats.rejected,

        reversalBlocked:
            signalStats.reversalBlocked,

        noAction:
            signalStats.noAction,

        closeSignals:
            signalStats.closeSignals,

        errors:
            signalStats.errors,

        acceptedRate,

        rejectedRate,

        symbols
    };
}


// ============================================================
// RESET STATISTICS
// ============================================================

function resetSignalStats() {

    signalStats.startedAt =
        new Date().toISOString();

    signalStats.totalSignals =
        0;

    signalStats.longSignals =
        0;

    signalStats.shortSignals =
        0;

    signalStats.accepted =
        0;

    signalStats.rejected =
        0;

    signalStats.noAction =
        0;

    signalStats.reversalBlocked =
        0;

    signalStats.closeSignals =
        0;

    signalStats.errors =
        0;

    signalStats.symbols =
        {};

    return getSignalStats();
}


// ============================================================
// OPEN MARKET POSITION
// ============================================================

async function openMarketPosition(
    symbol,
    direction
) {

    if (
        direction !== "LONG" &&
        direction !== "SHORT"
    ) {

        throw new Error(
            `Invalid direction: ${direction}`
        );
    }


    getSymbolSettings(symbol);


    // --------------------------------------------------------
    // FRESH ORDER BOOK
    // --------------------------------------------------------

    const orderBookCheck =
        await checkOrderBook(
            symbol,
            direction,
            getOrderBook
        );


    if (
        !orderBookCheck.allowed
    ) {

        console.log("");
        console.log(
            "############################################################"
        );

        console.log(
            "ORDER BLOCKED BY WEEX ORDER BOOK"
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
            "Imbalance:",
            orderBookCheck.imbalance
        );

        console.log(
            "Bid liquidity:",
            orderBookCheck.bidLiquidity
        );

        console.log(
            "Ask liquidity:",
            orderBookCheck.askLiquidity
        );

        console.log(
            "############################################################"
        );


        recordRejected(
            symbol
        );


        return {

            success:
                false,

            blocked:
                true,

            reason:
                orderBookCheck.reason,

            orderBook:
                orderBookCheck

        };
    }


    console.log("");
    console.log(
        `${symbol}: ORDER BOOK PASSED`
    );

    console.log(
        `Direction ${direction} is supported by WEEX order book.`
    );


    // --------------------------------------------------------
    // BALANCE
    // --------------------------------------------------------

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


    // --------------------------------------------------------
    // PRICE
    // --------------------------------------------------------

    const price =
        await getPrice(symbol);


    // --------------------------------------------------------
    // POSITION CALCULATION
    // --------------------------------------------------------

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


    // --------------------------------------------------------
    // LEVERAGE
    // --------------------------------------------------------

    await ensureLeverage(symbol);


    // --------------------------------------------------------
    // OPEN ORDER
    // --------------------------------------------------------

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


    recordAccepted(
        symbol
    );


    return {

        success:
            true,

        blocked:
            false,

        result,

        calculation,

        orderBook:
            orderBookCheck
    };
}


// ============================================================
// PROCESS SIGNAL
// ============================================================

async function processSignal(
    symbol,
    action
) {

    symbol =
        normalizeSymbol(symbol);


    action =
        String(
            action || ""
        )
            .trim()
            .toUpperCase();


    getSymbolSettings(
        symbol
    );


    const validActions = [
        "LONG",
        "SHORT",
        "CLOSE",
        "CLOSE_LONG",
        "CLOSE_SHORT"
    ];


    if (
        !validActions.includes(action)
    ) {

        throw new Error(
            "Action must be LONG, SHORT, CLOSE, CLOSE_LONG or CLOSE_SHORT."
        );
    }


    // --------------------------------------------------------
    // RECORD EVERY VALID SIGNAL
    // --------------------------------------------------------

    recordSignal(
        symbol,
        action
    );


    if (
        !TRADING_ENABLED
    ) {

        console.log(
            "TRADING DISABLED."
        );


        return {

            success:
                false,

            reason:
                "TRADING_DISABLED",

            symbol,

            action

        };
    }


    // --------------------------------------------------------
    // LOCK
    // --------------------------------------------------------

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


        // ----------------------------------------------------
        // LIVE POSITION
        // ----------------------------------------------------

        const current =
            await getCurrentPosition(
                symbol
            );


        // ====================================================
        // CLOSE
        // ====================================================

        if (
            action === "CLOSE" ||
            action === "CLOSE_LONG" ||
            action === "CLOSE_SHORT"
        ) {

            if (
                current.direction === "FLAT"
            ) {

                console.log(
                    `${symbol}: already FLAT. Nothing to close.`
                );


                recordNoAction(
                    symbol
                );


                return {

                    success:
                        true,

                    symbol,

                    action:
                        "ALREADY_FLAT"

                };
            }


            if (
                action === "CLOSE_LONG" &&
                current.direction !== "LONG"
            ) {

                recordNoAction(
                    symbol
                );


                return {

                    success:
                        true,

                    symbol,

                    action:
                        "NO_ACTION",

                    reason:
                        `CLOSE_LONG_RECEIVED_BUT_POSITION_IS_${current.direction}`,

                    position:
                        current
                };
            }


            if (
                action === "CLOSE_SHORT" &&
                current.direction !== "SHORT"
            ) {

                recordNoAction(
                    symbol
                );


                return {

                    success:
                        true,

                    symbol,

                    action:
                        "NO_ACTION",

                    reason:
                        `CLOSE_SHORT_RECEIVED_BUT_POSITION_IS_${current.direction}`,

                    position:
                        current
                };
            }


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


            const flat =
                await waitForPosition(
                    symbol,
                    "FLAT"
                );


            if (!flat) {

                throw new Error(
                    `${symbol}: WEEX did not confirm position closed.`
                );
            }


            return {

                success:
                    true,

                symbol,

                action:
                    action === "CLOSE_LONG"
                        ? "CLOSED_LONG"
                        : action === "CLOSE_SHORT"
                            ? "CLOSED_SHORT"
                            : "CLOSED",

                result:
                    closeResult
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


            recordNoAction(
                symbol
            );


            return {

                success:
                    true,

                symbol,

                action:
                    "NO_ACTION",

                reason:
                    `ALREADY_${action}`,

                position:
                    current
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


            const closeResult =
                await closePosition(
                    current
                );


            const flat =
                await waitForPosition(
                    symbol,
                    "FLAT"
                );


            if (!flat) {

                throw new Error(
                    `${symbol}: old position did not close.`
                );
            }


            console.log("");
            console.log(
                `${symbol}: OLD POSITION CLOSED`
            );

            console.log(
                `${symbol}: REQUESTING FRESH ORDER BOOK FOR ${action}`
            );


            const openResult =
                await openMarketPosition(
                    symbol,
                    action
                );


            if (
                openResult.blocked
            ) {

                recordReversalBlocked(
                    symbol
                );


                console.log("");
                console.log(
                    `${symbol}: REVERSAL OPEN BLOCKED BY ORDER BOOK`
                );

                console.log(
                    `${symbol}: CURRENT POSITION IS FLAT`
                );


                return {

                    success:
                        false,

                    symbol,

                    action:
                        `REVERSAL_TO_${action}_BLOCKED`,

                    close:
                        closeResult,

                    open:
                        openResult
                };
            }


            const verified =
                await waitForPosition(
                    symbol,
                    action
                );


            if (!verified) {

                throw new Error(
                    `${symbol}: WEEX did not confirm ${action} after reversal.`
                );
            }


            return {

                success:
                    true,

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
                    )
            };
        }


        // ====================================================
        // FLAT -> OPEN
        // ====================================================

        const openResult =
            await openMarketPosition(
                symbol,
                action
            );


        if (
            openResult.blocked
        ) {

            console.log("");
            console.log(
                `${symbol}: ENTRY BLOCKED BY ORDER BOOK`
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

                success:
                    false,

                symbol,

                action:
                    "ENTRY_BLOCKED",

                reason:
                    openResult.reason,

                orderBook:
                    openResult.orderBook
            };
        }


        const verified =
            await waitForPosition(
                symbol,
                action
            );


        if (!verified) {

            throw new Error(
                `${symbol}: WEEX did not confirm ${action} after opening.`
            );
        }


        return {

            success:
                true,

            symbol,

            action:
                `OPENED_${action}`,

            result:
                openResult,

            position:
                await getCurrentPosition(
                    symbol
                )
        };


    } catch (error) {

        recordError(
            symbol
        );

        throw error;

    } finally {

        releaseTradingLock(
            symbol
        );
    }
}


// ============================================================
// STATUS
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
                true,

            depth:
                ORDER_BOOK_DEPTH,

            longMinImbalance:
                LONG_MIN_IMBALANCE,

            shortMaxImbalance:
                SHORT_MAX_IMBALANCE,

            minBidAskRatio:
                MIN_BID_ASK_RATIO,

            minAskBidRatio:
                MIN_ASK_BID_RATIO
        },

        statistics:
            getSignalStats()
    };
}


module.exports = {

    processSignal,

    openMarketPosition,

    checkOrderBook:
        (
            symbol,
            direction
        ) =>
            checkOrderBook(
                symbol,
                direction,
                getOrderBook
            ),

    getStatusConfig,

    getSignalStats,

    resetSignalStats
};