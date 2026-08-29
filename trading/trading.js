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


// ============================================================
// SIGNAL / ORDER FLOW STATISTICS
// ============================================================

const signalStats = {

    totalSignals:
        0,

    long: {

        total:
            0,

        passed:
            0,

        blocked:
            0,

        opened:
            0
    },

    short: {

        total:
            0,

        passed:
            0,

        blocked:
            0,

        opened:
            0
    },

    totalPassed:
        0,

    totalBlocked:
        0,

    totalOpened:
        0,

    sameDirection:
        0,

    reversals:
        0,

    reversalBlocked:
        0
};


function getSignalStats() {

    const total =
        signalStats.totalSignals;


    return {

        ...signalStats,

        passRate:
            total > 0
                ? Number(
                    (
                        signalStats.totalPassed /
                        total *
                        100
                    ).toFixed(2)
                )
                : 0,

        blockRate:
            total > 0
                ? Number(
                    (
                        signalStats.totalBlocked /
                        total *
                        100
                    ).toFixed(2)
                )
                : 0
    };
}


function resetSignalStats() {

    signalStats.totalSignals =
        0;

    signalStats.long = {

        total:
            0,

        passed:
            0,

        blocked:
            0,

        opened:
            0
    };

    signalStats.short = {

        total:
            0,

        passed:
            0,

        blocked:
            0,

        opened:
            0
    };

    signalStats.totalPassed =
        0;

    signalStats.totalBlocked =
        0;

    signalStats.totalOpened =
        0;

    signalStats.sameDirection =
        0;

    signalStats.reversals =
        0;

    signalStats.reversalBlocked =
        0;
}


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
    // SIGNAL STATISTICS
    // --------------------------------------------------------

    if (
        action === "LONG" ||
        action === "SHORT"
    ) {

        signalStats.totalSignals++;

        signalStats[
            action === "LONG"
                ? "long"
                : "short"
        ].total++;
    }


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

            signalStats.sameDirection++;

            console.log(
                `${symbol}: already ${action}. No order.`
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

            signalStats.reversals++;

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

                signalStats.totalBlocked++;

                signalStats.reversalBlocked++;

                signalStats[
                    action === "LONG"
                        ? "long"
                        : "short"
                ].blocked++;

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


            signalStats.totalPassed++;

            signalStats[
                action === "LONG"
                    ? "long"
                    : "short"
            ].passed++;


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


            signalStats.totalOpened++;

            signalStats[
                action === "LONG"
                    ? "long"
                    : "short"
            ].opened++;


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

            signalStats.totalBlocked++;

            signalStats[
                action === "LONG"
                    ? "long"
                    : "short"
            ].blocked++;

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


        signalStats.totalPassed++;

        signalStats[
            action === "LONG"
                ? "long"
                : "short"
        ].passed++;

        signalStats.totalOpened++;

        signalStats[
            action === "LONG"
                ? "long"
                : "short"
        ].opened++;


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
        }
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