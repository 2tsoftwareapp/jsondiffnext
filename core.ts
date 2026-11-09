import { performance } from 'node:perf_hooks';
import { isDeepStrictEqual } from 'node:util';

export type JsonValue = null | boolean | number | string | readonly JsonValue[] | { readonly [key: string]: JsonValue };
export type JsonPatchOperation =
  | { readonly op: 'add' | 'replace' | 'test'; readonly path: string; readonly value: JsonValue }
  | { readonly op: 'remove'; readonly path: string }
  | { readonly op: 'move' | 'copy'; readonly path: string; readonly from: string };
export interface PatchBundle {
  readonly forward: readonly JsonPatchOperation[];
  readonly inverse: readonly JsonPatchOperation[];
  readonly baseRevision?: string;
  readonly targetRevision?: string;
}
export interface DiffOptions {
  arrays?: { mode: 'position' | 'keyed' };
  limits?: { maxWork: number; maxDepth: number };
}
export interface ApplyOptions { verifyBase: boolean }
export type LibraryName = 'jsondiffpatch' | 'fast-json-patch' | 'rfc6902';
export const DEFAULT_LIMITS = { maxWork: 20_000_000, maxDepth: 256 } as const;
export const HARD_MAX_DEPTH = 256;
export const APPLY_MAX_WORK = 100_000_000;
// Three-layer key guards:
// - POLLUTION_GUARDS: protect JSON Pointer write locations from prototype pollution.
// - BACKEND_RESTRICTIONS: backend-specific limits (e.g. jsondiffpatch diff format
//   uses `_t`, applier refuses `-` endpoints, and objectDiffFilter reads inherited
//   Object.prototype functions when own properties collide).
// - JSON data keys (constructor, prototype, toString, valueOf, etc.) remain valid
//   payload data and are not rejected unless targeting unsafe write channels.
export const POLLUTION_GUARDS = new Set(['__proto__']);
export const BACKEND_RESTRICTIONS: Record<LibraryName, ReadonlySet<string>> = {
  jsondiffpatch: new Set(['__proto__', '_t', 'valueOf', 'toString', 'toLocaleString', 'hasOwnProperty', 'isPrototypeOf', 'propertyIsEnumerable', 'constructor', 'prototype', '-']),
  'fast-json-patch': new Set(['__proto__']),
  rfc6902: new Set(['__proto__']),
};
export function keyGuards(name: LibraryName): ReadonlySet<string> {
  return new Set([...POLLUTION_GUARDS, ...BACKEND_RESTRICTIONS[name]]);
}
export class SpikeError extends Error {
  readonly code: string;
  readonly path?: string;
  readonly operationIndex?: number;
  constructor(code: string, message: string, path?: string, operationIndex?: number) {
    super(message); this.name = 'SpikeError'; this.code = code; this.path = path; this.operationIndex = operationIndex;
  }
}
export interface Measurements {
  times: Record<string, number>;
  cloneCalls: number;
  clonePositiveHeapDeltaBytes: number;
  cloneHeapSampleMaxBytes: number;
  fallback?: string;
  scanWork?: number;
  estimatedNativeWork?: number;
  diagnostics?: string[];
}
export class Meter {
  data: Measurements = this.empty();
  empty(): Measurements { return { times: {}, cloneCalls: 0, clonePositiveHeapDeltaBytes: 0, cloneHeapSampleMaxBytes: 0 }; }
  reset(): void { this.data = this.empty(); }
  span<T>(name: string, fn: () => T): T {
    const heapBefore = name === 'clone' ? process.memoryUsage().heapUsed : 0;
    const start = performance.now();
    try { return fn(); } finally {
      this.data.times[name] = (this.data.times[name] ?? 0) + performance.now() - start;
      if (name === 'clone') {
        const heapAfter = process.memoryUsage().heapUsed;
        this.data.cloneCalls++;
        this.data.clonePositiveHeapDeltaBytes += Math.max(0, heapAfter - heapBefore);
        this.data.cloneHeapSampleMaxBytes = Math.max(this.data.cloneHeapSampleMaxBytes, heapBefore, heapAfter);
      }
    }
  }
}
export interface ScanInfo { work: number; nodes: number; maxDepth: number; maxArrayNesting: number; arrayLengths: number[]; special: boolean }

