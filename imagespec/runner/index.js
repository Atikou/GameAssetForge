"use strict";

const { CapabilityRegistry } = require("./registry");
const { registerGameAssetForgeCapabilities } = require("./gameassetforge-adapter");
const { loadExternalRunnerDefinitions, registerExternalRunnerCapabilities } = require("./external-adapters");

function createDefaultRunnerRegistry(options = {}) {
  const registry = registerGameAssetForgeCapabilities(new CapabilityRegistry());
  const externalCapabilities = options.externalCapabilities || loadExternalRunnerDefinitions(options.externalConfigPath);
  return registerExternalRunnerCapabilities(registry, externalCapabilities, options);
}

module.exports = {
  CapabilityRegistry,
  registerGameAssetForgeCapabilities,
  registerExternalRunnerCapabilities,
  createDefaultRunnerRegistry,
  ...require("./external-adapters"),
};
