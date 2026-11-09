import type { ApplyOptions, DiffOptions, JsonValue, LibraryName, Measurements, PatchBundle, HashPatchBundle } from './core.ts';
export type { ApplyOptions, DiffOptions, JsonPatchOperation, JsonValue, PatchBundle } from './core.ts';
export { SpikeError } from './core.ts';
export interface Adapter {
    readonly name: LibraryName;
    diff(before: JsonValue, after: JsonValue, options?: DiffOptions): HashPatchBundle;
    applyPatch(document: JsonValue, patch: PatchBundle, options?: ApplyOptions): JsonValue;
    revertPatch(document: JsonValue, patch: PatchBundle, options?: ApplyOptions): JsonValue;
    resetMetrics(): void;
    measurements(): Measurements;
}
export declare const DEFAULT_ENGINE: LibraryName;
export declare const adapters: readonly Adapter[];
export declare function adapter(name?: string): Adapter;
export interface EngineOptions {
    engine?: LibraryName;
}
export declare function diff(before: JsonValue, after: JsonValue, options?: DiffOptions & EngineOptions): HashPatchBundle;
export declare function applyPatch(document: JsonValue, patch: PatchBundle, options?: Partial<ApplyOptions> & EngineOptions): JsonValue;
export declare function revertPatch(document: JsonValue, patch: PatchBundle, options?: Partial<ApplyOptions> & EngineOptions): JsonValue;
