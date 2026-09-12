
/* ============================================================
   GLOBAL STATE
============================================================ */

let latestPerCoinStats = {};

let availableSymbols = [];

let selectedLiveCoin = "";

let liveOrderBookLoading = false;

let currentLiveOrderBookData = null;



/* ============================================================
   REFRESH SETTINGS
============================================================ */

const DASHBOARD_REFRESH_MS =
    60 * 60 * 1000;


const LIVE_ORDERBOOK_REFRESH_MS =
    60 * 1000;


const AUTOMATIC_STATUS_REFRESH_MS =
    60 * 1000;



/* ============================================================
   HELPERS
============================================================ */

function setText(id,value){

    const element =
        document.getElementById(id);

    if(element){

        element.textContent =
            value ?? "--";

    }

}


function formatPercent(value){

    const number =
        Number(value);

    if(!Number.isFinite(number)){

        return "--";

    }

    return (
        number * 100
    ).toFixed(2) + "%";

}


function formatPercentAlready(value){

    const number =
        Number(value);

    if(!Number.isFinite(number)){

        return "--";

    }

    return number.toFixed(2) + "%";

}


function formatNumber(value){

    const number =
        Number(value);

    if(!Number.isFinite(number)){

        return "--";

    }

    return number.toFixed(4);

}


function calculateRate(
    accepted,
    total
){

    if(
        !total ||
        total <= 0
    ){

        return 0;

    }

    return (
        accepted /
        total *
        100
    );

}


function formatDate(value){

    if(!value){

        return "--";

    }

    const date =
        new Date(value);

    if(
        Number.isNaN(
            date.getTime()
        )
    ){

        return "--";

    }

    return date.toLocaleString();

}



/* ============================================================
   CONNECTION
============================================================ */

function setConnection(
    connected
){

    const element =
        document.getElementById(
            "connectionStatus"
        );

    if(!element){

        return;

    }


    if(connected){

        element.textContent =
            "ONLINE";

        element.className =
            "connection connected";

    }else{

        element.textContent =
            "● OFFLINE";

        element.className =
            "connection disconnected";

    }

}



/* ============================================================
   SYMBOL SELECTOR
============================================================ */

function updateCoinSelector(
    symbols
){

    const select =
        document.getElementById(
            "autoCoin"
        );

    if(!select){

        return;

    }


    if(
        !Array.isArray(symbols) ||
        symbols.length === 0
    ){

        select.innerHTML =
            `<option value="">
                No coins available
            </option>`;

        return;

    }


    availableSymbols =
        symbols.slice();


    const oldValue =
        selectedLiveCoin ||
        select.value ||
        "";


    select.innerHTML =
        symbols
        .map(symbol => {

            const safe =
                String(symbol)
                .replace(
                    /"/g,
                    "&quot;"
                );

            return `
                <option value="${safe}">
                    ${safe}
                </option>
            `;

        })
        .join("");


    const selected =
        symbols.find(
            symbol =>
                String(symbol).toUpperCase() ===
                String(oldValue).toUpperCase()
        ) ||
        symbols[0];


    select.value =
        selected;


    selectedLiveCoin =
        selected;


    setText(
        "liveCoinLabel",
        selected
    );

}



/* ============================================================
   SYMBOL DISPLAY
============================================================ */

function updateSymbols(
    symbols
){

    const container =
        document.getElementById(
            "symbols"
        );

    if(!container){

        return;

    }


    if(
        !Array.isArray(symbols) ||
        symbols.length === 0
    ){

        container.innerHTML =
            "<span>No symbols available.</span>";

        setText(
            "symbolsLoaded",
            "0"
        );

        return;

    }


    setText(
        "symbolsLoaded",
        symbols.length
    );


    container.innerHTML =
        symbols
        .map(
            symbol =>
                `<span class="symbol">
                    ${symbol}
                </span>`
        )
        .join("");

}



/* ============================================================
   RESET LIVE ORDER BOOK DISPLAY
============================================================ */

function resetLiveOrderBookDisplay(){

    const status =
        document.getElementById(
            "liveBookStatus"
        );


    if(status){

        status.textContent =
            "LOADING";

        status.className =
            "badge";

    }


    setText(
        "liveBidLiquidity",
        "--"
    );

    setText(
        "liveAskLiquidity",
        "--"
    );

    setText(
        "liveBidPercentage",
        "--"
    );

    setText(
        "liveAskPercentage",
        "--"
    );

    setText(
        "liveImbalance",
        "--"
    );

    setText(
        "liveBidAskRatio",
        "--"
    );

    setText(
        "liveAskBidRatio",
        "--"
    );

    setText(
        "liveDepth",
        "--"
    );

    setText(
        "liveBookUpdate",
        "--"
    );


    const decision =
        document.getElementById(
            "liveDecision"
        );


    if(decision){

        decision.textContent =
            "LOADING ORDER BOOK";

        decision.className =
            "orderbook-direction neutral";

    }


    updateMultiDepth(
        null,
        ""
    );

}



