"use strict";

const fs = require("fs");
const path = require("path");
const test = require("node:test");
const assert = require("node:assert/strict");

const protocol = require("../../imagespec/protocol");

const root = path.resolve(__dirname, "../..");

function exampleProject() {
  return JSON.parse(
    fs.readFileSync(path.join(root, "imagespec/protocol/examples/basic.project.imagespec/project.json"), "utf8"),
  );
}

test("default and example ImageSpec projects pass structural and semantic validation", () => {
  const created = protocol.createDefaultProject({ name: "Protocol test", width: 320, height: 480 });
  assert.deepEqual(protocol.validateDocument("project", created), { ok: true, issues: [] });
  assert.equal(protocol.validateDocument("project", exampleProject()).ok, true);
});

test("project validation rejects duplicate ids and graph cycles", () => {
  const project = exampleProject();
  const duplicate = structuredClone(project.assetGraph.nodes[0]);
  project.assetGraph.nodes.push(duplicate);
  let result = protocol.validateDocument("project", project);
  assert.equal(result.ok, false);
  assert.ok(result.issues.some((entry) => entry.code === "id.duplicate"));

  const cycleProject = exampleProject();
  cycleProject.assetGraph.nodes[0].parentId = "hud.player.name";
  result = protocol.validateDocument("project", cycleProject);
  assert.equal(result.ok, false);
  assert.ok(result.issues.some((entry) => entry.code === "graph.cycle"));
});

test("project validation rejects unsafe paths and baked dynamic text", () => {
  const unsafeProject = exampleProject();
  unsafeProject.designSystem.references.push({ id: "reference.bad", path: "../outside.png", purpose: "style" });
  const unsafeResult = protocol.validateDocument("project", unsafeProject);
  assert.equal(unsafeResult.ok, false);
  assert.ok(unsafeResult.issues.some((entry) => entry.code === "schema.pattern" || entry.code === "path.unsafe"));

  const textProject = exampleProject();
  textProject.assetGraph.nodes[1].exportPolicy.enabled = true;
  const textResult = protocol.validateDocument("project", textProject);
  assert.equal(textResult.ok, false);
  assert.ok(textResult.issues.some((entry) => entry.code === "text.dynamicBaking"));
});

test("plan validation rejects missing params and stale revisions", () => {
  const project = exampleProject();
  const plan = protocol.createOperationPlan(project, {
    operations: [
      {
        operationId: "operation.align.name",
        op: "asset.align",
        targetId: "hud.player.name",
        params: { axis: "x", alignment: "center" },
        allowedChanges: ["bounds.x"],
        deniedChanges: ["source"],
        requiresApproval: false,
      },
    ],
  });
  plan.baseRevision.number = 2;
  const result = protocol.validateDocument("plan", plan, { project });
  assert.equal(result.ok, false);
  assert.ok(result.issues.some((entry) => entry.code === "operation.missingParam"));
  assert.ok(result.issues.some((entry) => entry.code === "plan.stale"));
});

test("plan validation reserves validated and exportable state transitions", () => {
  const project = protocol.createDefaultProject({ projectId: "project.state" });
  project.assetGraph.nodes.push(protocol.createDefaultAsset({ id: "asset.state" }));
  project.revision.hash = protocol.hashProject(project);
  const plan = protocol.createOperationPlan(project, {
    operations: [{
      operationId: "operation.state.bypass",
      op: "asset.setPolicy",
      targetId: "asset.state",
      params: { state: "exportable" },
      allowedChanges: ["asset.*"],
      deniedChanges: ["canvas"],
      requiresApproval: false,
    }],
  });
  const result = protocol.validateDocument("plan", plan, { project });
  assert.equal(result.ok, false);
  assert.ok(result.issues.some((entry) => entry.code === "operation.stateReserved"));
});

test("canonical hashing is stable across object key order", () => {
  assert.equal(protocol.sha256(protocol.canonicalJson({ b: 2, a: 1 })), protocol.sha256(protocol.canonicalJson({ a: 1, b: 2 })));
});
