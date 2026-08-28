# 项目结构

GameAssetForge 按“启动入口 / 路由 / 工具实现 / 公共库 / 外部工具链”拆分服务端代码。新增工具时，不要把业务实现写进 `server/index.js` 或路由文件里；路由只负责参数、上传文件、响应格式和错误流转。

## 服务端

```text
server/
  index.js              # API 启动入口，只负责监听端口
  app.js                # 可测试的 Express app、静态文件、兼容上传与错误处理
  imagespec/
    access.js           # ImageSpec HTTP 工程根目录白名单
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
    unity.routes.js     # Unity APK 扫描、提取和复原接口
    rankings.routes.js  # 手游排行榜抓取接口
    imagespec.routes.js # ImageSpec Core 的薄 HTTP 适配层
  tools/
    image.js            # 图片工具兼容入口，统一导出 image/ 下的功能
    image/
      background.js     # 抠背景、溢色抑制、边缘 alpha 优化
      transform.js      # 格式转换、缩放、插帧、透明边裁剪
      pixel.js          # 像素放大、AI 假像素转真像素
      effects.js        # 边缘修复、风格化、法线图、遮罩图、调色
    atlas.js            # 图集打包、切片、九宫格、tileset
    batch.js            # 批量处理和质检
    sequence.js         # 序列帧整理、GIF/WebP/MP4 导出
    media.js            # 视频抽帧、视频抠图、音频转码
    app-rankings.js     # 排行榜来源抓取、缓存和综合排序
    unity-apk.js        # APK 扫描、AssetRipper/AssetStudio/Cpp2IL 命令适配
    unity-restore-pipeline.js # Unity 工程复原流水线
    text-asset-postprocess.js # 文本资产、JSON/关卡数据后处理
    unity-adapters/     # 内置 Unity 工具链检测和命令适配器
```

## ImageSpec 领域层

```text
imagespec/
  protocol/             # JSON Schema、稳定 ID、哈希、工厂和语义校验
  core/                 # 工程仓库、锁、原子事务、OperationPlan 执行和 Receipt
  runner/               # 内置能力 Registry、command/HTTP 外部 Runner 适配器
  validator/            # 文件、alpha、边缘、mask、九宫格和变更范围验证
  builder/              # 多倍率构建、atlas、引擎 manifest/适配产物和 ZIP
  cli/                  # 结构化 JSON CLI
mcp/tools/imagespec.js  # 共享 Core 的薄 MCP 工具
src/imagespec-studio.js # Studio 交互模块
src/imagespec-studio.css
skills/imagespec-agent/ # Agent 的 ImageSpec 工作流 Skill
```

`*.project.imagespec` 是权威数据源。HTTP、MCP、CLI 和 Studio 共享同一 Core；路由和工具包装层不复制业务逻辑。设计决策见 `docs/architecture/IMAGESPEC_ADR_001.md`。

## 内置 Unity 工具链

```text
tools/external/
  assetripper/          # 放 AssetRipper.CLI.exe 等本地下载产物
  assetstudio/          # 放 AssetStudioModCLI.exe 等本地下载产物
  cpp2il/               # 放 Cpp2IL.exe
  jadx/                 # 放 jadx / jadx-gui
  unitypy/              # UnityPy Python venv 和 export_unitypy.py
```

这些目录里的二进制工具是本机环境产物，已由 `.gitignore` 忽略。重新拉取项目后执行 `npm install` 会触发 `postinstall`，再由 `scripts/install-unity-tools.js` 尽量补齐可自动安装的工具；无法自动安装的工具会在 `npm run unity-tools` 中提示。

Unity APK 面板会先调用 `GET /api/unity/toolchain` 检测工具链。快速模式使用 adapter 的预设参数；专家模式可以继续用 `commandTemplate` 或 `toolArgs` 覆盖默认行为。

## 新增工具约定

1. 算法或外部工具调用写到 `server/tools/<tool-name>.js`，复杂工具可以继续拆到 `server/tools/<tool-name>/` 子目录。
2. HTTP 表单、响应和错误流转写到 `server/routes/<tool-name>.routes.js`。
3. 公共小函数优先放进 `server/lib/common.js`、`server/lib/http.js` 或 `server/lib/process.js`。
4. 在 `server/routes/index.js` 注册路由模块。
5. 在 `scripts/smoke-check.js` 补新增 DOM id、API route、工具导出或 MCP tool 的检查项。
6. 如果工具会出现在 MCP 中，再同步更新 `mcp/server.js` 和 `docs/MCP.md`。
7. ImageSpec 功能必须先进入 `imagespec/` 领域层，再由 HTTP/MCP/CLI/Studio 做薄适配；不要直接修改派生的 build、receipt 或 revision hash。

## 架构关注点

当前维护压力最大的文件仍是 `src/app.js`、`mcp/server.js` 和 Unity 复原流水线。服务端图片工具已拆为领域模块，下一步更适合继续把前端工具面板拆成 `src/tools/<tool-name>.js`，并把 MCP 工具定义与执行器拆成独立模块。
