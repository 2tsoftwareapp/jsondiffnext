# Changelog

All notable changes to this project are documented here.

This format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2026-11-09

Initial public release of `jsondiffnext`, a safety-focused JSON diff and patch wrapper for Node.js.

### Added

- Unified adapters for `fast-json-patch` (default), `jsondiffpatch`, and `rfc6902`.
- Versioned `HashPatchBundle` format with forward and inverse deltas and SHA-256 guards over RFC 8785 canonical JSON.
- Atomic patch application on cloned targets; failures do not partially mutate caller documents.
- Deep freezing for returned documents and bundles.
- Pointer and input validation, including checks for dangerous write paths while preserving supported JSON data keys.
- Configurable work and depth admission limits, with guarded root-replacement fallback for supported cases.
- Optional keyed-array matching through `{ arrays: { mode: 'keyed' } }` (items are matched by their `id` property).
- TypeScript declarations and a compiled `dist/` package.

### Verification

- The project test suite reported 349 passing tests in the release preparation run.
- The exploratory benchmark run completed 57/57 cells with correctness checks passing. Across adapters, median hash/E2E ratios ranged from 15.4% to 38.4%; see the README for the method and limitations.
- The resource sweep completed 9/9 cells at array sizes 2,000, 10,000, and 20,000. This single sweep does not establish general memory bounds or absence of long-term leaks.
