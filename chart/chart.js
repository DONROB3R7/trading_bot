/* ============================================================
WEEX PRICE SIGNAL LAB
=====================

PRICE ONLY

CAVEMAN TREND + PULLBACK LOGIC:

TREND:
200 candles
Direction must be >= 50%

ENTRY / PULLBACK:

If 200 TREND = LONG:
3 of 4 SHORT = LONG SIGNAL

If 200 TREND = SHORT:
3 of 4 LONG = SHORT SIGNAL

ENTRY WINDOWS:
15 / 20 / 30 / 60 candles

CYCLE:
10 one-minute calculations

CHART:
Berlin local time display
LONG / SHORT signal markers
COMPLETED CYCLE markers

NO:
Order book
Trading
TP / SL
Backtesting

============================================================ */


/* ============================================================
CONFIG
============================================================ */

const TREND_CANDLES = 200;

const ENTRY_WINDOWS = [
    15,
    20,
    30,
    60
];

const TREND_REQUIRED = 53;

const ENTRY_REQUIRED = 50;

const ENTRY_CONFIRMATIONS_REQUIRED = 3;

const CYCLE_LENGTH = 10;

const HISTORY_LIMIT = 500;

const KLINE_LIMIT = 1000;

const REFRESH_BUFFER_MS = 1200;


/* ============================================================
STATE
============================================================ */

let priceChart = null;

let candleSeries = null;

let currentCandles = [];

let currentSymbol = "POLUSDT";

let currentTimeframe = "1m";

let currentCycle = [];

let cycleHistory = [];

let refreshTimer = null;

let loading = false;


/*
    All chart markers live here.

    We keep them in browser memory for the
    entire page session.
*/
let signalMarkers = [];


/*
    Lightweight Charts newer API uses:

        LightweightCharts.createSeriesMarkers()

    instead of:

        candleSeries.setMarkers()

    This controller manages the markers.
*/
let signalMarkerController = null;


/*
    Prevent duplicate markers.
*/
const signalMarkerKeys = new Set();


/* ============================================================
HELPERS
============================================================ */

function element(id) {

    return document.getElementById(id);

}


function setText(id, value) {

    const el = element(id);

    if (!el) {
        return;
    }

    el.textContent = value;

}


function escapeHtml(value) {

    return String(value)
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");

}


function formatPercent(value) {

    const number = Number(value);

    if (!Number.isFinite(number)) {
        return "--";
    }

    return `${number.toFixed(2)}%`;

}


function formatSignedPercent(value) {

    const number = Number(value);

    if (!Number.isFinite(number)) {
        return "--";
    }

    if (number > 0) {
        return `+${number.toFixed(2)}%`;
    }

    return `${number.toFixed(2)}%`;

}


/* ============================================================
BERLIN TIME
============================================================ */

/*
    All displayed times are explicitly forced to Berlin.

    We do NOT modify WEEX candle timestamps.

    We only change how the timestamps are displayed.
*/

function formatTime(timestamp) {

    if (!timestamp) {
        return "--";
    }

    const date =
        new Date(timestamp);

    if (
        !Number.isFinite(
            date.getTime()
        )
    ) {

        return "--";

    }

    return date.toLocaleTimeString(
        "de-DE",
        {
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
            hour12: false,
            timeZone: "Europe/Berlin"
        }
    );

}


/*
    Lightweight Charts sends Unix seconds
    to the formatter.

    Display in Berlin time.
*/

function formatChartTime(timestamp) {

    const number =
        Number(timestamp);

    if (!Number.isFinite(number)) {
        return "";
    }

    const date =
        new Date(
            number * 1000
        );

    if (
        !Number.isFinite(
            date.getTime()
        )
    ) {

        return "";

    }

    return date.toLocaleTimeString(
        "de-DE",
        {
            hour: "2-digit",
            minute: "2-digit",
            hour12: false,
            timeZone: "Europe/Berlin"
        }
    );

}


function formatChartTick(timestamp) {

    const number =
        Number(timestamp);

    if (!Number.isFinite(number)) {
        return "";
    }

    const date =
        new Date(
            number * 1000
        );

    if (
        !Number.isFinite(
            date.getTime()
        )
    ) {

        return "";

    }

    return date.toLocaleTimeString(
        "de-DE",
        {
            hour: "2-digit",
            minute: "2-digit",
            hour12: false,
            timeZone: "Europe/Berlin"
        }
    );

}


/* ============================================================
CONNECTION
============================================================ */

function setConnection(online) {

    const dot =
        element("connectionDot");

    const text =
        element("connectionText");

    if (!dot || !text) {
        return;
    }

    dot.className =
        online
            ? "status-dot online"
            : "status-dot offline";

    text.textContent =
        online
            ? "ONLINE"
            : "OFFLINE";

}


/* ============================================================
DIRECTION CLASS
============================================================ */

function directionClass(direction) {

    if (direction === "LONG") {
        return "long";
    }

    if (direction === "SHORT") {
        return "short";
    }

    return "neutral";

}


/* ============================================================
WEEX CANDLE CONVERSION
============================================================ */

function convertWEEXCandles(data) {

    if (!Array.isArray(data)) {
        return [];
    }

    const candles = [];


    for (const raw of data) {

        if (
            !Array.isArray(raw) ||
            raw.length < 5
        ) {

            continue;

        }


        const timestamp =
            Number(raw[0]);

        const open =
            Number(raw[1]);

        const high =
            Number(raw[2]);

        const low =
            Number(raw[3]);

        const close =
            Number(raw[4]);

        const volume =
            Number(raw[5] ?? 0);


        if (
            !Number.isFinite(timestamp) ||
            !Number.isFinite(open) ||
            !Number.isFinite(high) ||
            !Number.isFinite(low) ||
            !Number.isFinite(close)
        ) {

            continue;

        }


        candles.push({

            time:
                timestamp > 100000000000
                    ? Math.floor(timestamp / 1000)
                    : timestamp,

            open,
            high,
            low,
            close,
            volume

        });

    }


    /*
        WEEX should already return chronological data,
        but we sort it anyway.
    */

    candles.sort(
        (a, b) =>
            a.time - b.time
    );


    /*
        Remove duplicate timestamps.
    */

    const unique = [];


    for (const candle of candles) {

        const previous =
            unique[
                unique.length - 1
            ];


        if (
            previous &&
            previous.time === candle.time
        ) {

            unique[
                unique.length - 1
            ] = candle;

        } else {

            unique.push(candle);

        }

    }


    return unique;

}


