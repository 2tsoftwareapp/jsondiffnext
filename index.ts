export {
  diff,
  applyPatch,
  revertPatch,
  adapter,
  adapters,
  DEFAULT_ENGINE,
} from './adapters.ts';

export type {
  Adapter,
  EngineOptions,
} from './adapters.ts';

export {
  SpikeError,
  canonicalClone,
  canonicalHash,
  sameJson,
  scanJson,
  deepFreeze,
  POLLUTION_GUARDS,
  BACKEND_RESTRICTIONS,
  DEFAULT_LIMITS,
  HARD_MAX_DEPTH,
  APPLY_MAX_WORK,
} from './core.ts';

export type {
  JsonValue,
  JsonPatchOperation,
  PatchBundle,
  LegacyPatchBundle,
  HashPatchBundle,
  HashAlgorithm,
  PatchBundleMetadata,
  DiffOptions,
  ApplyOptions,
  LibraryName,
  Measurements,
  ScanInfo,
} from './core.ts';
