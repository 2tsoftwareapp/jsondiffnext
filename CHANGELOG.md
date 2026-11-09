# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2026-11-09

Initial production MVP release of **jsondiffnext**: the zero-trust JSON diff & patch framework for Node.js.

### Added
- **Multi-Engine Adapters**: Unified wrapper over `fast-json-patch` (default), `jsondiffpatch`, and `rfc6902`.
- **Hash Guard Protocol v1**:
  - Deterministic SHA-256 integrity verification over RFC 8785 Canonical JSON (JCS).
  - Versioned `HashPatchBundle` (v1) with base and result hash guards.
  - Strips full-document test operations; carries only delta operations.
  - Strict header validation: malformed hash headers cannot silently downgrade to legacy unverified patching.
  - Wire-portable forward and inverse deltas compatible across all 3 underlying engines.
- **Atomic Staging & Isolation**:
  - Atomic patch application staging on cloned targets; errors mid-sequence never mutate input documents.
  - Deep-freezing of returned documents and patch bundles (`deepFreeze`).
  - Source snapshot isolation for RFC 6902 `copy` operations preventing post-patch reference leaks.
- **Three-Layer Key Guards**:
  - `POLLUTION_GUARDS`: blocks prototype pollution write channels (`__proto__`).
  - `BACKEND_RESTRICTIONS`: adapter-specific reserved tokens (`_t`, `valueOf`, `toString`, `constructor`, `prototype` for `jsondiffpatch`).
  - `JSON_DATA_KEYS`: safe own data keys (`constructor`, `prototype`, `toString`, etc.) are fully preserved in payloads and round-trip cleanly.
- **Adaptive Resource Admissions**:
  - Input scan bounds (`maxWork = 20,000,000`, `maxDepth = 256`, `APPLY_MAX_WORK = 100,000,000`).
  - Disjoint/adversarial array fallback: automatically falls back to safe root-replacement diff to avoid cubic $O(n^3)$ hangs or V8 call-stack exhaustion.
- **Keyed Array Matching**:
  - Entity-identity diffing via `{ arrays: { mode: 'keyed', id: 'id' } }` to eliminate false whole-array replacements on item reordering.
- **Comprehensive Verification**:
  - 349/349 tests passing with 100% green suite.
  - 57-cell performance benchmark matrix (19 fixtures × 3 engines × 21 samples).
  - 9-cell memory sweep proving linear bounded heap and zero memory leaks up to 20,000 array elements.
