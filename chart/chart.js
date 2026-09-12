"use strict";


// ============================================================
// WEEX MARKET LAB
// ============================================================
//
// PRICE
//   ↓
// DELTA
//   ↓
// CUMULATIVE DELTA
//
// VISUAL ONLY.
//
// NO TRADING.
// NO ORDERS.
// NO POSITIONS.
// NO AUTOMATIC TRADER.
// ============================================================


// ============================================================
// GLOBALS
// ============================================================

let priceChart = null;
let candleSeries = null;

let deltaChart = null;
let deltaSeries = null;

let cumulativeDeltaChart = null;
let cumulativeDeltaSeries = null;

let currentCandles = [];


// ============================================================
// START
// ============================================================

document.addEventListener(
    "DOMContentLoaded",
    () => {

        console.log(
            "=========================================="
        );

        console.log(
            "WEEX MARKET LAB"
        );

        console.log(
            "PRICE + DELTA + CUMULATIVE DELTA"
        );

        console.log(
            "=========================================="
        );


        // ----------------------------------------------------
        // DO NOT RUN FROM FILE://
        // ----------------------------------------------------

        if (
            window.location.protocol ===
            "file:"
        ) {

            console.error(
                "=================================================="
            );

            console.error(
                "WEEX MARKET LAB ERROR"
            );

            console.error(
                "chart.html was opened using file://"
            );

            console.error(
                "Open:"
            );

            console.error(
                "http://localhost:3000/chart/chart.html"
            );

            console.error(
                "=================================================="
            );


            setMarketStatus(
                "OPEN VIA SERVER"
            );


            const priceElement =
                document.getElementById(
                    "currentPrice"
                );


            if (
                priceElement
            ) {

                priceElement.textContent =
                    "OPEN VIA LOCALHOST";

            }


            return;

        }


        createPriceChart();

        createDeltaChart();

        createCumulativeDeltaChart();

    }
);


// ============================================================
// PRICE CHART
// ============================================================

function createPriceChart() {

    const container =
        document.getElementById(
            "priceChart"
        );


    if (
        !container
    ) {

        console.error(
            "PRICE CHART CONTAINER NOT FOUND"
        );

        return;

    }


    if (
        typeof LightweightCharts ===
        "undefined"
    ) {

        console.error(
            "LIGHTWEIGHT CHARTS NOT LOADED"
        );

        return;

    }


    priceChart =
        LightweightCharts.createChart(
            container,
            {

                layout: {

                    background: {
                        color:
                            "#090e14"
                    },

                    textColor:
                        "#7d8998"

                },


                grid: {

                    vertLines: {
                        color:
                            "#151d27"
                    },

                    horzLines: {
                        color:
                            "#151d27"
                    }

                },


                rightPriceScale: {

                    borderColor:
                        "#202b38"

                },


                timeScale: {

                    borderColor:
                        "#202b38",

                    timeVisible:
                        true,

                    secondsVisible:
                        false

                },


                crosshair: {

                    mode:
                        LightweightCharts
                            .CrosshairMode
                            .Normal

                }

            }
        );


    candleSeries =
        priceChart.addSeries(
            LightweightCharts
                .CandlestickSeries,
            {

                upColor:
                    "#21d38a",

                downColor:
                    "#ff5268",

                borderVisible:
                    false,

                wickUpColor:
                    "#21d38a",

                wickDownColor:
                    "#ff5268"

            }
        );


    loadWEEXCandles();

}


// ============================================================
// DELTA CHART
// ============================================================

function createDeltaChart() {

    const container =
        document.getElementById(
            "deltaChart"
        );


    if (
        !container
    ) {

        console.error(
            "DELTA CHART CONTAINER NOT FOUND"
        );

        return;

    }


    if (
        typeof LightweightCharts ===
        "undefined"
    ) {

        console.error(
            "LIGHTWEIGHT CHARTS NOT LOADED"
        );

        return;

    }


    deltaChart =
        LightweightCharts.createChart(
            container,
            {

                layout: {

                    background: {
                        color:
                            "#090e14"
                    },

                    textColor:
                        "#7d8998"

                },


                grid: {

                    vertLines: {
                        color:
                            "#151d27"
                    },

                    horzLines: {
                        color:
                            "#151d27"
                    }

                },


                rightPriceScale: {

                    borderColor:
                        "#202b38"

                },


                timeScale: {

                    borderColor:
                        "#202b38",

                    timeVisible:
                        true,

                    secondsVisible:
                        false

                }

            }
        );


    deltaSeries =
        deltaChart.addSeries(
            LightweightCharts
                .HistogramSeries,
            {

                priceFormat: {

                    type:
                        "volume"

                },

                priceScaleId:
                    "right"

            }
        );


    deltaChart
        .priceScale("right")
        .applyOptions(
            {

                scaleMargins: {

                    top:
                        0.10,

                    bottom:
                        0.10

                }

            }
        );


    deltaSeries.setData(
        []
    );

}