/* ============================================================
LOAD WEEX KLINES
============================================================ */

async function fetchCandles() {

    const url =
        `/chart/klines` +
        `?symbol=${encodeURIComponent(currentSymbol)}` +
        `&interval=${encodeURIComponent(currentTimeframe)}` +
        `&limit=${KLINE_LIMIT}`;


    const response =
        await fetch(
            url,
            {
                cache: "no-store"
            }
        );


    if (!response.ok) {

        throw new Error(
            `Kline request failed: HTTP ${response.status}`
        );

    }


    const data =
        await response.json();


    return convertWEEXCandles(data);

}


/* ============================================================
PRICE CHART
============================================================ */

function createPriceChart() {

    const container =
        element("priceChart");


    if (!container) {

        console.error(
            "PRICE CHART CONTAINER NOT FOUND."
        );

        return;

    }


    if (
        typeof LightweightCharts ===
        "undefined"
    ) {

        console.error(
            "Lightweight Charts is not available."
        );

        return;

    }


    priceChart =
        LightweightCharts.createChart(
            container,
            {

                layout: {

                    background: {
                        color: "#111720"
                    },

                    textColor: "#8b98a7"

                },


                grid: {

                    vertLines: {
                        color: "#1c2530"
                    },

                    horzLines: {
                        color: "#1c2530"
                    }

                },


                rightPriceScale: {

                    borderColor:
                        "#27313d"

                },


                timeScale: {

                    borderColor:
                        "#27313d",

                    timeVisible:
                        true,

                    secondsVisible:
                        false,

                    /*
                        Force chart labels to
                        Berlin local time.
                    */

                    tickMarkFormatter:
                        formatChartTick

                },


                localization: {

                    timeFormatter:
                        formatChartTime

                },


                crosshair: {

                    mode:
                        LightweightCharts.CrosshairMode
                            ? LightweightCharts.CrosshairMode.Normal
                            : 0

                }

            }
        );


    /*
        Modern Lightweight Charts API.

        IMPORTANT:

        Do NOT use:

            candleSeries.setMarkers()

        with this version.
    */

    candleSeries =
        priceChart.addSeries(
            LightweightCharts.CandlestickSeries,
            {

                upColor:
                    "#26a69a",

                downColor:
                    "#ef5350",

                borderVisible:
                    false,

                wickUpColor:
                    "#26a69a",

                wickDownColor:
                    "#ef5350"

            }
        );


    /*
        Prepare the marker controller.

        We do not create it until the
        candle series exists.
    */

    signalMarkerController = null;

}


/* ============================================================
MARKER HELPERS
============================================================ */

function getMarkerTimeFromMilliseconds(
    timestamp
) {

    const milliseconds =
        Number(timestamp);


    if (
        !Number.isFinite(
            milliseconds
        )
    ) {

        return null;

    }


    const seconds =
        Math.floor(
            milliseconds / 1000
        );


    if (
        !Number.isFinite(seconds)
    ) {

        return null;

    }


    return seconds;

}


/*
    Re-create / update the modern
    Lightweight Charts marker controller.
*/
function updateSignalMarkers() {

    if (!candleSeries) {
        return;
    }


    /*
        Modern Lightweight Charts.

        This is the API used by the
        current chart library.
    */

    if (
        typeof LightweightCharts !== "undefined" &&
        typeof LightweightCharts.createSeriesMarkers === "function"
    ) {

        try {

            if (!signalMarkerController) {

                signalMarkerController =
                    LightweightCharts.createSeriesMarkers(
                        candleSeries,
                        signalMarkers
                    );

            } else {

                signalMarkerController.setMarkers(
                    signalMarkers
                );

            }

            return;

        } catch (error) {

            console.error(
                "SIGNAL MARKER ERROR:",
                error
            );

            return;

        }

    }


    /*
        If the installed Lightweight Charts
        library is too old/new for the expected
        marker API, do NOT crash the entire
        Price Lab.

        The chart itself continues working.
    */

    console.warn(
        "Lightweight Charts marker API is not available. Chart markers are disabled."
    );

}


/* ============================================================
CLEAR SIGNAL MARKERS
============================================================ */

function clearSignalMarkers() {

    signalMarkers = [];

    signalMarkerKeys.clear();


    if (
        signalMarkerController &&
        typeof signalMarkerController.setMarkers === "function"
    ) {

        try {

            signalMarkerController.setMarkers([]);

        } catch (error) {

            console.error(
                "CLEAR MARKERS ERROR:",
                error
            );

        }

    }


    /*
        Reset controller.

        This is useful when switching
        to a completely different symbol.
    */

    signalMarkerController = null;


    /*
        Recreate empty controller if possible.
    */

    updateSignalMarkers();

}


/* ============================================================
ADD INDIVIDUAL SIGNAL MARKER
============================================================ */

function addSignalMarker(snapshot) {

    if (
        !snapshot ||
        !candleSeries
    ) {

        return;

    }


    /*
        Only directional final decisions
        receive markers.

        NEUTRAL = no marker.
    */

    if (
        snapshot.decision !== "LONG" &&
        snapshot.decision !== "SHORT"
    ) {

        return;

    }


    const candleTime =
        getMarkerTimeFromMilliseconds(
            snapshot.candleTime
        );


    if (
        candleTime === null
    ) {

        return;

    }


    /*
        Unique key:

            timestamp + decision

        This prevents duplicate markers
        when the same candle is fetched
        multiple times.
    */

    const markerKey =
        `${candleTime}_${snapshot.decision}`;


    if (
        signalMarkerKeys.has(markerKey)
    ) {

        return;

    }


    signalMarkerKeys.add(
        markerKey
    );


    signalMarkers.push({

        time:
            candleTime,

        position:
            snapshot.decision === "LONG"
                ? "belowBar"
                : "aboveBar",

        shape:
            snapshot.decision === "LONG"
                ? "arrowUp"
                : "arrowDown",

        color:
            snapshot.decision === "LONG"
                ? "#26a69a"
                : "#ef5350",

        text:
            snapshot.decision,

        size:
            2

    });


    /*
        Lightweight Charts requires
        markers to be sorted.
    */

    signalMarkers.sort(
        (a, b) =>
            a.time - b.time
    );


    /*
        Keep the one-day test lightweight.

        1000 markers is more than enough.
    */

    while (
        signalMarkers.length > 1000
    ) {

        const removed =
            signalMarkers.shift();


        if (removed) {

            for (
                const key of signalMarkerKeys
            ) {

                if (
                    key.startsWith(
                        `${removed.time}_`
                    )
                ) {

                    signalMarkerKeys.delete(
                        key
                    );

                }

            }

        }

    }


    updateSignalMarkers();

}


