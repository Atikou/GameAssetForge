# GameAssetForge API 文档

GameAssetForge 提供本地 HTTP API，方便 AI、自动化脚本和素材流水线直接调用游戏美术处理工具。默认只监听本机地址。

## 启动

```powershell
cd D:\Learn\GameAssetForge
npm install
npm run api
```

默认服务地址：

```text
http://127.0.0.1:5180
```

修改端口：

```powershell
$env:PORT=5181; npm run api
```

## 通用约定

- 上传文件使用 `multipart/form-data`。
- 单图接口通常返回 `image/png`。
- 多文件或带批量结果的接口返回 `application/zip`，压缩包内包含 `manifest.json`。
- 单图元数据会放在响应头 `X-GameAssetForge-Metadata`，内容为 base64 编码 JSON。
- 失败时返回 JSON：

```json
{
  "error": {
    "message": "错误说明"
  }
}
```

## 健康检查

```http
GET /api/health
```

## 图片背景色透明化

```http
POST /api/image/chroma-key
Content-Type: multipart/form-data
```

| 参数 | 类型 | 必填 | 默认值 | 说明 |
| --- | --- | --- | --- | --- |
| `image` | File | 是 | 无 | 输入图片 |
| `preset` | string | 否 | `green` | `green`、`magenta`、`blue`、`custom`、`auto`；`auto` 会从四角估计背景色 |
| `color` | string | 否 | `#00ff00` | 自定义颜色 |
| `tolerance` | number | 否 | `72` | 抠色容差，范围 `0-441` |
| `softness` | number | 否 | `18` | 边缘柔化，范围 `0-441` |
| `spill` | number | 否 | `85` | 去色边 / 去绿边强度，范围 `0-100` |
| `edgeCleanup` | number | 否 | `18` | 半透明边缘清理强度，范围 `0-100` |
| `matting` | boolean | 否 | `true` | 启用自动 trimap + guided matting 边缘精修 |
| `mattingStrength` | number | 否 | `70` | Matting 精修强度，范围 `0-100` |
| `mattingRadius` | number | 否 | `4` | Matting 引导滤波半径，范围 `1-32` |

响应：PNG 图片。

```bash
curl -X POST http://127.0.0.1:5180/api/image/chroma-key \
  -F "image=@effect.png" \
  -F "preset=green" \
  --output effect-transparent.png
```

## 图片改分辨率

```http
POST /api/image/resize
Content-Type: multipart/form-data
```

| 参数 | 类型 | 必填 | 默认值 | 说明 |
| --- | --- | --- | --- | --- |
| `image` | File | 是 | 无 | 输入图片 |
| `mode` | string | 否 | `exact` | `exact`、`scale`、`maxSide` |
| `width` | number | 否 | 原图宽 | 指定宽度 |
| `height` | number | 否 | 原图高 | 指定高度 |
| `scale` | number | 否 | `50` | 百分比，例如 `50` |
| `maxSide` | number | 否 | `1024` | 最长边限制 |

响应：PNG 图片。

## 自动裁透明边

```http
POST /api/image/trim-transparent
Content-Type: multipart/form-data
```

| 参数 | 类型 | 必填 | 默认值 | 说明 |
| --- | --- | --- | --- | --- |
| `image` | File | 是 | 无 | 输入透明 PNG 或任意可读图片 |
| `alphaThreshold` | number | 否 | `8` | 透明判定阈值，范围 `0-255` |
| `padding` | number | 否 | `0` | 裁切后保留的透明边距 |

响应：PNG 图片。响应头 `X-GameAssetForge-Metadata` 包含裁切偏移、原图尺寸和结果尺寸。

```bash
curl -X POST http://127.0.0.1:5180/api/image/trim-transparent \
  -F "image=@sprite.png" \
  -F "alphaThreshold=8" \
  -F "padding=2" \
  --output sprite-trim.png
```

## 像素风放大 / 缩小

```http
POST /api/image/pixel-scale
Content-Type: multipart/form-data
```

| 参数 | 类型 | 必填 | 默认值 | 说明 |
| --- | --- | --- | --- | --- |
| `image` | File | 是 | 无 | 输入图片 |
| `factor` | number | 否 | `2` | 缩放倍数，支持 `0.5`、`2`、`4` 等 |

响应：使用最近邻算法处理后的 PNG 图片。

## 图片插帧

```http
POST /api/image/interpolate
Content-Type: multipart/form-data
```

