"use strict";

function parseArgs(argv) {
  const positionals = [];
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) {
      positionals.push(token);
      continue;
    }
    const equals = token.indexOf("=");
    if (equals > 2) {
      options[token.slice(2, equals)] = token.slice(equals + 1);
      continue;
    }
    const key = token.slice(2);
    const next = argv[index + 1];
    if (next !== undefined && !next.startsWith("--")) {
      options[key] = next;
      index += 1;
    } else {
      options[key] = true;
    }
  }
  return { positionals, options };
}

function booleanOption(value, fallback = false) {
  if (value === undefined) return fallback;
  if (typeof value === "boolean") return value;
  return ["1", "true", "yes", "on"].includes(String(value).toLowerCase());
}

function numberOption(value, fallback) {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function requireOption(options, key) {
  if (options[key] === undefined || options[key] === true || options[key] === "") {
    const error = new Error(`Missing required option --${key}.`);
    error.code = "IMAGESPEC_CLI_OPTION_REQUIRED";
    error.details = { option: key };
    throw error;
  }
  return options[key];
}

module.exports = {
  parseArgs,
  booleanOption,
  numberOption,
  requireOption,
};
