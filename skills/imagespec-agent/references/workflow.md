# ImageSpec workflow reference

## Choose a surface

- Use `npm run imagespec -- ...` for local, scriptable work in the GameAssetForge checkout.
- Use the `imagespec_*` MCP tools when they are already connected; they call the same core service.
- Use ImageSpec Studio for visible AssetGraph, Region/Mask, Plan Inbox, preview, validation, build, and Receipt interaction.
- Use `ImageSpecService` directly only when extending the application or writing tests.

All surfaces share the same project repository, JSON Schemas, revision checks, locks, atomic transactions, validation, Builder, and Receipt format.

## Safe command sequence

```powershell
npm run imagespec -- project inspect --project <path.project.imagespec>
npm run imagespec -- asset find --project <path.project.imagespec> --query <stable-id-or-name>
npm run imagespec -- capability list
npm run imagespec -- plan create --project <path.project.imagespec> --input <plan.json>
npm run imagespec -- plan preview --project <path.project.imagespec> --plan <plan-id>
npm run imagespec -- plan apply --project <path.project.imagespec> --plan <plan-id>
npm run imagespec -- validate --project <path.project.imagespec> --apply
npm run imagespec -- build --project <path.project.imagespec> --preset <preset-id>
npm run imagespec -- export --project <path.project.imagespec> --preset <preset-id> --output build/exports/<name>.zip
```

Use `--approve --approval-id <id>` only after the user has approved the specific plan. Recovery is explicit: `project recover` handles an interrupted atomic transaction; it is not a substitute for resolving a stale plan.

## Operation routing

- Asset lifecycle: `asset.import`, `asset.rename`, `asset.move`, `asset.delete`.
- Asset layout/policy: `asset.align`, `asset.resize`, `asset.setPolicy`.
- Runner work: `asset.process`, `asset.replaceSource`, `asset.generate`, `asset.reconstruct`.
- Regions/masks: `region.create`, `region.update`, `region.associate`, `region.setMasks`, `region.delete`.
- Export configuration: `exportPreset.update`.
- Project actions: `project.validate`, `project.build`, `project.export`.

Use `schema print --name project|plan|receipt|common` for the authoritative fields. Do not invent undocumented operation parameters.

## Non-obvious invariants

- Every plan is bound to both revision number and revision hash.
- Saved plans and receipts are immutable and receipts are append-only.
- Asset file paths and build/export destinations are safe project-relative paths; archive exports stay below `build/`.
- Dynamic text remains a text asset and is not silently baked into a bitmap.
- Nine-slice borders use source coordinates and must survive build scaling/adapter conversion.
- Region masks are references to project files and must validate as readable images.
- The apply transaction must roll back project and file changes together on failure.
- Successful execution is proven by a succeeded Receipt with validation and provenance, not by a preview or generated file alone.
