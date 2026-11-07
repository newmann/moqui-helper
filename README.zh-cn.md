[English](README.md)

# Moqui Helper

Moqui Framework 3 的 XML 辅助扩展，运行在 Cursor、VS Code 以及其他支持标准 VS Code 扩展 API 的桌面编辑器上。

工作区根目录有 `MoquiInit.properties` 时启动语言服务。标签补全、属性补全和结构诊断由 Red Hat XML（LemMinX）根据本扩展自带的 schema 提供。实体、服务和 screen location 的补全、跳转、悬停和未解析诊断由本语言服务的索引提供。功能范围见 [docs/requirements.md](docs/requirements.md)。

## 环境

- Node.js 20 或更新版本
- npm

## 编译

```bash
npm install
npm run compile
npm test
```

产物在 `out/extension.js` 和 `out/server/index.js`。

## 结构补全与诊断

本扩展把 `http://moqui.org/xsd/*-3.xsd` 通过 `schemas/catalog.xml` 指到同目录的 XSD。文件根上有 `xsi:noNamespaceSchemaLocation` 时，由 catalog 解析。没有该属性时，按根标签关联对应 schema：`entities`、`services`、`secas`、`eecas`、`emecas`、`screen`、`screen-extend`、`moqui-conf`、`resource`、`component`、`widget-templates`、`entity-facade-xml`。

安装本扩展时，宿主会一并安装 Red Hat XML（`redhat.vscode-xml`）。若该扩展未安装或被禁用，宿主会提示安装并重新加载；本扩展不自己安装它。扩展开发宿主不会自动安装依赖，需要先在开发宿主里安装并启用 Red Hat XML。若本扩展已经激活但仍找不到 Red Hat XML，会再提示一次。catalog 或根标签关联注册失败时也会提示，语言服务仍会启动。

## 跨文件名字

语言服务索引 `entity` / `view-entity` 的 `package.entity-name`（以及 `short-alias`）、`service` / `service-include` 的 `类名.verb#noun`，以及 `screen` 文件的 `component://` location。服务类名是组件根下 `service/` 之后的相对路径。`create#`、`update#`、`delete#`、`store#` 后面跟实体名时，按实体 CRUD 解析。

这些名字可以补全、跳到定义、悬停查看，找不到时报告未解析。补全实体名时，前缀不含 `.` 会同时给出短名、完整名和 `short-alias`；`extend-entity` 只给短名。补全 screen location 时，`component://` 用完整 location，`./` 和 `../` 用相对路径，`//` 用 `//system` 或 `//tools`；前缀为 `//apps` 或 `//qapps` 时保留这两段。含 `${` 的值、`http` / `content` 路径，以及不能对应到文件的 `//` 路径不报告未解析。`#` 后面的 transition、section、form 名不校验。

`resource` 里 `method` 下的 `service@name` 和 `entity@name` 同样按服务名和实体名处理。`masterName` 和 `resource` 自己的 `name` 不在此列。

## 查找引用、重命名和引用次数

在实体、服务或 screen 的定义上，以及引用这些名字的位置，可以查找引用。定义上方显示引用次数，点击后打开引用列表。`create#`、`update#`、`delete#`、`store#` 记在实体上。`seca` 的模式服务名和含 `${` 的值不参与查找。

重命名实体改的是短名：完整名只替换最后一段，`short-alias` 与短名不同时保持不变。重命名服务只改 `verb` 或 `noun`，不改类名路径。重命名 screen 只改文件名，并改写解析到该文件的 location；目录和 `#` 后面的片段保留。名称对应多个定义时不能重命名。编辑器不支持文件重命名时，不能重命名 screen。

## 大纲

语言服务为打开的 XML 生成大纲。有标识时，行文本是 `标签: 值`。每个元素只取一个值：

- `service` 和 `service-include` 有 `verb` 时用 `verb#noun`。没有 `noun` 时只用 `verb`。不带类名。同一元素上的 `name` 不使用。
- 其他元素依次用 `name`、`entity-name`、`field-name`。空白值视为没有。
- 都没有则只显示标签名。

扩展启动后，会把当前工作区的 `xml.symbols.enabled` 设为 `false`，避免和 Red Hat XML 的大纲重复。这项配置只支持工作区作用域，不能写进单个文件夹。停用扩展时，如果这项仍是本扩展写上的 `false`，会删掉它。工作区里已经有这项设置的，不会改。写入失败只记在日志里。这个工作区里的其他 XML 也使用这套大纲。

## 资源管理器徽章

工作区根目录有 `MoquiInit.properties` 时，资源管理器里这些 Moqui XML 会在原有文件图标右下角显示两个字母。这是徽章，不替换当前的文件图标主题。悬停可以看到类型。字母只由根标签决定，不要求文件带有 `xsi:noNamespaceSchemaLocation`。其他 XML 不加徽章。`screen` 与 `screen-extend` 使用同一种颜色。

| 根标签 | 徽章 | 含义 |
| --- | --- | --- |
| `entities` | En | 实体定义 |
| `services` | Sv | 服务定义 |
| `secas` | Se | 服务 ECA |
| `eecas` | Ee | 实体 ECA |
| `emecas` | Em | 邮件 ECA |
| `screen` | Sc | Screen |
| `screen-extend` | Sx | Screen 扩展 |
| `moqui-conf` | Cf | Moqui 配置 |
| `resource` | Re | REST API |
| `component` | Co | 组件 |
| `widget-templates` | Wt | Widget 模板 |
| `entity-facade-xml` | Fx | 实体数据 |

## 折叠

`screen`、`screen-extend` 和 `widget-templates` 里的 `form-single`、`form-list` 可以折叠。表单第一行上方显示 `Single Form:` 或 `List Form:` 加上 `name`，点击后收起或展开这一段。行号槽里的折叠标记也可以用。打开文件时不会自动收起。其他根里的同名标签不折叠。

## entity-facade-xml

根标签下的标签名可以是实体完整名或 `short-alias`，也可以是 `delete-` 加实体短名。下一层可以是父实体的 relationship、related 实体名，或 `text-long` 字段。实体标签的属性来自字段；没有 `no-update-stamp="true"` 时还有 `lastUpdatedStamp`。对不上实体、字段、relationship 或服务的标签会报告未解析。`entity` 与 `extend-entity` 下的 `seed-data` 使用同一套规则。该标签自身，以及它外面的实体定义标签，不是数据标签。

Cursor 3.29.9 无法调试本扩展。`Run Extension` 会带上 `--inspect-brk-extensions` 启动开发宿主，并等待 Cursor 自带的 JavaScript 调试器连上。该调试器同时连接 `::1` 和 `127.0.0.1`，而扩展宿主的检查器只监听 `127.0.0.1`。`::1` 被拒绝后，这次附着会被取消，宿主停在第一行，并提示扩展宿主在 10 秒内没有启动。扩展因此不会激活。在 Cursor 里请运行任务 **Run Extension (no debug)**，或对 `Run Extension` 使用 **Run Without Debugging**（Ctrl+F5）。断点调试需要用 VS Code。

## 在 Cursor 或 VS Code 中调试

1. 用编辑器打开本仓库。
2. 在 VS Code 中运行调试配置 `Run Extension`。它会先执行 `npm run compile`，再打开一个扩展开发宿主。
3. 在开发宿主里打开一个根目录含有 `MoquiInit.properties` 的 Moqui 项目。扩展此时才会启动语言服务。

在 VS Code 中调试服务进程时，语言服务监听检查端口 `6009`。
