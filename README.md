# Moqui Helper

Moqui Framework 3 的 XML 辅助扩展，运行在 Cursor、VS Code 以及其他支持标准 VS Code 扩展 API 的桌面编辑器上。

当前是骨架：工作区根目录有 `MoquiInit.properties` 时启动语言服务，服务只完成初始化。功能范围见 [docs/requirements.md](docs/requirements.md)。

## 环境

- Node.js 20 或更新版本
- npm

## 编译

```bash
npm install
npm run compile
```

产物在 `out/extension.js` 和 `out/server/index.js`。

## 在 Cursor 或 VS Code 中调试

1. 用编辑器打开本仓库。
2. 运行调试配置 `Run Extension`。它会先执行 `npm run compile`，再打开一个扩展开发宿主。
3. 在开发宿主里打开一个根目录含有 `MoquiInit.properties` 的 Moqui 项目。扩展此时才会启动语言服务。

调试服务进程时，语言服务监听检查端口 `6009`。
