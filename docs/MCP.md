# GameAssetForge MCP 文档

GameAssetForge MCP 是给 Agent 使用的工具入口。它不重新实现图像算法，而是调用本地 HTTP API，因此网页、API、MCP 三者能力保持一致。

## 启动方式

推荐直接启动完整工具：

```powershell
npm run serve
```

该命令会同时启动：

```text
网页：http://127.0.0.1:5173/
API ：http://127.0.0.1:5180/
MCP ：http://127.0.0.1:5181/mcp
```

按 `Ctrl+C` 会同时关闭网页、API 和 MCP。

只启动 MCP：

```powershell
npm run mcp
```

只启动 MCP 时需要确保 API 已经运行：

```powershell
npm run api
```

## 端口配置

```powershell
$env:WEB_PORT=5174
$env:API_PORT=5182
$env:MCP_PORT=5183
npm run serve
```

单独启动 MCP 时可指定 API 地址：

```powershell
$env:GAF_API_URL="http://127.0.0.1:5180"
$env:MCP_PORT=5181
npm run mcp
```

## Agent 连接信息

MCP 传输方式：Streamable HTTP

```text
http://127.0.0.1:5181/mcp
```

健康检查：

```text
http://127.0.0.1:5181/health
```

## 输入输出约定

- MCP 工具使用本地文件路径作为输入，例如 `D:\assets\effect.png`。
- 输出使用 `outputPath` 或 `outputDir`。
- 如果没有提供输出位置，默认输出到项目的 `outputs/` 目录。
- 单图工具返回 PNG 路径和元数据。
- 批量、图集、视频工具返回 ZIP 路径，并尽量解析 `manifest.json` 或 `atlas.json` 摘要。

## 工具列表

| 工具名 | 用途 |
| --- | --- |
| `health_check` | 检查 GameAssetForge API 是否可用 |
| `chroma_key_image` | 图片抠绿幕、品红、蓝幕或自定义背景色 |
| `resize_image` | 图片改分辨率 |
| `trim_transparent_edges` | 自动裁透明边，返回 offset 元数据 |
| `pixel_scale_image` | 像素风最近邻放大 / 缩小 |
| `true_pixel_image` | AI 伪像素图转真实硬边像素 PNG |
| `pixel_image_to_json` | 像素图导出为 `{w,h,c,p}` 调色板索引 JSON |
| `interpolate_images` | 两帧图片生成中间帧 |
| `build_atlas` | 多图合成图集 ZIP |
| `batch_process_images` | 批量裁透明边、像素缩放、扣背景或真像素化 |
| `rename_sequence` | 序列帧排序和重命名 |
| `slice_atlas` | 未知图集按网格切割 |
| `auto_slice_atlas` | 自动识别透明背景、纯色背景或规则网格图集并切割 |
| `slice_atlas_boxes` | 按自定义 `{x,y,w,h}` 框切割图集 |
| `extract_video_frames` | 视频抽帧 |
| `chroma_key_video` | 视频逐帧抠背景 |
| `extract_unity_apk` | Unity APK 工程还原、资源提取或 IL2CPP 结构分析 |

## 调用示例

以 `trim_transparent_edges` 为例，Agent 需要传入：

```json
{
  "imagePath": "D:\\assets\\sprite.png",
  "outputDir": "D:\\assets\\out",
  "alphaThreshold": 8,
  "padding": 2
}
```

返回示例：

```json
{
  "ok": true,
  "outputPath": "D:\\assets\\out\\trimmed-image.png",
  "contentType": "image/png",
  "metadata": {
    "originalWidth": 128,
    "originalHeight": 128,
    "x": 12,
    "y": 8,
    "width": 96,
    "height": 104,
    "empty": false,
    "alphaThreshold": 8,
    "padding": 2
  }
}
```

图集切割类工具支持 `prefix` 参数，例如 `enemy_idle` 会输出 `enemy_idle_0001.png`、`enemy_idle_0002.png`。

## 设计说明

MCP 层只负责：

- 暴露 Agent 友好的工具名和参数 schema。
- 接收本地文件路径。
- 调用 HTTP API。
- 保存输出文件。
- 返回结构化结果。

这样后续新增算法时，只需要先补 API，再在 MCP 层加一个轻量 wrapper。
## 新增 MCP 工具

新增功能也提供 MCP 入口，适合让 Agent 直接处理本地文件路径：

- `convert_image`
- `pack_atlas_enhanced`
- `sprite_fx_image`
- `export_sequence_animation`
- `nine_slice_image`
- `slice_tileset`
- `quality_report_images`
- `batch_color_adjust`
- `process_audio`
- `extract_unity_apk`

这些工具默认把结果写入 `outputs/`，也可以传入 `outputPath` 或 `outputDir` 指定输出位置。

`extract_unity_apk` 支持 `mode=project/assets/raw/code` 和 `runMode=quick/expert`。快速模式会优先检测 `tools/external/` 内置工具；专家模式可传入 `commandTemplate` 或 `toolArgs`，并使用 `{input}`、`{inputDir}`、`{dataDir}`、`{output}` 等占位符：

```json
{
  "apkPath": "D:\\builds\\game.apk",
  "mode": "project",
  "runMode": "expert",
  "tool": "assetripper",
  "commandTemplate": "\"C:\\Tools\\AssetRipper\\AssetRipper.CLI.exe\" \"{input}\" \"{output}\"",
  "outputDir": "D:\\builds\\inspect"
}
```