/* ============================================================
   ORDER BOOK DEPTH CARD
============================================================ */

function updateDepthCard(
    depth,
    result
){

    const card =
        document.getElementById(
            `depthCard${depth}`
        );


    const badge =
        document.getElementById(
            `depthBadge${depth}`
        );


    if(
        !card ||
        !badge
    ){

        return;

    }


    const imbalance =
        document.getElementById(
            `depth${depth}Imbalance`
        );


    const bidAsk =
        document.getElementById(
            `depth${depth}BidAsk`
        );


    const askBid =
        document.getElementById(
            `depth${depth}AskBid`
        );


    const imbalanceTest =
        document.getElementById(
            `depth${depth}ImbalanceTest`
        );


    const ratioTest =
        document.getElementById(
            `depth${depth}RatioTest`
        );



    /* --------------------------------------------------------
       NO DATA
    -------------------------------------------------------- */

    if(
        !result ||
        result.error
    ){

        card.className =
            "depth-card no-data";

        badge.className =
            "depth-badge neutral";

        badge.textContent =
            "NO DATA";


        if(imbalance){

            imbalance.textContent =
                "--";

        }


        if(bidAsk){

            bidAsk.textContent =
                "--";

        }


        if(askBid){

            askBid.textContent =
                "--";

        }


        if(imbalanceTest){

            imbalanceTest.textContent =
                "--";

            imbalanceTest.className =
                "";

        }


        if(ratioTest){

            ratioTest.textContent =
                "--";

            ratioTest.className =
                "";

        }


        return;

    }



    /* --------------------------------------------------------
       VALUES
    -------------------------------------------------------- */

    if(imbalance){

        imbalance.textContent =
            formatNumber(
                result.imbalance
            );

    }


    if(bidAsk){

        bidAsk.textContent =
            formatNumber(
                result.bidAskRatio
            );

    }


    if(askBid){

        askBid.textContent =
            formatNumber(
                result.askBidRatio
            );

    }


    if(imbalanceTest){

        imbalanceTest.textContent =
            result.imbalancePass
                ? "PASS"
                : "FAIL";

        imbalanceTest.className =
            result.imbalancePass
                ? "test-pass"
                : "test-fail";

    }


    if(ratioTest){

        ratioTest.textContent =
            result.ratioPass
                ? "PASS"
                : "FAIL";

        ratioTest.className =
            result.ratioPass
                ? "test-pass"
                : "test-fail";

    }



    /* --------------------------------------------------------
       FINAL DEPTH STATUS
    -------------------------------------------------------- */

    if(result.filterPass){

        card.className =
            "depth-card pass";

        badge.className =
            "depth-badge pass";

        badge.textContent =
            "PASS";

    }else{

        card.className =
            "depth-card fail";

        badge.className =
            "depth-badge fail";

        badge.textContent =
            "BLOCKED";

    }

}



/* ============================================================
   MULTI DEPTH CONFIRMATION
   15 + 30 + 60 ONLY
============================================================ */

