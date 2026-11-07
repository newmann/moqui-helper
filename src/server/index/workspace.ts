import * as path from 'path';
import { isComponentXmlPath, pathKey, toPosix } from '../paths';
import { IndexedEntityMemberRef, IndexedMemberRef, IndexedRef, collectIndexedEntityMemberRefs, collectIndexedMemberRefs, collectIndexedRefs } from '../refs/indexed';
import { IndexedTemplateInclude, collectIndexedTemplateIncludes } from '../refs/paths';
import { IndexedIncludeRef, collectIndexedIncludeRefs } from '../refs/serviceInclude';
import { resolveScreenLocation } from '../refs/resolve';
import { Range, SymbolRecord } from '../types';
import { scanXml } from '../xml/scan';
import { ComponentInfo, readComponent } from './components';
import { extractEntities, extractPackages, shortEntityName } from './entities';
import {
  AutoParameters,
  EntityContribution,
  EntityShape,
  FacadeTag,
  FieldDef,
  RelationshipDef,
  relationshipMatches,
  ServiceMember,
  ServiceModel,
  ViewMember,
  collectFacadeTags,
  extractEntityModels,
  extractServiceModels,
} from './model';
import { ScreenMember, extractScreenMembers } from './screenMembers';
import { TextTemplateDef, extractTextTemplates } from './textTemplates';
import { WidgetTemplateDef, extractWidgetTemplates } from './widgetTemplates';
import { extractScreens } from './screens';
import { extractServices } from './services';

interface FileEntry {
  uri: string;
  fsPath: string;
  rootName?: string;
  symbols: SymbolRecord[];
  refs: IndexedRef[];
  memberRefs: IndexedMemberRef[];
  entityMemberRefs: IndexedEntityMemberRef[];
  includeRefs: IndexedIncludeRef[];
  templateIncludes: IndexedTemplateInclude[];
  templates: WidgetTemplateDef[];
  textTemplates: TextTemplateDef[];
  members: ScreenMember[];
  facadeTags: FacadeTag[];
  bases: EntityContribution[];
  extensions: EntityContribution[];
  serviceModels: ServiceModel[];
  packages: string[];
}

export interface ServiceParam {
  name: string;
  required: boolean;
}

export interface InterfaceParameter {
  name: string;
  type: string;
  required: boolean;
  children: InterfaceParameter[];
  uri?: string;
  nameRange?: Range;
}

export interface ServiceInterface {
  inputs: InterfaceParameter[];
  outputs: InterfaceParameter[];
}

export class WorkspaceIndex {
  private workspaceRoots: string[] = [];
  private readonly files = new Map<string, FileEntry>();
  private readonly componentByRoot = new Map<string, ComponentInfo>();
  private readonly componentsByName = new Map<string, ComponentInfo[]>();
  private readonly entitiesByCanonical = new Map<string, SymbolRecord[]>();
  private readonly entitiesByShort = new Map<string, SymbolRecord[]>();
  private readonly servicesByName = new Map<string, SymbolRecord[]>();
  private readonly screensByLocation = new Map<string, SymbolRecord[]>();
  private readonly screensByPath = new Map<string, SymbolRecord[]>();
  private readonly refsByLookup = new Map<string, IndexedRef[]>();
  private readonly screenRefs: IndexedRef[] = [];
  private readonly memberRefs: IndexedMemberRef[] = [];
  private readonly entityMemberRefs: IndexedEntityMemberRef[] = [];
  private readonly includeRefs: IndexedIncludeRef[] = [];
  private readonly templateIncludes: IndexedTemplateInclude[] = [];
  private readonly screenRefsByPath = new Map<string, IndexedRef[]>();
  private screenRefsDirty = true;
  private readonly facadeByLeaf = new Map<string, FacadeTag[]>();
  private readonly basesByName = new Map<string, EntityContribution[]>();
  private readonly extensionsByName = new Map<string, EntityContribution[]>();
  private readonly serviceModelsByName = new Map<string, ServiceModel[]>();
  private readonly textTemplatesByOriginal = new Map<string, TextTemplateDef[]>();

  setWorkspaceRoots(roots: readonly string[]): void {
    this.workspaceRoots = roots.map((root) => root);
    this.markScreenRefsDirty();
  }

  getWorkspaceRoots(): readonly string[] {
    return this.workspaceRoots;
  }

