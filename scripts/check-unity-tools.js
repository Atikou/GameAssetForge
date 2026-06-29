const { getUnityToolchainStatus } = require("../server/tools/unity-apk");

function stateLabel(tool) {
  if (tool.automationAvailable) return "[OK]";
  if (tool.available) return "[MANUAL]";
  return "[MISSING]";
}

function printAdapterTool(tool) {
  console.log("");
  console.log(`${stateLabel(tool)} ${tool.label} (${tool.kind})`);
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

function printPipelineTool(name, tool) {
  console.log("");
  console.log(`${stateLabel(tool)} ${tool.label || name} (${name})`);
  if (tool.purpose) console.log(`  ${tool.purpose}`);
  console.log(`  path: ${tool.path}`);
  if (tool.cliPath) console.log(`  cli: ${tool.cliPath}`);
  if (tool.guiPath) console.log(`  gui: ${tool.guiPath}`);
  if (tool.warning) console.log(`  warning: ${tool.warning}`);
}

(async () => {
  const status = await getUnityToolchainStatus();

  console.log(`Unity toolchain root: ${status.externalRoot}`);
  console.log("");
  console.log("Adapter tools:");
  for (const tool of status.tools) {
    printAdapterTool(tool);
  }
  if (status.restorePipeline) {
    console.log("");
    console.log("Full restore pipeline:");
    for (const [name, tool] of Object.entries(status.restorePipeline)) {
      printPipelineTool(name, tool);
    }
  }
})().catch((error) => {
  console.error(error.message || error);
  process.exitCode = 1;
});