function updateMultiDepth(
    multiDepth,
    direction
){

    const dashboard =
        currentLiveOrderBookData?.dashboard ||
        {};


    const selectedDirection =
        String(
            direction ||
            "LONG"
        ).toUpperCase();



    /* --------------------------------------------------------
       GET DEPTH RESULT
    -------------------------------------------------------- */

    function getDepthResult(depth){

        const depthData =
            dashboard?.[
                `depth${depth}`
            ] || {};


        const result =
            selectedDirection === "SHORT"
                ? depthData.short
                : depthData.long;


        return result || null;

    }



    /* --------------------------------------------------------
       UPDATE 15 / 30 / 60
    -------------------------------------------------------- */

    for(
        const depth of
        [15,30,60]
    ){

        updateDepthCard(
            depth,
            getDepthResult(depth)
        );

    }



    /* --------------------------------------------------------
       CONFIRMATION ELEMENTS
    -------------------------------------------------------- */

    const confirmation =
        document.getElementById(
            "multiConfirmation"
        );


    const resultElement =
        document.getElementById(
            "multiConfirmationResult"
        );


    const detail =
        document.getElementById(
            "multiConfirmationDetail"
        );


    if(!confirmation){

        return;

    }



    /* --------------------------------------------------------
       BACKEND CONFIRMATION
    -------------------------------------------------------- */

    let passed;


    if(
        typeof
        multiDepth?.confirmationPassed
        === "boolean"
    ){

        passed =
            multiDepth.confirmationPassed;

    }else{

        const depth15 =
            getDepthResult(15);

        const depth30 =
            getDepthResult(30);

        const depth60 =
            getDepthResult(60);


        passed =
            depth15?.filterPass === true &&
            depth30?.filterPass === true &&
            depth60?.filterPass === true;

    }



    /* --------------------------------------------------------
       RESULT
    -------------------------------------------------------- */

    if(passed){

        confirmation.className =
            "multi-confirmation pass";


        if(resultElement){

            resultElement.className =
                "multi-confirmation-result pass";

            resultElement.textContent =
                "PASSED";

        }

    }else{

        confirmation.className =
            "multi-confirmation fail";


        if(resultElement){

            resultElement.className =
                "multi-confirmation-result fail";

            resultElement.textContent =
                "BLOCKED";

        }

    }



    /* --------------------------------------------------------
       DETAIL
    -------------------------------------------------------- */

    if(detail){

        const depthResults =
            [15,30,60]
            .map(
                depth =>
                    getDepthResult(depth)
            );


        const passedDepths =
            depthResults.filter(
                result =>
                    result?.filterPass === true
            ).length;


        const failedDepths =
            depthResults.filter(
                result =>
                    result &&
                    result.filterPass !== true
            ).length;


        detail.textContent =
            `Requires 15 + 30 + 60 to pass. ` +
            `Passed: ${passedDepths} | ` +
            `Failed: ${failedDepths}`;

    }

}



/* ============================================================
   LIVE ORDER BOOK
============================================================ */


function updateLiveOrderBook(
    data
){

    if(!data){

        return;

    }


    currentLiveOrderBookData =
        data;


    const book =
        data.orderBook ||
        data;


    const symbol =
        data.symbol ||
        book.symbol ||
        selectedLiveCoin;


    setText(
        "liveCoinLabel",
        symbol
    );



    /* --------------------------------------------------------
       PRIMARY VALUES
    -------------------------------------------------------- */

    setText(
        "liveBidLiquidity",
        formatNumber(
            book.bidLiquidity
        )
    );


    setText(
        "liveAskLiquidity",
        formatNumber(
            book.askLiquidity
        )
    );


    setText(
        "liveBidPercentage",
        formatPercent(
            book.bidPercentage
        )
    );


    setText(
        "liveAskPercentage",
        formatPercent(
            book.askPercentage
        )
    );


    setText(
        "liveImbalance",
        formatNumber(
            book.imbalance
        )
    );


    setText(
        "liveBidAskRatio",
        formatNumber(
            book.bidAskRatio
        )
    );


    setText(
        "liveAskBidRatio",
        formatNumber(
            book.askBidRatio
        )
    );


    setText(
        "liveDepth",
        book.depth ||
        book.requestedDepth ||
        book.depthLevels ||
        data.requestedDepth ||
        200
    );



    /* --------------------------------------------------------
       MULTI DEPTH
    -------------------------------------------------------- */

    const multiDepth =
        data.multiDepth ||
        book.multiDepth ||
        data.dashboard?.multiDepth ||
        null;


    const direction =
        String(
            data.decision ||
            data.direction ||
            book.direction ||
            ""
        )
        .trim()
        .toUpperCase();


    updateMultiDepth(
        multiDepth,
        direction
    );



    /* --------------------------------------------------------
       FINAL DECISION
       --------------------------------------------------------
       
       IMPORTANT:
       
       The BACKEND already calculates:
       
           15 + 30 + 60
           2 OF 3 REQUIRED
       
       Therefore the dashboard MUST NOT recalculate the
       decision from the primary 15-level order-book values.
       
       Use the backend decision directly.
       
       -------------------------------------------------------- */

    const decision =
        document.getElementById(
            "liveDecision"
        );


    if(decision){

        const backendDecision =
            String(
                data.decision ||
                data.dashboard?.decision ||
                data.direction ||
                ""
            )
            .trim()
            .toUpperCase();


        if(
            backendDecision === "LONG"
        ){

            decision.textContent =
                "LONG";

            decision.className =
                "orderbook-direction long";


        }else if(
            backendDecision === "SHORT"
        ){

            decision.textContent =
                "SHORT";

            decision.className =
                "orderbook-direction short";


        }else{

            decision.textContent =
                "NEUTRAL";

            decision.className =
                "orderbook-direction neutral";
        }
    }



    /* --------------------------------------------------------
       STATUS
    -------------------------------------------------------- */

    const status =
        document.getElementById(
            "liveBookStatus"
        );


    if(status){

        const hasBookData =
            Number.isFinite(
                Number(
                    book.bidLiquidity
                )
            ) &&
            Number.isFinite(
                Number(
                    book.askLiquidity
                )
            ) &&
            Number.isFinite(
                Number(
                    book.imbalance
                )
            );


        if(hasBookData){

            status.textContent =
                "LIVE";

            status.className =
                "badge success";

        }else{

            status.textContent =
                "NO DATA";

            status.className =
                "badge";
        }
    }



    /* --------------------------------------------------------
       UPDATE TIME
    -------------------------------------------------------- */

    setText(
        "liveBookUpdate",
        new Date().toLocaleString()
    );

}




