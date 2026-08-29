function separator(char = "=", length = 60) {
    console.log(char.repeat(length));
}

function section(title, char = "=") {
    console.log("");
    separator(char);
    console.log(title);
    separator(char);
}

function pretty(value) {
    return JSON.stringify(value, null, 2);
}

module.exports = {
    separator,
    section,
    pretty
};