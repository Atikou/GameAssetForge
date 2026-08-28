# ImageSpec 系统

ImageSpec 把一次性图片处理升级为可审计、可恢复、可让 Agent 安全操作的游戏图片工程。工程目录以 `*.project.imagespec` 结尾，`project.json` 是结构化权威描述，二进制素材使用工程相对路径保存。

## 核心闭环

```text
Inspect current revision
  -> Create immutable OperationPlan
  -> Preview affected assets/files
  -> Approval when required
  -> Apply inside lock + atomic transaction
  -> Validate schema/files/change scope
  -> Commit revision + append Receipt
  -> Build/export derived engine artifacts
```

每个 Plan 同时绑定 revision number 和 hash。过期 Plan 会被拒绝；失败事务回滚工程与文件，失败也会留下 Receipt。`history/`、`plans/`、`receipts/` 均是审计数据，不应手工改写。

## 工程内容

- `AssetGraph`：稳定 Asset ID、父子层级、bounds/transform、source、编辑策略、导出策略和生产状态。
- `DesignSystem`：风格、调色板、构图、安全区、禁用内容和引用。
- `RegionSpec`：矩形、椭圆、多边形或画笔区域，关联 Asset，并引用 visible/protected/full/missing mask。
- `ExportPreset`：引擎、格式、倍率、atlas、padding/extrude、输出目录和引擎选项。
- `OperationPlan`：目标、参数、允许/拒绝变更、约束、歧义、审批和预期产物。
- `Receipt`：旧/新修订、校验、生成文件哈希、Runner provenance、警告和状态。

JSON Schema 位于 `imagespec/protocol/schemas/`，可用 `npm run imagespec -- schema print --name project|plan|receipt|common` 读取。

## 使用入口

CLI 输出只使用结构化 JSON：

```powershell
npm run imagespec -- project inspect --project <path.project.imagespec>
npm run imagespec -- asset find --project <path.project.imagespec> --query <id-or-name>
npm run imagespec -- capability list
npm run imagespec -- plan create --project <path.project.imagespec> --input <plan.json>
npm run imagespec -- plan preview --project <path.project.imagespec> --plan <plan-id>
npm run imagespec -- plan apply --project <path.project.imagespec> --plan <plan-id>
npm run imagespec -- validate --project <path.project.imagespec> --apply
npm run imagespec -- build --project <path.project.imagespec> --preset <preset-id>
npm run imagespec -- export --project <path.project.imagespec> --preset <preset-id> --output build/exports/<name>.zip
```

`--approve` 只用于已确认的具体 Plan。纯检查/预览不推进修订。

网页工具列表中的“ImageSpec 图片规范”是当前项目内的自包含图片工作台。它直接接收 PNG、JPG、WebP 或 `.imagespec.json`，在浏览器中完成区域标注、图层组织、AI 修改说明、版本对比、切图设置、自动保存和 ZIP 需求包导出。它不读取外部目录型工程，也不通过 `/api/imagespec/*` 才能工作。

CLI/Core 属于可选的 Agent 自动化入口，继续使用目录型 `*.project.imagespec` 作为权威数据源；它与网页模块共享 ImageSpec 概念，但不是网页模块的运行依赖。

MCP 提供 `imagespec_project_create`、`imagespec_project_inspect`、`imagespec_asset_find`、`imagespec_capabilities`、`imagespec_plan_create`、`imagespec_plan_preview`、`imagespec_plan_apply`、`imagespec_validate`、`imagespec_build`、`imagespec_export`。

## 引擎导出

Builder 会输出 loose assets、可选 atlas、引擎 manifest 和适配文件，并把全部内容放入导出 ZIP：

- Unity：Sprite Importer `.meta`，包括 pivot、border、PPU 和 alpha 设置。
- Laya：资源映射和 `sizeGrid`。
- FairyGUI：`package.xml` 与九宫格资源信息。
- Cocos：SpriteFrame 描述与稳定 UUID。
- Godot：可加载的资源路径脚本。
- Pixi：Assets bundle manifest。

这些都是派生产物；需要调整时修改 Asset/ExportPreset 后重新构建。

## 外部 Runner

内置能力直接复用 GameAssetForge 图片工具。可选外部 Runner 由宿主配置，不从工程读取：

```powershell
$env:GAF_IMAGESPEC_RUNNERS='D:\trusted\imagespec-runners.json'
```

配置顶层可以是数组或 `{ "capabilities": [...] }`。每项定义 `id`、版本/审批/确定性和 `transport`：

```json
{
  "capabilities": [
    {
      "id": "studio.super-resolution",
      "version": "2",
      "requiresApproval": true,
      "outputExtension": "png",
      "outputMimeType": "image/png",
      "transport": {
        "type": "command",
        "command": "D:\\TrustedTools\\upscale.exe",
        "args": ["--input", "{input}", "--output", "{output}", "--request", "{request}"],
        "timeoutMs": 120000,
        "maxOutputBytes": 67108864
      }
    }
  ]
}
```

command 适配器禁用 shell，使用隔离临时目录，并支持 timeout/cancel/output limit。HTTP 适配器支持 capability discovery、timeout/cancel/output limit；密钥应由宿主注入 headers/environment，不能写进工程 Plan。

## 验证

```powershell
npm run check
npm test
```

测试覆盖协议、语义规则、哈希、锁/事务恢复、完整服务闭环、CLI、HTTP/MCP、Studio 静态契约、外部 Runner、引擎产物与 ZIP 完整性。