/* ============================================================
   LOAD LIVE ORDER BOOK
============================================================ */

async function loadLiveOrderBook(){

    if(liveOrderBookLoading){

        return;

    }


    liveOrderBookLoading =
        true;


    try{

        const select =
            document.getElementById(
                "autoCoin"
            );


        const symbol =
            selectedLiveCoin ||
            select?.value;


        if(!symbol){

            console.warn(
                "[LIVE ORDER BOOK] No symbol selected."
            );

            return;

        }


        const normalizedSymbol =
            String(
                symbol
            )
            .trim()
            .toUpperCase();



        /* ----------------------------------------------------
           REQUEST
        ---------------------------------------------------- */

        const response =
            await fetch(
                `/live-orderbook?symbol=${encodeURIComponent(normalizedSymbol)}`,
                {
                    cache:"no-store"
                }
            );


        if(!response.ok){

            let errorText =
                "";


            try{

                errorText =
                    await response.text();

            }catch(readError){

                console.error(
                    "[LIVE ORDER BOOK] Error reading response:",
                    readError
                );

            }


            throw new Error(
                `Live order book HTTP ${response.status}: ${errorText}`
            );

        }



        /* ----------------------------------------------------
           JSON
        ---------------------------------------------------- */

        const data =
            await response.json();



        /* ----------------------------------------------------
           BACKEND FAILURE
        ---------------------------------------------------- */

        if(!data.success){

            throw new Error(
                data.error ||
                "Live order book request failed"
            );

        }



        /* ----------------------------------------------------
           SYMBOL VALIDATION
        ---------------------------------------------------- */

        const responseSymbol =
            String(
                data.symbol ||
                data.orderBook?.symbol ||
                normalizedSymbol
            )
            .trim()
            .toUpperCase();


        const currentSelectedSymbol =
            String(
                selectedLiveCoin ||
                select?.value ||
                ""
            )
            .trim()
            .toUpperCase();


        if(
            responseSymbol !==
            currentSelectedSymbol
        ){

            console.warn(
                "[LIVE ORDER BOOK] Stale response ignored.",
                {
                    requested:
                        normalizedSymbol,

                    response:
                        responseSymbol,

                    selected:
                        currentSelectedSymbol
                }
            );

            return;

        }



        /* ----------------------------------------------------
           SAVE RESPONSE
        ---------------------------------------------------- */

        currentLiveOrderBookData =
            data;



        /* ----------------------------------------------------
           UPDATE DASHBOARD
        ---------------------------------------------------- */

        updateLiveOrderBook(
            data
        );


    }catch(error){

        console.error(
            "[LIVE ORDER BOOK ERROR]",
            error
        );


        const status =
            document.getElementById(
                "liveBookStatus"
            );


        if(status){

            status.textContent =
                "ERROR";

            status.className =
                "badge danger";

        }


    }finally{

        liveOrderBookLoading =
            false;

    }

}



/* ============================================================
   UPDATE STATUS
============================================================ */

