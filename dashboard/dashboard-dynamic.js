/* ============================================================
   DYNAMIC ORDER BOOK DEPTH CARDS
   Cards are generated from backend confirmationDepths.
   Example: [15,30,60,90]
============================================================ */

function renderDepthCards(depths){

    const grid =
        document.getElementById(
            "multiDepthGrid"
        );

    if(!grid){
        return;
    }

    const normalizedDepths =
        Array.isArray(depths)
            ? depths
                .map(Number)
                .filter(
                    depth =>
                        Number.isFinite(depth) &&
                        depth > 0
                )
            : [];

    if(!normalizedDepths.length){
        grid.innerHTML = "";
        return;
    }

    grid.innerHTML =
        normalizedDepths
        .map(
            depth => `
                <div
                    id="depthCard${depth}"
                    class="depth-card no-data">

                    <div class="depth-header">

                        <div class="depth-title">
                            ${depth} Levels
                        </div>

                        <span
                            id="depthBadge${depth}"
                            class="depth-badge neutral">
                            NO DATA
                        </span>

                    </div>

                    <div class="depth-metric">

                        <span>
                            Imbalance
                        </span>

                        <strong
                            id="depth${depth}Imbalance">
                            --
                        </strong>

                    </div>

                    <div class="depth-metric">

                        <span>
                            Bid / Ask
                        </span>

                        <strong
                            id="depth${depth}BidAsk">
                            --
                        </strong>

                    </div>

                    <div class="depth-metric">

                        <span>
                            Ask / Bid
                        </span>

                        <strong
                            id="depth${depth}AskBid">
                            --
                        </strong>

                    </div>

                    <div class="depth-test">

                        <div class="test-box">

                            <span>
                                Imbalance Test
                            </span>

                            <strong
                                id="depth${depth}ImbalanceTest">
                                --
                            </strong>

                        </div>

                        <div class="test-box">

                            <span>
                                Ratio Test
                            </span>

                            <strong
                                id="depth${depth}RatioTest">
                                --
                            </strong>

                        </div>

                    </div>

                </div>
            `
        )
        .join("");
}


/* ============================================================
   MULTI DEPTH CONFIRMATION
   DYNAMIC DEPTH COUNT
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
       GET CONFIGURED DEPTHS
    -------------------------------------------------------- */

    const configuredDepths =
        Array.isArray(
            multiDepth?.confirmationDepths
        )
            ? multiDepth.confirmationDepths
                .map(Number)
                .filter(
                    depth =>
                        Number.isFinite(depth) &&
                        depth > 0
                )
            : (
                Array.isArray(
                    dashboard?.confirmationDepths
                )
                    ? dashboard.confirmationDepths
                        .map(Number)
                        .filter(
                            depth =>
                                Number.isFinite(depth) &&
                                depth > 0
                        )
                    : [15,30,60,90]
            );


    /* --------------------------------------------------------
       CREATE / REFRESH CARDS
    -------------------------------------------------------- */

    const grid =
        document.getElementById(
            "multiDepthGrid"
        );

    if(grid){

        const existingDepths =
            Array.from(
                grid.querySelectorAll(
                    ".depth-card"
                )
            )
            .map(card =>
                Number(
                    card.id.replace(
                        "depthCard",
                        ""
                    )
                )
            )
            .filter(
                depth =>
                    Number.isFinite(depth)
            );

        const needsRender =
            existingDepths.length !==
                configuredDepths.length ||
            existingDepths.some(
                (depth,index) =>
                    depth !==
                    configuredDepths[index]
            );

        if(needsRender){

            renderDepthCards(
                configuredDepths
            );

        }

    }


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
       UPDATE ALL CONFIGURED DEPTHS
    -------------------------------------------------------- */

    for(
        const depth of
        configuredDepths
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

        const depthResults =
            configuredDepths.map(
                depth =>
                    getDepthResult(depth)
            );

        const passedDepths =
            depthResults.filter(
                result =>
                    result?.filterPass === true
            ).length;

        const required =
            Number(
                multiDepth?.requiredPassedDepths ??
                multiDepth?.requiredDepths ??
                Math.ceil(
                    configuredDepths.length * 0.75
                )
            );

        passed =
            passedDepths >= required;

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
            configuredDepths.map(
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

        const required =
            Number(
                multiDepth?.requiredPassedDepths ??
                multiDepth?.requiredDepths ??
                Math.ceil(
                    configuredDepths.length * 0.75
                )
            );

        detail.textContent =
            `Requires ${required} of ` +
            `${configuredDepths.length} to pass. ` +
            `Passed: ${passedDepths} | ` +
            `Failed: ${failedDepths}`;

    }

} // CLOSE updateMultiDepth()


