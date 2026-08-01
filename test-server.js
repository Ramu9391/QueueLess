const express = require("express");

const app = express();

app.get("/", (req, res) => {
    console.log("REQUEST RECEIVED");
    res.send("SERVER WORKING!");
});

app.listen(4000, "127.0.0.1", () => {
    console.log("Test server running on port 4000");
});