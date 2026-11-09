# jsondiffnext

Hardened JSON diff/patch wrapper with multi-engine adapters, atomic apply, and
SHA-256 patch guards (Hash Guard Protocol v1).

`jsondiffnext` wraps three established diff engines behind one safety-focused
API:

- [`fast-json-patch`](https://www.npmjs.com/package/fast-json-patch) (default)
- [`jsondiffpatch`](https://www.npmjs.com/package/jsondiffpatch)
- [`rfc6902`](https://www.npmjs.com/package/rfc6902)

Every diff/apply/revert path enforces the same guarantees regardless of the
underlying engine:

- **Atomic apply** — patches always run on a staging copy; a mid-patch failure
  never mutates your input.
- **Prototype pollution guards** — dangerous write channels (`__proto__`,
  `constructor`, `prototype`) are blocked while the same names as plain data
  keys stay legal.
- **Bounded work & depth** — admission limits (`maxWork`, `maxDepth`) contain
  adversarial inputs; over-budget arrays degrade safely to a root-replace
  patch instead of hanging or blowing the stack.
- **Hash Guard bundles (v1)** — optional versioned SHA-256 bundles that
  verify both base and result documents (RFC 8785 canonical JSON) and carry
  forward + inverse deltas that replay across all three engines.
- **Frozen, self-owned results** — returned values are deeply frozen and own
  their nested data, so later caller edits cannot corrupt stored history.

## Installation

```bash
npm install jsondiffnext
```

Requires Node.js >= 24.

## Usage

```ts
import { diff, applyPatch, revertPatch } from 'jsondiffnext';

const before = { items: [{ id: 'a', qty: 1 }] };
const after = { items: [{ id: 'a', qty: 2 }, { id: 'b', qty: 5 }] };

const bundle = diff(before, after);          // engine: fast-json-patch
const next = applyPatch(before, bundle);     // deep-equals `after`
const back = revertPatch(next, bundle);      // deep-equals `before`
```

### Choosing an engine

```ts
import { diff, adapter } from 'jsondiffnext';

const fjp = adapter('fast-json-patch'); // default
const jdp = adapter('jsondiffpatch');
const rfc = adapter('rfc6902');

const bundle = fjp.diff(before, after, { arrays: { mode: 'keyed', id: 'id' } });
```

### Keyed array diffing

Arrays of entities with unique ids can be diffed by identity instead of
position, so reordering does not produce wholesale replace operations:

```ts
const bundle = diff(beforeUsers, afterUsers, {
  engine: 'fast-json-patch',
  arrays: { mode: 'keyed', id: 'id' },
});
```

### Hash Guard bundles

Every `diff()` returns a versioned `HashPatchBundle` (v1): the bundle pins
both endpoint documents with SHA-256 hashes over RFC 8785 canonical JSON.

```ts
import { diff, applyPatch } from 'jsondiffnext';

const bundle = diff(before, after);
// bundle.version === 1, bundle.algorithm === 'sha256'
// bundle.baseHash / bundle.resultHash pin both endpoints
const next = applyPatch(before, bundle); // verifies baseHash, checks resultHash
```

A v1 bundle strips embedded snapshots, carries only the deltas, and fails
closed if either endpoint hash does not match — malformed headers cannot
silently downgrade to legacy verification. Bundles survive JSON
stringify/parse and interoperate across all three engines.

## API

| Export | Purpose |
| --- | --- |
| `diff(left, right, options?)` | Create a patch bundle (forward + inverse). |
| `applyPatch(doc, bundle, options?)` | Atomically apply a bundle; verifies base. |
| `revertPatch(doc, bundle, options?)` | Atomically revert a bundle. |
| `adapter(name)` | Get a bound single-engine adapter. |
| `canonicalHash(value)` | RFC 8785 canonical JSON SHA-256 hash. |
| `canonicalClone(value)` | Deep clone with canonical key order, null-prototype safe. |
| `sameJson(a, b)` | Structural JSON equality (prototype-insensitive). |
| `DEFAULT_LIMITS`, `HARD_MAX_DEPTH`, `APPLY_MAX_WORK` | Admission limits. |

Errors are thrown as `SpikeError` with structured `code` fields (e.g.
`InvalidPatch`, `BaseMismatch`) rather than leaking raw engine exceptions.

## Safety model

- All apply/revert operations stage a clone first; nothing mutates caller
  input, even on late-operation failure.
- JSON Pointer writes into `__proto__`/`constructor`/`prototype` channels are
  rejected; the same names as own data keys are preserved and round-trip.
- Input scans bound total work (`maxWork`) and nesting (`maxDepth`); disjoint
  or adversarial arrays fall back to a guarded root replacement that keeps
  every correctness guarantee with a bounded payload.
- Returned documents and bundles are deeply frozen.

## Development

```bash
npm test          # 349 tests, single-threaded
npm run typecheck
npm run repro     # regenerate raw/reproductions.json
npm run bench     # isolated benchmark matrix (requires --expose-gc)
npm run summarize # build RESULTS.md from raw benchmark data
```

## License

[MIT](LICENSE)
