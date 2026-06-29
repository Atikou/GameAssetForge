# Unity 外部工具目录

`npm install` 会自动检查并下载 Unity APK 相关工具。也可以手动运行：

```powershell
npm run install-tools
```

如果只想安装 npm 依赖，不想下载外部工具：

```powershell
$env:GAF_SKIP_TOOL_INSTALL=1
npm install
```

工具放在这里后，GameAssetForge 会自动检测。AssetStudio、Cpp2IL、jadx、Java 和 UnityPy 可由快速模式自动调用。
AssetRipper 只有检测到可退出的 CLI/headless 程序时才会自动化；如果只有 GUI 包，则会标记为“仅手动/专家模式”。

```text
tools/external/
  assetripper/
    AssetRipper.CLI.exe        # 自动引用结构还原首选
    AssetRipper.GUI.Free.exe   # 只能手动/专家模式使用
  assetstudio/
    AssetStudio.CLI.exe
  cpp2il/
    Cpp2IL.exe
  jadx/
    lib/jadx-*.jar
  java/
    jdk-17.*-jre/bin/java.exe
  unitypy/
    .venv/Scripts/python.exe
    export_unitypy.py
```

如果不想放到项目目录，也可以用环境变量或界面的专家模式指定命令。