  clear(): void {
    this.files.clear();
    this.componentByRoot.clear();
    this.componentsByName.clear();
    this.entitiesByCanonical.clear();
    this.entitiesByShort.clear();
    this.servicesByName.clear();
    this.screensByLocation.clear();
    this.screensByPath.clear();
    this.refsByLookup.clear();
    this.screenRefs.length = 0;
    this.memberRefs.length = 0;
    this.entityMemberRefs.length = 0;
    this.includeRefs.length = 0;
    this.templateIncludes.length = 0;
    this.markScreenRefsDirty();
    this.facadeByLeaf.clear();
    this.basesByName.clear();
    this.extensionsByName.clear();
    this.serviceModelsByName.clear();
    this.textTemplatesByOriginal.clear();
  }

  components(): ComponentInfo[] {
    return [...this.componentByRoot.values()];
  }

  componentsNamed(name: string): ComponentInfo[] {
    return this.componentsByName.get(name) ?? [];
  }

  indexedPaths(): string[] {
    return [...this.files.values()].map((entry) => entry.fsPath);
  }

  replaceFile(uri: string, fsPath: string, text: string): boolean {
    const key = pathKey(fsPath);
    const previous = this.files.get(key);
    if (previous) {
      this.unindex(previous);
    }

    const scan = scanXml(text);
    let componentChanged = false;
    if (isComponentXmlPath(fsPath)) {
      componentChanged = this.replaceComponent(readComponent(fsPath, scan), path.dirname(fsPath));
    }

    const symbols = [
      ...extractEntities(scan, uri),
      ...extractServices(scan, fsPath, uri, this.components()),
      ...extractScreens(scan, fsPath, uri, this.components()),
    ];
    const models = extractEntityModels(scan, uri);
    const entry: FileEntry = {
      uri,
      fsPath,
      rootName: scan.rootName,
      symbols,
      refs: collectIndexedRefs(text, uri, fsPath),
      memberRefs: collectIndexedMemberRefs(text, uri, fsPath),
      entityMemberRefs: collectIndexedEntityMemberRefs(text, uri, fsPath),
      includeRefs: collectIndexedIncludeRefs(text, uri, fsPath),
      templateIncludes: collectIndexedTemplateIncludes(text, uri, fsPath),
      templates: extractWidgetTemplates(scan, uri, fsPath),
      textTemplates: extractTextTemplates(scan, uri, fsPath),
      members: extractScreenMembers(scan, uri, fsPath),
      facadeTags: collectFacadeTags(scan, uri, fsPath),
      bases: models.bases,
      extensions: models.extensions,
      serviceModels: extractServiceModels(scan, fsPath, uri, this.components()),
      packages: extractPackages(scan),
    };
    this.files.set(key, entry);
    this.indexEntry(entry);
    this.markScreenRefsDirty();
    return componentChanged;
  }

  removeFile(fsPath: string): boolean {
    const key = pathKey(fsPath);
    const previous = this.files.get(key);
    if (previous) {
      this.unindex(previous);
      this.files.delete(key);
    }
    this.markScreenRefsDirty();
    if (!isComponentXmlPath(fsPath)) {
      return false;
    }
    return this.replaceComponent(undefined, path.dirname(fsPath));
  }

  reindexIndexedFiles(readText: (fsPath: string) => string | undefined, exceptPath?: string): void {
    const except = exceptPath ? pathKey(exceptPath) : undefined;
    const entries = [...this.files.values()];
    for (const entry of entries) {
      if (pathKey(entry.fsPath) === except) {
        continue;
      }
      const text = readText(entry.fsPath);
      if (text === undefined) {
        continue;
      }
      this.replaceFile(entry.uri, entry.fsPath, text);
    }
  }

  findEntities(name: string): SymbolRecord[] {
    const key = name.trim();
    if (!key) {
      return [];
    }
    if (key.includes('.')) {
      return this.entitiesByCanonical.get(key) ?? [];
    }
    return this.entitiesByShort.get(key) ?? [];
  }

  findServices(name: string): SymbolRecord[] {
    const key = name.trim();
    if (!key) {
      return [];
    }
    return this.servicesByName.get(key) ?? [];
  }

  findScreensByLocation(location: string): SymbolRecord[] {
    return this.screensByLocation.get(location) ?? [];
  }