/* ============================================================
ADD COMPLETED CYCLE MARKER
============================================================ */

function addCycleMarker(cycle) {

    if (
        !cycle ||
        !candleSeries
    ) {

        return;

    }


    if (
        cycle.decision !== "LONG" &&
        cycle.decision !== "SHORT"
    ) {

        return;

    }


    /*
        Prefer the exact candle that
        completed the cycle.
    */

    let candleTime =
        getMarkerTimeFromMilliseconds(
            cycle.endCandleTime
        );


    /*
        Compatibility fallback.
    */

    if (candleTime === null) {

        const endDate =
            new Date(
                cycle.endTime
            );


        if (
            Number.isFinite(
                endDate.getTime()
            )
        ) {

            candleTime =
                Math.floor(
                    endDate.getTime() / 1000
                );

        }

    }


    if (
        candleTime === null
    ) {

        return;

    }


    const text =
        `CYCLE ${cycle.decision}`;


    const markerKey =
        `${candleTime}_${text}`;


    if (
        signalMarkerKeys.has(
            markerKey
        )
    ) {

        return;

    }


    signalMarkerKeys.add(
        markerKey
    );


    signalMarkers.push({

        time:
            candleTime,

        position:
            cycle.decision === "LONG"
                ? "belowBar"
                : "aboveBar",

        shape:
            cycle.decision === "LONG"
                ? "arrowUp"
                : "arrowDown",

        color:
            cycle.decision === "LONG"
                ? "#00ff9d"
                : "#ff405d",

        text,

        size:
            3

    });


    signalMarkers.sort(
        (a, b) =>
            a.time - b.time
    );


    updateSignalMarkers();

}


/* ============================================================
REBUILD SIGNAL MARKERS
============================================================ */

function rebuildSignalMarkers() {

    if (!candleSeries) {
        return;
    }


    signalMarkers = [];

    signalMarkerKeys.clear();


    /*
        --------------------------------------------------------
        COMPLETED CYCLES
        --------------------------------------------------------
    */

    for (
        const cycle of cycleHistory
    ) {

        if (
            cycle.decision !== "LONG" &&
            cycle.decision !== "SHORT"
        ) {

            continue;

        }


        let candleTime =
            getMarkerTimeFromMilliseconds(
                cycle.endCandleTime
            );


        /*
            Compatibility with older cycle objects.
        */

        if (candleTime === null) {

            const endDate =
                new Date(
                    cycle.endTime
                );


            if (
                Number.isFinite(
                    endDate.getTime()
                )
            ) {

                candleTime =
                    Math.floor(
                        endDate.getTime() /
                        1000
                    );

            }

        }


        if (
            candleTime === null
        ) {

            continue;

        }


        const text =
            `CYCLE ${cycle.decision}`;


        const markerKey =
            `${candleTime}_${text}`;


        if (
            signalMarkerKeys.has(
                markerKey
            )
        ) {

            continue;

        }


        signalMarkerKeys.add(
            markerKey
        );


        signalMarkers.push({

            time:
                candleTime,

            position:
                cycle.decision === "LONG"
                    ? "belowBar"
                    : "aboveBar",

            shape:
                cycle.decision === "LONG"
                    ? "arrowUp"
                    : "arrowDown",

            color:
                cycle.decision === "LONG"
                    ? "#00ff9d"
                    : "#ff405d",

            text,

            size:
                3

        });

    }


    /*
        --------------------------------------------------------
        CURRENT 1-MINUTE FINAL DECISIONS
        --------------------------------------------------------
    */

    for (
        const snapshot of currentCycle
    ) {

        if (
            snapshot.decision !== "LONG" &&
            snapshot.decision !== "SHORT"
        ) {

            continue;

        }


        const candleTime =
            getMarkerTimeFromMilliseconds(
                snapshot.candleTime
            );


        if (
            candleTime === null
        ) {

            continue;

        }


        const markerKey =
            `${candleTime}_${snapshot.decision}`;


        if (
            signalMarkerKeys.has(
                markerKey
            )
        ) {

            continue;

        }


        signalMarkerKeys.add(
            markerKey
        );


        signalMarkers.push({

            time:
                candleTime,

            position:
                snapshot.decision === "LONG"
                    ? "belowBar"
                    : "aboveBar",

            shape:
                snapshot.decision === "LONG"
                    ? "arrowUp"
                    : "arrowDown",

            color:
                snapshot.decision === "LONG"
                    ? "#26a69a"
                    : "#ef5350",

            text:
                snapshot.decision,

            size:
                2

        });

    }


    /*
        Sort everything.
    */

    signalMarkers.sort(
        (a, b) =>
            a.time - b.time
    );


    /*
        Final duplicate protection.
    */

    const unique = [];

    const uniqueKeys =
        new Set();


    for (
        const marker of signalMarkers
    ) {

        const key =
            `${marker.time}_${marker.text}`;


        if (
            uniqueKeys.has(key)
        ) {

            continue;

        }


        uniqueKeys.add(key);

        unique.push(
            marker
        );

    }


    signalMarkers =
        unique;


    signalMarkerKeys.clear();


    for (
        const marker of signalMarkers
    ) {

        signalMarkerKeys.add(
            `${marker.time}_${marker.text}`
        );

    }


    updateSignalMarkers();

}


/* ============================================================
UPDATE PRICE CHART
============================================================ */

function updatePriceChart(candles) {

    if (
        !candleSeries ||
        !Array.isArray(candles)
    ) {

        return;

    }


    candleSeries.setData(
        candles
    );


    /*
        Rebuild markers after candle data.
    */

    rebuildSignalMarkers();


    priceChart
        ?.timeScale()
        .fitContent();


    setText(
        "candleCount",
        `${candles.length} candles`
    );

}


/* ============================================================
BASIC PRICE MOVEMENT
============================================================ */

function calculateCandleChange(candle) {

    if (
        !candle ||
        !Number.isFinite(candle.open) ||
        candle.open === 0
    ) {

        return null;

    }


    return (
        (
            candle.close -
            candle.open
        ) /
        candle.open
    ) * 100;

}


