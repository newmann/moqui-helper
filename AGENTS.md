# Moqui Helper

Moqui Framework 3 的 XML 辅助扩展。面向标准 VS Code 扩展 API，同一份扩展运行在 Cursor、VS Code、VSCodium 以及其他兼容该 API 的桌面编辑器上。

## 与 IntelliJ 插件的关系

规格参考同级目录 `d:\work\moqui-idea-plugin`：XSD、根标签、属性之间的引用关系。

- 不要移植 IntelliJ PSI、DOM、Swing，也不要把那个仓库当编译依赖。
- 不要把 `DomElement` 或编辑器 DOM 对象放进索引。索引只保存普通数据：名称、文件 URI、range。

## 架构

- `src/extension.ts`：扩展入口。仅当某个工作区文件夹的根目录存在 `MoquiInit.properties` 时启动语言客户端。
- `src/server/index.ts`：语言服务入口，独立 Node 进程。这里实现补全、跳转、悬停、诊断和大纲。
- 两个进程不要互相 import。服务代码禁止 import `vscode`。
- 结构校验（标签、属性、XSD）交给 `schemas/catalog.xml` 与 Red Hat XML（LemMinX）。跨文件名字（实体、服务、screen location）放在本语言服务里。
- `schemas/` 存放 Moqui 3 的 `*-3.xsd` 与 catalog。扩展不解析 XSD。

## 约定

- 与用户用中文。代码标识符、Moqui 术语、Git 提交说明用英文。
- 用户可见文案放在 `package.nls.json`（英文，默认）和 `package.nls.zh-cn.json`（简体中文），随 `vscode.env.language` 选择，不要写进逻辑。`zh-cn` 与 `zh-hans` 用简体中文，其余语言用英文；中文缺键时回退英文。包括 Red Hat XML 未安装时的提示，以及未解析名字和悬停说明。
- 只用稳定的 VS Code API 与 LSP。不要使用 proposed API、原生模块或 Cursor 私有接口。
- `engines.vscode` 保持 `^1.85.0`，除非有明确的兼容性理由。
- 没有 `MoquiInit.properties` 的工作区不要扫描，也不要建索引。

## 当前阶段

P10：固定取值补全。已索引实体和 view-entity 的 `package`，`parameter@type`，以及 `format` 的常用日期和数字格式。取值不在列表里不报未解析，也不替代结构补全。功能范围见 `docs/requirements.md` 与 `docs/req-phase2.md`。