function updateStatus(
    data
){

    if(!data){

        return;

    }


    setText(
        "botStatus",
        data.online
            ? "ONLINE"
            : "OFFLINE"
    );


    setText(
        "botMode",
        data.mode || "--"
    );



    const balance =
        Number(
            data.balance
        );


    setText(
        "balance",
        Number.isFinite(balance)
            ? balance.toFixed(4)
            : "--"
    );



    const notional =
        Number(
            data.defaultRisk?.positionNotional
        );


    setText(
        "notional",
        Number.isFinite(notional)
            ? notional.toFixed(2)
            : "--"
    );


    setText(
        "symbolCount",
        data.discoveredSymbols ?? 0
    );


    setText(
        "margin",
        `${data.defaultRisk?.margin ?? "--"} USDT`
    );


    setText(
        "leverage",
        `${data.defaultRisk?.leverage ?? "--"}x`
    );


    setText(
        "marginMode",
        data.marginMode || "--"
    );


    setText(
        "tradingEnabled",
        data.tradingEnabled
            ? "ENABLED"
            : "DISABLED"
    );


    setText(
        "reversal",
        data.reversal || "--"
    );



    /* --------------------------------------------------------
       ORDER BOOK CONFIG
    -------------------------------------------------------- */

    const filter =
        data.orderBookFilter || {};


    setText(
        "apiRequestDepth",
        filter.apiRequestDepth ??
        filter.depth ??
        "--"
    );


    setText(
        "confirmationDepths",
        Array.isArray(
            filter.confirmationDepths
        )
            ? filter.confirmationDepths.join(" + ")
            : "--"
    );


    setText(
        "comparisonDepths",
        Array.isArray(
            filter.comparisonDepths
        )
            ? filter.comparisonDepths.join(" / ")
            : "--"
    );


    setText(
        "longImbalance",
        filter.long?.minImbalance ??
        filter.longMinImbalance ??
        "--"
    );


    setText(
        "shortImbalance",
        filter.short?.maxImbalance ??
        filter.shortMaxImbalance ??
        "--"
    );


    setText(
        "bidAskRatio",
        filter.long?.minBidAskRatio ??
        filter.minBidAskRatio ??
        "--"
    );


    setText(
        "askBidRatio",
        filter.short?.minAskBidRatio ??
        filter.minAskBidRatio ??
        "--"
    );


    setText(
        "confirmationMode",
        filter.long?.confirmation ||
        filter.short?.confirmation ||
        "ALL DEPTHS"
    );



    const filterStatus =
        document.getElementById(
            "filterStatus"
        );


    if(filterStatus){

        filterStatus.textContent =
            filter.enabled
                ? "ENABLED"
                : "DISABLED";


        filterStatus.className =
            filter.enabled
                ? "badge success"
                : "badge danger";

    }



    /* --------------------------------------------------------
       OTHER DATA
    -------------------------------------------------------- */

    updateStatistics(
        data.orderFlowStatistics
    );


    updateSymbols(
        data.symbols
    );


    updateCoinSelector(
        data.symbols
    );


    updateHistorySymbolSelector(
    data.automaticTrading?.managedSymbols
    );



    setConnection(true);

}




/* ============================================================
   PER COIN STATISTICS
============================================================ */

function normalizePerCoinStats(
    stats
){

    if(
        !stats ||
        typeof stats !== "object"
    ){

        return {};

    }


    return (
        stats.bySymbol ||
        stats.perSymbol ||
        stats.perCoin ||
        stats.symbols ||
        {}
    );

}



function numberOrDash(
    value,
    showZero = true
){

    const number =
        Number(value);


    if(!Number.isFinite(number)){

        return "—";

    }


    if(
        !showZero &&
        number === 0
    ){

        return "—";

    }


    return String(number);

}



function getDirectionStats(
    row,
    direction
){

    const value =
        row?.[direction] ||
        row?.[
            direction.toLowerCase()
        ] ||
        {};


    return {

        accepted:
            Number(
                value.accepted ??
                value.allowed ??
                value.yes ??
                0
            ),

        rejected:
            Number(
                value.rejected ??
                value.blocked ??
                value.no ??
                0
            )

    };

}



