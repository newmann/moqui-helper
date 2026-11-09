[简体中文](https://github.com/newmann/moqui-helper/blob/main/README.zh-cn.md)

# Moqui Helper

XML assistance for Moqui Framework 3. One package runs in VS Code, Cursor, VSCodium, CodeBuddy, and other desktop editors that host the standard VS Code extension API.

The language service starts when a workspace folder root contains `MoquiInit.properties` or a file named `moq`. Tag completion, attribute completion, and structural diagnostics come from Red Hat XML (LemMinX), using the schemas shipped with this extension. Names that the schemas leave open — entities, services, screens, and the names inside those files — come from this language service. The feature scope is in [docs/requirements.md](https://github.com/newmann/moqui-helper/blob/main/docs/requirements.md) and [docs/req-phase2.md](https://github.com/newmann/moqui-helper/blob/main/docs/req-phase2.md).

## Install

- **VS Code:** install from the Visual Studio Marketplace.
- **Cursor, VSCodium, and CodeBuddy (international):** install from Open VSX. In CodeBuddy the command is `buddy --install-extension newmann.moqui-helper`.
- **CodeBuddy (China):** the extension view does not publish third-party extensions. Use **Extensions: Install from VSIX**, or run `buddycn --install-extension moqui-helper-0.1.0.vsix`. The package is attached to the [GitHub release](https://github.com/newmann/moqui-helper/releases).

Installing this extension asks the host to install Red Hat XML (`redhat.vscode-xml`) from the same gallery. If that extension is missing or disabled, the host prompts to install it and reload the window. This extension does not install it itself. Install and enable Red Hat XML in CodeBuddy the same way when the gallery does not offer it: from Open VSX, or from a VSIX. If this extension is already active and still cannot find Red Hat XML, it prompts again. A failed catalog or root-tag association is also reported. The language service still starts.

The Extension Development Host does not install extension dependencies. Install and enable Red Hat XML there before debugging.

## What it covers

- Structure: local Moqui 3 schemas for `entities`, `services`, `secas`, `eecas`, `emecas`, `gitecas`, `screen`, `screen-extend`, `moqui-conf`, `resource`, `component`, `widget-templates`, and `entity-facade-xml`.
- Cross-file names: entities, services, and screen locations, with completion, go to definition, hover, find references, rename, reference counts, and unresolved diagnostics.
- Names inside a file: screen transitions, sections, forms, and subscreens items; entity fields, relationships, and view-entity aliases; service includes, interfaces, and in-parameters.
- File locations such as widget-template includes, `load-data`, and `link` URLs. A `#` fragment that names a section or form is checked.
- `entity-facade-xml` and `seed-data` tags generated from entity fields.
- Localized message text that matches `LocalizedMessage.original`, and fixed values for an entity `package`, `parameter@type`, and common date and number formats. A value outside those lists is not reported as unresolved.
- Explorer badges, folding for `form-single` and `form-list`, and an outline.

Groovy injection, an admin tool window, and a custom project view grouped by entity, service, or screen are not included.

## Structural completion and diagnostics

This extension maps `http://moqui.org/xsd/*-3.xsd` through `schemas/catalog.xml` to the XSD files in the same directory. A root `xsi:noNamespaceSchemaLocation` is resolved by the catalog. Without that attribute, the root tag selects the schema: `entities`, `services`, `secas`, `eecas`, `emecas`, `gitecas`, `screen`, `screen-extend`, `moqui-conf`, `resource`, `component`, `widget-templates`, `entity-facade-xml`.

## Cross-file names

The language service indexes `package.entity-name` (and `short-alias`) of `entity` / `view-entity`, `class-name.verb#noun` of `service` / `service-include`, and the `component://` location of each `screen` file. The service class name is the relative path after `service/` under the component root. `create#`, `update#`, `delete#`, and `store#` followed by an entity name resolve as entity CRUD.

These names support completion, go to definition, and hover. A name that cannot be found is reported as unresolved. Entity-name completion with a prefix that contains no `.` offers the short name, the full name, and `short-alias`. `extend-entity` offers only the short name. Screen-location completion uses the full location for `component://`, a relative path for `./` and `../`, and `//system` or `//tools` for `//`. A prefix of `//apps` or `//qapps` keeps those two segments. Values that contain `${`, `http` and `content` paths, and `//` paths that do not map to a file are not reported as unresolved. A `#` fragment that names a section or form is checked.

Inside `resource`, `service@name` and `entity@name` under `method` are treated as service names and entity names. `masterName` and the `name` on `resource` itself are not.

## Find references, rename, and reference count

Find References is available on an entity, service, or screen definition, and on references to those names. The reference count is shown above the definition. Choosing it opens the reference list. `create#`, `update#`, `delete#`, and `store#` are counted on the entity. Pattern service names on `seca`, and values that contain `${`, are excluded.

Renaming an entity changes the short name. A full name replaces only the last segment. A `short-alias` that differs from the short name stays as it is. Renaming a service changes `verb` or `noun` only, and leaves the class-name path unchanged. Renaming a screen changes the file name and rewrites locations that resolve to that file. The directory and the fragment after `#` are kept. A name that matches more than one definition cannot be renamed. A screen cannot be renamed when the editor cannot rename files.

## Outline

The language service builds an outline for the open XML document. When an element has an identifier, the line reads `tag: value`. Each element contributes one value:

- `service` and `service-include` use `verb#noun` when `verb` is present. Without `noun`, only `verb` is used. The class name is omitted. `name` on the same element is ignored.
- Other elements use `name`, then `entity-name`, then `field-name`. A blank value is treated as absent.
- With none of these, only the tag name is shown.

After startup, the extension sets `xml.symbols.enabled` to `false` for the current workspace, so the outline does not duplicate Red Hat XML. The setting is workspace-scoped and cannot be written for a single folder. On deactivation, that `false` is removed when this extension wrote it. An existing workspace value is left unchanged. A failed write is recorded in the log only. Other XML in the workspace uses this outline as well.

## Explorer badges

When the workspace root contains `MoquiInit.properties` or `moq`, these Moqui XML files show two letters at the lower-right of the existing file icon in the Explorer. The badge keeps the current file-icon theme. Hover shows the type. The letters come from the root tag alone, and the file does not need `xsi:noNamespaceSchemaLocation`. Other XML files have no badge. `screen` and `screen-extend` share one color.

| Root tag | Badge | Meaning |
| --- | --- | --- |
| `entities` | En | Entity definitions |
| `services` | Sv | Service definitions |
| `secas` | Se | Service ECAs |
| `eecas` | Ee | Entity ECAs |
| `emecas` | Em | Email ECAs |
| `gitecas` | Ge | Git ECAs |
| `screen` | Sc | Screen |
| `screen-extend` | Sx | Screen extend |
| `moqui-conf` | Cf | Moqui configuration |
| `resource` | Re | REST API |
| `component` | Co | Component |
| `widget-templates` | Wt | Widget templates |
| `entity-facade-xml` | Fx | Entity data |

## Folding

`form-single` and `form-list` in `screen`, `screen-extend`, and `widget-templates` can be folded. Above the first line of the form, the editor shows `Single Form:` or `List Form:` followed by `name`. Choosing it collapses or expands that range. The fold marker in the gutter works as well. Opening a file does not collapse these ranges. The same tags under other roots are not folded.

## entity-facade-xml

Tag names under the root may be an entity's full name or `short-alias`, or `delete-` plus the entity short name. The next level may be a relationship of the parent entity, a related entity name, or a `text-long` field. Attributes on an entity tag come from its fields. Without `no-update-stamp="true"`, `lastUpdatedStamp` is included. A tag that matches no entity, field, relationship, or service is reported as unresolved. `seed-data` under `entity` and `extend-entity` uses the same rules. That element, and the entity-definition element around it, is not a data tag.

## Development

Build requirements are Node.js 20 or later, and npm.

```bash
npm install
npm run compile
npm test
npm run package
```

`npm run compile` writes `out/extension.js` and `out/server/index.js`. `npm run package` writes `moqui-helper-0.1.0.vsix`. Packaging and publishing steps are in [docs/publishing.md](https://github.com/newmann/moqui-helper/blob/main/docs/publishing.md).

Cursor 3.29.9 cannot debug this extension. **Run Extension** starts the development host with `--inspect-brk-extensions` and waits for Cursor's JavaScript debugger. That debugger connects to `::1` and `127.0.0.1` at the same time, while the extension host inspector listens only on `127.0.0.1`. The refused `::1` connection cancels the attach, so the host stays stopped on the first line and reports that the extension host did not start in 10 seconds. The extension never activates. From Cursor, run the **Run Extension (no debug)** task, or use **Run Without Debugging** (Ctrl+F5) on **Run Extension**. Breakpoints need VS Code.

1. Open this repository in the editor.
2. In VS Code, run the `Run Extension` debug configuration. It runs `npm run compile`, then opens an Extension Development Host.
3. In the development host, open a Moqui project whose root contains `MoquiInit.properties` or `moq`. The extension starts the language service at that point.

To debug the server process in VS Code, the language service listens on inspect port `6009`.
