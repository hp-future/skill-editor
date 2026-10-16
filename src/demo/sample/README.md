# 示例技能包

`api-call-by-knowledge.zip` 用于演示页默认载入，也是目录树 / `SKILL.md` 解析的对照样本。

它的未压缩源文件在 `../fixtures/api-call-by-knowledge/`，压缩包即由该目录打包而成（保留顶层
`api-call-by-knowledge/` 目录，用于演示 wrapper 目录折叠）。

重新打包（Windows PowerShell，在仓库根目录执行）：

```powershell
Push-Location src\demo\fixtures
Compress-Archive -Path .\api-call-by-knowledge -DestinationPath ..\sample\api-call-by-knowledge.zip -Force
Pop-Location
```

其他平台：

```bash
cd src/demo/fixtures && zip -r ../sample/api-call-by-knowledge.zip api-call-by-knowledge
```

也可以用命令行直接查看解析结果：

```bash
pnpm inspect src/demo/sample/api-call-by-knowledge.zip
```
