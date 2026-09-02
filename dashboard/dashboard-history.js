// ============================================================
// DASHBOARD HISTORY
// ============================================================

let selectedHistoryCoin = "";


// ============================================================
// SYMBOL SELECTOR
// ============================================================

function updateHistorySymbolSelector(managedSymbols) {

    const select =
        document.getElementById(
            "historySymbolSelect"
        );

    if (!select) {
        return;
    }


    if (
        !Array.isArray(managedSymbols) ||
        managedSymbols.length === 0
    ) {

        select.innerHTML =
            `<option value="">NO MANAGED COINS</option>`;

        selectedHistoryCoin = "";

        resetHistoryCycleCard();

        return;
    }


    const symbols =
        managedSymbols
            .map(
                symbol =>
                    String(symbol)
                        .trim()
                        .toUpperCase()
            )
            .filter(
                symbol =>
                    symbol.length > 0
            );


    if (!symbols.length) {

        select.innerHTML =
            `<option value="">NO MANAGED COINS</option>`;

        selectedHistoryCoin = "";

        resetHistoryCycleCard();

        return;
    }


    // --------------------------------------------------------
    // KEEP CURRENT SELECTION IF POSSIBLE
    // --------------------------------------------------------

    const oldValue =
        select.value
            .trim()
            .toUpperCase();


    select.innerHTML =
        symbols
            .map(
                symbol =>
                    `<option value="${symbol}">
                        ${symbol}
                    </option>`
            )
            .join("");


    const selected =
        symbols.includes(oldValue)
            ? oldValue
            : symbols[0];


    select.value =
        selected;

    selectedHistoryCoin =
        selected;


    loadHistoryCycle();
}


// ============================================================
// LOAD HISTORY
// ============================================================

async function loadHistoryCycle() {

    if (!selectedHistoryCoin) {

        resetHistoryCycleCard();

        return;
    }


    try {

        const response =
            await fetch(
                `/automatic-trader/history?symbol=${encodeURIComponent(
                    selectedHistoryCoin
                )}`,
                {
                    cache: "no-store"
                }
            );


        if (!response.ok) {

            throw new Error(
                `HTTP ${response.status}`
            );
        }


        const data =
            await response.json();


        if (!data.success) {

            throw new Error(
                data.error ||
                "History request failed"
            );
        }


        updateHistoryCycle(
            data
        );


    } catch (error) {

        console.error(
            "HISTORY CYCLE ERROR:",
            error
        );


        resetHistoryCycleCard();


        setHistoryText(
            "historyDecisionReason",
            "HISTORY ERROR"
        );
    }
}


// ============================================================
// UPDATE HISTORY CARD
// ============================================================