function calculateLookbackChange(
    candles,
    candleCount
) {

    if (
        !Array.isArray(candles) ||
        candles.length <= candleCount
    ) {

        return null;

    }


    const current =
        candles[
            candles.length - 1
        ];


    const previous =
        candles[
            candles.length -
            1 -
            candleCount
        ];


    if (
        !current ||
        !previous ||
        !Number.isFinite(
            previous.close
        ) ||
        previous.close === 0
    ) {

        return null;

    }


    return (
        (
            current.close -
            previous.close
        ) /
        previous.close
    ) * 100;

}


function setPercentageValue(
    id,
    value
) {

    const el =
        element(id);


    if (!el) {
        return;
    }


    el.textContent =
        formatSignedPercent(value);


    el.classList.remove(
        "positive",
        "negative"
    );


    if (Number(value) > 0) {

        el.classList.add(
            "positive"
        );

    }


    if (Number(value) < 0) {

        el.classList.add(
            "negative"
        );

    }

}


function updatePriceMovement(candles) {

    if (!candles.length) {
        return;
    }


    const current =
        candles[
            candles.length - 1
        ];


    setPercentageValue(
        "changeCurrent",
        calculateCandleChange(
            current
        )
    );


    setPercentageValue(
        "change5",
        calculateLookbackChange(
            candles,
            5
        )
    );


    setPercentageValue(
        "change10",
        calculateLookbackChange(
            candles,
            10
        )
    );


    setPercentageValue(
        "change20",
        calculateLookbackChange(
            candles,
            20
        )
    );


    setPercentageValue(
        "change60",
        calculateLookbackChange(
            candles,
            60
        )
    );

}


/* ============================================================
DIRECTIONAL STRENGTH
============================================================ */

function calculateDirectionalStrength(
    candles,
    windowSize
) {

    if (
        !Array.isArray(candles) ||
        candles.length <
            windowSize + 1
    ) {

        return null;

    }


    const start =
        candles.length -
        windowSize -
        1;


    let upMovement = 0;

    let downMovement = 0;


    for (
        let i = start + 1;
        i < candles.length;
        i++
    ) {

        const previous =
            candles[i - 1];

        const current =
            candles[i];


        if (
            !previous ||
            !current ||
            !Number.isFinite(
                previous.close
            ) ||
            !Number.isFinite(
                current.close
            ) ||
            previous.close === 0
        ) {

            continue;

        }


        const change =
            (
                (
                    current.close -
                    previous.close
                ) /
                previous.close
            ) * 100;


        if (change > 0) {

            upMovement += change;

        }


        if (change < 0) {

            downMovement +=
                Math.abs(change);

        }

    }


    const totalMovement =
        upMovement +
        downMovement;


    if (
        totalMovement <= 0
    ) {

        return {

            direction:
                "NEUTRAL",

            rawDirection:
                "NEUTRAL",

            strength:
                0,

            upMovement:
                0,

            downMovement:
                0,

            totalMovement:
                0

        };

    }


    const upStrength =
        (
            upMovement /
            totalMovement
        ) * 100;


    const downStrength =
        (
            downMovement /
            totalMovement
        ) * 100;


    if (
        upStrength >=
        downStrength
    ) {

        return {

            direction:
                upStrength >=
                TREND_REQUIRED
                    ? "LONG"
                    : "NEUTRAL",

            rawDirection:
                "LONG",

            strength:
                upStrength,

            upMovement,

            downMovement,

            totalMovement

        };

    }


    return {

        direction:
            downStrength >=
            TREND_REQUIRED
                ? "SHORT"
                : "NEUTRAL",

        rawDirection:
            "SHORT",

        strength:
            downStrength,

        upMovement,

        downMovement,

        totalMovement

    };

}


/* ============================================================
TREND
============================================================ */

function calculateTrend(candles) {

    const result =
        calculateDirectionalStrength(
            candles,
            TREND_CANDLES
        );


    if (!result) {
        return null;
    }


    return {

        ...result,

        window:
            TREND_CANDLES,

        required:
            TREND_REQUIRED

    };

}


/* ============================================================
ENTRY
============================================================ */

function calculateEntry(
    candles,
    windowSize
) {

    const result =
        calculateDirectionalStrength(
            candles,
            windowSize
        );


    if (!result) {
        return null;
    }


    let direction =
        "NEUTRAL";


    if (
        result.upMovement >
            result.downMovement &&
        result.strength >=
            ENTRY_REQUIRED
    ) {

        direction =
            "LONG";

    } else if (
        result.downMovement >
            result.upMovement &&
        result.strength >=
            ENTRY_REQUIRED
    ) {

        direction =
            "SHORT";

    }


    return {

        ...result,

        window:
            windowSize,

        required:
            ENTRY_REQUIRED,

        direction

    };

}


/* ============================================================
CAVEMAN ENTRY CONFIRMATION
============================================================ */

function calculateEntryConfirmation(
    entries,
    trend
) {

    if (
        !trend ||
        !entries
    ) {

        return {

            decision:
                "NEUTRAL",

            longVotes:
                0,

            shortVotes:
                0,

            neutralVotes:
                4,

            confirmed:
                false,

            rawLongVotes:
                0,

            rawShortVotes:
                0

        };

    }


    let rawLongVotes = 0;

    let rawShortVotes = 0;

    let neutralVotes = 0;


    for (
        const windowSize of
        ENTRY_WINDOWS
    ) {

        const entry =
            entries[windowSize];


        if (!entry) {

            neutralVotes++;

            continue;

        }


        if (
            entry.direction ===
            "LONG"
        ) {

            rawLongVotes++;

        } else if (
            entry.direction ===
            "SHORT"
        ) {

            rawShortVotes++;

        } else {

            neutralVotes++;

        }

    }


    let decision =
        "NEUTRAL";


    let longVotes = 0;

    let shortVotes = 0;


    /*
        ========================================================
        CAVEMAN PULLBACK LOGIC
        ========================================================

        LONG TREND:

            RAW SHORT votes
            are the pullback.

            3 of 4 SHORT
                =
            FINAL LONG


        SHORT TREND:

            RAW LONG votes
            are the pullback.

            3 of 4 LONG
                =
            FINAL SHORT

        IMPORTANT:

        We do NOT flip the entry UI.

        The flip happens here,
        in the final decision.
    */


    if (
        trend.direction ===
        "LONG"
    ) {

        longVotes =
            rawShortVotes;

        shortVotes =
            rawLongVotes;


        if (
            rawShortVotes >=
            ENTRY_CONFIRMATIONS_REQUIRED
        ) {

            decision =
                "LONG";

        }

    } else if (
        trend.direction ===
        "SHORT"
    ) {

        /*
            THIS IS THE IMPORTANT SHORT FIX.

            SHORT trend + 3 LONG raw entries
                =
            SHORT final decision.
        */

        shortVotes =
            rawLongVotes;

        longVotes =
            rawShortVotes;


        if (
            rawLongVotes >=
            ENTRY_CONFIRMATIONS_REQUIRED
        ) {

            decision =
                "SHORT";

        }

    }


    return {

        decision,

        longVotes,

        shortVotes,

        neutralVotes,

        confirmed:
            decision !== "NEUTRAL",

        rawLongVotes,

        rawShortVotes

    };

}


