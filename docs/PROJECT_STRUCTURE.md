# 项目结构

GameAssetForge 按“启动入口 / 路由 / 工具实现 / 公共库”拆分服务端代码，新增工具时不要再把实现写进 `server/index.js`。

## 服务端

```text
server/
  index.js              # API 启动入口，只负责 Express、静态文件、错误处理
  lib/
    common.js           # 参数解析、文件名、颜色、通用数值工具
    http.js             # 上传文件校验和 PNG / ZIP / 二进制响应
    process.js          # 临时目录、ffmpeg、外部进程执行
  routes/
    index.js            # 汇总注册全部 API 路由
    image.routes.js     # 图片处理接口
    atlas.routes.js     # 图集、切片、九宫格、tileset 接口
    batch.routes.js     # 批量处理接口
    sequence.routes.js  # 序列帧重命名和动图导出接口
    media.routes.js     # 视频和音频接口
    quality.routes.js   # 素材质检接口
    unity.routes.js     # Unity APK 资源提取接口
  tools/
    unity-adapters/      # 内置工具链检测和命令适配器
    image.js            # 抠图、缩放、插帧、Sprite 增强等图片算法
    atlas.js            # 图集打包、切片、九宫格、tileset
    batch.js            # 批量处理和质检
    sequence.js         # 序列帧整理、GIF/WebP/MP4 导出
    media.js            # 视频抽帧、视频抠图、音频转码
    unity-apk.js        # APK 扫描、AssetRipper/AssetStudio/Cpp2IL 命令模板适配
```

## 内置 Unity 工具链

```text
tools/external/
  assetripper/           # 放 AssetRipper.CLI.exe 等
  assetstudio/           # 放 AssetStudioModCLI.exe 等
  cpp2il/                # 放 Cpp2IL.exe
  unitypy/               # 放 UnityPy Python venv 和 export_unitypy.py
```

Unity APK 面板会先调用 `GET /api/unity/toolchain` 检测这些目录。快速模式会使用 adapter 的预设参数；专家模式可以继续传 `commandTemplate` 或 `toolArgs` 覆盖默认行为。

## 新增工具约定

1. 算法或外部工具调用写到 `server/tools/<tool-name>.js`。
2. HTTP 表单、响应和错误流转写到 `server/routes/<tool-name>.routes.js`。
3. 公共小函数优先放进 `server/lib/common.js`、`server/lib/http.js` 或 `server/lib/process.js`。
4. 在 `server/routes/index.js` 注册路由模块。
5. 在 `scripts/smoke-check.js` 补新增 DOM id、API route 或 MCP tool 的检查项。

前端当前仍以 `src/app.js` 作为浏览器入口，已经按 `setupXxxTool()` 分块组织。后续如果继续扩大，建议把工具面板拆成 `src/tools/<tool-name>.js`，并把 `index.html` 改为 ES module 入口。
