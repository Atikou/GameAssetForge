"use strict";

((root, factory) => {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.ImageSpecZip = api;
})(typeof globalThis !== "undefined" ? globalThis : this, () => {
  const CRC_TABLE = (() => {
    const table = new Uint32Array(256);
    for (let index = 0; index < 256; index += 1) {
      let value = index;
      for (let bit = 0; bit < 8; bit += 1) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
      table[index] = value >>> 0;
    }
    return table;
  })();

  function crc32(bytes) {
    let value = 0xffffffff;
    for (const byte of bytes) value = CRC_TABLE[(value ^ byte) & 0xff] ^ (value >>> 8);
    return (value ^ 0xffffffff) >>> 0;
  }

  function header(size) { return new DataView(new ArrayBuffer(size)); }

  function dateTime(date = new Date()) {
    return {
      time: ((date.getHours() & 31) << 11) | ((date.getMinutes() & 63) << 5) | ((date.getSeconds() / 2) & 31),
      date: (((Math.max(1980, date.getFullYear()) - 1980) & 127) << 9) | (((date.getMonth() + 1) & 15) << 5) | (date.getDate() & 31),
    };
  }

  async function bytes(value) {
    if (typeof Blob !== "undefined" && value instanceof Blob) return new Uint8Array(await value.arrayBuffer());
    if (value instanceof Uint8Array) return value;
    if (value instanceof ArrayBuffer) return new Uint8Array(value);
    return new TextEncoder().encode(String(value));
  }

  async function createZipBlob(files) {
    if (!Array.isArray(files) || files.length > 0xffff) throw new Error("ZIP file list is invalid or too large.");
    const parts = [];
    const centralParts = [];
    const flags = 0x0800;
    let offset = 0;
    for (const file of files) {
      const name = new TextEncoder().encode(String(file.name).replace(/\\/g, "/"));
      const data = await bytes(file.data);
      if (name.length > 0xffff || data.length > 0xffffffff) throw new Error(`ZIP entry is too large: ${file.name}`);
      const checksum = crc32(data);
      const stamp = dateTime(file.date);
      const local = header(30);
      local.setUint32(0, 0x04034b50, true);
      local.setUint16(4, 20, true);
      local.setUint16(6, flags, true);
      local.setUint16(8, 0, true);
      local.setUint16(10, stamp.time, true);
      local.setUint16(12, stamp.date, true);
      local.setUint32(14, checksum, true);
      local.setUint32(18, data.length, true);
      local.setUint32(22, data.length, true);
      local.setUint16(26, name.length, true);
      local.setUint16(28, 0, true);
      parts.push(local.buffer, name, data);

      const central = header(46);
      central.setUint32(0, 0x02014b50, true);
      central.setUint16(4, 20, true);
      central.setUint16(6, 20, true);
      central.setUint16(8, flags, true);
      central.setUint16(10, 0, true);
      central.setUint16(12, stamp.time, true);
      central.setUint16(14, stamp.date, true);
      central.setUint32(16, checksum, true);
      central.setUint32(20, data.length, true);
      central.setUint32(24, data.length, true);
      central.setUint16(28, name.length, true);
      central.setUint16(30, 0, true);
      central.setUint16(32, 0, true);
      central.setUint16(34, 0, true);
      central.setUint16(36, 0, true);
      central.setUint32(38, 0, true);
      central.setUint32(42, offset, true);
      centralParts.push(central.buffer, name);
      offset += 30 + name.length + data.length;
    }
    const centralSize = centralParts.reduce((sum, part) => sum + part.byteLength, 0);
    const end = header(22);
    end.setUint32(0, 0x06054b50, true);
    end.setUint16(4, 0, true);
    end.setUint16(6, 0, true);
    end.setUint16(8, files.length, true);
    end.setUint16(10, files.length, true);
    end.setUint32(12, centralSize, true);
    end.setUint32(16, offset, true);
    end.setUint16(20, 0, true);
    return new Blob([...parts, ...centralParts, end.buffer], { type: "application/zip" });
  }

  return { createZipBlob, crc32 };
});
