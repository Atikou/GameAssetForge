"use strict";

const fs = require("fs");

const [, , inputPath, outputPath, requestPath, delayValue = "0"] = process.argv;
const delay = Number(delayValue) || 0;
JSON.parse(fs.readFileSync(requestPath, "utf8"));
setTimeout(() => {
  fs.copyFileSync(inputPath, outputPath);
}, delay);
