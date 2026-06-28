function requireFile(req, fieldName = "image") {
  const file = req.file || req.files?.[fieldName]?.[0];
  if (!file) {
    const error = new Error(`Missing multipart file field: ${fieldName}`);
    error.statusCode = 400;
    throw error;
  }
  return file;
}

function pngResponse(res, buffer, filename) {
  res.setHeader("Content-Type", "image/png");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.send(buffer);
}

function binaryResponse(res, buffer, filename, contentType = "application/octet-stream") {
  res.setHeader("Content-Type", contentType);
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.send(buffer);
}

async function zipResponse(res, zip, filename) {
  const buffer = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
  res.setHeader("Content-Type", "application/zip");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.send(buffer);
}

module.exports = {
  requireFile,
  pngResponse,
  binaryResponse,
  zipResponse,
};
