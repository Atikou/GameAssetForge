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
| `preset` | string | 否 | `green` | `green`、`magenta`、`blue`、`custom` |
| `color` | string | 否 | `#00ff00` | 自定义颜色 |
| `tolerance` | number | 否 | `72` | 抠色容差，范围 `0-441` |
| `softness` | number | 否 | `18` | 边缘柔化，范围 `0-441` |

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

## 给 AI 调用的建议流程

1. 先调用 `GET /api/health` 确认服务可用。
2. 单张图片优先使用 `/api/image/chroma-key`、`/api/image/trim-transparent`、`/api/image/pixel-scale`、`/api/image/resize`。
3. 多图流水线使用 `/api/batch/process`，得到 ZIP 后读取 `manifest.json` 继续下一步。
4. 序列帧先用 `/api/sequence/rename` 统一命名，再用 `/api/atlas` 合成图集。
5. 未知图集优先用 `/api/atlas/auto-slice` 自动识别；需要精确控制行列时再用 `/api/atlas/slice`。