function updateHistoryCycle(data) {

    const history =
        data.history || {};


    const status =
        data.status || {};


    const decision =
        data.decision || {};


    // ========================================================
    // SNAPSHOT PROGRESS
    // ========================================================

    const snapshots =
        Number(
            history.count ??
            history.snapshots?.length ??
            status.snapshots ??
            0
        );


    const requiredSnapshots =
        Number(
            history.requiredSnapshots ??
            status.requiredSnapshots ??
            decision.history?.requiredSnapshots ??
            20
        );


    const safeRequired =
        requiredSnapshots > 0
            ? requiredSnapshots
            : 20;


    const progress =
        Math.min(
            100,
            Math.max(
                0,
                (
                    snapshots /
                    safeRequired
                ) * 100
            )
        );


    setHistoryText(
        "historyProgressText",
        `${snapshots} / ${safeRequired}`
    );


    const progressBar =
        document.getElementById(
            "historyProgressBar"
        );


    if (progressBar) {

        progressBar.style.width =
            `${progress}%`;
    }


    // ========================================================
    // TREND HISTORY
    //
    // 200 LEVEL HISTORY
    // ========================================================

    const trendHistory =
        decision.trend200 || {};


    const trendLongPercent =
        formatHistoryPercent(
            trendHistory.longPercent
        );


    const trendShortPercent =
        formatHistoryPercent(
            trendHistory.shortPercent
        );


    const trendNeutralPercent =
        formatHistoryPercent(
            trendHistory.neutralPercent
        );


    // ========================================================
    // TRIGGER HISTORY
    //
    // 15 / 20 / 30 / 60 LEVEL HISTORY
    // ========================================================

    const triggerHistory =
        decision.triggerHistory || {};


    const triggerLongPercent =
        formatHistoryPercent(
            triggerHistory.longPercent
        );


    const triggerShortPercent =
        formatHistoryPercent(
            triggerHistory.shortPercent
        );


    const triggerNeutralPercent =
        formatHistoryPercent(
            triggerHistory.neutralPercent
        );


    // ========================================================
    // DISPLAY PERCENTAGES
    //
    // Main percentages show TREND HISTORY.
    // ========================================================

    setHistoryText(
        "historyLongPercent",
        `${trendLongPercent}%`
    );


    setHistoryText(
        "historyShortPercent",
        `${trendShortPercent}%`
    );


    setHistoryText(
        "historyNeutralPercent",
        `${trendNeutralPercent}%`
    );


    // ========================================================
    // TREND HISTORY DIRECTION
    // ========================================================
    //
    // Use the highest TREND history percentage.
    //
    // Example:
    //
    // LONG    100%
    // SHORT     0%
    // NEUTRAL   0%
    //
    // => TREND LONG · 100%
    // ========================================================

    let trendDisplay =
        "NEUTRAL";


    if (
        trendLongPercent >
        trendShortPercent &&
        trendLongPercent >
        trendNeutralPercent
    ) {

        trendDisplay =
            `LONG · ${trendLongPercent}%`;

    } else if (
        trendShortPercent >
        trendLongPercent &&
        trendShortPercent >
        trendNeutralPercent
    ) {

        trendDisplay =
            `SHORT · ${trendShortPercent}%`;

    } else {

        trendDisplay =
            `NEUTRAL · ${trendNeutralPercent}%`;
    }


    setHistoryText(
        "historyTrendDirection",
        trendDisplay
    );


    // ========================================================
    // TRIGGER HISTORY DIRECTION
    // ========================================================
    //
    // IMPORTANT:
    //
    // We use the HIGHEST trigger-history percentage.
    //
    // This matches the console.
    //
    // Example:
    //
    // LONG      52.94%
    // SHORT     29.41%
    // NEUTRAL   17.65%
    //
    // => TRIGGER LONG · 53%
    // ========================================================

    let triggerDisplay =
        "NEUTRAL";


    if (
        triggerLongPercent >
        triggerShortPercent &&
        triggerLongPercent >
        triggerNeutralPercent
    ) {

        triggerDisplay =
            `LONG · ${triggerLongPercent}%`;

    } else if (
        triggerShortPercent >
        triggerLongPercent &&
        triggerShortPercent >
        triggerNeutralPercent
    ) {

        triggerDisplay =
            `SHORT · ${triggerShortPercent}%`;

    } else {

        triggerDisplay =
            `NEUTRAL · ${triggerNeutralPercent}%`;
    }


    setHistoryText(
        "historyTriggerDirection",
        triggerDisplay
    );


    // ========================================================
    // DISPLAY-ONLY FINAL PREVIEW
    // ========================================================
    //
    // IMPORTANT:
    //
    // This is ONLY for the dashboard.
    //
    // It does NOT affect the bot.
    // It does NOT change the backend FINAL decision.
    //
    // Logic:
    //
    // TREND LONG + TRIGGER LONG
    //     => DISPLAY FINAL LONG
    //
    // TREND SHORT + TRIGGER SHORT
    //     => DISPLAY FINAL SHORT
    //
    // Anything else
    //     => DISPLAY FINAL NEUTRAL
    // ========================================================

    let displayFinal =
        "NEUTRAL";


    const trendDirection =
        getHistoryDirectionFromPercentages(
            trendLongPercent,
            trendShortPercent,
            trendNeutralPercent
        );


    const triggerDirection =
        getHistoryDirectionFromPercentages(
            triggerLongPercent,
            triggerShortPercent,
            triggerNeutralPercent
        );


    if (
        trendDirection === "LONG" &&
        triggerDirection === "LONG"
    ) {

        displayFinal =
            "LONG";

    } else if (
        trendDirection === "SHORT" &&
        triggerDirection === "SHORT"
    ) {

        displayFinal =
            "SHORT";
    }


    setHistoryText(
        "historyFinalDirection",
        displayFinal
    );


    // ========================================================
    // REASON
    //
    // Keep backend reason visible for debugging.
    // ========================================================

    const reason =
        decision.reason ??
        data.reason ??
        "—";


    setHistoryText(
        "historyDecisionReason",
        reason
    );
}