  findScreensByPath(fsPath: string): SymbolRecord[] {
    return this.screensByPath.get(pathKey(fsPath)) ?? [];
  }

  membersIn(fsPath: string): ScreenMember[] {
    return this.files.get(pathKey(fsPath))?.members ?? [];
  }

  screenScope(fsPath: string): ScreenMember[] {
    const members: ScreenMember[] = [];
    const seen = new Set<string>();
    for (const file of this.relatedPaths(fsPath)) {
      const key = pathKey(file);
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      members.push(...(this.files.get(key)?.members ?? []));
    }
    return members;
  }

  screenPaths(fsPath: string): string[] {
    const paths: string[] = [];
    const seen = new Set<string>();
    for (const file of this.relatedPaths(fsPath)) {
      const key = pathKey(file);
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      if (this.files.get(key)?.rootName === 'screen') {
        paths.push(file);
      }
    }
    return paths;
  }

  allMemberRefs(): readonly IndexedMemberRef[] {
    return this.memberRefs;
  }

  allEntityMemberRefs(): readonly IndexedEntityMemberRef[] {
    return this.entityMemberRefs;
  }

  allIncludeRefs(): readonly IndexedIncludeRef[] {
    return this.includeRefs;
  }

  allTemplateIncludes(): readonly IndexedTemplateInclude[] {
    return this.templateIncludes;
  }

  findTextTemplates(original: string): TextTemplateDef[] {
    if (!original) {
      return [];
    }
    return this.textTemplatesByOriginal.get(original) ?? [];
  }

  textTemplateOriginals(): string[] {
    return [...this.textTemplatesByOriginal.keys()];
  }

  templatesIn(fsPath: string): WidgetTemplateDef[] {
    return this.files.get(pathKey(fsPath))?.templates ?? [];
  }

  serviceModelsIn(fsPath: string): ServiceModel[] {
    return this.files.get(pathKey(fsPath))?.serviceModels ?? [];
  }

  isServiceInterface(symbol: SymbolRecord): boolean {
    return this.serviceDefinition(symbol)?.type === 'interface';
  }

  indexedFile(fsPath: string): string | undefined {
    return this.files.get(pathKey(fsPath))?.fsPath;
  }

  viewByName(name: string): EntityContribution | undefined {
    for (const symbol of this.findEntities(name)) {
      if (symbol.kind !== 'view-entity') {
        continue;
      }
      const contribution = this.contributionFor(symbol);
      if (contribution?.view) {
        return contribution;
      }
    }
    return undefined;
  }

  memberEntityName(base: EntityContribution, member: ViewMember): string | undefined {
    return this.resolveMemberEntity(base, member, new Set<string>(), new Set<string>());
  }

  viewMemberAt(
    fsPath: string,
    position: { line: number; character: number },
  ): { member: ViewMember; uri: string; viewName: string } | undefined {
    const entry = this.files.get(pathKey(fsPath));
    if (!entry) {
      return undefined;
    }
    for (const base of entry.bases) {
      for (const member of base.view?.members ?? []) {
        if (rangeContains(member.aliasRange, position)) {
          return { member, uri: base.uri, viewName: base.canonical };
        }
      }
    }
    return undefined;
  }

  memberAt(fsPath: string, position: { line: number; character: number }): ScreenMember | undefined {
    for (const member of this.membersIn(fsPath)) {
      if (rangeContains(member.nameRange, position)) {
        return member;
      }
    }
    return undefined;
  }

  packages(): string[] {
    const names = new Set<string>();
    for (const entry of this.files.values()) {
      for (const name of entry.packages) {
        names.add(name);
      }
    }
    return [...names];
  }

  entities(): SymbolRecord[] {
    const records: SymbolRecord[] = [];
    for (const entry of this.files.values()) {
      for (const symbol of entry.symbols) {
        if (symbol.kind === 'entity' || symbol.kind === 'view-entity') {
          records.push(symbol);
        }
      }
    }
    return records;
  }

  services(): SymbolRecord[] {
    const records: SymbolRecord[] = [];
    for (const entry of this.files.values()) {
      for (const symbol of entry.symbols) {
        if (symbol.kind === 'service') {
          records.push(symbol);
        }
      }
    }
    return records;
  }

  fileUri(fsPath: string): string | undefined {
    return this.files.get(pathKey(fsPath))?.uri;
  }

