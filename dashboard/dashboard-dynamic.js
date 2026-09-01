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

}