| 参数 | 类型 | 必填 | 默认值 | 说明 |
| --- | --- | --- | --- | --- |
| `frameA` | File | 是 | 无 | 前一帧 |
| `frameB` | File | 是 | 无 | 后一帧 |
| `t` | number | 否 | `0.5` | 插帧位置，范围 `0-1` |
| `mode` | string | 否 | `alphaBlend` | `alphaBlend` 或 `nearest` |

响应：PNG 图片。

## 批量处理队列

```http
POST /api/batch/process
Content-Type: multipart/form-data
```

| 参数 | 类型 | 必填 | 默认值 | 说明 |
| --- | --- | --- | --- | --- |
| `images` | File[] | 是 | 无 | 重复上传多个图片 |
| `operation` | string | 否 | `trim` | `trim` 或 `pixelScale` |
| `alphaThreshold` | number | 否 | `8` | `trim` 使用 |
| `padding` | number | 否 | `0` | `trim` 使用 |
| `factor` | number | 否 | `2` | `pixelScale` 使用 |

响应：ZIP，包含处理后的 PNG 和 `manifest.json`。

```bash
curl -X POST http://127.0.0.1:5180/api/batch/process \
  -F "images=@a.png" \
  -F "images=@b.png" \
  -F "operation=trim" \
  --output batch-results.zip
```

## 序列帧重命名 / 排序

```http
POST /api/sequence/rename
Content-Type: multipart/form-data
```

| 参数 | 类型 | 必填 | 默认值 | 说明 |
| --- | --- | --- | --- | --- |
| `frames` | File[] | 是 | 无 | 序列帧文件 |
| `sort` | string | 否 | `natural` | `natural`、`reverse`、`mtime` |
| `prefix` | string | 否 | `frame` | 输出名前缀 |
| `start` | number | 否 | `0` | 起始编号 |
| `padding` | number | 否 | `4` | 编号补零位数 |
| `format` | string | 否 | `original` | `original` 或 `png` |

响应：ZIP，包含重命名后的文件和 `manifest.json`。

## 导入未知图集切割

### 自动识别切割

```http
POST /api/atlas/auto-slice
Content-Type: multipart/form-data
```

| 参数 | 类型 | 必填 | 默认值 | 说明 |
| --- | --- | --- | --- | --- |
| `image` | File | 是 | 无 | 输入图集 |
| `mode` | string | 否 | `auto` | `auto`、`alpha`、`solid`、`grid` |
| `threshold` | number | 否 | `16` | alpha 阈值或背景色距离容差 |
| `minArea` | number | 否 | `8` | 忽略小于该面积的噪点 |
| `padding` | number | 否 | `0` | 每个切片框外扩像素 |
| `prefix` | string | 否 | `slice` | 输出切片名前缀 |

响应：ZIP，包含自动切割出的 PNG 和 `manifest.json`。`manifest.json` 中会包含 `detection.detectedMode`、背景采样色和每个切片的矩形。

推荐优先使用 `mode=auto`。如果自动判断不准：

- 透明 PNG 图集使用 `mode=alpha`
- 纯色底图集使用 `mode=solid`
- 规则行列图集使用 `mode=grid`

```bash
curl -X POST http://127.0.0.1:5180/api/atlas/auto-slice \
  -F "image=@atlas.png" \
  -F "mode=auto" \
  -F "threshold=16" \
  -F "minArea=8" \
  -F "prefix=enemy_idle" \
  --output atlas-auto-slices.zip
```

### 手动网格切割

```http
POST /api/atlas/slice
Content-Type: multipart/form-data
```

| 参数 | 类型 | 必填 | 默认值 | 说明 |
| --- | --- | --- | --- | --- |
| `image` | File | 是 | 无 | 输入图集 |
| `columns` | number | 否 | `1` | 列数 |
| `rows` | number | 否 | `1` | 行数 |
| `cellWidth` | number | 否 | 自动计算 | 单格宽度 |
| `cellHeight` | number | 否 | 自动计算 | 单格高度 |
| `marginX` | number | 否 | `0` | 左右边距 |
| `marginY` | number | 否 | `0` | 上下边距 |
| `gapX` | number | 否 | `0` | 横向间隔 |
| `gapY` | number | 否 | `0` | 纵向间隔 |
| `prefix` | string | 否 | `slice` | 输出名前缀 |

响应：ZIP，包含切割出的 PNG 和 `manifest.json`。

### 自定义框切割

```http
POST /api/atlas/slice-boxes
Content-Type: multipart/form-data
```

| 参数 | 类型 | 必填 | 默认值 | 说明 |
| --- | --- | --- | --- | --- |
| `image` | File | 是 | 无 | 输入图集 |
| `boxes` | JSON string | 是 | 无 | 切割框数组，如 `[{"x":10,"y":12,"w":32,"h":32}]` |
| `prefix` | string | 否 | `slice` | 未指定单个框 `name` 时使用的输出名前缀 |

