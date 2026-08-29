require("dotenv").config();

const BASE_URL = "https://api.toobit.com";

const endpoints = [
    "/quote/v1/ticker/price?symbol=BTCUSDT",
    "/quote/v1/ticker/price?symbol=BTC-SWAP-USDT",
    "/quote/v1/ticker/price?symbols=BTCUSDT",
    "/quote/v1/ticker/price?symbols=BTC-SWAP-USDT",

    "/api/v1/market/ticker/price?symbol=BTC-SWAP-USDT",
    "/api/v1/futures/ticker/price?symbol=BTC-SWAP-USDT",

    "/quote/v1/market/ticker?symbol=BTC-SWAP-USDT",
    "/quote/v1/market/tickers?symbol=BTC-SWAP-USDT",

    "/api/v1/contract/ticker?symbol=BTC-SWAP-USDT",
    "/api/v1/contracts/ticker?symbol=BTC-SWAP-USDT",
];

async function test() {

    console.log("=================================");
    console.log("TOOBIT FUTURES PRICE DISCOVERY");
    console.log("=================================");

    for (const endpoint of endpoints) {

        const url = BASE_URL + endpoint;

        console.log("");
        console.log("---------------------------------");
        console.log("REQUEST:");
        console.log(url);

        try {

            const response = await fetch(url);

            const text = await response.text();

            console.log("STATUS:", response.status);

            console.log("RESPONSE:");

            // Don't print huge responses
            if (text.length > 1000) {
                console.log(text.substring(0, 1000));
                console.log("... response truncated ...");
            } else {
                console.log(text);
            }

        } catch (error) {

            console.log(
                "ERROR:",
                error.message
            );

        }
    }

    console.log("");
    console.log("=================================");
    console.log("DISCOVERY COMPLETE");
    console.log("=================================");
}

test();