// ============================================================
// FINAL DECISION SESSION
// ============================================================

let finalDecisionSessionData = null;


// ============================================================
// LOAD FINAL DECISION SESSION
// ============================================================

async function loadFinalDecisionSession(){

    try{

        const response =
            await fetch(
                "/automatic-trader/session",
                {
                    cache: "no-store"
                }
            );

        if(!response.ok){

            throw new Error(
                `HTTP ${response.status}`
            );

        }

        const data =
            await response.json();

        if(
            !data ||
            data.success !== true ||
            !data.session
        ){

            throw new Error(
                "Invalid final-decision session response"
            );

        }

        finalDecisionSessionData =
            data.session;

        renderFinalDecisionSession();

    }catch(error){

        console.error(
            "FINAL DECISION SESSION ERROR:",
            error
        );

    }

}


// ============================================================
// FORMAT SESSION RUNTIME
// ============================================================

function formatFinalDecisionRuntime(
    runtime
){

    /*
     * Backend already sends HH:MM:SS.
     *
     * IMPORTANT:
     * No client-side timer.
     * Dashboard refreshes once per minute.
     */

    if(
        typeof runtime === "string" &&
        /^\d{2}:\d{2}:\d{2}$/.test(runtime)
    ){

        return runtime;

    }

    return "00:00:00";

}


// ============================================================
// FORMAT SESSION START TIME
// ============================================================

function formatFinalDecisionStart(
    timestamp
){

    if(!timestamp){
        return "--";
    }

    const date =
        new Date(timestamp);

    if(
        Number.isNaN(
            date.getTime()
        )
    ){

        return "--";

    }

    return date.toLocaleString(
        undefined,
        {
            dateStyle: "short",
            timeStyle: "medium"
        }
    );

}


// ============================================================
// FORMAT DECISION TIME
// ============================================================

function formatFinalDecisionTime(
    timestamp
){

    if(!timestamp){
        return "--";
    }

    const date =
        new Date(timestamp);

    if(
        Number.isNaN(
            date.getTime()
        )
    ){

        return "--";

    }

    return date.toLocaleTimeString(
        undefined,
        {
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit"
        }
    );

}


// ============================================================
// DECISION CSS CLASS
// ============================================================

function getFinalDecisionClass(
    decision
){

    const value =
        String(
            decision || ""
        )
        .trim()
        .toUpperCase();

    if(
        value === "LONG"
    ){

        return "session-decision-long";

    }

    if(
        value === "SHORT"
    ){

        return "session-decision-short";

    }

    return "session-decision-neutral";

}


// ============================================================
// RENDER FINAL DECISION SESSION
// ============================================================