`boxes` 中每个对象支持：

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `x` / `y` | number | 是 | 切割框左上角 |
| `w` / `h` | number | 是 | 切割框宽高，也可使用 `width` / `height` |
| `name` | string | 否 | 指定该切片输出文件名 |

响应：ZIP，包含切割出的 PNG 和 `manifest.json`。适合把前端手动拖拽调整后的切割框交给 Agent/API 复用。

## 多图合成图集

```http
POST /api/atlas
Content-Type: multipart/form-data
```

| 参数 | 类型 | 必填 | 默认值 | 说明 |
| --- | --- | --- | --- | --- |
| `frames` | File[] | 是 | 无 | 多张帧图 |
| `columns` | number | 否 | 自动计算 | 图集列数 |

响应：ZIP，包含 `atlas.png` 和 `atlas.json`。

## 视频抽帧

```http
POST /api/video/extract-frames
Content-Type: multipart/form-data
```

| 参数 | 类型 | 必填 | 默认值 | 说明 |
| --- | --- | --- | --- | --- |
| `video` | File | 是 | 无 | 输入视频 |
| `interval` | number | 否 | `0.5` | 抽帧间隔，单位秒 |
| `maxFrames` | number | 否 | `240` | 最大导出帧数 |

响应：ZIP，包含帧 PNG 和 `manifest.json`。

## 视频抠背景

```http
POST /api/video/chroma-key
Content-Type: multipart/form-data
```

参数同 `/api/video/extract-frames` 加 `/api/image/chroma-key` 的抠色参数。

响应：ZIP，包含透明帧 PNG 和 `manifest.json`。

## Unity APK 工程还原 / 资源提取

```http
GET /api/unity/toolchain
```

返回项目内置工具链检测结果，包括 `tools/external/` 下 AssetRipper、AssetStudio、Cpp2IL、UnityPy 的可用状态、候选程序名和环境变量名。

```http
POST /api/unity/apk-inspect
Content-Type: multipart/form-data
```

只解析 APK/ZIP 结构，不调用任何外部工具。浏览器 UI 在选择 APK 后会立即调用该接口，并弹窗显示是否检测为 Unity APK、`assets/bin/Data`、AssetBundle、`global-metadata.dat`、`libunity.so`、`libil2cpp.so` 等关键结构数量。验证未通过时会禁用后续提取按钮。

```http
POST /api/unity/apk-extract
Content-Type: multipart/form-data
```

| 参数 | 类型 | 必填 | 默认值 | 说明 |
| --- | --- | --- | --- | --- |
| `apk` | File | 是 | 无 | Unity Android APK |
| `mode` | string | 否 | `assets` | `project` 按引用还原工程、`assets` 只提取资源、`code` 做 IL2CPP 结构分析、`raw` 仅解包 Unity 原始结构 |
| `runMode` | string | 否 | `quick` | `quick` 使用内置工具链预设参数；`expert` 允许覆盖命令模板或参数 |
| `tool` | string | 否 | `auto` | `auto`、`assetripper`、`assetstudio`、`unitypy`、`cpp2il`、`raw` |
| `includeRaw` | boolean | 否 | `true` | 是否把 APK 中识别到的 Unity 原始结构放入 ZIP 的 `apk-unity-data/` |
| `assetTypes` | string | 否 | `texture,audio,mesh,text` | 传给命令模板的资源类型备注 |
| `commandTemplate` | string | 否 | 无 | 专家模式命令模板；留空时优先使用 `tools/external/` 内置工具 |
| `toolArgs` | string | 否 | 无 | 专家模式参数模板；有内置工具路径但要覆盖默认参数时使用 |
| `timeoutMs` | number | 否 | `600000` | 外部工具超时时间 |

响应：ZIP，包含 `manifest.json`、可选 `apk-unity-data/`、可选外部工具输出 `tool-output/`。

进度模式推荐给浏览器 UI 使用：

```http
POST /api/unity/apk-extract/jobs
GET /api/unity/apk-extract/jobs/{jobId}
GET /api/unity/apk-extract/jobs/{jobId}/download
```

`POST /jobs` 使用同样的 multipart 参数，立即返回 `jobId`、`status`、`percent`、`message` 和 `downloadUrl`。轮询 `GET /jobs/{jobId}` 可查看执行阶段、百分比和最近日志；状态为 `done` 后再请求 `downloadUrl` 下载 ZIP。同步接口 `POST /api/unity/apk-extract` 继续保留，适合脚本或 MCP 直接等待结果。

