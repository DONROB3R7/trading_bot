require("dotenv").config();

const BASE_URL = "https://api.toobit.com";

async function test(url) {

    console.log("");
    console.log("=================================");
    console.log(url);
    console.log("=================================");

    try {

        const response = await fetch(url);

        const text = await response.text();

        console.log("Status:", response.status);
        console.log(
            "Content-Type:",
            response.headers.get("content-type")
        );

        console.log("");
        console.log(text.substring(0, 5000));

    } catch (error) {

        console.log("ERROR:", error.message);
    }
}


async function main() {

    await test(
        `${BASE_URL}/api/v1/exchangeInfo`
    );

    await test(
        `${BASE_URL}/api/v1/market/tickers`
    );

    await test(
        `${BASE_URL}/api/v1/ticker/price`
    );

    await test(
        `${BASE_URL}/api/v1/ticker`
    );

    await test(
        `${BASE_URL}/api/v1/tickers`
    );

    await test(
        `${BASE_URL}/quote/v1/ticker/price`
    );

    await test(
        `${BASE_URL}/quote/v1/tickers`
    );

}


main();