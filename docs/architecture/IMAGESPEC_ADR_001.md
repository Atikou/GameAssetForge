# ADR-001: ImageSpec integration boundary

Status: accepted

## Context

GameAssetForge is currently a local, stateless asset utility service with a browser UI, HTTP routes, and MCP wrappers. ImageSpec requires a durable project format, stable asset identities, revision-aware operations, validation, builds, and execution receipts.

The existing one-shot tools remain useful, but HTTP uploads, browser state, ZIP manifests, and the `outputs/` directory are not suitable as the authoritative source for an ImageSpec project.

## Decisions

1. ImageSpec lives in the root `imagespec/` domain and does not depend on Express, MCP, the browser UI, Codex, or a specific image model.
2. JSON Schema Draft 2020-12 is the protocol authority. Zod remains a transport validator for MCP inputs only.
3. A `*.project.imagespec` directory is the authoritative source. Large files are referenced by relative path and are never embedded as data URLs.
4. All mutations use `OperationPlan -> Preview -> Apply -> Validate -> Receipt`, require a base revision, and execute under a per-project lock.
5. Existing `server/tools/` algorithms are exposed through a Runner capability registry. HTTP, CLI, MCP, and Studio reuse the same application services.
6. Existing HTTP and MCP tools remain backward compatible. ImageSpec routes and tools are additive.
7. The GameAssetForge browser surface is a self-contained ImageSpec image-workflow module. It does not require a directory project or the CLI/Core at runtime; the directory-based Studio/Agent workflow remains a separate optional surface.
8. Existing ZIP and image endpoints may keep in-memory uploads for compatibility. ImageSpec project execution uses file paths, staged writes, and bounded streaming/file IO.

## Initial delivery gates

- Protocol schemas and positive/negative fixtures.
- Filesystem repository with revision, lock, atomic write recovery, history, and receipts.
- Deterministic operations and Runner adapters for existing GameAssetForge tools.
- CLI, HTTP, MCP, Studio, Builder/Exporter, external adapters, and Codex Skill using the same core.
- End-to-end evidence for Plan, Preview, Apply, Validate, Build, Export, and Receipt.
