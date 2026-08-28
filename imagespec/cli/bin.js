#!/usr/bin/env node
"use strict";

const { runCli } = require("./main");

runCli().then((exitCode) => {
  process.exitCode = exitCode;
});