/* ============================================================
BUILD SIGNAL SNAPSHOT
============================================================ */

function calculateSignalSnapshot(
    candles
) {

    const trend =
        calculateTrend(
            candles
        );


    const entries = {};


    for (
        const windowSize of
        ENTRY_WINDOWS
    ) {

        entries[windowSize] =
            calculateEntry(
                candles,
                windowSize
            );

    }


    const confirmation =
        calculateEntryConfirmation(
            entries,
            trend
        );


    let decision =
        confirmation.decision;


    let reason =
        "WAITING";


    if (!trend) {

        reason =
            "NOT_ENOUGH_200_CANDLES";

        decision =
            "NEUTRAL";

    } else if (
        trend.direction ===
        "NEUTRAL"
    ) {

        reason =
            `TREND_BELOW_${TREND_REQUIRED}%`;

        decision =
            "NEUTRAL";

    } else if (
        confirmation.confirmed
    ) {

        /*
            FINAL DECISION IS ALREADY
            CORRECTLY FLIPPED.

            LONG trend + 3 SHORT
                =
            LONG

            SHORT trend + 3 LONG
                =
            SHORT
        */

        if (
            trend.direction ===
            "LONG"
        ) {

            reason =
                `LONG_TREND_${trend.strength.toFixed(2)}_PULLBACK_3_OF_4_SHORT`;

        } else {

            reason =
                `SHORT_TREND_${trend.strength.toFixed(2)}_PULLBACK_3_OF_4_LONG`;

        }

    } else {

        reason =
            `${trend.direction}_TREND_PULLBACK_NOT_CONFIRMED`;

        decision =
            "NEUTRAL";

    }


    const candle =
        candles[
            candles.length - 1
        ];


    return {

        timestamp:
            new Date().toISOString(),

        candleTime:
            candle?.time
                ? candle.time * 1000
                : Date.now(),

        symbol:
            currentSymbol,

        timeframe:
            currentTimeframe,

        trend,

        entries,

        confirmation,

        decision,

        reason,

        price:
            candle?.close ?? null

    };

}


/* ============================================================
UPDATE TREND UI
============================================================ */

function updateTrendUI(trend) {

    if (!trend) {

        setText(
            "trendDirection",
            "--"
        );

        setText(
            "trendStrength",
            "--"
        );

        setText(
            "trendLongMovement",
            "--"
        );

        setText(
            "trendShortMovement",
            "--"
        );

        setText(
            "trendMessage",
            "Waiting for 200 candles..."
        );

        return;

    }


    const direction =
        trend.direction;


    const directionEl =
        element(
            "trendDirection"
        );


    if (directionEl) {

        directionEl.textContent =
            direction;

        directionEl.className =
            `big-direction ${directionClass(
                direction
            )}`;

    }


    setText(
        "trendStrength",
        formatPercent(
            trend.strength
        )
    );


    setText(
        "trendLongMovement",
        formatPercent(
            trend.upMovement
        )
    );


    setText(
        "trendShortMovement",
        formatPercent(
            trend.downMovement
        )
    );


    const badge =
        element(
            "trendBadge"
        );


    if (badge) {

        badge.textContent =
            direction === "NEUTRAL"
                ? `BELOW ${TREND_REQUIRED}%`
                : direction;

        badge.className =
            `signal-badge ${directionClass(
                direction
            )}`;

    }


    const bar =
        element(
            "trendStrengthBar"
        );


    if (bar) {

        bar.style.width =
            `${Math.min(
                100,
                Math.max(
                    0,
                    trend.strength
                )
            )}%`;

        bar.className =
            `strength-fill ${directionClass(
                direction
            )}`;

    }


    if (
        direction ===
        "LONG"
    ) {

        setText(
            "trendMessage",
            `LONG trend confirmed at ${trend.strength.toFixed(2)}%. Looking for SHORT pullback signals.`
        );

    } else if (
        direction ===
        "SHORT"
    ) {

        setText(
            "trendMessage",
            `SHORT trend confirmed at ${trend.strength.toFixed(2)}%. Looking for LONG pullback signals.`
        );

    } else {

        setText(
            "trendMessage",
            `No trend confirmation. Strongest direction is ${trend.strength.toFixed(2)}%, below the required ${TREND_REQUIRED}%.`
        );

    }

}


/* ============================================================
UPDATE ENTRY UI
============================================================ */

function updateEntryUI(
    entries,
    confirmation,
    trend
) {

    for (
        const windowSize of
        ENTRY_WINDOWS
    ) {

        const entry =
            entries[windowSize];


        const card =
            element(
                `entryCard${windowSize}`
            );


        const direction =
            element(
                `entryDirection${windowSize}`
            );


        const strength =
            element(
                `entryStrength${windowSize}`
            );


        const up =
            element(
                `entryUp${windowSize}`
            );


        const down =
            element(
                `entryDown${windowSize}`
            );


        const status =
            element(
                `entryStatus${windowSize}`
            );


        if (!entry) {

            if (direction) {
                direction.textContent =
                    "--";
            }

            if (strength) {
                strength.textContent =
                    "--";
            }

            if (up) {
                up.textContent =
                    "--";
            }

            if (down) {
                down.textContent =
                    "--";
            }

            if (status) {
                status.textContent =
                    "Waiting";
            }

            continue;

        }


        /*
            IMPORTANT:

            Show the REAL raw entry direction.

            Do NOT flip the displayed entry.

            The pullback conversion happens
            only in calculateEntryConfirmation().
        */

        if (direction) {

            direction.textContent =
                entry.direction;

            direction.className =
                `entry-direction ${directionClass(
                    entry.direction
                )}`;

        }


        if (strength) {

            strength.textContent =
                formatPercent(
                    entry.strength
                );

        }


        if (up) {

            up.textContent =
                formatPercent(
                    entry.upMovement
                );

        }


        if (down) {

            down.textContent =
                formatPercent(
                    entry.downMovement
                );

        }


        if (card) {

            card.className =
                `entry-card ${directionClass(
                    entry.direction
                )}`;

        }


        if (status) {

            if (
                entry.direction ===
                "NEUTRAL"
            ) {

                status.textContent =
                    `Below ${ENTRY_REQUIRED}%`;

            } else if (
                trend &&
                trend.direction ===
                    "LONG" &&
                entry.direction ===
                    "SHORT"
            ) {

                status.textContent =
                    "PULLBACK FOR LONG";

            } else if (
                trend &&
                trend.direction ===
                    "SHORT" &&
                entry.direction ===
                    "LONG"
            ) {

                status.textContent =
                    "PULLBACK FOR SHORT";

            } else {

                status.textContent =
                    "NOT PULLBACK";

            }

        }

    }


    const confirmationBadge =
        element(
            "entryConfirmationBadge"
        );


    if (confirmationBadge) {

        if (
            confirmation.confirmed
        ) {

            confirmationBadge.textContent =
                `${confirmation.decision} ${Math.max(
                    confirmation.longVotes,
                    confirmation.shortVotes
                )}/4`;

            confirmationBadge.className =
                `signal-badge ${
                    directionClass(
                        confirmation.decision
                    )
                }`;

        } else {

            let pullbackVotes = 0;


            if (
                trend?.direction ===
                "LONG"
            ) {

                pullbackVotes =
                    confirmation.rawShortVotes;

            } else if (
                trend?.direction ===
                "SHORT"
            ) {

                pullbackVotes =
                    confirmation.rawLongVotes;

            }


            confirmationBadge.textContent =
                `${pullbackVotes}/4`;

            confirmationBadge.className =
                "signal-badge neutral";

        }

    }

}


