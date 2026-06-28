const { getUnityToolchainStatus } = require("../server/tools/unity-adapters");

const status = getUnityToolchainStatus();

console.log(`Unity toolchain root: ${status.externalRoot}`);
for (const tool of status.tools) {
  const state = tool.automationAvailable ? "[OK]" : tool.available ? "[MANUAL]" : "[MISSING]";
  console.log("");
  console.log(`${state} ${tool.label} (${tool.kind})`);
  console.log(`  ${tool.purpose}`);
  console.log(`  directory: ${tool.directory}`);
  console.log(`  executable: ${tool.executable || tool.candidates.join(" / ")}`);
  if (tool.manualReason) {
    console.log(`  note: ${tool.manualReason}`);
  }
  if (tool.script && !tool.scriptAvailable) {
    console.log(`  script: missing ${tool.script}`);
  }
}