  symbolsIn(fsPath: string): SymbolRecord[] {
    return this.files.get(pathKey(fsPath))?.symbols ?? [];
  }

  refsLookingUp(kind: 'entity' | 'service', lookup: string): IndexedRef[] {
    return this.refsByLookup.get(refKey(kind, lookup)) ?? [];
  }

  screenRefsFor(symbol: SymbolRecord): readonly IndexedRef[] {
    this.ensureScreenRefs();
    const filePath = this.symbolPath(symbol);
    if (!filePath) {
      return [];
    }
    return this.screenRefsByPath.get(pathKey(filePath)) ?? [];
  }

  symbolPath(symbol: SymbolRecord): string | undefined {
    for (const entry of this.files.values()) {
      if (entry.symbols.includes(symbol)) {
        return entry.fsPath;
      }
    }
    return undefined;
  }

  facadeTagsNamed(leaf: string): FacadeTag[] {
    return this.facadeByLeaf.get(leaf) ?? [];
  }

  entityShape(symbol: SymbolRecord): EntityShape {
    return this.shapeOf(symbol, new Set<string>());
  }

  entityDefinition(symbol: SymbolRecord): EntityContribution | undefined {
    return this.contributionFor(symbol);
  }

  serviceDefinition(symbol: SymbolRecord): ServiceModel | undefined {
    for (const model of this.serviceModelsByName.get(symbol.name) ?? []) {
      if (model.uri === symbol.uri && rangesEqual(model.range, symbol.range)) {
        return model;
      }
    }
    return undefined;
  }

  forEachFacadeTag(visit: (tag: FacadeTag) => void): void {
    for (const entry of this.files.values()) {
      for (const tag of entry.facadeTags) {
        visit(tag);
      }
    }
  }

  serviceParameters(symbol: SymbolRecord): ServiceParam[] {
    const params: ServiceParam[] = [];
    const model = this.serviceDefinition(symbol);
    if (!model) {
      return params;
    }
    for (const member of model.inputs) {
      if (member.kind === 'parameter') {
        pushParam(params, member.name, member.required);
      }
    }
    for (const member of model.inputs) {
      if (member.kind === 'auto') {
        this.expandAuto(member.auto, params);
      }
    }
    return params;
  }

  serviceInterface(symbol: SymbolRecord): ServiceInterface {
    return this.mergeInterface(symbol, new Set<string>());
  }

  fieldAt(fsPath: string, offset: number, positionAt: (offset: number) => { line: number; character: number }): FieldDef | undefined {
    const entry = this.files.get(pathKey(fsPath));
    if (!entry) {
      return undefined;
    }
    const position = positionAt(offset);
    for (const base of entry.bases) {
      for (const field of base.fields) {
        if (rangeContains(field.nameRange, position)) {
          return field;
        }
      }
      for (const alias of base.view?.aliases ?? []) {
        if (rangeContains(alias.nameRange, position)) {
          return { name: alias.name, type: '', isPk: false, uri: alias.uri, nameRange: alias.nameRange };
        }
      }
    }
    for (const extension of entry.extensions) {
      for (const field of extension.fields) {
        if (rangeContains(field.nameRange, position)) {
          return field;
        }
      }
    }
    return undefined;
  }

  relationshipAt(
    fsPath: string,
    offset: number,
    positionAt: (offset: number) => { line: number; character: number },
  ): { relationship: RelationshipDef; via: 'alias' | 'related' } | undefined {
    const entry = this.files.get(pathKey(fsPath));
    if (!entry) {
      return undefined;
    }
    const position = positionAt(offset);
    const lists = [...entry.bases, ...entry.extensions];
    for (const contribution of lists) {
      for (const relationship of contribution.relationships) {
        if (relationship.shortAliasRange && rangeContains(relationship.shortAliasRange, position)) {
          return { relationship, via: 'alias' };
        }
        if (rangeContains(relationship.relatedRange, position)) {
          return { relationship, via: 'related' };
        }
      }
    }
    return undefined;
  }

  screens(): SymbolRecord[] {
    const records: SymbolRecord[] = [];
    for (const entry of this.files.values()) {
      for (const symbol of entry.symbols) {
        if (symbol.kind === 'screen') {
          records.push(symbol);
        }
      }
    }
    return records;
  }

