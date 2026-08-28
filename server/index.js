const { createApp } = require("./app");

const app = createApp();
const host = process.env.HOST || "127.0.0.1";
const port = Number(process.env.PORT || 5180);

app.listen(port, host, () => {
  console.log(`GameAssetForge API started: http://${host}:${port}`);
  console.log("API documentation: docs/API.md");
});
