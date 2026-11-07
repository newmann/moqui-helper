# Moqui Helper 需求说明

## 背景

本仓库是 Moqui Framework 3 的 XML 辅助扩展。交付物是一个标准 VS Code 扩展，Cursor 以及其他使用该扩展 API 的桌面编辑器安装同一份 VSIX。

## 运行环境

支持：

- Cursor 桌面版
- VS Code 桌面版
- VSCodium
- 其他完整托管标准 VS Code 扩展 API、并能启动 Node 语言服务进程的桌面编辑器

不承诺：

- `vscode.dev`、github.dev 等浏览器宿主
- Eclipse Theia 等扩展 API 不完整的宿主

约束：

- `engines.vscode` 为 `^1.85.0`
- 只使用稳定 API，不使用 proposed API、原生模块或某个编辑器的私有接口
- 只有工作区文件夹根目录存在 `MoquiInit.properties` 或 `moq` 时才激活语言服务并建立索引

## 支持的 XML 根标签

`entities`、`services`、`secas`、`eecas`、`emecas`、`screen`、`screen-extend`、`moqui-conf`、`resource`、`component`、`widget-templates`、`entity-facade-xml`。这些根在资源管理器里用徽章区分。

标签和属性的结构以 Moqui 3 的 `*-3.xsd` 为准。实体名、服务名、screen location 等跨文件引用不在 XSD 枚举里，由语言服务自己的索引提供。

## 阶段

### P0 本阶段：仓库与骨架

- 本地 Git 仓库、扩展工程、`AGENTS.md`、本需求文档
- 扩展在发现根目录 `MoquiInit.properties` 或 `moq` 后启动语言服务
- 语言服务只完成 LSP `initialize`，不提供补全、跳转或诊断

验收：

- 目录与上述文档齐全
- `npm install` 与 `npm run compile` 成功
- 编译产物为 `out/extension.js` 与 `out/server/index.js`

### P1：Schema 结构支持

- 将 Moqui 3 的 `*-3.xsd` 放入 `schemas/`
- 文件已有 `xsi:noNamespaceSchemaLocation` 时，用 catalog 把这些 schema 解析到本地 XSD
- 没有该属性时，按上面列出的根标签关联对应 schema
- 结构层交给 Red Hat XML（LemMinX）：标签补全、属性补全、结构诊断
- 不在本仓库再实现一套 XSD 解析

### P2：跨文件语义

- 索引实体、服务、screen location。`resource` 里 `method` 下的 `service@name`、`entity@name` 也按服务名和实体名处理
- 这些名字的补全、跳转到定义、悬停说明、未解析诊断
- 索引用普通数据（名称、文件 URI、range），文件变化时增量更新

### P3：编辑增强

- 查找引用
- 重命名
- `screen`、`screen-extend`、`widget-templates` 中的 `form-single` / `form-list` 折叠。其他根不折叠
- 引用次数（Code Lens）
- `entity-facade-xml` 按实体字段生成的动态标签
- XML 大纲由语言服务提供：`name`、`entity-name`、`field-name`，以及 `service` / `service-include` 的 `verb#noun`。不使用 Red Hat XML 的符号过滤

## 明确不做

以下能力不在当前路线里，以后若要做再单独立项：

- Groovy 注入，以及 `ec.entity.find(...)`、`ServiceCallSync.name(...)` 的补全
- Admin 工具窗
- 按实体、服务、屏幕划分的自定义项目视图

P4 及以后的需求见 [req-phase2.md](req-phase2.md)。