命令模板支持以下占位符：

| 占位符 | 含义 |
| --- | --- |
| `{input}` / `{apk}` | 临时 APK 文件路径 |
| `{inputDir}` | 已解包的 Unity 相关文件目录 |
| `{dataDir}` | `{inputDir}/assets/bin/Data` |
| `{output}` | 外部工具输出目录 |
| `{mode}` | 当前模式 |
| `{assetTypes}` | `assetTypes` 参数 |

内置工具默认目录：

| 工具 | 目录 | 主要文件 |
| --- | --- | --- |
| AssetRipper | `tools/external/assetripper/` | `AssetRipper.CLI.exe` |
| AssetStudio | `tools/external/assetstudio/` | `AssetStudioModCLI.exe` |
| Cpp2IL | `tools/external/cpp2il/` | `Cpp2IL.exe` |
| UnityPy | `tools/external/unitypy/` | `.venv/Scripts/python.exe` + `export_unitypy.py` |

示例：

```bash
curl -X POST http://127.0.0.1:5180/api/unity/apk-extract \
  -F "apk=@game.apk" \
  -F "mode=project" \
  -F "tool=assetripper" \
  -F "commandTemplate=\"C:\Tools\AssetRipper\AssetRipper.CLI.exe\" \"{input}\" \"{output}\"" \
  --output unity-apk-extract.zip
```

## 给 AI 调用的建议流程

1. 先调用 `GET /api/health` 确认服务可用。
2. 单张图片优先使用 `/api/image/chroma-key`、`/api/image/trim-transparent`、`/api/image/pixel-scale`、`/api/image/resize`。
3. 多图流水线使用 `/api/batch/process`，得到 ZIP 后读取 `manifest.json` 继续下一步。
4. 序列帧先用 `/api/sequence/rename` 统一命名，再用 `/api/atlas` 合成图集。
5. 未知图集优先用 `/api/atlas/auto-slice` 自动识别；需要精确控制行列时再用 `/api/atlas/slice`。
6. Unity APK 打包后检查使用 `/api/unity/apk-extract`；未配置外部工具时先读取 `manifest.json` 和 `apk-unity-data/`，配置 AssetRipper 后再生成还原工程。

## 新增工具 API

以下接口同样使用本地 HTTP 服务，不会上传到外部服务。

| 功能 | 接口 | 输入 | 输出 |
| --- | --- | --- | --- |
| 图片格式转换 / 压缩 | `POST /api/image/convert` | `image`，`format=png/webp/jpeg/avif`，`quality`，`maxSide`，`background` | 图片文件 |
| 透明边缘修复 | `POST /api/image/edge-fix` | `image`，`iterations`，`alphaThreshold` | PNG |
| Sprite 描边 / 投影 / 调色 / 压色 | `POST /api/image/stylize` | `image`，`operation=outline/shadow/palette/color` 及对应参数 | PNG |
| 法线图 | `POST /api/image/normal-map` | `image`，`strength` | PNG |
| 遮罩图 / 高光图基础图 | `POST /api/image/mask-map` | `image`，`channel=alpha/luma`，`invert` | PNG |
| 增强图集打包 | `POST /api/atlas/pack` | 多个 `frames`，`padding`，`extrude`，`trim`，`powerOfTwo`，`maxSize`，`engine` | ZIP，含 `atlas.png`、`atlas.json`、引擎 JSON |
| 序列帧动图 | `POST /api/sequence/animation` | 多个 `frames`，`fps`，`format=gif/webp/mp4` | GIF / WebP / MP4 |
| 九宫格切片 | `POST /api/ui/nine-slice` | `image`，`left/right/top/bottom` | ZIP，含 9 个切片和 `nine-slice.json` |
| Tileset 切片 | `POST /api/tileset/slice` | `image`，`tileWidth`，`tileHeight`，`marginX/Y`，`gapX/Y`，`dedupe` | ZIP，含 tile PNG 和 `tileset.json` |
| 素材质检 | `POST /api/quality/report` | 多个 `images` | JSON 报告 |
| 批量调色 | `POST /api/batch/color` | 多个 `images`，`brightness`，`saturation`，`hue` | ZIP |
| 音频转码 / 标准化 | `POST /api/audio/process` | `audio`，`operation=convert/normalize`，`format=ogg/mp3/wav/m4a`，`bitrate` | 音频文件 |
| Unity APK 工程还原 / 资源提取 | `POST /api/unity/apk-extract` | `apk`，`mode`，`tool`，可选 `commandTemplate` | ZIP，含 `manifest.json`、原始 Unity 结构和外部工具输出 |