/* ============================================================
UPDATE FINAL DECISION
============================================================ */

function updateFinalDecisionUI(
    snapshot
) {

    const card =
        element(
            "finalDecisionCard"
        );


    const decision =
        element(
            "finalDecision"
        );


    if (
        !card ||
        !decision
    ) {

        return;

    }


    card.className =
        `decision-card ${directionClass(
            snapshot.decision
        )}`;


    decision.textContent =
        snapshot.decision;


    setText(
        "decisionReason",
        snapshot.reason
    );

}


/* ============================================================
ADD TO CURRENT CYCLE
============================================================ */

function addToCurrentCycle(
    snapshot
) {

    /*
        Prevent duplicate processing
        of the same candle.
    */

    const last =
        currentCycle[
            currentCycle.length - 1
        ];


    if (
        last &&
        last.candleTime ===
            snapshot.candleTime
    ) {

        return false;

    }


    currentCycle.push(
        snapshot
    );


    /*
        Add immediate final signal marker.

        Only LONG / SHORT.
    */

    if (
        snapshot.decision ===
            "LONG" ||
        snapshot.decision ===
            "SHORT"
    ) {

        addSignalMarker(
            snapshot
        );

    }


    /*
        Keep the current cycle
        at maximum CYCLE_LENGTH.
    */

    if (
        currentCycle.length >
        CYCLE_LENGTH
    ) {

        currentCycle =
            currentCycle.slice(
                -CYCLE_LENGTH
            );

    }


    return true;

}


/* ============================================================
CYCLE DECISION
============================================================ */

function calculateCycleDecision(
    snapshots
) {

    let longVotes = 0;

    let shortVotes = 0;

    let neutralVotes = 0;


    for (
        const snapshot of
        snapshots
    ) {

        if (
            snapshot.decision ===
            "LONG"
        ) {

            longVotes++;

        } else if (
            snapshot.decision ===
            "SHORT"
        ) {

            shortVotes++;

        } else {

            neutralVotes++;

        }

    }


    let decision =
        "NEUTRAL";


    /*
        10-minute cycle:

        6 / 10 or more
        = directional.

        Otherwise:
        NEUTRAL.
    */

    if (
        longVotes >
            shortVotes &&
        longVotes >= 6
    ) {

        decision =
            "LONG";

    } else if (
        shortVotes >
            longVotes &&
        shortVotes >= 6
    ) {

        decision =
            "SHORT";

    }


    const last =
        snapshots[
            snapshots.length - 1
        ];


    return {

        decision,

        longVotes,

        shortVotes,

        neutralVotes,

        trend:
            last?.trend || null,

        entries:
            last?.entries || {},

        finalSnapshot:
            last || null

    };

}


/* ============================================================
BUILD CYCLE REASON
============================================================ */

/*
    IMPORTANT FIX:

    Previously the cycle reason was copied from
    the LAST snapshot:

        cycleDecision.finalSnapshot.reason

    That can create a misleading row.

    Example:

        9 LONG
        1 NEUTRAL

    Cycle decision:
        LONG

    But if the final snapshot was neutral,
    the old reason could say:

        SHORT_TREND_PULLBACK_NOT_CONFIRMED

    That makes the table look broken.

    Now the cycle reason describes the
    ACTUAL completed cycle.
*/

function buildCycleReason(
    cycleDecision
) {

    if (!cycleDecision) {
        return "CYCLE_COMPLETE";
    }


    const longVotes =
        cycleDecision.longVotes;


    const shortVotes =
        cycleDecision.shortVotes;


    const neutralVotes =
        cycleDecision.neutralVotes;


    if (
        cycleDecision.decision ===
        "LONG"
    ) {

        return (
            `CYCLE_LONG_${longVotes}_OF_${CYCLE_LENGTH}`
        );

    }


    if (
        cycleDecision.decision ===
        "SHORT"
    ) {

        return (
            `CYCLE_SHORT_${shortVotes}_OF_${CYCLE_LENGTH}`
        );

    }


    return (
        `CYCLE_NEUTRAL_${longVotes}L_${shortVotes}S_${neutralVotes}N`
    );

}


/* ============================================================
COMPLETE CYCLE
============================================================ */