function renderFinalDecisionSession(){

    if(!finalDecisionSessionData){
        return;
    }

    const session =
        finalDecisionSessionData;


    /* --------------------------------------------------------
       SESSION NUMBER
    -------------------------------------------------------- */

    const sessionNumber =
        document.getElementById(
            "sessionNumber"
        );

    if(sessionNumber){

        sessionNumber.textContent =
            Number(
                session.sessionNumber || 1
            );

    }


    /* --------------------------------------------------------
       BOT RUNTIME
    -------------------------------------------------------- */

    const runtime =
        document.getElementById(
            "sessionRuntime"
        );

    if(runtime){

        runtime.textContent =
            formatFinalDecisionRuntime(
                session.runtime
            );

    }


    /* --------------------------------------------------------
       LONG
    -------------------------------------------------------- */

    const long =
        document.getElementById(
            "sessionLong"
        );

    if(long){

        long.textContent =
            Number(
                session.long || 0
            );

    }


    /* --------------------------------------------------------
       SHORT
    -------------------------------------------------------- */

    const short =
        document.getElementById(
            "sessionShort"
        );

    if(short){

        short.textContent =
            Number(
                session.short || 0
            );

    }


    /* --------------------------------------------------------
       NEUTRAL
    -------------------------------------------------------- */

    const neutral =
        document.getElementById(
            "sessionNeutral"
        );

    if(neutral){

        neutral.textContent =
            Number(
                session.neutral || 0
            );

    }


    /* --------------------------------------------------------
       TOTAL
    -------------------------------------------------------- */

    const total =
        document.getElementById(
            "sessionTotal"
        );

    if(total){

        total.textContent =
            Number(
                session.total || 0
            );

    }


    /* --------------------------------------------------------
       SESSION START
    -------------------------------------------------------- */

    const startedAt =
        document.getElementById(
            "sessionStartedAt"
        );

    if(startedAt){

        startedAt.textContent =
            formatFinalDecisionStart(
                session.startedAt
            );

    }


    /* --------------------------------------------------------
       DECISIONS
    -------------------------------------------------------- */

    const decisions =
        Array.isArray(
            session.decisions
        )
            ? session.decisions
            : [];

    const decisionCount =
        document.getElementById(
            "sessionDecisionCount"
        );

    if(decisionCount){

        decisionCount.textContent =
            decisions.length;

    }

    renderFinalDecisionList(
        decisions
    );

}


// ============================================================
// RENDER FINAL DECISION LIST
// ============================================================

function renderFinalDecisionList(
    decisions
){

    const tableBody =
        document.getElementById(
            "sessionDecisionList"
        );

    if(!tableBody){
        return;
    }


    /* --------------------------------------------------------
       NO DATA
    -------------------------------------------------------- */

    if(!decisions.length){

        tableBody.innerHTML = `

            <tr>

                <td
                    colspan="3"
                    class="table-empty">

                    Waiting for completed cycles...

                </td>

            </tr>

        `;

        return;

    }


    /*
     * Newest completed decision first.
     */

    const newestFirst =
        [...decisions]
            .reverse();


    tableBody.innerHTML =
        newestFirst
            .map(
                decision => {

                    const symbol =
                        String(
                            decision?.symbol ||
                            "--"
                        )
                        .trim()
                        .toUpperCase();


                    const direction =
                        String(
                            decision?.decision ||
                            decision?.finalDecision ||
                            "NEUTRAL"
                        )
                        .trim()
                        .toUpperCase();


                    const timestamp =
                        decision?.timestamp ||
                        decision?.createdAt ||
                        decision?.time ||
                        null;


                    return `

                        <tr>

                            <td
                                class="session-decision-time">

                                ${formatFinalDecisionTime(
                                    timestamp
                                )}

                            </td>


                            <td>

                                <strong>
                                    ${symbol}
                                </strong>

                            </td>


                            <td>

                                <strong
                                    class="${getFinalDecisionClass(
                                        direction
                                    )}">

                                    ${direction}

                                </strong>

                            </td>

                        </tr>

                    `;

                }
            )
            .join("");

}


// ============================================================
// START FINAL DECISION SESSION
// ============================================================

function startFinalDecisionSession(){

    /*
     * Load immediately.
     */

    loadFinalDecisionSession();


    /*
     * Refresh ONCE PER MINUTE.
     *
     * NO 1-second timer.
     * NO client-side runtime counter.
     */

    setInterval(
        loadFinalDecisionSession,
        60 * 1000
    );

}


// ============================================================
// START AFTER DOM IS READY
// ============================================================

if(
    document.readyState === "loading"
){

    document.addEventListener(
        "DOMContentLoaded",
        startFinalDecisionSession
    );

}else{

    startFinalDecisionSession();

}