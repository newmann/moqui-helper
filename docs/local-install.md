# 本地打包并安装到 Cursor 和 CodeBuddy

在本仓库打出一份 VSIX，再装进本机的 Cursor 或 CodeBuddy。市场发布见 [publishing.md](publishing.md)。

当前版本在 `package.json` 的 `version` 里。产物文件名是 `moqui-helper-<version>.vsix`，例如 `0.1.0` 对应 `moqui-helper-0.1.0.vsix`。

## 打包

需要 Node.js 20 或更新版本。在仓库根目录执行：

```bash
npm install
npm test
npm run package
```

`npm test` 先检查 catalog，再编译并运行测试。`npm run package` 做类型检查，用 esbuild 打出压缩后的两个入口，再调用 `vsce package`。成功后，仓库根目录出现 `moqui-helper-<version>.vsix`。

把这份 VSIX 装进已经打开的普通窗口。不要用调试配置拉起的扩展开发宿主验收：那个宿主不会自动安装依赖的 Red Hat XML。

## 安装到 Cursor

```bash
cursor --install-extension ./moqui-helper-<version>.vsix --force
```

```powershell
cursor --install-extension .\moqui-helper-<version>.vsix --force
```

`--force` 用来覆盖已经装过的同一扩展。若提示找不到 `cursor`，在 Cursor 里打开命令面板，执行 **Shell Command: Install 'cursor' command in PATH**。也可以在扩展视图的 `...` 菜单里选择 **Install from VSIX...**，再选中这个文件。

## 安装到 CodeBuddy

国内版：

```bash
buddycn --install-extension moqui-helper-<version>.vsix
```

```powershell
buddycn --install-extension .\moqui-helper-<version>.vsix
```

国际版：

```bash
buddy --install-extension moqui-helper-<version>.vsix
```

```powershell
buddy --install-extension .\moqui-helper-<version>.vsix
```

命令不在 PATH 上时，在扩展视图里选择 **Extensions: Install from VSIX**。国内版没有第三方市场入口，只能用这份 VSIX。

## 装好之后

重新加载窗口。再打开一个根目录有 `MoquiInit.properties` 或 `moq` 的 Moqui 工程。本仓库没有这两个文件，不能用来确认扩展已启动。国内版 CodeBuddy 在工作区未受信任时不会启动扩展，先信任工作区。

宿主会提示安装 Red Hat XML（`redhat.vscode-xml`）。Cursor 从 Open VSX 安装。CodeBuddy 的市场里没有这份扩展时，同样从 Open VSX 或它的 VSIX 安装并启用。

确认这几项：

- 扩展因根目录的 `MoquiInit.properties` 或 `moq` 激活。
- 日志里没有 `Missing addXMLFileAssociations`。没有这项 API 时，结构补全不会注册，语言服务仍会启动。
- 实体或服务能补全，并能跳到定义。
- 资源管理器里对应的 Moqui XML 出现两个字母的徽章。
