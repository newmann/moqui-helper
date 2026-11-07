# Moqui Helper 后续需求

P0–P3 以 [requirements.md](requirements.md) 为准，并且已经落地。本文件只收 IntelliJ 插件里已经启用、而本仓库还没有的编辑能力。

仍然不做：

- Groovy 注入，以及 `ec.entity.find(...)`、`ServiceCallSync.name(...)` 的补全
- Admin 工具窗
- 按实体、服务、屏幕划分的自定义项目视图

插件里已注释掉的检查、Screen 编辑器和 Web 工具窗不在本文件中。

分期按依赖和日常编辑频率。每一期可以单独做完并验收。P10 不依赖前面各期，可以提前做。

## P4：屏幕内部名字

在已有 screen location 之上，索引 `screen`、`screen-extend`、`widget-templates` 里的 `transition`、`transition-include`、`section`、`form-single`、`form-list`、`subscreens-item`，以及表单字段名。

- 补全、跳到定义、悬停、未解析、查找引用、重命名：
  - `transition` 与 `transition-include` 的 `name`
  - 表单、`dynamic-container`、`dynamic-dialog`、`dynamic-options` 的 `transition`。指向本屏 transition，或下一级 screen
  - `section-include` 的 `name`，以及 location 里 `#` 后面的 section
  - `form-single` / `form-list` 的 `extends`：本文件 form 名，或 `文件#form`
  - `subscreens` 的 `default-item`：本屏 `subscreens-item`，或相对路径 screen
  - `field-ref`，以及 `form-single` 的 `focus-field`
- `transition`、`transition-include` 的定义上显示引用次数
- 悬停 `section`

验收：

- 上述名字能补全、跳转、悬停
- 对不上时报未解析
- 定义上可查找引用和重命名
- transition 显示引用次数
- `#` 后面能对应到 section 或 form 时要校验，不能再一律跳过

## P5：实体字段与 relationship

实体名保持 P2 的行为。本阶段补实体内部名字。字段和 relationship 用现有实体形状，不新造一套实体索引。

- 字段名的补全、跳转、未解析、查找引用、重命名：`alias`、`complex-alias-field`、`econdition`、`exclude`、`field-map`、`index-field`、`key-map`、`key-value`，以及逗号分隔的 `order-by`、`select-field`、`search-form-inputs`
- relationship 名：`detail`、`member-relationship`。`relationship@related` 仍是实体名
- view-entity 的 `entity-alias`：`member-entity`、`alias`、`alias-all`、`econdition`
- `alias@name` 只做补全：按成员实体字段提示，选定后带上对应 `entity-alias`。不建引用，也不报未解析

验收：

- 字段名、relationship 名、`entity-alias` 能补全并跳到定义
- 找不到时报未解析
- `alias@name` 只出现补全

## P6：服务 include、接口与入参

- `service-include` 的 `verb` / `noun` 跳到 `location` 指向的服务，悬停显示该服务的入参和出参。不再把 include 收成当前文件类名下的服务定义
- 这些 `location` 跳到文件，并对不上文件的路径报未解析：`service-include`、`service`、`script`、`text`、`service-file`、`service-location`
- `implements@service` 只补全并解析 `type="interface"` 的服务
- `service-call` 的 `in-map` 按该服务入参补全、跳转、未解析
- `service-call` 上的字段名指向该服务入参，而不是实体字段。含 `${` 的值不参与

验收：

- include 的 verb、noun 和 location 指向被包含的服务与文件
- `implements` 不列出普通服务
- `in-map` 和调用上的字段名对得上入参

## P7：其余 location 与 widget-template

沿用 screen location 的路径规则（`component://`、相对路径、`//` 简写）。动态路径不报未解析。

- `widget-template-include@location`
- `load-data`、`load-entity` 的 `location`
- `link`、`image`、`att-list-response` 的 `url`
- `screen` 的 `menu-image`、`screen-text-output` 的宏模板、`resource` 的 `xml-actions-template-location`、组件样式 location
- `widget-template` 定义上的引用次数。引用来自 `widget-template-include`
- 补全触发字符加上 `/`

验收：

- 上述路径能补全、跳到文件
- 明确写死且对不上文件时报未解析
- widget-template 显示引用次数
- 输入 `/` 时在这些属性里弹出补全

## P8：文本模板

- `display`、`display-entity`、`label`、`link`、`entity-options`、`list-options` 的 `text`：整段值与 `locale="default"` 的 `LocalizedMessage.original` 全字相等时，补全并跳到该 `original`
- 值是模板引用时，在属性值前显示行内提示 `(LocalizedMessage)`
- 对不上的值是普通字面量，不报未解析，也不显示行内提示

验收：

- 模板名能补全和跳转
- 普通字面量不报未解析，也不显示行内提示

## P9：seed-data 动态标签

`entity` 与 `extend-entity` 下的 `seed-data`，标签和属性规则与 P3 的 `entity-facade-xml` 相同：实体完整名、`short-alias`、`delete-` 加短名、relationship、`text-long` 字段，以及字段属性。

验收：

- `seed-data` 内的补全、悬停、未解析与 `entity-facade-xml` 一致
- `seed-data` 以外的实体定义标签不被当成数据标签

## P10：固定取值补全

XSD 将这些写成自由字符串，不替代结构补全。无前序依赖，可与 P4–P9 并行。

- 已索引实体和 view-entity 的 `package`
- `parameter@type`：String、Timestamp、Time、Date、Integer、Long、Float、Double、BigDecimal、BigInteger、Boolean、Object、Blob、Clob、Collection、List、Map、Set、Node
- `format` 的常用日期格式（`MM/yyyy`、`yyyy-MM-dd`、`yyyy-MM-dd HH:mm`、`yyyy-MM-dd HH:mm:ss`、`yyyy-MM-dd HH:mm:ss.SSS z`）和数字格式（`0000`、`0.00`、`0.000`、`0.00#`、`#,##0.00`、`#,##0.###`）

验收：

- 这三处出现对应补全
- 不因取值不在列表里报未解析