  private markScreenRefsDirty(): void {
    this.screenRefsDirty = true;
    this.screenRefsByPath.clear();
  }

  private ensureScreenRefs(): void {
    if (!this.screenRefsDirty) {
      return;
    }
    for (const ref of this.screenRefs) {
      const resolved = resolveScreenLocation(ref.lookup, ref.fsPath, this);
      if (resolved.status !== 'ok') {
        continue;
      }
      const seen = new Set<string>();
      for (const record of resolved.records) {
        const filePath = this.symbolPath(record);
        if (!filePath) {
          continue;
        }
        const key = pathKey(filePath);
        if (seen.has(key)) {
          continue;
        }
        seen.add(key);
        pushRecord(this.screenRefsByPath, key, ref);
      }
    }
    this.screenRefsDirty = false;
  }

  private indexEntry(entry: FileEntry): void {
    for (const symbol of entry.symbols) {
      if (symbol.kind === 'entity' || symbol.kind === 'view-entity') {
        pushRecord(this.entitiesByCanonical, symbol.name, symbol);
        const keys = new Set<string>([shortEntityName(symbol.name), ...symbol.aliases]);
        for (const key of keys) {
          if (key) {
            pushRecord(this.entitiesByShort, key, symbol);
          }
        }
      } else if (symbol.kind === 'service') {
        pushRecord(this.servicesByName, symbol.name, symbol);
      } else {
        pushRecord(this.screensByLocation, symbol.name, symbol);
        pushRecord(this.screensByPath, pathKey(entry.fsPath), symbol);
      }
    }
    for (const ref of entry.refs) {
      if (ref.kind === 'screen') {
        this.screenRefs.push(ref);
      } else {
        pushRecord(this.refsByLookup, refKey(ref.kind, ref.lookup), ref);
      }
    }
    this.memberRefs.push(...entry.memberRefs);
    this.entityMemberRefs.push(...entry.entityMemberRefs);
    this.includeRefs.push(...entry.includeRefs);
    this.templateIncludes.push(...entry.templateIncludes);
    for (const tag of entry.facadeTags) {
      const leaf = tag.names[tag.names.length - 1];
      if (leaf) {
        pushRecord(this.facadeByLeaf, leaf, tag);
      }
    }
    for (const base of entry.bases) {
      pushRecord(this.basesByName, base.canonical, base);
    }
    for (const extension of entry.extensions) {
      pushRecord(this.extensionsByName, extension.canonical, extension);
    }
    for (const model of entry.serviceModels) {
      pushRecord(this.serviceModelsByName, model.name, model);
    }
    for (const template of entry.textTemplates) {
      pushRecord(this.textTemplatesByOriginal, template.original, template);
    }
  }

  private unindex(entry: FileEntry): void {
    for (const symbol of entry.symbols) {
      if (symbol.kind === 'entity' || symbol.kind === 'view-entity') {
        removeRecord(this.entitiesByCanonical, symbol.name, symbol);
        const keys = new Set<string>([shortEntityName(symbol.name), ...symbol.aliases]);
        for (const key of keys) {
          removeRecord(this.entitiesByShort, key, symbol);
        }
      } else if (symbol.kind === 'service') {
        removeRecord(this.servicesByName, symbol.name, symbol);
      } else {
        removeRecord(this.screensByLocation, symbol.name, symbol);
        removeRecord(this.screensByPath, pathKey(entry.fsPath), symbol);
      }
    }
    const droppedRefs = new Set(entry.refs);
    if (entry.refs.some((ref) => ref.kind === 'screen')) {
      const kept = this.screenRefs.filter((ref) => !droppedRefs.has(ref));
      this.screenRefs.length = 0;
      this.screenRefs.push(...kept);
    }
    for (const ref of entry.refs) {
      if (ref.kind !== 'screen') {
        removeRecord(this.refsByLookup, refKey(ref.kind, ref.lookup), ref);
      }
    }
    if (entry.memberRefs.length > 0) {
      const droppedMembers = new Set(entry.memberRefs);
      const keptMembers = this.memberRefs.filter((ref) => !droppedMembers.has(ref));
      this.memberRefs.length = 0;
      this.memberRefs.push(...keptMembers);
    }
    if (entry.entityMemberRefs.length > 0) {
      const droppedEntityMembers = new Set(entry.entityMemberRefs);
      const keptEntityMembers = this.entityMemberRefs.filter((ref) => !droppedEntityMembers.has(ref));
      this.entityMemberRefs.length = 0;
      this.entityMemberRefs.push(...keptEntityMembers);
    }
    if (entry.includeRefs.length > 0) {
      const droppedIncludes = new Set(entry.includeRefs);
      const keptIncludes = this.includeRefs.filter((ref) => !droppedIncludes.has(ref));
      this.includeRefs.length = 0;
      this.includeRefs.push(...keptIncludes);
    }
    if (entry.templateIncludes.length > 0) {
      const droppedTemplates = new Set(entry.templateIncludes);
      const keptTemplates = this.templateIncludes.filter((ref) => !droppedTemplates.has(ref));
      this.templateIncludes.length = 0;
      this.templateIncludes.push(...keptTemplates);
    }
    for (const tag of entry.facadeTags) {
      const leaf = tag.names[tag.names.length - 1];
      if (leaf) {
        removeRecord(this.facadeByLeaf, leaf, tag);
      }
    }
    for (const base of entry.bases) {
      removeRecord(this.basesByName, base.canonical, base);
    }
    for (const extension of entry.extensions) {
      removeRecord(this.extensionsByName, extension.canonical, extension);
    }
    for (const model of entry.serviceModels) {
      removeRecord(this.serviceModelsByName, model.name, model);
    }
    for (const template of entry.textTemplates) {
      removeRecord(this.textTemplatesByOriginal, template.original, template);
    }
  }

