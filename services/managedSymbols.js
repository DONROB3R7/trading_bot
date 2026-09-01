const {
    SUPPORTED_SYMBOLS,
    normalizeSymbol,
    getCurrentPosition
} = require("../weex/weex");


// ============================================================
// MANAGED SYMBOLS
// ============================================================
//
// Persistent monitoring list.
//
// A symbol can be:
//
//     managed + LONG
//     managed + SHORT
//     managed + FLAT
//
// Closing a position does NOT remove the symbol.
// ============================================================

const managedSymbols = new Set();


// ============================================================
// HELPERS
// ============================================================

function isSupported(symbol) {

    return (
        !!symbol &&
        SUPPORTED_SYMBOLS.has(symbol)
    );
}


function addManagedSymbol(symbol) {

    const normalized =
        normalizeSymbol(symbol);

    if (!isSupported(normalized)) {
        return false;
    }

    const alreadyManaged =
        managedSymbols.has(normalized);

    managedSymbols.add(normalized);

    if (!alreadyManaged) {
        console.log(
            "MANAGED SYMBOL ADDED:",
            normalized
        );
    }

    return true;
}


function managedList() {

    return Array.from(
        managedSymbols
    ).sort();
}


function clearManagedSymbols() {

    managedSymbols.clear();
}


// ============================================================
// POSITION SIDE
// ============================================================

function getPositionSide(position) {

    if (!position) {
        return "FLAT";
    }

    const size =
        Number(
            position.size ??
            position.positionSize ??
            position.quantity ??
            position.qty ??
            position.total ??
            position.available ??
            0
        );

    if (
        Number.isFinite(size) &&
        Math.abs(size) === 0
    ) {
        return "FLAT";
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
        direct === "BUY" ||
        direct.includes("LONG")
    ) {
        return "LONG";
    }

    if (
        direct === "SHORT" ||
        direct === "SELL" ||
        direct.includes("SHORT")
    ) {
        return "SHORT";
    }

    if (
        direct === "FLAT" ||
        direct === "NONE"
    ) {
        return "FLAT";
    }

    return "UNKNOWN";
}


// ============================================================
// DISCOVER LIVE WEEX POSITIONS
// ============================================================

async function discoverLivePositions() {

    const symbols =
        Array.from(
            SUPPORTED_SYMBOLS
        ).sort();

    const activePositions = [];

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

    for (const symbol of symbols) {

        try {

            const position =
                await getCurrentPosition(symbol);

            const direction =
                getPositionSide(position);


            // ------------------------------------------------
            // ACTIVE POSITION
            // ------------------------------------------------

            if (
                direction === "LONG" ||
                direction === "SHORT"
            ) {

                managedSymbols.add(symbol);

                activePositions.push({

                    symbol,

                    direction,

                    quantity:
                        position.quantity ??
                        position.size ??
                        position.positionSize ??
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

                continue;
            }


            // ------------------------------------------------
            // FLAT
            // ------------------------------------------------
            //
            // IMPORTANT:
            // DO NOT REMOVE FROM managedSymbols.
            // ------------------------------------------------

            if (
                direction === "FLAT"
            ) {

                if (
                    managedSymbols.has(symbol)
                ) {

                    console.log(
                        "WEEX POSITION CLOSED - KEEPING IN WATCH:",
                        symbol
                    );
                }

                continue;
            }


            // ------------------------------------------------
            // UNKNOWN
            // ------------------------------------------------

            console.log(
                "POSITION STATUS UNKNOWN - KEEPING MANAGED STATE:",
                symbol
            );

        } catch (error) {

            console.error(
                `POSITION DISCOVERY ERROR ${symbol}:`,
                error.message
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

    if (activePositions.length > 0) {

        console.log("");

        for (const position of activePositions) {

            console.log(
                `${position.symbol}: ${position.direction}`
            );
        }
    }

    console.log("");
    console.log(
        "CURRENT MANAGED SYMBOLS:"
    );

    console.log(
        managedList()
    );

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
// EXPORTS
// ============================================================

module.exports = {

    managedSymbols,

    isSupported,

    addManagedSymbol,

    managedList,

    clearManagedSymbols,

    getPositionSide,

    discoverLivePositions
};