// ============================================================
// CUMULATIVE DELTA CHART
// ============================================================

function createCumulativeDeltaChart() {

    const container =
        document.getElementById(
            "cumulativeDeltaChart"
        );


    if (
        !container
    ) {

        console.error(
            "CUMULATIVE DELTA CONTAINER NOT FOUND"
        );

        return;

    }


    if (
        typeof LightweightCharts ===
        "undefined"
    ) {

        console.error(
            "LIGHTWEIGHT CHARTS NOT LOADED"
        );

        return;

    }


    cumulativeDeltaChart =
        LightweightCharts.createChart(
            container,
            {

                layout: {

                    background: {
                        color:
                            "#090e14"
                    },

                    textColor:
                        "#7d8998"

                },


                grid: {

                    vertLines: {
                        color:
                            "#151d27"
                    },

                    horzLines: {
                        color:
                            "#151d27"
                    }

                },


                rightPriceScale: {

                    borderColor:
                        "#202b38"

                },


                timeScale: {

                    borderColor:
                        "#202b38",

                    timeVisible:
                        true,

                    secondsVisible:
                        false

                }

            }
        );


    cumulativeDeltaSeries =
        cumulativeDeltaChart.addSeries(
            LightweightCharts
                .LineSeries,
            {

                lineWidth:
                    2,

                priceLineVisible:
                    false,

                lastValueVisible:
                    true,

                priceScaleId:
                    "right"

            }
        );


    cumulativeDeltaChart
        .priceScale("right")
        .applyOptions(
            {

                scaleMargins: {

                    top:
                        0.10,

                    bottom:
                        0.10

                }

            }
        );


    cumulativeDeltaSeries.setData(
        []
    );


    // ========================================================
    // SYNCHRONIZE PRICE
    // WITH CUMULATIVE DELTA
    // ========================================================

    if (
        priceChart
    ) {

        let syncingFromPrice =
            false;

        let syncingFromCumulative =
            false;


        priceChart
            .timeScale()
            .subscribeVisibleLogicalRangeChange(
                (
                    range
                ) => {

                    if (
                        syncingFromCumulative ||
                        !range
                    ) {

                        return;

                    }


                    syncingFromPrice =
                        true;


                    if (
                        deltaChart
                    ) {

                        deltaChart
                            .timeScale()
                            .setVisibleLogicalRange(
                                range
                            );

                    }


                    if (
                        cumulativeDeltaChart
                    ) {

                        cumulativeDeltaChart
                            .timeScale()
                            .setVisibleLogicalRange(
                                range
                            );

                    }


                    syncingFromPrice =
                        false;

                }
            );


        if (
            cumulativeDeltaChart
        ) {

            cumulativeDeltaChart
                .timeScale()
                .subscribeVisibleLogicalRangeChange(
                    (
                        range
                    ) => {

                        if (
                            syncingFromPrice ||
                            !range
                        ) {

                            return;

                        }


                        syncingFromCumulative =
                            true;


                        priceChart
                            .timeScale()
                            .setVisibleLogicalRange(
                                range
                            );


                        if (
                            deltaChart
                        ) {

                            deltaChart
                                .timeScale()
                                .setVisibleLogicalRange(
                                    range
                                );

                        }


                        syncingFromCumulative =
                            false;

                    }
                );

        }

    }

}


// ============================================================
// LOAD WEEX DATA
// ============================================================