  private shapeOf(symbol: SymbolRecord, seen: Set<string>): EntityShape {
    const identity = symbolIdentity(symbol);
    if (seen.has(identity)) {
      return { fields: [], relationships: [], noUpdateStamp: false };
    }
    const stack = new Set(seen);
    stack.add(identity);
    const base = this.contributionFor(symbol);
    const fields: FieldDef[] = [];
    const relationships: RelationshipDef[] = [];
    let noUpdateStamp = base?.noUpdateStamp ?? false;
    if (base?.view) {
      for (const alias of base.view.aliases) {
        fields.push({ name: alias.name, type: '', isPk: false, uri: alias.uri, nameRange: alias.nameRange });
      }
      for (const aliasAll of base.view.aliasAll) {
        const member = base.view.members.find((item) => item.alias === aliasAll.entityAlias);
        if (!member) {
          continue;
        }
        const entityName = this.resolveMemberEntity(base, member, stack, new Set<string>());
        if (!entityName) {
          continue;
        }
        for (const target of this.findEntities(entityName)) {
          for (const field of this.shapeOf(target, stack).fields) {
            if (aliasAll.excludes.includes(field.name)) {
              continue;
            }
            const name = prefixedName(aliasAll.prefix, field.name);
            if (fields.some((item) => item.name === name)) {
              continue;
            }
            fields.push({
              ...field,
              name,
              originName: field.originName ?? (name === field.name ? undefined : field.name),
            });
          }
        }
      }
    } else if (base) {
      fields.push(...base.fields);
    }
    if (base) {
      relationships.push(...base.relationships);
    }
    for (const extension of this.extensionsByName.get(symbol.name) ?? []) {
      noUpdateStamp = noUpdateStamp || extension.noUpdateStamp;
      for (const field of extension.fields) {
        if (!fields.some((item) => item.name === field.name)) {
          fields.push(field);
        }
      }
      for (const relationship of extension.relationships) {
        if (!relationships.some((item) => item.related === relationship.related && item.shortAlias === relationship.shortAlias)) {
          relationships.push(relationship);
        }
      }
    }
    return { fields, relationships, noUpdateStamp };
  }

  private resolveMemberEntity(
    base: EntityContribution,
    member: ViewMember,
    symbolSeen: Set<string>,
    memberSeen: Set<string>,
  ): string | undefined {
    if (member.kind !== 'relationship') {
      return member.entityName || undefined;
    }
    if (!base.view || !member.joinFromAlias || !member.relationship || memberSeen.has(member.alias)) {
      return undefined;
    }
    memberSeen.add(member.alias);
    const from = base.view.members.find((item) => item.alias === member.joinFromAlias);
    if (!from) {
      return undefined;
    }
    const fromName = this.resolveMemberEntity(base, from, symbolSeen, memberSeen);
    if (!fromName) {
      return undefined;
    }
    for (const symbol of this.findEntities(fromName)) {
      for (const relationship of this.shapeOf(symbol, symbolSeen).relationships) {
        if (relationshipMatches(relationship, member.relationship)) {
          return relationship.related;
        }
      }
    }
    return undefined;
  }

