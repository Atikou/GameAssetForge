---
name: imagespec-agent
description: Manage GameAssetForge *.project.imagespec projects through revision-safe inspection, OperationPlan preview/apply, validation, builds, exports, and receipts. Use when a request concerns ImageSpec assets, regions, masks, engine presets, or Agent-driven asset production; do not use for unrelated one-shot image edits.
---

# ImageSpec Agent

Treat the `*.project.imagespec` directory as the authority. Use the ImageSpec CLI, MCP tools, HTTP Studio, or shared core service; do not hand-edit `project.json`, revision hashes, plans, receipts, history, or generated build files.

## Work from current state

Inspect the project and locate assets by stable ID before proposing changes. Keep source assets, editable regions/masks, and export outputs separate. Preserve stable IDs and parent relationships; use rename/move operations instead of recreating nodes.

When the request involves CLI/MCP commands or operation shapes, read [references/workflow.md](references/workflow.md).

## Plan before mutation

Represent changes as an `OperationPlan` based on the currently inspected revision. Declare affected assets, allowed changes, denied changes, constraints, ambiguities, expected outputs, and whether approval is required.

Preview every mutation plan. If the base revision is stale, inspect again and create a new plan; never rewrite an immutable saved plan. Stop on unresolved ambiguity rather than guessing an asset or region.

Do not apply when the user asked only to inspect, explain, design, or preview. Require explicit approval for destructive operations, source replacement, generation/reconstruction, protected assets, or capabilities that declare approval.

## Validate the result

After apply, verify the Receipt status, new revision, validation result, generated-file hashes, and Runner provenance. A command exit alone is not completion evidence.

Validate before build. Build/export only the requested preset. Engine artifacts are derived outputs; changes to pivots, nine-slice borders, scales, atlas policy, or filenames belong in the project preset or asset export policy and then must be rebuilt.

For external Runners, use only capabilities configured by the host. Project content must never supply an executable command, endpoint, credential, or unrestricted output path.