function completeCycle() {

    if (
        currentCycle.length <
        CYCLE_LENGTH
    ) {

        return;

    }


    const first =
        currentCycle[0];


    const last =
        currentCycle[
            currentCycle.length - 1
        ];


    const cycleDecision =
        calculateCycleDecision(
            currentCycle
        );


    const cycle = {

        cycleId:
            cycleHistory.length + 1,

        symbol:
            currentSymbol,

        timeframe:
            currentTimeframe,

        startTime:
            first.timestamp,

        endTime:
            last.timestamp,

        /*
            Exact candle timestamp.

            Used for the cycle marker.
        */

        endCandleTime:
            last.candleTime,

        completedAt:
            new Date().toISOString(),

        candles:
            currentCycle.length,

        trend:
            cycleDecision.trend,

        entries:
            cycleDecision.entries,

        votes: {

            long:
                cycleDecision.longVotes,

            short:
                cycleDecision.shortVotes,

            neutral:
                cycleDecision.neutralVotes

        },

        decision:
            cycleDecision.decision,

        /*
            FIXED:

            This now describes the completed
            cycle itself.

            It no longer copies the last
            snapshot's reason.
        */

        reason:
            buildCycleReason(
                cycleDecision
            )

    };


    cycleHistory.unshift(
        cycle
    );


    if (
        cycleHistory.length >
        HISTORY_LIMIT
    ) {

        cycleHistory =
            cycleHistory.slice(
                0,
                HISTORY_LIMIT
            );

    }


    /*
        Add large completed-cycle marker.

        Individual signal:
            smaller arrow

        Completed cycle:
            larger arrow
            with CYCLE LONG / CYCLE SHORT
    */

    addCycleMarker(
        cycle
    );


    /*
        Start a completely fresh
        10-minute cycle.
    */

    currentCycle = [];


    renderPreviousCycleHistory();

}


/* ============================================================
CURRENT CYCLE TABLE
============================================================ */

function renderCurrentCycle() {

    const tbody =
        element(
            "currentCycleTable"
        );


    if (!tbody) {
        return;
    }


    if (!currentCycle.length) {

        tbody.innerHTML = `
            <tr>
                <td colspan="8" class="empty-table">
                    Waiting for first 1-minute calculation...
                </td>
            </tr>
        `;

        return;

    }


    tbody.innerHTML =
        currentCycle
            .slice()
            .reverse()
            .map(
                snapshot => {

                    const trend =
                        snapshot.trend;


                    const entry15 =
                        snapshot.entries[15];


                    const entry20 =
                        snapshot.entries[20];


                    const entry30 =
                        snapshot.entries[30];


                    const entry60 =
                        snapshot.entries[60];


                    return `
                        <tr>

                            <td>
                                ${escapeHtml(
                                    formatTime(
                                        snapshot.timestamp
                                    )
                                )}
                            </td>

                            <td>
                                ${escapeHtml(
                                    snapshot.symbol
                                )}
                            </td>

                            <td class="${
                                directionClass(
                                    trend?.direction
                                ) === "long"
                                    ? "table-long"
                                    : directionClass(
                                        trend?.direction
                                    ) === "short"
                                        ? "table-short"
                                        : "table-neutral"
                            }">

                                ${
                                    trend
                                        ? `${trend.direction} ${trend.strength.toFixed(2)}%`
                                        : "--"
                                }

                            </td>

                            <td class="${tableDirectionClass(
                                entry15?.direction
                            )}">
                                ${
                                    entry15
                                        ? `${entry15.direction} ${entry15.strength.toFixed(2)}%`
                                        : "--"
                                }
                            </td>

                            <td class="${tableDirectionClass(
                                entry20?.direction
                            )}">
                                ${
                                    entry20
                                        ? `${entry20.direction} ${entry20.strength.toFixed(2)}%`
                                        : "--"
                                }
                            </td>

                            <td class="${tableDirectionClass(
                                entry30?.direction
                            )}">
                                ${
                                    entry30
                                        ? `${entry30.direction} ${entry30.strength.toFixed(2)}%`
                                        : "--"
                                }
                            </td>

                            <td class="${tableDirectionClass(
                                entry60?.direction
                            )}">
                                ${
                                    entry60
                                        ? `${entry60.direction} ${entry60.strength.toFixed(2)}%`
                                        : "--"
                                }
                            </td>

                            <td class="${tableDirectionClass(
                                snapshot.decision
                            )}">
                                ${escapeHtml(
                                    snapshot.decision
                                )}
                            </td>

                        </tr>
                    `;

                }
            )
            .join("");

}


/* ============================================================
TABLE DIRECTION CLASS
============================================================ */

function tableDirectionClass(
    direction
) {

    if (
        direction ===
        "LONG"
    ) {

        return "table-long";

    }


    if (
        direction ===
        "SHORT"
    ) {

        return "table-short";

    }


    return "table-neutral";

}


/* ============================================================
PREVIOUS CYCLE TABLE
============================================================ */

function renderPreviousCycleHistory() {

    const tbody =
        element(
            "previousCycleTable"
        );


    if (!tbody) {
        return;
    }


    setText(
        "completedCycleCount",
        `${cycleHistory.length} cycle${
            cycleHistory.length === 1
                ? ""
                : "s"
        }`
    );


    if (!cycleHistory.length) {

        tbody.innerHTML = `
            <tr>
                <td colspan="6" class="empty-table">
                    No completed cycles yet.
                </td>
            </tr>
        `;

        return;

    }


    tbody.innerHTML =
        cycleHistory
            .map(
                cycle => {

                    const trend =
                        cycle.trend;


                    const votes =
                        `${cycle.votes.long}L / ${cycle.votes.short}S / ${cycle.votes.neutral}N`;


                    return `
                        <tr>

                            <td>
                                ${escapeHtml(
                                    formatTime(
                                        cycle.completedAt
                                    )
                                )}
                            </td>

                            <td>
                                ${escapeHtml(
                                    cycle.symbol
                                )}
                            </td>

                            <td class="${tableDirectionClass(
                                trend?.direction
                            )}">
                                ${
                                    trend
                                        ? `${trend.direction} ${trend.strength.toFixed(2)}%`
                                        : "--"
                                }
                            </td>

                            <td>
                                ${escapeHtml(
                                    votes
                                )}
                            </td>

                            <td class="${tableDirectionClass(
                                cycle.decision
                            )}">
                                ${escapeHtml(
                                    cycle.decision
                                )}
                            </td>

                            <td class="reason">
                                ${escapeHtml(
                                    cycle.reason
                                )}
                            </td>

                        </tr>
                    `;

                }
            )
            .join("");

}


/* ============================================================
CYCLE UI
============================================================ */

function updateCycleUI() {

    setText(
        "cycleProgress",
        `${currentCycle.length} / ${CYCLE_LENGTH}`
    );


    setText(
        "cycleHistoryCount",
        `${currentCycle.length} / ${CYCLE_LENGTH}`
    );


    if (
        currentCycle.length ===
        0
    ) {

        setText(
            "cycleStatus",
            "Waiting"
        );

    } else if (
        currentCycle.length <
        CYCLE_LENGTH
    ) {

        const remaining =
            CYCLE_LENGTH -
            currentCycle.length;


        setText(
            "cycleStatus",
            `${remaining} minute${
                remaining === 1
                    ? ""
                    : "s"
            } remaining`
        );

    } else {

        setText(
            "cycleStatus",
            "Completing cycle..."
        );

    }

}