async function loadWEEXCandles() {

    // --------------------------------------------------------
    // SAFETY
    // --------------------------------------------------------

    if (
        window.location.protocol ===
        "file:"
    ) {

        console.error(
            "CHART IS RUNNING FROM file://"
        );

        setMarketStatus(
            "OPEN VIA SERVER"
        );

        return;

    }


    const symbolElement =
        document.getElementById(
            "symbol"
        );


    const timeframeElement =
        document.getElementById(
            "timeframe"
        );


    const symbol =
        symbolElement
            ? String(
                symbolElement.value
            )
                .trim()
                .toUpperCase()
            : "POLUSDT";


    const interval =
        timeframeElement
            ? String(
                timeframeElement.value
            )
                .trim()
            : "1m";


    setMarketStatus(
        "LOADING..."
    );


    try {

        console.log(
            "=========================================="
        );

        console.log(
            "LOADING WEEX MARKET DATA"
        );

        console.log(
            "SYMBOL:",
            symbol
        );

        console.log(
            "TIMEFRAME:",
            interval
        );


        // ====================================================
        // EXPRESS PROXY
        // ====================================================

        const url =
            `/chart/klines` +
            `?symbol=${encodeURIComponent(
                symbol
            )}` +
            `&interval=${encodeURIComponent(
                interval
            )}` +
            `&limit=300`;


        console.log(
            "KLINE URL:",
            url
        );


        const response =
            await fetch(
                url
            );


        if (
            !response.ok
        ) {

            throw new Error(
                `HTTP ${response.status}`
            );

        }


        const data =
            await response.json();


        console.log(
            "WEEX KLINE RESPONSE:",
            data
        );


        // ====================================================
        // PRICE DATA
        // ====================================================

        const candles =
            convertWEEXCandles(
                data
            );


        if (
            candles.length === 0
        ) {

            throw new Error(
                "No valid candles received."
            );

        }


        currentCandles =
            candles;


        const lastCandle =
            candles[
                candles.length - 1
            ];


        console.log(
            "=========================================="
        );

        console.log(
            "WEEX CANDLES LOADED"
        );

        console.log(
            "SYMBOL:",
            symbol
        );

        console.log(
            "TIMEFRAME:",
            interval
        );

        console.log(
            "CANDLES:",
            candles.length
        );

        console.log(
            "LAST PRICE:",
            lastCandle.close
        );

        console.log(
            "=========================================="
        );


        // ====================================================
        // PRICE
        // ====================================================

        candleSeries.setData(
            candles
        );


        priceChart
            .timeScale()
            .fitContent();


        updateCurrentPrice(
            lastCandle.close
        );


        // ====================================================
        // DELTA
        // ====================================================

        const deltaData =
            calculateDelta(
                data
            );


        deltaSeries.setData(
            deltaData
        );


        // ====================================================
        // CUMULATIVE DELTA
        // ====================================================

        const cumulativeData =
            calculateCumulativeDelta(
                deltaData
            );


        cumulativeDeltaSeries.setData(
            cumulativeData
        );


        // ====================================================
        // ALIGN ALL CHARTS
        // ====================================================

        const visibleRange =
            priceChart
                .timeScale()
                .getVisibleLogicalRange();


        if (
            visibleRange
        ) {

            if (
                deltaChart
            ) {

                deltaChart
                    .timeScale()
                    .setVisibleLogicalRange(
                        visibleRange
                    );

            }


            if (
                cumulativeDeltaChart
            ) {

                cumulativeDeltaChart
                    .timeScale()
                    .setVisibleLogicalRange(
                        visibleRange
                    );

            }

        }


        // ====================================================
        // VALUES
        // ====================================================

        updateDeltaValue(
            deltaData
        );


        updateCumulativeDeltaValue(
            cumulativeData
        );


        setMarketStatus(
            "LIVE DATA"
        );


    } catch (
        error
    ) {

        console.error(
            "WEEX CANDLE ERROR:",
            error
        );


        setMarketStatus(
            "ERROR"
        );


        const priceElement =
            document.getElementById(
                "currentPrice"
            );


        if (
            priceElement
        ) {

            priceElement.textContent =
                "ERROR";

        }


        const deltaElement =
            document.getElementById(
                "deltaValue"
            );


        if (
            deltaElement
        ) {

            deltaElement.textContent =
                "ERROR";

        }


        const cumulativeElement =
            document.getElementById(
                "cumulativeDeltaValue"
            );


        if (
            cumulativeElement
        ) {

            cumulativeElement.textContent =
                "ERROR";

        }

    }

}


// ============================================================
// CONVERT WEEX CANDLES
// ============================================================

