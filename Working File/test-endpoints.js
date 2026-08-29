const url =
    "https://api.toobit.com/quote/v1/contract/ticker/price?symbol=BTC-SWAP-USDT";

async function test() {

    console.log("=================================");
    console.log("TOOBIT BTC FUTURES PRICE");
    console.log("=================================");

    try {

        const response = await fetch(url);

        const text = await response.text();

        console.log("Status:", response.status);
        console.log("Content-Type:", response.headers.get("content-type"));

        console.log("Response:");

        try {

            const data = JSON.parse(text);

            console.log(
                JSON.stringify(data, null, 2)
            );

        } catch {

            console.log(text);
        }

    } catch (error) {

        console.error(
            "ERROR:",
            error.message
        );
    }

    console.log("=================================");
}

test();