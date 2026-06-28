const path = require("path");

function parseNumber(value, fallback, min, max) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function parseBoolean(value, fallback = false) {
  if (value === undefined || value === null || value === "") return fallback;
  if (typeof value === "boolean") return value;
  return ["1", "true", "yes", "on"].includes(String(value).toLowerCase());
}

function nextPowerOfTwo(value) {
  let size = 1;
  while (size < value) size *= 2;
  return size;
}

function normalizeHexColor(value, fallback = "#00ff00") {
  const color = typeof value === "string" ? value.trim() : "";
  if (/^#[0-9a-fA-F]{6}$/.test(color)) return color;
  if (/^[0-9a-fA-F]{6}$/.test(color)) return `#${color}`;
  return fallback;
}

function hexToRgb(hex) {
  const clean = hex.replace("#", "");
  const value = Number.parseInt(clean, 16);
  return {
    r: (value >> 16) & 255,
    g: (value >> 8) & 255,
    b: value & 255,
  };
}

function presetToColor(preset, customColor) {
  const presets = {
    green: "#00ff00",
    magenta: "#ff00ff",
    blue: "#006bff",
  };
  if (preset === "auto") return "auto";
  if (preset === "custom") return normalizeHexColor(customColor);
  return presets[preset] || normalizeHexColor(customColor, presets.green);
}

function clampByte(value) {
  return Math.max(0, Math.min(255, Math.round(value)));
}

function smoothStep(edge0, edge1, value) {
  const t = Math.max(0, Math.min(1, (value - edge0) / Math.max(0.0001, edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

function naturalCompare(a, b) {
  return String(a).localeCompare(String(b), "zh-Hans-CN", {
    numeric: true,
    sensitivity: "base",
  });
}

function safeBaseName(filename, fallback) {
  const parsed = path.parse(filename || "");
  return (parsed.name || fallback).replace(/[<>:"/\\|?*\x00-\x1f]/g, "_");
}

function safeExtension(filename, fallback = ".png") {
  const extension = path.extname(filename || "").toLowerCase();
  return extension && extension.length <= 12 ? extension : fallback;
}

function contentTypeForImageFormat(format) {
  const types = {
    png: "image/png",
    webp: "image/webp",
    jpeg: "image/jpeg",
    jpg: "image/jpeg",
    avif: "image/avif",
  };
  return types[format] || "application/octet-stream";
}

module.exports = {
  parseNumber,
  parseBoolean,
  nextPowerOfTwo,
  normalizeHexColor,
  hexToRgb,
  presetToColor,
  clampByte,
  smoothStep,
  naturalCompare,
  safeBaseName,
  safeExtension,
  contentTypeForImageFormat,
};