  private contributionFor(symbol: SymbolRecord): EntityContribution | undefined {
    for (const contribution of this.basesByName.get(symbol.name) ?? []) {
      if (contribution.uri === symbol.uri && rangesEqual(contribution.range, symbol.range)) {
        return contribution;
      }
    }
    return undefined;
  }

  private mergeInterface(symbol: SymbolRecord, seen: Set<string>): ServiceInterface {
    const identity = symbolIdentity(symbol);
    if (seen.has(identity)) {
      return { inputs: [], outputs: [] };
    }
    seen.add(identity);
    const model = this.serviceDefinition(symbol);
    if (!model) {
      return { inputs: [], outputs: [] };
    }
    const inputs = this.expandMembers(model.inputs);
    const outputs = this.expandMembers(model.outputs);
    const inputNames = new Set(inputs.map((item) => item.name));
    const outputNames = new Set(outputs.map((item) => item.name));
    for (const inherited of model.implementsServices) {
      for (const target of this.findServices(inherited.service)) {
        const face = this.mergeInterface(target, seen);
        appendMissing(inputs, inputNames, copyParameters(face.inputs, inherited.required));
        appendMissing(outputs, outputNames, copyParameters(face.outputs, inherited.required));
      }
    }
    return { inputs, outputs };
  }

  private expandMembers(members: ServiceMember[]): InterfaceParameter[] {
    const parameters: InterfaceParameter[] = [];
    for (const member of members) {
      if (member.kind !== 'parameter') {
        continue;
      }
      parameters.push({
        name: member.name,
        type: member.type,
        required: member.required,
        children: this.expandMembers(member.children),
        uri: member.uri,
        nameRange: member.nameRange,
      });
    }
    const names = new Set(parameters.map((item) => item.name));
    for (const member of members) {
      if (member.kind !== 'auto') {
        continue;
      }
      for (const field of this.autoFields(member.auto)) {
        if (names.has(field.name)) {
          continue;
        }
        names.add(field.name);
        parameters.push({
          name: field.name,
          type: field.type,
          required: field.isPk,
          children: [],
          uri: field.uri,
          nameRange: field.nameRange,
        });
      }
    }
    return parameters;
  }

  private autoFields(auto: AutoParameters): FieldDef[] {
    const fields: FieldDef[] = [];
    const seen = new Set<string>();
    for (const entity of this.findEntities(auto.entityName)) {
      for (const field of this.entityShape(entity).fields) {
        if (seen.has(field.name) || auto.excludes.includes(field.name)) {
          continue;
        }
        if (auto.include === 'pk' && !field.isPk) {
          continue;
        }
        if (auto.include === 'nonpk' && field.isPk) {
          continue;
        }
        seen.add(field.name);
        fields.push(field);
      }
    }
    return fields;
  }

  private expandAuto(auto: AutoParameters, params: ServiceParam[]): void {
    for (const field of this.autoFields(auto)) {
      pushParam(params, field.name, field.isPk);
    }
  }

  private relatedPaths(fsPath: string): string[] {
    const entry = this.files.get(pathKey(fsPath));
    if (!entry || (entry.rootName !== 'screen' && entry.rootName !== 'screen-extend')) {
      return [fsPath];
    }
    const entries = [...this.files.values()];
    const screens = entries.filter((item) => item.rootName === 'screen');
    const extendFiles = entries.filter((item) => item.rootName === 'screen-extend');
    if (entry.rootName === 'screen') {
      return [entry.fsPath, ...extendPaths(this.screenSuffix(entry), extendFiles)];
    }
    const paths = new Set<string>([entry.fsPath]);
    for (const screen of screens) {
      const suffix = this.screenSuffix(screen);
      if (!suffix || !pathEndsWith(entry.fsPath, suffix)) {
        continue;
      }
      paths.add(screen.fsPath);
      for (const extra of extendPaths(suffix, extendFiles)) {
        paths.add(extra);
      }
    }
    return [...paths];
  }

