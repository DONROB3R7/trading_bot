const BASE_URL = "https://api.toobit.com";

async function test() {
    const url = `${BASE_URL}/api/v1/exchangeInfo`;

    const response = await fetch(url);
    const data = await response.json();

    console.log("Status:", response.status);

    console.log("Top-level keys:");
    console.log(Object.keys(data));

    console.log("\nFutures contract:");
    const contract = data.contracts?.find(
        x => x.symbol === "BTC-SWAP-USDT"
    );

    console.log(JSON.stringify(contract, null, 2));
}

test();