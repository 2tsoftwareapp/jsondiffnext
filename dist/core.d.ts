export type JsonValue = null | boolean | number | string | readonly JsonValue[] | {
    readonly [key: string]: JsonValue;
};
export type JsonPatchOperation = {
    readonly op: 'add' | 'replace' | 'test';
    readonly path: string;
    readonly value: JsonValue;
} | {
    readonly op: 'remove';
    readonly path: string;
} | {
    readonly op: 'move' | 'copy';
    readonly path: string;
    readonly from: string;
};
interface PatchDirections {
    readonly forward: readonly JsonPatchOperation[];
    readonly inverse: readonly JsonPatchOperation[];
    readonly baseRevision?: string;
    readonly targetRevision?: string;
}
export interface LegacyPatchBundle extends PatchDirections {
    readonly version?: never;
    readonly algorithm?: never;
    readonly baseHash?: never;
    readonly resultHash?: never;
}
export type HashAlgorithm = 'sha256';
export interface PatchBundleMetadata {
    readonly engine?: string;
    readonly createdAt?: string;
    readonly byteLength?: number;
}
export interface HashPatchBundle extends PatchDirections {
    readonly version: 1;
    readonly algorithm: HashAlgorithm;
    readonly baseHash: string;
    readonly resultHash: string;
    readonly metadata?: PatchBundleMetadata;
}
export type PatchBundle = LegacyPatchBundle | HashPatchBundle;
export interface DiffOptions {
    arrays?: {
        mode: 'position' | 'keyed';
    };
    limits?: {
        maxWork: number;
        maxDepth: number;
    };
}
export interface ApplyOptions {
    verifyBase: boolean;
}
export type LibraryName = 'jsondiffpatch' | 'fast-json-patch' | 'rfc6902';
export declare const DEFAULT_LIMITS: {
    readonly maxWork: 20000000;
    readonly maxDepth: 256;
};
export declare const HARD_MAX_DEPTH = 256;
export declare const APPLY_MAX_WORK = 100000000;
export declare const POLLUTION_GUARDS: Set<string>;
export declare const BACKEND_RESTRICTIONS: Record<LibraryName, ReadonlySet<string>>;
export declare function keyGuards(name: LibraryName): ReadonlySet<string>;
export declare class SpikeError extends Error {
    readonly code: string;
    readonly path?: string;
    readonly operationIndex?: number;
    constructor(code: string, message: string, path?: string, operationIndex?: number);
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
export declare class Meter {
    data: Measurements;
    empty(): Measurements;
    reset(): void;
    span<T>(name: string, fn: () => T): T;
}
export interface ScanInfo {
    work: number;
    nodes: number;
    maxDepth: number;
    maxArrayNesting: number;
    arrayLengths: number[];
    special: boolean;
}
export declare function scanJson(value: unknown, maxWork?: number, maxDepth?: number, guards?: ReadonlySet<string>): ScanInfo;
export declare function canonicalClone<T>(value: T): T;
export declare function canonicalHash(value: JsonValue): string;
export declare function deepFreeze<T>(v: T): T;
export declare function sameJson(a: unknown, b: unknown): boolean;
export declare function validateOptions(options: DiffOptions): {
    maxWork: number;
    maxDepth: number;
    mode: 'position' | 'keyed';
};
export declare function checkIdentities(value: JsonValue): void;
export declare function tokens(path: string, guards?: ReadonlySet<string>): string[];
export declare function validateOperations(ops: readonly JsonPatchOperation[], guards?: ReadonlySet<string>, requireRootTest?: boolean): void;
export declare function endpoint(document: JsonValue, path: string, allowAdd?: boolean): {
    parent: any;
    key: string;
    value: any;
    exists: boolean;
};
export declare function validateEndpoint(document: JsonValue, op: JsonPatchOperation, guards?: ReadonlySet<string>): JsonPatchOperation;
export declare function testOperation(document: JsonValue, op: Extract<JsonPatchOperation, {
    op: 'add' | 'replace' | 'test';
}>): void;
export declare function envelopeOperation(op: JsonPatchOperation): any;
export declare function stripEnvelope(ops: readonly any[]): JsonPatchOperation[];
export {};
