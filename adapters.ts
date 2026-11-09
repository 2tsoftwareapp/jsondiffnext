import * as jdp from 'jsondiffpatch';
import { format, patch as jdpJsonPatch } from 'jsondiffpatch/formatters/jsonpatch';
import fast from 'fast-json-patch';
import rfc from 'rfc6902';
import {
  APPLY_MAX_WORK, HARD_MAX_DEPTH, Meter, SpikeError, canonicalClone, checkIdentities,
  deepFreeze, envelopeOperation, keyGuards, sameJson, scanJson, stripEnvelope,
  testOperation, validateEndpoint, validateOperations, validateOptions,
} from './core.ts';
import { endpoint } from './core.ts';
import type { ApplyOptions, DiffOptions, JsonPatchOperation, JsonValue, LibraryName, Measurements, PatchBundle, ScanInfo } from './core.ts';
export type { ApplyOptions, DiffOptions, JsonPatchOperation, JsonValue, PatchBundle } from './core.ts';
export { SpikeError } from './core.ts';
export interface Adapter {
  readonly name: LibraryName;
  diff(before: JsonValue, after: JsonValue, options?: DiffOptions): PatchBundle;
  applyPatch(document: JsonValue, patch: PatchBundle, options?: ApplyOptions): JsonValue;
  revertPatch(document: JsonValue, patch: PatchBundle, options?: ApplyOptions): JsonValue;
  resetMetrics(): void;
  measurements(): Measurements;
}
interface NativeEngine {
  generate(before: JsonValue, after: JsonValue, keyed: boolean): JsonPatchOperation[];
  apply(envelope: { value: JsonValue }, operation: any): void;
}
const native: Record<LibraryName, NativeEngine> = {
  jsondiffpatch: {
    generate(before, after, keyed) {
      const engine = jdp.create({
        cloneDiffValues: true,
        matchByPosition: !keyed,
        arrays: { detectMove: keyed },
        objectHash: keyed ? item => {
          const id = item !== null && typeof item === 'object' && Object.hasOwn(item, 'id') ? (item as { id: unknown }).id : undefined;
          return typeof id === 'string' || typeof id === 'number' ? `${typeof id}:${id}` : undefined;
        } : undefined,
      });
      return stripEnvelope(format(engine.diff({ value: before }, { value: after })));
    },
    apply(envelope, operation) { jdpJsonPatch(envelope, [operation]); },
  },
  'fast-json-patch': {
    generate(before, after) { return stripEnvelope(fast.compare({ value: before }, { value: after }, true)); },
    apply(envelope, operation) { fast.applyPatch(envelope, [operation], true, true, true); },
  },
  rfc6902: {
    generate(before, after) { return stripEnvelope(rfc.createPatch({ value: before }, { value: after })); },
    apply(envelope, operation) {
      const errors = rfc.applyPatch(envelope, [operation]);
      const error = errors.find(e => e !== null);
      if (error) throw error;
    },
  },
};
// Deterministic admission score, NOT an instruction counter/time/RSS guarantee.
// Cubic rfc score accounts for retained edit lists; A score for LCS cells;
// these deliberately prefer a correct larger patch over unbounded native work.
function estimate(name: LibraryName, left: ScanInfo, right: ScanInfo): number {
  const info = [left, right];
  const linear = (left.work + right.work) * 4;
  if (name === 'fast-json-patch') return linear;
  const sizes = info.flatMap(i => i.arrayLengths);
  const meanElementNodes = Math.max(1, (left.nodes + right.nodes) / Math.max(1, sizes.reduce((a, b) => a + b, 0)));
  const power = name === 'rfc6902' ? 3 : 2;
  return linear + Math.ceil(2 * meanElementNodes * sizes.reduce((sum, n) => sum + n ** power, 0));
}
function makeAdapter(name: LibraryName): Adapter {
  const meter = new Meter();
  const engine = native[name];
  function diff(before: JsonValue, after: JsonValue, options: DiffOptions = {}): PatchBundle {
    const settings = validateOptions(options);
    // Adapter-specific guard set: core pollution guards plus this backend's
    // own restrictions (e.g. `_t` for jsondiffpatch's diff format).
    const guards = keyGuards(name);
    const [leftInfo, rightInfo] = meter.span('validation', () => {
      const left = scanJson(before, settings.maxWork, settings.maxDepth, guards);
      const right = scanJson(after, settings.maxWork - left.work, settings.maxDepth, guards);
      if (settings.mode === 'keyed') { checkIdentities(before); checkIdentities(after); }
      return [left, right];
    });
    const [left, right] = meter.span('clone', () => [canonicalClone(before), canonicalClone(after)]);
    const score = estimate(name, leftInfo!, rightInfo!);
    meter.data.scanWork = leftInfo!.work + rightInfo!.work;
    meter.data.estimatedNativeWork = score;
    let forward: JsonPatchOperation[], inverse: JsonPatchOperation[];
    const equal = meter.span('guard', () => sameJson(left, right));
    if (equal) {
      meter.data.fallback = 'unchanged'; forward = []; inverse = [];
    } else if (leftInfo!.special || rightInfo!.special || (name === 'rfc6902' && Math.max(leftInfo!.maxArrayNesting, rightInfo!.maxArrayNesting) > 1) || score + meter.data.scanWork > settings.maxWork) {
      if (leftInfo!.special || rightInfo!.special) {
        meter.data.fallback = 'special-key-root-replace';
      } else if (name === 'rfc6902' && Math.max(leftInfo!.maxArrayNesting, rightInfo!.maxArrayNesting) > 1) {
        meter.data.fallback = 'nested-arrays-root-replace';
        meter.data.diagnostics = ['rfc6902 does not safely diff nested arrays; consider using fast-json-patch'];
      } else {
        meter.data.fallback = 'native-admission-root-replace';
        if (name === 'rfc6902') {
          meter.data.diagnostics = [`rfc6902 cubic array diff exceeded admission budget (${score} > ${settings.maxWork}); consider using fast-json-patch`];
        }
      }
      forward = [{ op: 'replace', path: '', value: right! }];
      inverse = [{ op: 'replace', path: '', value: left! }];
    } else {
      meter.data.fallback = 'native';
      [forward, inverse] = meter.span('nativeDiff', () => [engine.generate(left!, right!, settings.mode === 'keyed'), engine.generate(right!, left!, settings.mode === 'keyed')]);
    }
    const bundle = meter.span('clone', () => canonicalClone({
      forward: [{ op: 'test', path: '', value: left! }, ...forward],
      inverse: [{ op: 'test', path: '', value: right! }, ...inverse],
    })) as PatchBundle;
    meter.span('freeze', () => deepFreeze(bundle));
    return bundle;
  }
  function run(document: JsonValue, patch: PatchBundle, reverse: boolean, options: ApplyOptions = { verifyBase: true }): JsonValue {
    if (typeof options.verifyBase !== 'boolean') throw new SpikeError('InvalidOptions', 'verifyBase must be a boolean');
    const guards = keyGuards(name);
    meter.span('validation', () => {
      scanJson(document, APPLY_MAX_WORK, HARD_MAX_DEPTH, guards);
      scanJson(patch, APPLY_MAX_WORK, HARD_MAX_DEPTH + 4, guards);
      if (!patch || typeof patch !== 'object') throw new SpikeError('InvalidPatch', 'Bundle required');
      validateOperations(patch.forward, guards); validateOperations(patch.inverse, guards);
    });
    const envelope = meter.span('clone', () => ({ value: canonicalClone(document) }));
    const operations = meter.span('clone', () => canonicalClone(reverse ? patch.inverse : patch.forward));
    for (let i = 0; i < operations.length; i++) {
      const operation = operations[i]!;
      if (i === 0 && !options.verifyBase) continue;
      try {
        if (operation.op === 'test') {
          meter.span('guard', () => testOperation(envelope.value, operation));
        } else if (operation.op === 'copy') {
          // RFC 6902 copy: read source, then add at destination (wrapper-owned,
          // like root replace, so every backend behaves identically). Source and
          // destination were validated in the same staging state above.
          const source = endpoint(envelope.value, operation.from).value;
          const destination = endpoint(envelope.value, operation.path, true);
          meter.span('nativeApply', () => {
            if (destination.key === '-') (destination.parent as unknown[]).push(source);
            else Object.defineProperty(destination.parent, destination.key, { value: source, enumerable: true, writable: true, configurable: true });
          });
        } else {
          const validatedOperation = meter.span('validation', () => validateEndpoint(envelope.value, operation, guards));
          meter.span('nativeApply', () => {
            // Own the replacement at the wrapper boundary: rfc6902's recursive
            // value clone deliberately drops literal __proto__ JSON members.
            if (operation.path === '' && (operation.op === 'replace' || operation.op === 'add')) envelope.value = operation.value;
            else engine.apply(envelope, envelopeOperation(validatedOperation));
          });
        }
      } catch (error) {
        const code = error instanceof SpikeError ? error.code : 'PatchFailed';
        throw new SpikeError(code, error instanceof Error ? error.message : String(error), operation.path, i);
      }
    }
    meter.span('validation', () => scanJson(envelope.value, APPLY_MAX_WORK, HARD_MAX_DEPTH));
    // A successful native operation may reuse values in its working patch. An
    // exit clone makes returned ownership independent from all history/inputs.
    return meter.span('clone', () => canonicalClone(envelope.value));
  }
  return {
    name, diff,
    applyPatch: (doc, bundle, options) => run(doc, bundle, false, options),
    revertPatch: (doc, bundle, options) => run(doc, bundle, true, options),
    resetMetrics: () => meter.reset(),
    measurements: () => canonicalClone(meter.data),
  };
}
export const DEFAULT_ENGINE: LibraryName = 'fast-json-patch';

export const adapters: readonly Adapter[] = ['jsondiffpatch', 'fast-json-patch', 'rfc6902'].map(name => makeAdapter(name as LibraryName));
export function adapter(name: string = DEFAULT_ENGINE): Adapter {
  const found = adapters.find(a => a.name === name);
  if (!found) throw new SpikeError('InvalidOptions', `Unknown adapter ${name}`);
  return found;
}

export interface EngineOptions { engine?: LibraryName }

export function diff(before: JsonValue, after: JsonValue, options: DiffOptions & EngineOptions = {}): PatchBundle {
  return adapter(options.engine ?? DEFAULT_ENGINE).diff(before, after, options);
}

export function applyPatch(document: JsonValue, patch: PatchBundle, options: Partial<ApplyOptions> & EngineOptions = {}): JsonValue {
  return adapter(options.engine ?? DEFAULT_ENGINE).applyPatch(document, patch, { verifyBase: options.verifyBase ?? true });
}

export function revertPatch(document: JsonValue, patch: PatchBundle, options: Partial<ApplyOptions> & EngineOptions = {}): JsonValue {
  return adapter(options.engine ?? DEFAULT_ENGINE).revertPatch(document, patch, { verifyBase: options.verifyBase ?? true });
}