function renderPerCoinStatistics(
    stats
){

    latestPerCoinStats =
        normalizePerCoinStats(
            stats
        );


    const tbody =
        document.getElementById(
            "orderFlowByCoin"
        );


    if(!tbody){

        return;

    }


    const search =
        (
            document.getElementById(
                "coinSearch"
            )?.value || ""
        )
        .trim()
        .toUpperCase();


    const entries =
        Object.entries(
            latestPerCoinStats
        )
        .map(
            ([symbol,raw]) => {

                const row =
                    raw &&
                    typeof raw === "object"
                        ? raw
                        : {};


                const long =
                    getDirectionStats(
                        row,
                        "long"
                    );


                const short =
                    getDirectionStats(
                        row,
                        "short"
                    );


                const total =
                    long.accepted +
                    long.rejected +
                    short.accepted +
                    short.rejected;


                return {

                    symbol:
                        String(
                            symbol
                        ).toUpperCase(),

                    long,
                    short,
                    total

                };

            }
        )
        .filter(
            item =>
                !search ||
                item.symbol.includes(
                    search
                )
        )
        .sort(
            (a,b) => {

                if(
                    b.total !==
                    a.total
                ){

                    return (
                        b.total -
                        a.total
                    );

                }


                return a.symbol.localeCompare(
                    b.symbol
                );

            }
        );


    if(!entries.length){

        tbody.innerHTML = `
            <tr>
                <td
                    colspan="6"
                    class="table-empty">

                    ${
                        search
                            ? "No matching coins."
                            : "No order-flow checks yet."
                    }

                </td>
            </tr>
        `;

        return;

    }


    tbody.innerHTML =
        entries
        .map(
            item => `

                <tr>

                    <td class="coin-name">
                        ${item.symbol}
                    </td>

                    <td class="accepted-cell">
                        ${
                            numberOrDash(
                                item.long.accepted,
                                item.long.accepted !== 0
                            )
                        }
                    </td>

                    <td class="rejected-cell">
                        ${
                            numberOrDash(
                                item.long.rejected,
                                item.long.rejected !== 0
                            )
                        }
                    </td>

                    <td class="accepted-cell">
                        ${
                            numberOrDash(
                                item.short.accepted,
                                item.short.accepted !== 0
                            )
                        }
                    </td>

                    <td class="rejected-cell">
                        ${
                            numberOrDash(
                                item.short.rejected,
                                item.short.rejected !== 0
                            )
                        }
                    </td>

                    <td>
                        ${item.total}
                    </td>

                </tr>

            `
        )
        .join("");

}



/* ============================================================
   STATISTICS
============================================================ */

function updateStatistics(
    stats
){

    if(!stats){

        renderPerCoinStatistics({});

        return;

    }


    renderPerCoinStatistics(
        stats
    );


    const total =
        Number(
            stats.total || 0
        );


    const accepted =
        Number(
            stats.accepted || 0
        );


    const rejected =
        Number(
            stats.rejected || 0
        );


    const acceptanceRate =
        Number(
            stats.acceptanceRate ??
            calculateRate(
                accepted,
                total
            )
        );


    const rejectionRate =
        Number(
            stats.rejectionRate ??
            calculateRate(
                rejected,
                total
            )
        );


    setText(
        "totalChecks",
        total
    );


    setText(
        "accepted",
        accepted
    );


    setText(
        "rejected",
        rejected
    );


    setText(
        "acceptanceRate",
        formatPercentAlready(
            acceptanceRate
        )
    );


    setText(
        "rejectionRate",
        formatPercentAlready(
            rejectionRate
        )
    );


    setText(
        "rateText",
        `${formatPercentAlready(
            acceptanceRate
        )} / ${formatPercentAlready(
            rejectionRate
        )}`
    );


    const acceptanceBar =
        document.getElementById(
            "acceptanceBar"
        );


    if(acceptanceBar){

        acceptanceBar.style.width =
            Math.min(
                Math.max(
                    acceptanceRate,
                    0
                ),
                100
            ) + "%";

    }



    const long =
        stats.long || {};


    const short =
        stats.short || {};


    const longTotal =
        Number(
            long.total || 0
        );


    const longAccepted =
        Number(
            long.accepted || 0
        );


    const longRejected =
        Number(
            long.rejected || 0
        );


    const shortTotal =
        Number(
            short.total || 0
        );


    const shortAccepted =
        Number(
            short.accepted || 0
        );


    const shortRejected =
        Number(
            short.rejected || 0
        );


    setText(
        "longTotal",
        longTotal
    );


    setText(
        "longAccepted",
        longAccepted
    );


    setText(
        "longRejected",
        longRejected
    );


    setText(
        "longRate",
        formatPercentAlready(
            calculateRate(
                longAccepted,
                longTotal
            )
        )
    );


    setText(
        "shortTotal",
        shortTotal
    );


    setText(
        "shortAccepted",
        shortAccepted
    );


    setText(
        "shortRejected",
        shortRejected
    );


    setText(
        "shortRate",
        formatPercentAlready(
            calculateRate(
                shortAccepted,
                shortTotal
            )
        )
    );

}



/* ============================================================
   AUTOMATIC TRADER
============================================================ */

function updateAutomaticTrader(
    data
){

    const auto =
        data?.automaticTrading ||
        data?.automaticTrader ||
        data ||
        {};


    setText(
        "autoStatus",
        auto.enabled
            ? (
                auto.running
                    ? "RUNNING"
                    : "ENABLED"
            )
            : "DISABLED"
    );


    const minutes =
        Number(
            auto.intervalMinutes
        );


    setText(
        "autoInterval",
        Number.isFinite(minutes)
            ? `${minutes} min`
            : "--"
    );


    setText(
        "autoLastRun",
        formatDate(
            auto.lastRun
        )
    );


    setText(
        "autoNextRun",
        formatDate(
            auto.nextRun
        )
    );


    setText(
        "autoTraderMessage",
        auto.enabled
            ? (
                auto.running
                    ? "Automatic trader is scanning symbols..."
                    : "Automatic trader is waiting for the next hourly scan."
            )
            : "Automatic trader is disabled."
    );

}