  private screenSuffix(entry: FileEntry): string | undefined {
    const location = entry.symbols.find((symbol) => symbol.kind === 'screen')?.name;
    if (!location) {
      return undefined;
    }
    const marker = '/screen/';
    const index = location.indexOf(marker);
    if (index < 0) {
      return undefined;
    }
    const suffix = location.slice(index + marker.length);
    return suffix || undefined;
  }

  private replaceComponent(next: ComponentInfo | undefined, rootPath: string): boolean {
    const key = pathKey(rootPath);
    const previous = this.componentByRoot.get(key);
    if (!next) {
      if (!previous) {
        return false;
      }
      this.forgetComponent(previous);
      return true;
    }
    const info: ComponentInfo = { name: next.name, rootPath: path.normalize(rootPath) };
    if (previous && previous.name === info.name && pathKey(previous.rootPath) === key) {
      return false;
    }
    if (previous) {
      this.forgetComponent(previous);
    }
    this.componentByRoot.set(key, info);
    const named = this.componentsByName.get(info.name) ?? [];
    named.push(info);
    this.componentsByName.set(info.name, named);
    return true;
  }

  private forgetComponent(info: ComponentInfo): void {
    this.componentByRoot.delete(pathKey(info.rootPath));
    const named = this.componentsByName.get(info.name);
    if (!named) {
      return;
    }
    const next = named.filter((item) => pathKey(item.rootPath) !== pathKey(info.rootPath));
    if (next.length === 0) {
      this.componentsByName.delete(info.name);
    } else {
      this.componentsByName.set(info.name, next);
    }
  }
}

function extendPaths(suffix: string | undefined, extendFiles: readonly FileEntry[]): string[] {
  if (!suffix) {
    return [];
  }
  return extendFiles.filter((item) => pathEndsWith(item.fsPath, suffix)).map((item) => item.fsPath);
}

function pathEndsWith(filePath: string, suffix: string): boolean {
  const normalized = toPosix(path.normalize(filePath));
  const needle = suffix.replace(/^\/+/, '');
  return normalized.endsWith(`/${needle}`);
}

function pushRecord<T>(map: Map<string, T[]>, key: string, record: T): void {
  const list = map.get(key);
  if (list) {
    list.push(record);
  } else {
    map.set(key, [record]);
  }
}

function removeRecord<T>(map: Map<string, T[]>, key: string, record: T): void {
  const list = map.get(key);
  if (!list) {
    return;
  }
  const next = list.filter((item) => item !== record);
  if (next.length === 0) {
    map.delete(key);
  } else {
    map.set(key, next);
  }
}

function refKey(kind: string, lookup: string): string {
  return `${kind}\n${lookup}`;
}

function rangesEqual(left: Range, right: Range): boolean {
  return (
    left.start.line === right.start.line &&
    left.start.character === right.start.character &&
    left.end.line === right.end.line &&
    left.end.character === right.end.character
  );
}

function rangeContains(range: Range, position: { line: number; character: number }): boolean {
  if (position.line < range.start.line || position.line > range.end.line) {
    return false;
  }
  if (position.line === range.start.line && position.character < range.start.character) {
    return false;
  }
  if (position.line === range.end.line && position.character > range.end.character) {
    return false;
  }
  return true;
}

function symbolIdentity(symbol: SymbolRecord): string {
  return `${symbol.uri}\n${symbol.kind}\n${symbol.name}\n${symbol.range.start.line}:${symbol.range.start.character}`;
}

function prefixedName(prefix: string, name: string): string {
  if (!prefix || !name) {
    return name;
  }
  return prefix + name.charAt(0).toUpperCase() + name.slice(1);
}

function pushParam(params: ServiceParam[], name: string, required: boolean): void {
  if (!params.some((item) => item.name === name)) {
    params.push({ name, required });
  }
}

function copyParameters(parameters: InterfaceParameter[], required: boolean | undefined): InterfaceParameter[] {
  return parameters.map((parameter) => ({
    name: parameter.name,
    type: parameter.type,
    required: required === undefined ? parameter.required : required,
    children: copyParameters(parameter.children, required),
    uri: parameter.uri,
    nameRange: parameter.nameRange,
  }));
}

function appendMissing(target: InterfaceParameter[], names: Set<string>, extra: InterfaceParameter[]): void {
  for (const parameter of extra) {
    if (names.has(parameter.name)) {
      continue;
    }
    names.add(parameter.name);
    target.push(parameter);
  }
}
