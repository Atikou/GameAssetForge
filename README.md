# GameAssetForge 游戏常用工具

GameAssetForge 是一个本地运行的游戏素材处理工具台，提供中文网页界面、HTTP API 和 MCP 工具入口，方便 AI 或自动化脚本直接调用素材处理能力。

## 当前功能

- 图片背景色透明化：支持绿幕、品红背景、蓝色背景和自定义颜色。
- 图片改分辨率：支持指定宽高、按比例缩放、限制最长边。
- 自动裁透明边：裁掉 PNG 四周空透明区域，并生成偏移元数据。
- 像素风放大 / 缩小：使用最近邻算法，适合像素素材。
- 像素图片编辑：支持小尺寸像素画布、画笔、橡皮和吸色。
- 图片插帧：输入前后两帧，生成一张轻量中间帧。
- 视频抽帧：支持按时间间隔批量抽帧，并可预览帧动画。
- 视频抠背景：支持将视频按帧扣绿幕、品红、蓝幕或自定义背景色，导出透明 PNG 序列。
- 批量处理队列：多图批量裁透明边或像素缩放。
- 序列帧重命名 / 排序：统一前缀、补零编号和导出 manifest。
- 未知图集切割：支持透明背景、纯色背景、规则网格自动识别，也可按行列、格子尺寸、边距和间隔手动切割。
- 帧图导出：支持多张图片合成图集 PNG，并生成对应 JSON 元数据。
- Unity APK 资源检查：导入打包后的 APK，导出 Unity 原始结构清单，配置 AssetRipper / AssetStudio / Cpp2IL 后可还原工程、提取资源或分析 IL2CPP。

## 运行完整工具

首次运行前安装依赖：

```powershell
npm install
```

启动：

```powershell
npm run serve
```

该命令会同时启动网页、API 和 MCP，并自动打开默认浏览器：

```text
网页：http://127.0.0.1:5173/
API ：http://127.0.0.1:5180/
MCP ：http://127.0.0.1:5181/mcp
```

按 `Ctrl+C` 会同时关闭网页、API 和 MCP。

如需指定端口：

```powershell
$env:WEB_PORT=5174
$env:API_PORT=5182
$env:MCP_PORT=5183
npm run serve
```

## 单独运行

只运行 API：

```powershell
npm run api
```

只运行 MCP：

```powershell
npm run mcp
```

单独运行 MCP 时，需要 API 已经可用。可通过 `GAF_API_URL` 指定 API 地址。

## 文档

- API 文档：[docs/API.md](docs/API.md)
- MCP 文档：[docs/MCP.md](docs/MCP.md)
- 项目结构：[docs/PROJECT_STRUCTURE.md](docs/PROJECT_STRUCTURE.md)

## 检查项目

```powershell
npm run check
```

## 说明

- 网页工具主要在浏览器本地处理素材。
- API 服务在本机处理素材，不会上传到外部服务。
- MCP 面向 Agent，使用本地文件路径输入，返回输出文件路径和结构化元数据。
- 视频抽帧和视频抠背景依赖项目安装的 `ffmpeg-static`。

## 新增工具概览

- 格式转换 / 压缩：PNG、WebP、JPG、AVIF，支持质量和最长边限制。
- 增强图集打包：padding、extrude、裁透明边、2 的幂尺寸，以及 Unity / Godot / Cocos / Pixi manifest。
- Unity APK 工程还原 / 资源提取：默认产出 `manifest.json` 和 `apk-unity-data/`，可通过命令模板接入 AssetRipper、Razviar/AssetStudio、UnityPy、Cpp2IL。
- 内置 Unity 工具链：把工具放入 `tools/external/assetripper`、`assetstudio`、`cpp2il`、`unitypy` 后，Unity APK 面板会自动检测并使用快速模式调用。
- 序列帧动图：多帧导出 GIF、WebP 或 MP4。
- 透明边缘修复：对抠图后的白边、黑边、色边做 alpha bleed 扩色。
- Sprite 增强：描边、投影、调色、限制色数。
- 九宫格切片：导出 9-slice 切片和 JSON 元数据。
- Tileset 工具：按 tile 尺寸切片，可去重并导出 tileset manifest。
- 法线图 / 遮罩图：从 2D 图片生成基础 normal map、alpha/luma mask。
- 素材质检：检查空白帧、非 2 的幂尺寸、大图风险、尺寸一致性等。
- 批量调色：批量调整亮度、饱和度和色相。
- 音频工具：音效 / BGM 转码和响度标准化。

## 抠图优化

- 抠背景支持 `auto` 自动四角取色，适合 AI 生成图的纯色或近纯色背景。
- 新增边缘去色污染，会从半透明像素中反推并移除绿幕、蓝幕或品红背景混色。
- 新增边缘清理参数，可减少抠图后残留的彩色半透明毛边。
- 新增轻量 Matting 精修：自动生成 trimap，并用 guided alpha refinement 优化边缘，不需要 Python、CUDA 或 AI 模型。