function convertWEEXCandles(
    data
) {

    if (
        !Array.isArray(data)
    ) {

        throw new Error(
            "Invalid WEEX kline response."
        );

    }


    const candles =
        data
            .map(
                (
                    candle
                ) => {

                    if (
                        !Array.isArray(
                            candle
                        ) ||
                        candle.length < 5
                    ) {

                        return null;

                    }


                    const time =
                        Number(
                            candle[0]
                        );


                    const open =
                        Number(
                            candle[1]
                        );


                    const high =
                        Number(
                            candle[2]
                        );


                    const low =
                        Number(
                            candle[3]
                        );


                    const close =
                        Number(
                            candle[4]
                        );


                    if (
                        !Number.isFinite(
                            time
                        ) ||
                        !Number.isFinite(
                            open
                        ) ||
                        !Number.isFinite(
                            high
                        ) ||
                        !Number.isFinite(
                            low
                        ) ||
                        !Number.isFinite(
                            close
                        )
                    ) {

                        return null;

                    }


                    return {

                        time:
                            Math.floor(
                                time / 1000
                            ),

                        open:
                            open,

                        high:
                            high,

                        low:
                            low,

                        close:
                            close

                    };

                }
            )
            .filter(
                Boolean
            )
            .sort(
                (
                    a,
                    b
                ) =>
                    a.time -
                    b.time
            );


    // ========================================================
    // REMOVE DUPLICATE CANDLE TIMESTAMPS
    // ========================================================

    const uniqueCandles =
        [];


    for (
        const candle of candles
    ) {

        const previous =
            uniqueCandles[
                uniqueCandles.length - 1
            ];


        if (
            previous &&
            previous.time ===
                candle.time
        ) {

            continue;

        }


        uniqueCandles.push(
            candle
        );

    }


    return uniqueCandles;

}


// ============================================================
// ESTIMATED DELTA
// ============================================================
//
// WEEX:
//
// candle[5]
//     TOTAL VOLUME
//
// candle[9]
//     TAKER BUY VOLUME
//
// Estimated sell volume:
//
// total - takerBuy
//
// Estimated delta:
//
// takerBuy - sell
//
// Therefore:
//
// delta =
// (2 * takerBuy) - total
//
// IMPORTANT:
//
// This is KLINE-BASED ESTIMATED DELTA.
//
// It is NOT trade-by-trade exchange Delta.
// ============================================================

function calculateDelta(
    data
) {

    if (
        !Array.isArray(data)
    ) {

        return [];

    }


    const deltaData =
        data
            .map(
                (
                    candle
                ) => {

                    if (
                        !Array.isArray(
                            candle
                        ) ||
                        candle.length < 10
                    ) {

                        return null;

                    }


                    const time =
                        Number(
                            candle[0]
                        );


                    const totalVolume =
                        Number(
                            candle[5]
                        );


                    const takerBuyVolume =
                        Number(
                            candle[9]
                        );


                    if (
                        !Number.isFinite(
                            time
                        ) ||
                        !Number.isFinite(
                            totalVolume
                        ) ||
                        !Number.isFinite(
                            takerBuyVolume
                        )
                    ) {

                        return null;

                    }


                    const delta =
                        (
                            2 *
                            takerBuyVolume
                        ) -
                        totalVolume;


                    return {

                        time:
                            Math.floor(
                                time / 1000
                            ),

                        value:
                            delta,

                        color:
                            delta >= 0
                                ? "#21d38a"
                                : "#ff5268"

                    };

                }
            )
            .filter(
                Boolean
            )
            .sort(
                (
                    a,
                    b
                ) =>
                    a.time -
                    b.time
            );


    // ========================================================
    // REMOVE DUPLICATES
    // ========================================================

    const uniqueDelta =
        [];


    for (
        const item of deltaData
    ) {

        const previous =
            uniqueDelta[
                uniqueDelta.length - 1
            ];


        if (
            previous &&
            previous.time ===
                item.time
        ) {

            continue;

        }


        uniqueDelta.push(
            item
        );

    }


    return uniqueDelta;

}


// ============================================================
// CUMULATIVE DELTA
// ============================================================
//
// Example:
//
// Delta:
//
// +100
// -50
// +200
// -75
//
// Cumulative:
//
// +100
// +50
// +250
// +175
//
// This shows whether buying/selling pressure is building
// over the visible history.
// ============================================================

function calculateCumulativeDelta(
    deltaData
) {

    if (
        !Array.isArray(
            deltaData
        )
    ) {

        return [];

    }


    let cumulative =
        0;


    const result =
        [];


    for (
        const item of deltaData
    ) {

        const value =
            Number(
                item.value
            );


        if (
            !Number.isFinite(
                value
            )
        ) {

            continue;

        }


        cumulative +=
            value;


        result.push(
            {

                time:
                    item.time,

                value:
                    cumulative

            }
        );

    }


    return result;

}


// ============================================================
// PRICE FORMAT
// ============================================================

function formatPrice(
    price
) {

    const numericPrice =
        Number(
            price
        );


    if (
        !Number.isFinite(
            numericPrice
        )
    ) {

        return "—";

    }


    if (
        numericPrice < 0.0001
    ) {

        return numericPrice.toFixed(
            8
        );

    }


    if (
        numericPrice < 0.001
    ) {

        return numericPrice.toFixed(
            7
        );

    }


    if (
        numericPrice < 0.01
    ) {

        return numericPrice.toFixed(
            6
        );

    }


    if (
        numericPrice < 0.1
    ) {

        return numericPrice.toFixed(
            5
        );

    }


    if (
        numericPrice < 1
    ) {

        return numericPrice.toFixed(
            4
        );

    }


    if (
        numericPrice < 100
    ) {

        return numericPrice.toFixed(
            2
        );

    }


    return numericPrice.toFixed(
        2
    );

}


