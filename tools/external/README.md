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

工具放在这里后，GameAssetForge 会自动检测并在“快速模式”下调用它们。

```text
tools/external/
  assetripper/
    AssetRipper.CLI.exe
  assetstudio/
    AssetStudioModCLI.exe
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