// Validate iteratively before invoking any recursive library or clone. Work units
// count visited nodes plus key/string UTF-16 code units; not CPU instructions.
// `guards` marks keys that make the value ineligible for native handling in the
// caller's context: POLLUTION_GUARDS by default, adapter restrictions added by callers.
export function scanJson(value: unknown, maxWork = DEFAULT_LIMITS.maxWork as number, maxDepth = HARD_MAX_DEPTH as number, guards: ReadonlySet<string> = POLLUTION_GUARDS): ScanInfo {
  const info: ScanInfo = { work: 0, nodes: 0, maxDepth: 0, maxArrayNesting: 0, arrayLengths: [], special: false };
  const ancestors = new WeakSet<object>();
  const stack: { value: unknown; depth: number; arrayNesting: number; exit?: boolean }[] = [{ value, depth: 0, arrayNesting: 0 }];
  function charge(units: number): void {
    info.work += units;
    if (info.work > maxWork) throw new SpikeError('ResourceLimit', `JSON scan exceeds maxWork=${maxWork}`);
  }
  while (stack.length) {
    const item = stack.pop()!;
    const v = item.value;
    if (item.exit) { ancestors.delete(v as object); continue; }
    charge(1); info.nodes++; info.maxDepth = Math.max(info.maxDepth, item.depth);
    if (item.depth > maxDepth) throw new SpikeError('ResourceLimit', `JSON nesting exceeds maxDepth=${maxDepth}`);
    if (v === null || typeof v === 'boolean') continue;
    if (typeof v === 'number') { if (!Number.isFinite(v)) throw new SpikeError('InvalidJson', 'Non-finite number'); continue; }
    if (typeof v === 'string') { charge(v.length); continue; }
    if (typeof v !== 'object') throw new SpikeError('InvalidJson', 'Only plain JSON values are accepted');
    const proto = Object.getPrototypeOf(v);
    if (!Array.isArray(v) && proto !== Object.prototype && proto !== null) throw new SpikeError('InvalidJson', 'Only plain objects are accepted');
    if (Array.isArray(v) && proto !== Array.prototype) throw new SpikeError('InvalidJson', 'Custom array prototypes are unsupported');
    if (ancestors.has(v)) throw new SpikeError('InvalidJson', 'Circular reference');
    ancestors.add(v); stack.push({ value: v, depth: item.depth, arrayNesting: item.arrayNesting, exit: true });
    const childArrayNesting = item.arrayNesting + (Array.isArray(v) ? 1 : 0);
    info.maxArrayNesting = Math.max(info.maxArrayNesting, childArrayNesting);
    const keys = Reflect.ownKeys(v);
    if (Array.isArray(v)) {
      info.arrayLengths.push(v.length);
      if (keys.length !== v.length + 1) throw new SpikeError('InvalidJson', 'Sparse arrays or array properties are unsupported');
    }
    // Charge keys before scheduling children, limiting auxiliary stack growth.
    for (const key of keys) {
      if (Array.isArray(v) && key === 'length') continue;
      if (typeof key !== 'string') throw new SpikeError('InvalidJson', 'Symbol keys are unsupported');
      charge(key.length);
      const descriptor = Object.getOwnPropertyDescriptor(v, key)!;
      if (!descriptor.enumerable || !('value' in descriptor)) throw new SpikeError('InvalidJson', 'Accessors/non-enumerable data are unsupported');
      if (Array.isArray(v) && (!/^(0|[1-9]\d*)$/.test(key) || Number(key) >= v.length)) throw new SpikeError('InvalidJson', 'Invalid array index');
      if (guards.has(key)) info.special = true;
      stack.push({ value: descriptor.value, depth: item.depth + 1, arrayNesting: childArrayNesting });
    }
  }
  return info;
}

