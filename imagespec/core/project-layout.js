"use strict";

const PROJECT_SUFFIX = ".project.imagespec";
const PROJECT_FILE = "project.json";
const LOCK_FILE = ".imagespec.lock";
const TRANSACTION_DIR = "history/.transactions";

const PROJECT_DIRECTORIES = [
  "design/references",
  "assets/source",
  "assets/generated",
  "assets/masks",
  "assets/reconstructed",
  "plans",
  "previews",
  "receipts",
  "history",
  TRANSACTION_DIR,
  "presets",
  "build",
];

module.exports = {
  PROJECT_SUFFIX,
  PROJECT_FILE,
  LOCK_FILE,
  TRANSACTION_DIR,
  PROJECT_DIRECTORIES,
};