/* ============================================================
PROCESS ONE NEW MARKET UPDATE
============================================================ */

function processMarketUpdate(
    candles
) {

    currentCandles =
        candles;


    /*
        Update actual chart data first.
    */

    updatePriceChart(
        candles
    );


    /*
        Update price movement cards.
    */

    updatePriceMovement(
        candles
    );


    /*
        Calculate one complete
        one-minute signal snapshot.
    */

    const snapshot =
        calculateSignalSnapshot(
            candles
        );


    /*
        Update trend.
    */

    updateTrendUI(
        snapshot.trend
    );


    /*
        Update 15 / 20 / 30 / 60 entries.
    */

    updateEntryUI(
        snapshot.entries,
        snapshot.confirmation,
        snapshot.trend
    );


    /*
        Update current final decision.
    */

    updateFinalDecisionUI(
        snapshot
    );


    /*
        Add exactly one calculation
        for the current candle.
    */

    const added =
        addToCurrentCycle(
            snapshot
        );


    /*
        When 10 unique one-minute
        snapshots exist, complete cycle.
    */

    if (added) {

        if (
            currentCycle.length >=
            CYCLE_LENGTH
        ) {

            completeCycle();

        }

    }


    /*
        Update cycle UI.
    */

    updateCycleUI();


    renderCurrentCycle();


    /*
        Rebuild markers after everything.

        This guarantees:

        - current signals
        - completed cycle markers
        - candle refreshes

        are all represented correctly.
    */

    rebuildSignalMarkers();


    /*
        Explicit Berlin time.
    */

    setText(
        "lastUpdate",
        formatTime(
            snapshot.timestamp
        )
    );


    setConnection(
        true
    );

}


/* ============================================================
LOAD MARKET
============================================================ */

async function loadMarket() {

    if (loading) {
        return;
    }


    loading = true;


    const button =
        element(
            "loadButton"
        );


    if (button) {

        button.disabled =
            true;

        button.textContent =
            "Loading...";

    }


    try {

        const symbolInput =
            element(
                "symbol"
            );


        const timeframeInput =
            element(
                "timeframe"
            );


        currentSymbol =
            (
                symbolInput?.value ||
                "POLUSDT"
            )
                .trim()
                .toUpperCase();


        currentTimeframe =
            timeframeInput?.value ||
            "1m";


        if (!currentSymbol) {

            throw new Error(
                "Symbol is required."
            );

        }


        /*
            Fetch first.

            We only reset the cycle/markers
            after we know the market loaded.
        */

        const candles =
            await fetchCandles();


        if (
            candles.length <
            TREND_CANDLES + 1
        ) {

            throw new Error(
                `Need at least ${TREND_CANDLES + 1} candles. WEEX returned ${candles.length}.`
            );

        }


        /*
            New market load means:

            fresh 10-minute experimental cycle.
        */

        currentCycle = [];


        /*
            Clear old markers.

            This prevents markers from
            another symbol appearing on
            the new chart.
        */

        clearSignalMarkers();


        /*
            Load actual market data.
        */

        processMarketUpdate(
            candles
        );


        /*
            Start the one-minute timer.
        */

        scheduleNextRefresh();


    } catch (error) {

        console.error(
            "PRICE LAB ERROR:",
            error
        );


        setConnection(
            false
        );


        setText(
            "trendMessage",
            error.message ||
            "Failed to load market."
        );


    } finally {

        loading = false;


        if (button) {

            button.disabled =
                false;

            button.textContent =
                "Load Market";

        }

    }

}


/* ============================================================
1-MINUTE REFRESH SCHEDULER
============================================================ */

function scheduleNextRefresh() {

    if (refreshTimer) {

        clearTimeout(
            refreshTimer
        );

        refreshTimer =
            null;

    }


    const now =
        new Date();


    /*
        Next exact minute boundary.
    */

    const nextMinute =
        new Date(
            now.getTime()
        );


    nextMinute.setSeconds(
        0,
        0
    );


    nextMinute.setMinutes(
        nextMinute.getMinutes() +
        1
    );


    /*
        Add a small buffer.

        Example:

        07:20:00
        candle closes/updates

        Wait until:

        07:21:01.200
    */

    const delay =
        Math.max(
            1000,
            nextMinute.getTime() -
                now.getTime() +
                REFRESH_BUFFER_MS
        );


    refreshTimer =
        setTimeout(
            async () => {

                await refreshMarket();

                scheduleNextRefresh();

            },
            delay
        );

}


/* ============================================================
REFRESH MARKET
============================================================ */

async function refreshMarket() {

    if (loading) {
        return;
    }


    try {

        loading = true;


        const candles =
            await fetchCandles();


        if (
            candles.length <
            TREND_CANDLES + 1
        ) {

            throw new Error(
                `Not enough candles: ${candles.length}`
            );

        }


        processMarketUpdate(
            candles
        );


    } catch (error) {

        console.error(
            "1-MINUTE UPDATE ERROR:",
            error
        );


        setConnection(
            false
        );


        setText(
            "trendMessage",
            error.message ||
            "1-minute update failed."
        );


    } finally {

        loading = false;

    }

}


/* ============================================================
RESIZE
============================================================ */

function handleResize() {

    const container =
        element(
            "priceChart"
        );


    if (
        !container ||
        !priceChart
    ) {

        return;

    }


    priceChart.resize(
        container.clientWidth,
        container.clientHeight
    );

}


/* ============================================================
EVENTS
============================================================ */

function setupEvents() {

    element("symbol")
        ?.addEventListener(
            "keydown",
            event => {

                if (
                    event.key ===
                    "Enter"
                ) {

                    loadMarket();

                }

            }
        );


    element("loadButton")
        ?.addEventListener(
            "click",
            () => {

                loadMarket();

            }
        );


    window.addEventListener(
        "resize",
        handleResize
    );

}


/* ============================================================
INITIALIZE
============================================================ */

window.addEventListener(
    "DOMContentLoaded",
    async () => {

        try {

            createPriceChart();


            setupEvents();


            await loadMarket();


        } catch (error) {

            console.error(
                "PRICE LAB INITIALIZATION ERROR:",
                error
            );


            setConnection(
                false
            );


            setText(
                "trendMessage",
                error.message ||
                "Price Lab initialization failed."
            );

        }

    }
);