// ============================================================
// VOLUME FORMAT
// ============================================================

function formatVolume(
    value
) {

    const numeric =
        Number(
            value
        );


    if (
        !Number.isFinite(
            numeric
        )
    ) {

        return "—";

    }


    const absolute =
        Math.abs(
            numeric
        );


    if (
        absolute >= 1000000
    ) {

        return (
            numeric /
            1000000
        ).toFixed(2) +
        "M";

    }


    if (
        absolute >= 1000
    ) {

        return (
            numeric /
            1000
        ).toFixed(2) +
        "K";

    }


    return numeric.toFixed(
        2
    );

}


// ============================================================
// LAST PRICE
// ============================================================

function updateCurrentPrice(
    price
) {

    const element =
        document.getElementById(
            "currentPrice"
        );


    if (
        !element
    ) {

        return;

    }


    element.textContent =
        `LAST PRICE: ${formatPrice(price)}`;

}


// ============================================================
// LAST DELTA
// ============================================================

function updateDeltaValue(
    deltaData
) {

    const element =
        document.getElementById(
            "deltaValue"
        );


    if (
        !element
    ) {

        return;

    }


    if (
        !Array.isArray(
            deltaData
        ) ||
        deltaData.length === 0
    ) {

        element.textContent =
            "DELTA: —";

        return;

    }


    const last =
        deltaData[
            deltaData.length - 1
        ];


    const value =
        Number(
            last.value
        );


    if (
        !Number.isFinite(
            value
        )
    ) {

        element.textContent =
            "DELTA: —";

        return;

    }


    const prefix =
        value >= 0
            ? "+"
            : "";


    element.textContent =
        `DELTA: ${prefix}${formatVolume(value)}`;

}


// ============================================================
// CUMULATIVE DELTA VALUE
// ============================================================

function updateCumulativeDeltaValue(
    cumulativeData
) {

    const element =
        document.getElementById(
            "cumulativeDeltaValue"
        );


    if (
        !element
    ) {

        return;

    }


    if (
        !Array.isArray(
            cumulativeData
        ) ||
        cumulativeData.length === 0
    ) {

        element.textContent =
            "CVD: —";

        return;

    }


    const last =
        cumulativeData[
            cumulativeData.length - 1
        ];


    const value =
        Number(
            last.value
        );


    if (
        !Number.isFinite(
            value
        )
    ) {

        element.textContent =
            "CVD: —";

        return;

    }


    const prefix =
        value >= 0
            ? "+"
            : "";


    element.textContent =
        `CVD: ${prefix}${formatVolume(value)}`;

}


// ============================================================
// MARKET STATUS
// ============================================================

function setMarketStatus(
    text
) {

    const element =
        document.getElementById(
            "marketStatus"
        );


    if (
        !element
    ) {

        return;

    }


    element.textContent =
        text;

}


// ============================================================
// SYMBOL CHANGE
// ============================================================

const symbolElement =
    document.getElementById(
        "symbol"
    );


if (
    symbolElement
) {

    symbolElement.addEventListener(
        "change",
        () => {

            loadWEEXCandles();

        }
    );

}


// ============================================================
// TIMEFRAME CHANGE
// ============================================================

const timeframeElement =
    document.getElementById(
        "timeframe"
    );


if (
    timeframeElement
) {

    timeframeElement.addEventListener(
        "change",
        () => {

            loadWEEXCandles();

        }
    );

}


// ============================================================
// WINDOW RESIZE
// ============================================================

window.addEventListener(
    "resize",
    () => {


        if (
            priceChart
        ) {

            const container =
                document.getElementById(
                    "priceChart"
                );


            if (
                container
            ) {

                priceChart.resize(
                    container.clientWidth,
                    container.clientHeight
                );

            }

        }


        if (
            deltaChart
        ) {

            const container =
                document.getElementById(
                    "deltaChart"
                );


            if (
                container
            ) {

                deltaChart.resize(
                    container.clientWidth,
                    container.clientHeight
                );

            }

        }


        if (
            cumulativeDeltaChart
        ) {

            const container =
                document.getElementById(
                    "cumulativeDeltaChart"
                );


            if (
                container
            ) {

                cumulativeDeltaChart.resize(
                    container.clientWidth,
                    container.clientHeight
                );

            }

        }

    }
);

