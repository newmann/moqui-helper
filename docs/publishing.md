# 打包与发布

同一份 VSIX 发给 Visual Studio Marketplace 和 Open VSX，并附到 GitHub Release。VS Code 从微软市场安装。Cursor、VSCodium 和 CodeBuddy 国际版从 Open VSX 安装。CodeBuddy 国内版没有第三方发布入口，用这份 VSIX 侧载。

`publisher` 必须是 `newmann`，并且已经在两个市场后台建成同名发布者。许可证保持 `CC0-1.0`，与 `LICENSE.md` 和 `schemas/*.xsd` 的文件头一致。

## 发布前

1. 在 `package.json` 里改 `version`。版本号用语义化版本。
2. 在 `CHANGELOG.md` 顶部加上这一版的摘要。
3. 确认 `publisher` 仍是 `newmann`，`license` 仍是 `CC0-1.0`。发布者 ID 只能含字母、数字和连字符。
4. 提交这次版本变更。发布用的标签和 VSIX 都指向这次提交。

构建机使用 Node.js 20 或更新版本。扩展宿主按 `engines.vscode` `^1.85.0` 运行，对应的 Node 是 18，所以 `scripts/esbuild.mjs` 的 `target` 保持 `node18`。

## 打包

```bash
npm install
npm test
npm run package
```

`npm test` 先检查 catalog，再编译并运行 `out-test` 里的测试。`npm run package` 会先做类型检查，再用 esbuild 打出压缩后的两个入口，然后调用 `vsce package`。

两个入口不能合成一个文件：

- `out/extension.js` 跑在扩展宿主里。`vscode` 保持外部模块。
- `out/server/index.js` 是独立的语言服务进程。扩展用这个文件的绝对路径启动它。

语言服务依赖已经打进这两个文件，所以它们放在 `devDependencies`。`.vscodeignore` 排除整个 `node_modules`。打包前脚本会清空 `out/`，避免旧的 `tsc` 产物进包。

生成的文件名是 `moqui-helper-<version>.vsix`。`vsce ls` 的结果里应有：

- `extension/out/extension.js`
- `extension/out/server/index.js`
- `extension/schemas/catalog.xml`
- `extension/readme.md`
- `extension/LICENSE.md`

不应有 `node_modules/`、`src/`、`test/`、`docs/`、`scripts/` 或 `.map`。`docs/` 被排除是预期行为，商店页只渲染包内的 `README.md`。

## 侧载验收

用这份 VSIX 在未打开本仓库的编辑器里安装。扩展开发宿主不会自动安装 `extensionDependencies`，不能当作发布验收。

验收用一个根目录含有 `MoquiInit.properties` 或 `moq` 的 Moqui 工程：

- 扩展因其中一个标记文件激活，并拉起 Red Hat XML（`redhat.vscode-xml`）。
- 日志里没有 `Missing addXMLFileAssociations`。没有这项 API 时，结构补全不会注册，语言服务仍会启动。
- 实体或服务能补全，并能跳到定义。
- 资源管理器里对应的 Moqui XML 出现两个字母的徽章。

CodeBuddy 国内版在工作区未受信任时不会启动扩展。先信任工作区，再看上面几项。安装命令：

```bash
buddycn --install-extension moqui-helper-<version>.vsix
```

也可以在扩展视图里选择 **Extensions: Install from VSIX**。同一宿主里还要能装上 Red Hat XML。Open VSX 上已有 `redhat.vscode-xml`。

## 发布到两个市场

先在后台建好发布者，再发布。令牌只放在本机环境变量或 CI secret 里，不要写进仓库，也不要留在 shell 历史里。

Visual Studio Marketplace 给 VS Code 用。在 [Marketplace 管理页](https://marketplace.visualstudio.com/manage) 创建发布者 `newmann`。个人访问令牌在 Azure DevOps 创建，范围选择 Marketplace 的 Manage。

```bash
# bash
export VSCE_PAT="令牌"

# PowerShell
$env:VSCE_PAT = "令牌"

npx vsce publish --packagePath moqui-helper-<version>.vsix
```

`--packagePath` 上传已经验收过的那个文件，避免发布时再打一次包。

Open VSX 给 Cursor、VSCodium 和 CodeBuddy 国际版用。用 GitHub 账号登录 [open-vsx.org](https://open-vsx.org)，创建命名空间 `newmann`，再创建访问令牌。

```bash
export OVSX_PAT="令牌"
npx ovsx publish moqui-helper-<version>.vsix -p "$OVSX_PAT"
```

```powershell
$env:OVSX_PAT = "令牌"
npx ovsx publish moqui-helper-<version>.vsix -p $env:OVSX_PAT
```

两个市场的版本号必须相同，并且都是这一份 VSIX。

CodeBuddy 国际版装好后可以用：

```bash
buddy --install-extension newmann.moqui-helper
```

国内版不要把插件市场改到 `https://marketplace.visualstudio.com`。那是用户自己的编辑器设置，不是本扩展的发布步骤。

## GitHub Release

国内版 CodeBuddy 的安装说明指向 GitHub Release 上的 VSIX。标签用 `v` 加版本号，附件用刚发布的那个文件。

```bash
git tag v<version>
git push origin v<version>
gh release create v<version> moqui-helper-<version>.vsix --title "v<version>" --notes-file CHANGELOG.md
```

`--notes-file` 会带上整个变更记录。若只要这一版，把对应段落写进发布说明。

## 不要做的事

- 不要把令牌提交进仓库。
- 不要在 `extension.js` 里打包 `vscode`，也不要把语言服务并进扩展宿主的那个文件。
- 不要为了消除文件数量提示而把 `node_modules` 重新放进 VSIX。依赖已经在两个入口里。
- 不要改 `publisher`，除非新 ID 已经在两个市场建成。
- 不要把许可证改回和 `LICENSE.md` 不一致的值。
