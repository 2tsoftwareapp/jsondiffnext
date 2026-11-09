<div align="center">

# ⚡ jsondiffnext

### The Zero-Trust JSON Diff &amp; Patch Framework for Node.js

[![npm version](https://img.shields.io/badge/version-0.1.0-blue.svg?style=flat-square)](package.json)
[![license](https://img.shields.io/badge/license-MIT-green.svg?style=flat-square)](LICENSE)
[![tests](https://img.shields.io/badge/tests-349%2F349%20passing-brightgreen.svg?style=flat-square)](tests/)
[![node](https://img.shields.io/badge/node-%3E%3D24-darkgreen.svg?style=flat-square)](package.json)
[![typescript](https://img.shields.io/badge/typescript-strict%205.9-blue.svg?style=flat-square)](tsconfig.json)
[![standards](https://img.shields.io/badge/standards-RFC%206902%20%7C%20RFC%208785-purple.svg?style=flat-square)](https://datatracker.ietf.org/doc/html/rfc6902)
[![security](https://img.shields.io/badge/security-hardened%20%26%20atomic-red.svg?style=flat-square)](#-why-jsondiffnext)

<p align="center">
  <b>Hardened multi-engine wrapper</b> · <b>Zero prototype pollution</b> · <b>Atomic staging</b> · <b>SHA-256 Hash Guard Protocol v1</b> · <b>Adaptive resource limits</b>
</p>

</div>

---

## 🚨 Why JSONDiffNext?

Standard Node.js diff/patch libraries (`jsondiffpatch`, `fast-json-patch`, `rfc6902`) are fast, but they were built for trusted inputs. In multi-tenant systems, collaborative editors, and microservices, using them directly introduces **critical production vulnerabilities**:

| Hazard in Legacy Libraries | Real-World Impact | How `jsondiffnext` Solves It |
| :--- | :--- | :--- |
| **Prototype Pollution** (CVE-2021-44906, `__proto__`, `constructor`) | Attackers inject prototype modifications through crafted JSON Pointers, compromising the entire Node.js process. | **Three-Layer Key Guards**: blocks dangerous write channels (`__proto__`, `constructor`) while keeping legitimate business data keys (`toString`, `valueOf`) intact. |
| **Cubic Array Diff Hangs &amp; Stack Overflow** | `rfc6902` exhibits $O(n^3)$ complexity on disjoint arrays; `RangeError: Maximum call stack size exceeded` crashes the process on arrays &gt; 10,000 items. | **Adaptive Admission Defense**: automatically bounds `maxWork` and `maxDepth`. Over-budget arrays fall back to safe root-replacement diffing instantly. |
| **Partial Mutation on Failure** | If operation #7 of a 10-op patch fails mid-flight, legacy patchers leave the target document half-mutated and permanently corrupted. | **Strict Atomic Staging**: patches execute exclusively on isolated staging clones. Any failure cleanly aborts with zero mutation to caller documents. |
| **Blind Patch Application** | Patches are applied blindly without verifying document state, silently corrupting mismatched versions or stale documents. | **Hash Guard Protocol v1**: cryptographically binds base and result documents with RFC 8785 (JCS) SHA-256 hashes, ensuring strict deterministic replay. |
| **Caller Mutation &amp; Leakage** | Shared object references allow callers to mutate patch history or leak memory across cycles. | **Deep-Frozen Immutability**: returns deeply frozen, self-owned documents and bundles (`deepFreeze`), preventing external tampering. |

---

## 📊 Feature &amp; Security Comparison Matrix

| Capability / Guarantee | `fast-json-patch` | `jsondiffpatch` | `rfc6902` | **`jsondiffnext`** ⚡ |
| :--- | :---: | :---: | :---: | :---: |
| **Default Architecture** | Single-engine | Single-engine | Single-engine | **Multi-Engine Hardened Wrapper** |
| **Prototype Pollution Immunity** | ⚠️ Partial | ❌ Vulnerable | ⚠️ Partial | ✅ **Guaranteed (Three-Layer Guards)** |
| **Atomic Rollback on Error** | ❌ (mutates input) | ❌ (mutates input) | ❌ (mutates input) | ✅ **100% Atomic on Staging Clone** |
| **Cryptographic Hash Verification** | ❌ None | ❌ None | ❌ None | ✅ **SHA-256 Hash Guard (RFC 8785)** |
| **Cross-Engine Portable Replay** | ❌ Format-locked | ❌ Custom delta | ❌ RFC only | ✅ **Universal Portable Bundles** |
| **Adversarial Array Admission Guard** | ❌ (quadratic/hangs) | ⚠️ (slow LCS) | ❌ (crashes at 10k) | ✅ **Adaptive Fallback Protection** |
| **Keyed Array Entity Diffing** | ❌ Positional only | ✅ Keyed | ❌ Positional only | ✅ **Unified `{ arrays: { mode: 'keyed' } }`** |
| **RFC 6902 Isolated `copy` Semantics**| ⚠️ Alias leak | ❌ N/A | ⚠️ Reference leak | ✅ **Cloned Snapshot &amp; Add Semantics** |
| **Deep-Frozen Immutability** | ❌ Mutable refs | ❌ Mutable refs | ❌ Mutable refs | ✅ **Deep-Frozen (`deepFreeze`)** |

---

## 🏛️ Architecture &amp; Execution Pipeline

`jsondiffnext` places a multi-stage defense-in-depth shield around your diff and patch operations:

<div align="center">
  <img src="assets/architecture.svg" alt="JSONDiffNext Architecture" width="100%" />
</div>

```
Untrusted JSON ──► [Stage 1: Guard Scanner] ──► [Stage 2: Engine Adapter] ──► [Stage 3: Hash Guard] ──► Immutable Result
                     • __proto__ blocked          • fast-json-patch (fastest)    • RFC 8785 canonical      • Deep-frozen
                     • Keyed ID check             • jsondiffpatch (LCS)          • SHA-256 baseHash        • Atomic staging
                     • Work & depth limits        • rfc6902 (RFC standard)      • SHA-256 resultHash      • Zero leak
```

---

## 🚀 Performance &amp; Benchmark Telemetry

Measured across **57 cells** (19 fixtures × 3 engines × 21 samples, 1,197 runs) on Node v24 isolated child workers with strict memory and CPU enforcement:

<div align="center">
  <img src="assets/benchmark.svg" alt="JSONDiffNext Benchmark Telemetry" width="100%" />
</div>

### 1. Engine Latency Comparison (Median p50)

- **`fast-json-patch` (Default Engine)** outperformed `jsondiffpatch` in **16/19 fixtures** with a **median 2.1x speedup** (0.48x latency ratio).
- **`fast-json-patch`** outperformed `rfc6902` in **15/19 fixtures** with a **median 1.5x speedup** (0.67x latency ratio).

| Fixture / Workload | `fast-json-patch` (Default) | `rfc6902` | `jsondiffpatch` | Speedup vs `jsondiffpatch` |
| :--- | :---: | :---: | :---: | :---: |
| **`medium-flat-50`** (keyed) | **0.16 ms** | 0.29 ms | 0.39 ms | **2.4x faster** |
| **`array-move-edit-500`** (keyed) | **2.75 ms** | 5.69 ms | 11.81 ms | **4.3x faster** |
| **`large-array-2000-sparse`** (keyed) | **1.93 ms** | 1.84 ms *(fallback)* | 13.84 ms | **7.2x faster** |
| **`adversarial-disjoint-2000`** (keyed)| **1.98 ms** | 1.90 ms *(fallback)* | 14.03 ms | **7.1x faster** |
| **`large-equal-20000`** (unchanged) | **1.02 ms** | 1.03 ms | 1.03 ms | Instant Fast-Path |

### 2. Hash Guard Protocol v1 Overhead

- **Median Hash Overhead:** **0.94%** of end-to-end processing time (median hash latency: **4 µs**).
- **Realistic Payloads (50 – 5,000 items):** Hash overhead consistently stays between **0.4% and 2.4%**, well within the 5.0% performance budget.
- **Micro-fixtures:** On sub-millisecond payloads (&lt; 0.05 ms, e.g. empty object), fixed SHA-256 setup takes ~4 µs, resulting in a higher mathematical fraction without measurable CPU impact.

### 3. Memory Safety &amp; Scaling Sweep

Tested across $n \in \{2,000, 10,000, 20,000\}$ random array elements:

- **$n = 2,000$:** Native diffing Peak RSS = 161 MiB; Retained Heap = 2.1 MiB.
- **$n = 10,000$:** Native diffing Peak RSS = 313 MiB; Retained Heap = 9.3 MiB.
- **$n = 20,000$:** Adaptive Admission Guard trips at `maxWork = 500,000`, switching to `native-admission-root-replace`. Peak RSS drops to **198 MiB** (vs native crash on unprotected `rfc6902`). Zero memory leaks detected across 8 consecutive cycles.

---

## 📦 Installation

```bash
npm install jsondiffnext
```

*Requires Node.js >= 24.*

---

## 🛠️ Usage Guide

### Basic Diff &amp; Atomic Apply

```ts
import { diff, applyPatch, revertPatch } from 'jsondiffnext';

const before = {
  service: 'auth',
  replicas: 3,
  tags: ['production', 'eu-west-1'],
};

const after = {
  service: 'auth',
  replicas: 5,
  tags: ['production', 'eu-west-1', 'canary'],
};

// 1. Generate versioned HashPatchBundle (v1)
const bundle = diff(before, after);

// 2. Atomically apply patch (verifies base document hash first)
const next = applyPatch(before, bundle);

// 3. Revert back to original state cleanly
const prev = revertPatch(next, bundle);
```

### Keyed Array Matching

Eliminate false array replacements caused by reordering or inserting elements:

```ts
const beforeUsers = [{ id: 'u1', name: 'Alice' }, { id: 'u2', name: 'Bob' }];
const afterUsers  = [{ id: 'u2', name: 'Bob' }, { id: 'u1', name: 'Alice (Admin)' }];

const bundle = diff(beforeUsers, afterUsers, {
  arrays: { mode: 'keyed', id: 'id' },
});
```

### Switching Engine Adapters

Switch between engines on the fly while retaining identical security guarantees:

```ts
import { diff, adapter } from 'jsondiffnext';

// Use explicit engine option
const rfcBundle = diff(before, after, { engine: 'rfc6902' });

// Or bind directly to an adapter instance
const jdp = adapter('jsondiffpatch');
const jdpBundle = jdp.diff(before, after);
```

### Hash Guard Protocol v1 Wire Format

Every bundle generated by `diff()` is a self-contained, serializable `HashPatchBundle`:

```json
{
  "version": 1,
  "algorithm": "sha256",
  "baseHash": "3f796245cb75b75b9f71c1f0d361c775a6c117e0c4...",
  "resultHash": "a1b2c3d4e5f6...",
  "forward": [
    { "op": "replace", "path": "/replicas", "value": 5 },
    { "op": "add", "path": "/tags/2", "value": "canary" }
  ],
  "inverse": [
    { "op": "replace", "path": "/replicas", "value": 3 },
    { "op": "remove", "path": "/tags/2" }
  ]
}
```

> **Security Note:** `applyPatch()` recalculates the RFC 8785 canonical hash of the target document and rejects mismatches with `PreconditionFailed` before executing any operations. Malformed or tampered headers cannot silently downgrade to legacy unverified mode.

---

## 📖 API Reference

### Core Functions

```ts
function diff(before: JsonValue, after: JsonValue, options?: DiffOptions & EngineOptions): HashPatchBundle;
function applyPatch(document: JsonValue, patch: PatchBundle, options?: Partial<ApplyOptions> & EngineOptions): JsonValue;
function revertPatch(document: JsonValue, patch: PatchBundle, options?: Partial<ApplyOptions> & EngineOptions): JsonValue;
function adapter(name: LibraryName): Adapter;
```

### Cryptographic &amp; Utility Primitives

```ts
function canonicalHash(value: JsonValue): string;     // SHA-256 over RFC 8785 canonical JSON
function canonicalClone<T>(value: T): T;              // Deep clone preserving null-prototype & canonical UTF-16 key order
function sameJson(a: unknown, b: unknown): boolean;   // Structural JSON equality regardless of prototype
function deepFreeze<T>(obj: T): T;                    // Recursive Object.freeze
```

### Structured Errors (`SpikeError`)

All wrapper operations throw structured `SpikeError` instances instead of unhandled third-party exceptions:

| Error `code` | Meaning |
| :--- | :--- |
| `InvalidJson` | Input contains cycles, non-finite numbers, or unsupported types. |
| `InvalidPatch` | Malformed patch structure, dangerous pointer path, or illegal op. |
| `PreconditionFailed` | Document base or result hash does not match `baseHash` / `resultHash`. |
| `ResourceLimit` | Document exceeded `maxWork` (20M ops) or `maxDepth` (256 levels). |
| `InvalidOptions` | Unknown engine name or invalid option parameter. |

---

## 🔒 Security Model

1. **Staging Clone Isolation**: All operations execute on an isolated clone. A failure on operation #N leaves original memory untouched.
2. **Channel Protection**: JSON Pointers attempting to write to `__proto__`, `constructor`, or `prototype` are rejected immediately.
3. **Data Key Preservation**: Valid JSON documents containing properties named `toString`, `valueOf`, `constructor` are treated as legitimate data and round-trip without corruption.
4. **RFC 6902 `copy` Hardening**: Target destinations clone values independently; later mutations of source paths cannot corrupt copied destinations.

---

## 🧪 Testing &amp; Verification

```bash
# Run full test suite (349/349 tests pass)
npm test

# Typecheck TypeScript definitions
npm run typecheck

# Verify CVE & regression reproduces
npm run repro

# Run isolated performance benchmark matrix (requires --expose-gc)
npm run bench

# Regenerate RESULTS.md summary tables
npm run summarize
```

---

## 📜 Changelog

See [CHANGELOG.md](CHANGELOG.md) for detailed version history.

---

## 📄 License

[MIT](LICENSE) © 2026 [truongnat](https://github.com/truongnat)
