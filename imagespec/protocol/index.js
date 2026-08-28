"use strict";

module.exports = {
  ...require("./constants"),
  ...require("./ids"),
  ...require("./paths"),
  ...require("./hash"),
  ...require("./factory"),
  ...require("./validator"),
  schemas: {
    common: require("./schemas/common.schema.json"),
    project: require("./schemas/project.schema.json"),
    plan: require("./schemas/operation-plan.schema.json"),
    receipt: require("./schemas/receipt.schema.json"),
  },
};