async function loadAutomaticTraderStatus(){

    try{

        const response =
            await fetch(
                "/automatic-trader/status",
                {
                    cache:"no-store"
                }
            );


        if(!response.ok){

            throw new Error(
                `HTTP ${response.status}`
            );

        }


        const data =
            await response.json();


        updateAutomaticTrader(
            data
        );


        const symbol =
            data.selectedSymbol ||
            data.symbol ||
            (
                Array.isArray(
                    data.selectedSymbols
                )
                    ? data.selectedSymbols[0]
                    : null
            );


        if(symbol){

            const select =
                document.getElementById(
                    "autoCoin"
                );


            if(select){

                const option =
                    Array.from(
                        select.options
                    )
                    .find(
                        option =>
                            option.value
                            .toUpperCase() ===
                            String(
                                symbol
                            ).toUpperCase()
                    );


                if(option){

                    select.value =
                        option.value;

                    selectedLiveCoin =
                        option.value;

                }

            }

        }


    }catch(error){

        console.error(
            "AUTOMATIC TRADER STATUS ERROR:",
            error
        );

    }

}



/* ============================================================
   AUTOMATIC TRADER RUN
============================================================ */

async function runAutomaticTrader(){

    const button =
        document.getElementById(
            "autoRunButton"
        );


    const select =
        document.getElementById(
            "autoCoin"
        );


    const symbol =
        select?.value
        ?.trim()
        .toUpperCase();


    if(!symbol){

        alert(
            "Please select a coin."
        );

        return;

    }


    if(button){

        button.disabled =
            true;

        button.textContent =
            "▶ Starting...";

    }


    try{

        const response =
            await fetch(
                "/automatic-trader/run",
                {

                    method:"POST",

                    headers:{
                        "Content-Type":
                            "application/json"
                    },

                    body:
                        JSON.stringify({
                            symbol
                        })

                }
            );


        const data =
            await response.json();


        if(!response.ok){

            throw new Error(
                data.error ||
                `HTTP ${response.status}`
            );

        }


        setText(
            "autoTraderMessage",
            data.message ||
            `Automatic trader scan started for ${symbol}.`
        );


        await loadAutomaticTraderStatus();


    }catch(error){

        console.error(
            "AUTOMATIC TRADER ERROR:",
            error
        );


        setText(
            "autoTraderMessage",
            "ERROR: " +
            error.message
        );


    }finally{

        if(button){

            button.disabled =
                false;

            button.textContent =
                "▶ Run Scan Now";

        }

    }

}



/* ============================================================
   FORCE AUTOMATIC CHECK
============================================================ */

async function forceAutomaticCheck(){

    const button =
        document.getElementById(
            "forceAutoCheckButton"
        );


    if(!button){

        return;

    }


    const original =
        button.innerText;


    button.disabled =
        true;


    button.innerText =
        "⏳ Checking...";


    try{

        const response =
            await fetch(
                "/automatic-trader/run",
                {

                    method:"POST",

                    headers:{
                        "Content-Type":
                            "application/json"
                    }

                }
            );


        const data =
            await response.json();


        if(!response.ok){

            throw new Error(
                data.error ||
                "Automatic check failed"
            );

        }


        button.innerText =
            "✓ Check Started";


        setTimeout(
            () => {

                button.innerText =
                    original;

            },
            2000
        );


    }catch(error){

        console.error(
            "FORCE CHECK ERROR:",
            error
        );


        button.innerText =
            "✗ Check Failed";


        setTimeout(
            () => {

                button.innerText =
                    original;

            },
            2500
        );

    }finally{

        setTimeout(
            () => {

                button.disabled =
                    false;

            },
            1000
        );

    }

}



/* ============================================================
   RESET STATISTICS
============================================================ */

async function resetStatistics(){

    const confirmed =
        window.confirm(
            "Reset all order-flow statistics?"
        );


    if(!confirmed){

        return;

    }


    try{

        const response =
            await fetch(
                "/orderflow-stats/reset",
                {
                    method:"POST"
                }
            );


        if(!response.ok){

            throw new Error(
                `Reset HTTP ${response.status}`
            );

        }


        const data =
            await response.json();


        updateStatistics(
            data.statistics
        );


        setText(
            "lastUpdate",
            new Date().toLocaleString()
        );


    }catch(error){

        console.error(
            "RESET ERROR:",
            error
        );


        alert(
            "Could not reset statistics."
        );

    }

}