// Called only after admission; sort keys before native generation. Safe property
// definition preserves literal __proto__ and normalizes -0 to JSON wire semantics.
// Object prototype identity is preserved: null-prototype dictionaries stay
// null-prototype instead of silently gaining Object.prototype.
export function canonicalClone<T>(value: T): T {
  function copy(v: any): any {
    if (v === null || typeof v !== 'object') return typeof v === 'number' && Object.is(v, -0) ? 0 : v;
    if (Array.isArray(v)) return v.map(copy);
    const result: Record<string, unknown> = Object.create(Object.getPrototypeOf(v));
    for (const key of Object.keys(v).sort()) Object.defineProperty(result, key, { value: copy(v[key]), enumerable: true, writable: true, configurable: true });
    return result;
  }
  return copy(value);
}
export function deepFreeze<T>(v: T): T {
  if (v && typeof v === 'object' && !Object.isFrozen(v)) {
    Object.freeze(v); for (const x of Object.values(v)) deepFreeze(x);
  }
  return v;
}
// Structural JSON equality: prototype identity must not change the verdict,
// so both sides are normalized to plain containers before the deep compare.
// Property definition is mandatory: assignment result[key] = value with a literal
// __proto__ key would silently set the prototype instead of creating an own
// data member. -0/0 are already normalized to wire semantics upstream.
function plainContainer(v: any): any {
  if (v === null || typeof v !== 'object') return v;
  if (Array.isArray(v)) return v.map(plainContainer);
  const result: Record<string, unknown> = {};
  for (const key of Object.keys(v)) Object.defineProperty(result, key, { value: plainContainer(v[key]), enumerable: true, writable: true, configurable: true });
  return result;
}
export function sameJson(a: unknown, b: unknown): boolean { return isDeepStrictEqual(plainContainer(a), plainContainer(b)); }
export function validateOptions(options: DiffOptions): { maxWork: number; maxDepth: number; mode: 'position' | 'keyed' } {
  const { maxWork, maxDepth } = options.limits ?? DEFAULT_LIMITS;
  if (!Number.isSafeInteger(maxWork) || maxWork < 1 || !Number.isSafeInteger(maxDepth) || maxDepth < 0 || maxDepth > HARD_MAX_DEPTH) throw new SpikeError('InvalidOptions', `Positive integer maxWork and maxDepth in [0,${HARD_MAX_DEPTH}] required`);
  const mode = options.arrays?.mode ?? 'position';
  if (mode !== 'position' && mode !== 'keyed') throw new SpikeError('InvalidOptions', 'Unknown array mode');
  return { maxWork, maxDepth, mode };
}
export function checkIdentities(value: JsonValue): void {
  const stack: JsonValue[] = [value];
  while (stack.length) {
    const v = stack.pop()!;
    if (!v || typeof v !== 'object') continue;
    if (Array.isArray(v)) {
      const ids = new Set<string>();
      for (const item of v) {
        if (item && !Array.isArray(item) && typeof item === 'object' && Object.hasOwn(item, 'id')) {
          const id = (item as Record<string, JsonValue>).id;
          if (typeof id !== 'string' && typeof id !== 'number') throw new SpikeError('InvalidIdentity', 'Entity id must be a string or finite number');
          const key = `${typeof id}:${id}`;
          if (ids.has(key)) throw new SpikeError('DuplicateIdentity', `Duplicate entity identity ${key}`);
          ids.add(key);
        }
      }
    }
    for (const child of Object.values(v)) stack.push(child);
  }
}
export function tokens(path: string, guards: ReadonlySet<string> = POLLUTION_GUARDS): string[] {
  if (path === '') return [];
  if (!path.startsWith('/') || /~(?:[^01]|$)/.test(path)) throw new SpikeError('InvalidPatch', 'Invalid JSON Pointer', path);
  const parts = path.slice(1).split('/').map(p => p.replace(/~1/g, '/').replace(/~0/g, '~'));
  if (parts.some(p => p !== '-' && guards.has(p))) throw new SpikeError('InvalidPatch', 'Unsafe or incompatible native pointer segment; use root replacement', path);
  return parts;
}
export function validateOperations(ops: readonly JsonPatchOperation[], guards: ReadonlySet<string> = POLLUTION_GUARDS): void {
  if (!Array.isArray(ops) || !ops.length || ops[0]?.op !== 'test' || ops[0].path !== '') throw new SpikeError('InvalidPatch', 'Every direction must begin with a full-document test');
  for (const op of ops) {
    if (!op || typeof op !== 'object' || !['add', 'remove', 'replace', 'move', 'test', 'copy'].includes(op.op) || typeof op.path !== 'string') throw new SpikeError('InvalidPatch', 'Unsupported operation');
    tokens(op.path, guards);
    if (op.op === 'move' || op.op === 'copy') {
      if (typeof op.from !== 'string') throw new SpikeError('InvalidPatch', `${op.op} requires from`);
      tokens(op.from, guards);
    }
    if (op.op === 'move') {
      if (op.path.startsWith(op.from + '/')) throw new SpikeError('InvalidPatch', 'Cannot move a node into its descendant');
    }
    if (['add', 'replace', 'test'].includes(op.op) && !Object.hasOwn(op, 'value')) throw new SpikeError('InvalidPatch', 'Operation requires value');
    if (['add', 'replace'].includes(op.op) && op.path !== '' && scanJson(op.value, APPLY_MAX_WORK, HARD_MAX_DEPTH + 4, guards).special) {
      throw new SpikeError('InvalidPatch', 'Guarded keys in nested patch values require a root replacement', op.path);
    }
    if (op.path === '' && (op.op === 'remove' || op.op === 'move')) throw new SpikeError('InvalidPatch', 'Root removal/move unsupported by bundle profile');
    if ((op.op === 'move' || op.op === 'copy') && op.from === '') throw new SpikeError('InvalidPatch', 'Root move/copy unsupported');
  }
}
export function endpoint(document: JsonValue, path: string, allowAdd = false): { parent: any; key: string; value: any; exists: boolean } {
  const parts = tokens(path, POLLUTION_GUARDS);
  if (!parts.length) return { parent: undefined, key: '', value: document, exists: true };
  let cursor: any = document;
  for (let i = 0; i < parts.length; i++) {
    const key = parts[i]!;
    if (cursor === null || typeof cursor !== 'object') throw new SpikeError('PathNotFound', 'Pointer parent is not a container', path);
    const last = i === parts.length - 1;
    // '-' is only the append token when the RFC pointer actually targets an
    // array element; a literal '-' member of a plain object is ordinary data
    // reachable via a "-" JSON Pointer (RFC 6901 makes no exception).
    if (key === '-' && Array.isArray(cursor) && !(last && allowAdd)) throw new SpikeError('InvalidPatch', 'Dash pointer is reserved for array append', path);
    if (Array.isArray(cursor)) {
      const adding = last && allowAdd;
      if (key === '-' && adding) return { parent: cursor, key, value: undefined, exists: false };
      if (!/^(0|[1-9]\d*)$/.test(key) || Number(key) > cursor.length - (adding ? 0 : 1)) throw new SpikeError('PathNotFound', 'Array index is outside document', path);
    }
    const exists = Object.hasOwn(cursor, key);
    if (!exists && !(last && allowAdd)) throw new SpikeError('PathNotFound', 'Pointer does not resolve to an own property', path);
    if (last) return { parent: cursor, key, value: cursor[key], exists };
    cursor = cursor[key];
  }
  throw new SpikeError('InvalidPatch', 'Unreachable pointer state', path);
}
// Validate move destinations in their RFC state after source removal. Staging is
// private; restore it in finally so this check cannot leak a partial edit.
export function validateEndpoint(document: JsonValue, op: JsonPatchOperation, guards: ReadonlySet<string> = POLLUTION_GUARDS): JsonPatchOperation {
  if (op.op !== 'move') { endpoint(document, op.path, op.op === 'add'); return op; }
  const source = endpoint(document, op.from);
  if (scanJson(source.value, APPLY_MAX_WORK, HARD_MAX_DEPTH, guards).special) throw new SpikeError('InvalidPatch', 'Moving guarded-key data requires root replacement', op.from);
  const array = Array.isArray(source.parent);
  if (array) source.parent.splice(Number(source.key), 1);
  else delete source.parent[source.key];
  try {
    const destination = endpoint(document, op.path, true);
    if (Array.isArray(destination.parent) && destination.key === '-') {
      return { ...op, path: `${op.path.slice(0, op.path.lastIndexOf('/') + 1)}${destination.parent.length}` };
    }
    return op;
  } finally {
    if (array) source.parent.splice(Number(source.key), 0, source.value);
    else Object.defineProperty(source.parent, source.key, { value: source.value, enumerable: true, writable: true, configurable: true });
  }
}
export function testOperation(document: JsonValue, op: Extract<JsonPatchOperation, { op: 'add' | 'replace' | 'test' }>): void {
  const actual = endpoint(document, op.path).value;
  if (!sameJson(actual, op.value)) throw new SpikeError('PreconditionFailed', 'Document does not match expected state', op.path);
}
export function envelopeOperation(op: JsonPatchOperation): any {
  return { ...op, path: '/value' + op.path, ...(op.op === 'move' ? { from: '/value' + op.from } : {}) };
}
export function stripEnvelope(ops: readonly any[]): JsonPatchOperation[] {
  return ops.map(op => {
    if (!op.path.startsWith('/value') || (op.path !== '/value' && !op.path.startsWith('/value/'))) throw new SpikeError('InvalidPatch', 'Native generator escaped envelope');
    return { ...op, path: op.path.slice(6), ...(op.from !== undefined ? { from: op.from.slice(6) } : {}) };
  });
}
