"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const JSZip = require("jszip");
const { createZipBlob, crc32 } = require("../../src/imagespec-zip");

test("self-contained ImageSpec module ZIP is standards-compatible", async () => {
  const text = new TextEncoder().encode("123456789");
  assert.equal(crc32(text), 0xcbf43926);

  const blob = await createZipBlob([
    { name: "project.json", data: '{"schemaVersion":1}' },
    { name: "masks/R01_按钮.png", data: new Uint8Array([137, 80, 78, 71]) },
  ]);
  assert.equal(blob.type, "application/zip");

  const archive = await JSZip.loadAsync(Buffer.from(await blob.arrayBuffer()));
  assert.equal(await archive.file("project.json").async("text"), '{"schemaVersion":1}');
  assert.deepEqual([...await archive.file("masks/R01_按钮.png").async("uint8array")], [137, 80, 78, 71]);
});