/* ============================================================
   COIN CHANGE
============================================================ */

document
.getElementById(
    "autoCoin"
)
?.addEventListener(
    "change",
    () => {

        selectedLiveCoin =
            document
            .getElementById(
                "autoCoin"
            )
            .value
            .trim()
            .toUpperCase();


        setText(
            "liveCoinLabel",
            selectedLiveCoin
        );


        resetLiveOrderBookDisplay();


        loadLiveOrderBook();

    }
);



/* ============================================================
   SEARCH
============================================================ */

document
.getElementById(
    "coinSearch"
)
?.addEventListener(
    "input",
    () =>
        renderPerCoinStatistics(
            latestPerCoinStats
        )
);



/* ============================================================
   MAIN DASHBOARD
============================================================ */

async function loadDashboard(){

    const button =
        document.getElementById(
            "refreshButton"
        );


    if(button){

        button.disabled =
            true;

        button.textContent =
            "↻ Loading...";

    }


    try{

        const response =
            await fetch(
                "/status",
                {
                    cache:"no-store"
                }
            );


        if(!response.ok){

            throw new Error(
                `Status HTTP ${response.status}`
            );

        }


        const data =
            await response.json();


        updateStatus(
            data
        );


        setText(
            "lastUpdate",
            new Date().toLocaleString()
        );


        await loadLiveOrderBook();


        await loadAutomaticTraderStatus();


    }catch(error){

        console.error(
            "DASHBOARD ERROR:",
            error
        );


        setConnection(
            false
        );


        setText(
            "botStatus",
            "ERROR"
        );


    }finally{

        if(button){

            button.disabled =
                false;

            button.textContent =
                "↻ Refresh";

        }

    }

}



/* ============================================================
   INITIAL LOAD
============================================================ */

window.addEventListener(
    "DOMContentLoaded",
    async () => {

        await loadDashboard();

    }
);



/* ============================================================
   MAIN STATUS REFRESH
   Every 60 minutes
============================================================ */

setInterval(
    () => {

        loadDashboard();

    },
    DASHBOARD_REFRESH_MS
);



/* ============================================================
   LIVE ORDER BOOK REFRESH
   Every 1 minute
============================================================ */

setInterval(
    () => {

        loadLiveOrderBook();

    },
    LIVE_ORDERBOOK_REFRESH_MS
);



/* ============================================================
   AUTOMATIC TRADER STATUS REFRESH
   Every 1 minute
============================================================ */

setInterval(
    () => {

        loadAutomaticTraderStatus();

    },
    AUTOMATIC_STATUS_REFRESH_MS
);



/* ============================================================
   START BOT
============================================================ */

async function startBot(){

    const input =
        document.getElementById(
            "trendDepthInput"
        );


    const button =
        document.getElementById(
            "startBotButton"
        );


    if(!input){

        console.error(
            "TREND DEPTH INPUT NOT FOUND"
        );

        return;

    }


    const trendDepth =
        Number(
            input.value
        );


    /* --------------------------------------------------------
       VALIDATE
    -------------------------------------------------------- */

    if(
        !Number.isFinite(trendDepth) ||
        trendDepth <= 0 ||
        !Number.isInteger(trendDepth)
    ){

        alert(
            "Please enter a valid trend depth number."
        );

        input.focus();

        return;

    }


    /* --------------------------------------------------------
       BUTTON
    -------------------------------------------------------- */

    if(button){

        button.disabled =
            true;

        button.textContent =
            "⏳ STARTING...";

    }


    try{

        const response =
            await fetch(
                "/automatic-trader/start",
                {

                    method:"POST",

                    headers:{
                        "Content-Type":
                            "application/json"
                    },

                    body:
                        JSON.stringify({
                            trendDepth
                        })

                }
            );


        const data =
            await response.json();


        if(!response.ok){

            throw new Error(
                data.error ||
                `HTTP ${response.status}`
            );

        }


        /* ----------------------------------------------------
           SUCCESS
        ---------------------------------------------------- */

        setText(
            "autoTraderMessage",
            data.message ||
            `Bot started with ${trendDepth} trend depth.`
        );


        await loadAutomaticTraderStatus();


    }catch(error){

        console.error(
            "START BOT ERROR:",
            error
        );


        setText(
            "autoTraderMessage",
            "ERROR: " +
            error.message
        );


    }finally{

        if(button){

            button.disabled =
                false;

            button.textContent =
                "▶ START BOT";

        }

    }

}