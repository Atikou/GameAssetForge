"use strict";

const { ImageSpecError, asImageSpecError } = require("../core/errors");

class CapabilityRegistry {
  constructor() {
    this.capabilities = new Map();
  }

  register(definition) {
    if (!definition?.id || typeof definition.execute !== "function") {
      throw new ImageSpecError("IMAGESPEC_INVALID_CAPABILITY", "Runner capability requires id and execute().", { definition });
    }
    if (this.capabilities.has(definition.id)) {
      throw new ImageSpecError("IMAGESPEC_DUPLICATE_CAPABILITY", `Runner capability already registered: ${definition.id}`);
    }
    this.capabilities.set(definition.id, {
      version: "1",
      title: definition.id,
      description: "",
      deterministic: false,
      inputKinds: ["image"],
      outputKinds: ["image"],
      requiresApproval: false,
      ...definition,
    });
    return this;
  }

  has(id) {
    return this.capabilities.has(id);
  }

  get(id) {
    return this.capabilities.get(id) || null;
  }

  list() {
    return [...this.capabilities.values()].map(({ execute, validate, ...definition }) => structuredClone(definition));
  }

  async execute(id, context = {}) {
    const capability = this.get(id);
    if (!capability) {
      throw new ImageSpecError("IMAGESPEC_CAPABILITY_UNAVAILABLE", `Runner capability is not available: ${id}`, { id }, { statusCode: 424 });
    }
    if (capability.validate) {
      const validation = await capability.validate(context.params || {}, context);
      if (validation && validation.ok === false) {
        throw new ImageSpecError("IMAGESPEC_CAPABILITY_INPUT_INVALID", `Invalid input for Runner capability ${id}.`, validation);
      }
    }
    try {
      const result = await capability.execute(context);
      if (!result || result.status === "blocked") {
        throw new ImageSpecError("IMAGESPEC_RUNNER_BLOCKED", result?.message || `Runner capability ${id} is blocked.`, { id, result }, { statusCode: 424 });
      }
      if (!Buffer.isBuffer(result.output) && !Array.isArray(result.outputs)) {
        throw new ImageSpecError("IMAGESPEC_RUNNER_OUTPUT_INVALID", `Runner capability ${id} returned no output.`, { id });
      }
      return {
        status: "succeeded",
        capability: { id: capability.id, version: capability.version },
        deterministic: capability.deterministic,
        warnings: [],
        ...result,
      };
    } catch (error) {
      throw asImageSpecError(error, "IMAGESPEC_RUNNER_FAILED");
    }
  }
}

module.exports = { CapabilityRegistry };