// ============================================================
// GET HISTORY DIRECTION
// ============================================================
//
// Returns the direction with the highest percentage.
//
// This is display-only.
// It does NOT affect the bot.
//
// ============================================================

function getHistoryDirectionFromPercentages(
    longPercent,
    shortPercent,
    neutralPercent
) {

    if (
        longPercent >
        shortPercent &&
        longPercent >
        neutralPercent
    ) {

        return "LONG";
    }


    if (
        shortPercent >
        longPercent &&
        shortPercent >
        neutralPercent
    ) {

        return "SHORT";
    }


    return "NEUTRAL";
}


// ============================================================
// FORMAT PERCENT
// ============================================================

function formatHistoryPercent(value) {

    const number =
        Number(value);


    if (
        !Number.isFinite(number)
    ) {

        return 0;
    }


    return Math.round(
        number
    );
}


// ============================================================
// NORMALIZE DIRECTION
// ============================================================

function normalizeHistoryDirection(
    direction
) {

    const value =
        String(
            direction ||
            "NEUTRAL"
        )
            .trim()
            .toUpperCase();


    if (
        value === "LONG" ||
        value === "SHORT" ||
        value === "NEUTRAL"
    ) {

        return value;
    }


    return "NEUTRAL";
}


// ============================================================
// SET HISTORY TEXT
// ============================================================

function setHistoryText(
    id,
    value
) {

    const element =
        document.getElementById(
            id
        );


    if (element) {

        element.textContent =
            value ?? "—";
    }
}


// ============================================================
// RESET CARD
// ============================================================

function resetHistoryCycleCard() {

    setHistoryText(
        "historyProgressText",
        "0 / 20"
    );


    setHistoryText(
        "historyLongPercent",
        "0%"
    );


    setHistoryText(
        "historyShortPercent",
        "0%"
    );


    setHistoryText(
        "historyNeutralPercent",
        "0%"
    );


    setHistoryText(
        "historyTrendDirection",
        "NEUTRAL"
    );


    setHistoryText(
        "historyTriggerDirection",
        "NEUTRAL"
    );


    setHistoryText(
        "historyFinalDirection",
        "NEUTRAL"
    );


    setHistoryText(
        "historyDecisionReason",
        "—"
    );


    const progressBar =
        document.getElementById(
            "historyProgressBar"
        );


    if (progressBar) {

        progressBar.style.width =
            "0%";
    }
}


// ============================================================
// SELECTOR CHANGE
// ============================================================

document.addEventListener(
    "DOMContentLoaded",
    () => {

        const select =
            document.getElementById(
                "historySymbolSelect"
            );


        if (!select) {
            return;
        }


        select.addEventListener(
            "change",
            () => {

                selectedHistoryCoin =
                    select.value
                        .trim()
                        .toUpperCase();


                loadHistoryCycle();
            }
        );

    }
);