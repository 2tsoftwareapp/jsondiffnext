# Independent safety/property review

Only `tests/safety.test.ts`, `tests/property.test.ts`, and this findings file were written by this task. Adapters and core were not edited.

## Verified commands

- `node --test --test-concurrency=1 tests/safety.test.ts tests/property.test.ts`: exit 1, **93 tests: 88 pass, 5 fail, 0 skipped**.
- `npm test`: exit 1, **96 tests: 91 pass, 5 fail, 0 skipped** (includes the three existing contract tests).
- `npm run typecheck`: exit 0.

The added suites contain 84 deterministic safety tests and 9 property tests. Each property test exercises all 300 inputs with seed `20261109`, including when a generated case fails: **2,700 generated inputs total; 900 per adapter**. Generated caller data is cloned before deliberate mutation to avoid changing fast-check's inputs. JSON equality uses wire normalization, including negative zero. Failures are collected and asserted at the end of each seeded group; minimal regressions from the initial shrinking run are retained as safety tests.

## Findings requiring adapter fixes

1. **jsondiffpatch valid own prototype-method names**: `diff({valueOf: 0}, {})` throws the native `Error: functions are not supported`; the valid JSON key encounters an inherited method lookup. Initial conventional fast-check shrinking found this after case 84 with seed 20261109 and shrink path `83:1:0:66:66:66`. The full 300-case root and ownership groups each fail on three generated pairs, involving `valueOf` or `toString`. The deterministic `own valueOf JSON key` test retains the minimal counterexample. The native error also escapes the wrapper's structured error contract.
2. **jsondiffpatch keyed arrays containing null**: `diff([{id:'a',v:1},{v:2},null,3], [null,{v:4},{id:'a',v:2},3], {arrays:{mode:'keyed'}})` throws `TypeError: Cannot convert undefined or null to object` in the adapter's `Object.hasOwn` callback. Missing-ID/mixed arrays must use positional matching. Numeric and string identity distinction is tested independently and passes.
3. **rfc6902 own `__proto__` key loss**: replay of the dangerous-own-key fixture returns an object missing its own `__proto__` member. The expected value is `{'__proto__':{polluted:3},constructor:{prototype:{polluted:4}},prototype:5,_t:'b','-':2}` (constructed via JSON.parse). This is data loss; assertions on Object.prototype and Array.prototype descriptors execute in finally and do not report global prototype mutation.

No tests were skipped, weakened, or converted to expected failures. The five test failures represent three distinct adapter defects: two property-group failures plus the minimal own-valueOf regression, the keyed-null regression, and the own-__proto__ regression. All fast-json-patch tests pass.

## Coverage

Input/patch/result ownership; immutable and wire history; caller mutations; #377 nested-array patch chain and undo/replay; stale targeted and untargeted fields on apply/revert; explicit verifyBase=false; late failure with atomic=true and false; all primitive/object/array root transitions; -0 wire behavior; empty and escaped pointer segments; dangerous own keys and inherited-path rejection; positional prepend/append/remove/reorder/move+edit/duplicates; keyed entity move/edit/insert/delete, duplicate rejection, numeric versus string identity, missing IDs and invalid identity; equal and edited arrays of 20,000 elements; configured depth and hard 256-depth limits; input-scan work rejection and native-work root replacement fallback; invalid cyclic/accessor/sparse/nonfinite and non-JSON values; recursive key insertion ordering determinism; seeded arbitrary JSON roundtrip, ownership/conflict and small shuffled keyed entity properties.

## Raw full-suite evidence

```text
npm notice run jsondiffnext-wrapper-validation-spike@0.0.0 test
npm notice run node --test --test-concurrency=1 tests/*.test.ts
✔ jsondiffpatch: serialized guarded forward/inverse round trip (7.89175ms)
✔ fast-json-patch: serialized guarded forward/inverse round trip (2.104432ms)
✔ rfc6902: serialized guarded forward/inverse round trip (4.44412ms)
✖ jsondiffpatch: seeded JSON root forward/inverse wire round trips (300 cases) (335.430375ms)
✖ jsondiffpatch: seeded ownership, caller edits and untargeted conflicts (300 cases) (419.431627ms)
✔ jsondiffpatch: seeded small keyed entity shuffle/edit/insert/delete round trips (300 cases) (714.078078ms)
✔ fast-json-patch: seeded JSON root forward/inverse wire round trips (300 cases) (263.923134ms)
✔ fast-json-patch: seeded ownership, caller edits and untargeted conflicts (300 cases) (432.370242ms)
✔ fast-json-patch: seeded small keyed entity shuffle/edit/insert/delete round trips (300 cases) (840.328001ms)
✔ rfc6902: seeded JSON root forward/inverse wire round trips (300 cases) (184.432027ms)
✔ rfc6902: seeded ownership, caller edits and untargeted conflicts (300 cases) (296.704613ms)
✔ rfc6902: seeded small keyed entity shuffle/edit/insert/delete round trips (300 cases) (594.691262ms)
✔ jsondiffpatch: diff captures independent inputs and freezes all history values (12.81775ms)
✔ jsondiffpatch: returned apply/revert targets own their nested values independently of wire history (4.519402ms)
✔ jsondiffpatch: issue #377 nested array patch chain leaves earlier history and replay unchanged (5.435186ms)
✔ jsondiffpatch: stale targeted and untargeted fields reject apply and revert without mutation (1.659932ms)
✔ jsondiffpatch: explicit verifyBase false permits an untargeted edit while retaining input ownership (2.162034ms)
✔ jsondiffpatch: late operation failure is isolated for apply/revert with atomic=true (1.043027ms)
✔ jsondiffpatch: late operation failure is isolated for apply/revert with atomic=false (0.557769ms)
✔ jsondiffpatch: root primitives and every root type transition survive wire replay (51.243755ms)
✔ jsondiffpatch: escaped and empty JSON Pointer keys round trip (3.566739ms)
✔ jsondiffpatch: dangerous own JSON keys remain data and do not mutate prototypes (1.921975ms)
✔ jsondiffpatch: positional prepend (1.277173ms)
✔ jsondiffpatch: positional append (0.772446ms)
✔ jsondiffpatch: positional remove (0.729007ms)
✔ jsondiffpatch: positional reorder (1.085237ms)
✔ jsondiffpatch: positional move plus edit (1.304044ms)
✔ jsondiffpatch: positional duplicate positional values and ids (1.417919ms)
✔ jsondiffpatch: keyed reorder, move plus edit, insertion and deletion retain entity values (4.80829ms)
✔ jsondiffpatch: duplicate keyed identities fail in either input and nested arrays (0.399966ms)
✔ jsondiffpatch: keyed numeric and string ids are distinct (1.217305ms)
✖ jsondiffpatch: keyed arrays accept missing ids, null and primitive positional values (0.414197ms)
✔ jsondiffpatch: invalid keyed identity is rejected explicitly (0.169269ms)
✖ jsondiffpatch: own valueOf JSON key can be removed and restored without inherited method lookup (0.241394ms)
✔ jsondiffpatch: equal and changed 20000 element arrays avoid native stack failures (500.682784ms)
✔ jsondiffpatch: configured maxDepth boundary and hard depth limit fail predictably (11.071446ms)
✔ jsondiffpatch: maxWork rejects the input scan but native admission falls back to a valid root patch (2.168055ms)
✔ jsondiffpatch: strict JSON rejects cycles, accessors, sparse arrays and non JSON values before execution (1.711622ms)
✔ jsondiffpatch: invalid and inherited patch pointers fail without changing input or globals (0.585832ms)
✔ jsondiffpatch: serialized bundles are deterministic across recursive key insertion orders (4.644149ms)
✔ fast-json-patch: diff captures independent inputs and freezes all history values (2.030585ms)
✔ fast-json-patch: returned apply/revert targets own their nested values independently of wire history (3.192773ms)
✔ fast-json-patch: issue #377 nested array patch chain leaves earlier history and replay unchanged (2.257518ms)
✔ fast-json-patch: stale targeted and untargeted fields reject apply and revert without mutation (0.545442ms)
✔ fast-json-patch: explicit verifyBase false permits an untargeted edit while retaining input ownership (0.359973ms)
✔ fast-json-patch: late operation failure is isolated for apply/revert with atomic=true (0.326181ms)
✔ fast-json-patch: late operation failure is isolated for apply/revert with atomic=false (0.283049ms)
✔ fast-json-patch: root primitives and every root type transition survive wire replay (35.470134ms)
✔ fast-json-patch: escaped and empty JSON Pointer keys round trip (1.180107ms)
✔ fast-json-patch: dangerous own JSON keys remain data and do not mutate prototypes (0.609026ms)
✔ fast-json-patch: positional prepend (0.526086ms)
✔ fast-json-patch: positional append (0.582234ms)
✔ fast-json-patch: positional remove (0.464731ms)
✔ fast-json-patch: positional reorder (0.534383ms)
✔ fast-json-patch: positional move plus edit (0.890641ms)
✔ fast-json-patch: positional duplicate positional values and ids (0.736677ms)
✔ fast-json-patch: keyed reorder, move plus edit, insertion and deletion retain entity values (1.369067ms)
✔ fast-json-patch: duplicate keyed identities fail in either input and nested arrays (0.344524ms)
✔ fast-json-patch: keyed numeric and string ids are distinct (1.697571ms)
✔ fast-json-patch: keyed arrays accept missing ids, null and primitive positional values (0.738718ms)
✔ fast-json-patch: invalid keyed identity is rejected explicitly (0.176953ms)
✔ fast-json-patch: own valueOf JSON key can be removed and restored without inherited method lookup (0.632486ms)
✔ fast-json-patch: equal and changed 20000 element arrays avoid native stack failures (341.498924ms)
✔ fast-json-patch: configured maxDepth boundary and hard depth limit fail predictably (7.613351ms)
✔ fast-json-patch: maxWork rejects the input scan but native admission falls back to a valid root patch (4.473459ms)
✔ fast-json-patch: strict JSON rejects cycles, accessors, sparse arrays and non JSON values before execution (0.65458ms)
✔ fast-json-patch: invalid and inherited patch pointers fail without changing input or globals (0.453285ms)
✔ fast-json-patch: serialized bundles are deterministic across recursive key insertion orders (2.067154ms)
✔ rfc6902: diff captures independent inputs and freezes all history values (2.368364ms)
✔ rfc6902: returned apply/revert targets own their nested values independently of wire history (1.289165ms)
✔ rfc6902: issue #377 nested array patch chain leaves earlier history and replay unchanged (1.586383ms)
✔ rfc6902: stale targeted and untargeted fields reject apply and revert without mutation (0.479095ms)
✔ rfc6902: explicit verifyBase false permits an untargeted edit while retaining input ownership (0.386066ms)
✔ rfc6902: late operation failure is isolated for apply/revert with atomic=true (0.488066ms)
✔ rfc6902: late operation failure is isolated for apply/revert with atomic=false (0.308072ms)
✔ rfc6902: root primitives and every root type transition survive wire replay (35.5615ms)
✔ rfc6902: escaped and empty JSON Pointer keys round trip (2.408953ms)
✖ rfc6902: dangerous own JSON keys remain data and do not mutate prototypes (2.764977ms)
✔ rfc6902: positional prepend (0.633915ms)
✔ rfc6902: positional append (0.539412ms)
✔ rfc6902: positional remove (0.549663ms)
✔ rfc6902: positional reorder (0.51241ms)
✔ rfc6902: positional move plus edit (0.704228ms)
✔ rfc6902: positional duplicate positional values and ids (0.873931ms)
✔ rfc6902: keyed reorder, move plus edit, insertion and deletion retain entity values (0.910231ms)
✔ rfc6902: duplicate keyed identities fail in either input and nested arrays (0.174425ms)
✔ rfc6902: keyed numeric and string ids are distinct (0.504673ms)
✔ rfc6902: keyed arrays accept missing ids, null and primitive positional values (0.681657ms)
✔ rfc6902: invalid keyed identity is rejected explicitly (0.140244ms)
✔ rfc6902: own valueOf JSON key can be removed and restored without inherited method lookup (0.407232ms)
✔ rfc6902: equal and changed 20000 element arrays avoid native stack failures (507.269175ms)
✔ rfc6902: configured maxDepth boundary and hard depth limit fail predictably (12.891846ms)
✔ rfc6902: maxWork rejects the input scan but native admission falls back to a valid root patch (2.388736ms)
✔ rfc6902: strict JSON rejects cycles, accessors, sparse arrays and non JSON values before execution (0.942468ms)
✔ rfc6902: invalid and inherited patch pointers fail without changing input or globals (0.373883ms)
✔ rfc6902: serialized bundles are deterministic across recursive key insertion orders (2.850218ms)
ℹ tests 96
ℹ suites 0
ℹ pass 91
ℹ fail 5
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 6367.296082

✖ failing tests:

test at tests/property.test.ts:40:3
✖ jsondiffpatch: seeded JSON root forward/inverse wire round trips (300 cases) (335.430375ms)
  AssertionError [ERR_ASSERTION]: 3/300 generated cases failed; first three:
  [{"1{z&)M%)kz":"[hxx|s","%[f":false,"N!":null,"%Ne":true,"9F8We^][T|":null,"g#":-2.5e-323,"valueOf":2.8323993706944964e-272," /\"":null,"":true},{">u-B8":[-3.1776582746770233e+126,-9.61817406778743e-237,false,true,"?e>+YL","2","E?vm5",null,-9.45956992642609e+155],"&":{"5^t[p":null,"9i|lBCMELH":false,")EF-#!k":null,"s":null,"tBxp+c":"X9V+w#?>","/dD$0qc":"5A2"}}]: Error: functions are not supported
      at trivialMatchesDiffFilter (file:///repo/node_modules/jsondiffpatch/lib/filters/trivial.js:19:15)
      at Pipe.process (file:///repo/node_modules/jsondiffpatch/lib/pipe.js:21:13)
      at Processor.process (file:///repo/node_modules/jsondiffpatch/lib/processor.js:48:22)
      at DiffPatcher.diff (file:///repo/node_modules/jsondiffpatch/lib/diffpatcher.js:29:31)
      at Object.generate (file:///repo/adapters.ts:37:42)
      at file:///repo/adapters.ts:91:67
      at Meter.span (file:///repo/core.ts:49:18)
      at Object.diff (file:///repo/adapters.ts:91:34)
      at file:///repo/tests/property.test.ts:48:30
      at exercise (file:///repo/tests/property.test.ts:22:9)
  [{"7+-\\":[],"ynEx]Mike!":">$m[cY)d$J","A":null,"r6qC9G\\JE":false},{"S\"+I&KA":";`","gz":1.7178000016174176e-255,"2[7u\\-{7@b":"fp-)>$v0","j,d/0(^s":">G","valueOf":-3.067855648309872e-162,"|zT/}y":-8.624165770933416e-8,"jXOaEuKll":"U}l","*3oxg5U":false}]: Error: functions are not supported
      at trivialMatchesDiffFilter (file:///repo/node_modules/jsondiffpatch/lib/filters/trivial.js:19:15)
      at Pipe.process (file:///repo/node_modules/jsondiffpatch/lib/pipe.js:21:13)
      at Processor.process (file:///repo/node_modules/jsondiffpatch/lib/processor.js:48:22)
      at DiffPatcher.diff (file:///repo/node_modules/jsondiffpatch/lib/diffpatcher.js:29:31)
      at Object.generate (file:///repo/adapters.ts:37:42)
      at file:///repo/adapters.ts:91:126
      at Meter.span (file:///repo/core.ts:49:18)
      at Object.diff (file:///repo/adapters.ts:91:34)
      at file:///repo/tests/property.test.ts:48:30
      at exercise (file:///repo/tests/property.test.ts:22:9)
  [{"GM":"d\"_","4,":true,"cNHGob":"O=N*o","pu4 'crlB":7.4673075520917214e+199,"xKQ-}`iz!":"YFZ","":null,"toString":""},{"":true,"bMBd":"k",";Jd)tyd|H2":true,"7@W%E":"YiW","~c":null,"wk*$j":2.5790035940835513e-123,"ng#+":true,"(ZmM":true,"%sJO":null,"SL$(SUgyp":-1.7670574942723115e+229}]: Error: functions are not supported
      at trivialMatchesDiffFilter (file:///repo/node_modules/jsondiffpatch/lib/filters/trivial.js:19:15)
      at Pipe.process (file:///repo/node_modules/jsondiffpatch/lib/pipe.js:21:13)
      at Processor.process (file:///repo/node_modules/jsondiffpatch/lib/processor.js:48:22)
      at DiffPatcher.diff (file:///repo/node_modules/jsondiffpatch/lib/diffpatcher.js:29:31)
      at Object.generate (file:///repo/adapters.ts:37:42)
      at file:///repo/adapters.ts:91:67
      at Meter.span (file:///repo/core.ts:49:18)
      at Object.diff (file:///repo/adapters.ts:91:34)
      at file:///repo/tests/property.test.ts:48:30
      at exercise (file:///repo/tests/property.test.ts:22:9)
  
  3 !== 0
  
      at finish (file:///repo/tests/property.test.ts:28:10)
      at TestContext.<anonymous> (file:///repo/tests/property.test.ts:62:5)
      at Test.runInAsyncScope (node:async_hooks:226:14)
      at Test.run (node:internal/test_runner/test:1402:25)
      at Test.start (node:internal/test_runner/test:1262:17)
      at startSubtestAfterBootstrap (node:internal/test_runner/harness:387:17) {
    generatedMessage: false,
    code: 'ERR_ASSERTION',
    actual: 3,
    expected: 0,
    operator: 'strictEqual',
    diff: 'simple'
  }

test at tests/property.test.ts:65:3
✖ jsondiffpatch: seeded ownership, caller edits and untargeted conflicts (300 cases) (419.431627ms)
  AssertionError [ERR_ASSERTION]: 3/300 generated cases failed; first three:
  [{"1{z&)M%)kz":"[hxx|s","%[f":false,"N!":null,"%Ne":true,"9F8We^][T|":null,"g#":-2.5e-323,"valueOf":2.8323993706944964e-272," /\"":null,"":true},{">u-B8":[-3.1776582746770233e+126,-9.61817406778743e-237,false,true,"?e>+YL","2","E?vm5",null,-9.45956992642609e+155],"&":{"5^t[p":null,"9i|lBCMELH":false,")EF-#!k":null,"s":null,"tBxp+c":"X9V+w#?>","/dD$0qc":"5A2"}}]: Error: functions are not supported
      at trivialMatchesDiffFilter (file:///repo/node_modules/jsondiffpatch/lib/filters/trivial.js:19:15)
      at Pipe.process (file:///repo/node_modules/jsondiffpatch/lib/pipe.js:21:13)
      at Processor.process (file:///repo/node_modules/jsondiffpatch/lib/processor.js:48:22)
      at DiffPatcher.diff (file:///repo/node_modules/jsondiffpatch/lib/diffpatcher.js:29:31)
      at Object.generate (file:///repo/adapters.ts:37:42)
      at file:///repo/adapters.ts:91:67
      at Meter.span (file:///repo/core.ts:49:18)
      at Object.diff (file:///repo/adapters.ts:91:34)
      at file:///repo/tests/property.test.ts:74:30
      at exercise (file:///repo/tests/property.test.ts:22:9)
  [{"7+-\\":[],"ynEx]Mike!":">$m[cY)d$J","A":null,"r6qC9G\\JE":false},{"S\"+I&KA":";`","gz":1.7178000016174176e-255,"2[7u\\-{7@b":"fp-)>$v0","j,d/0(^s":">G","valueOf":-3.067855648309872e-162,"|zT/}y":-8.624165770933416e-8,"jXOaEuKll":"U}l","*3oxg5U":false}]: Error: functions are not supported
      at trivialMatchesDiffFilter (file:///repo/node_modules/jsondiffpatch/lib/filters/trivial.js:19:15)
      at Pipe.process (file:///repo/node_modules/jsondiffpatch/lib/pipe.js:21:13)
      at Processor.process (file:///repo/node_modules/jsondiffpatch/lib/processor.js:48:22)
      at DiffPatcher.diff (file:///repo/node_modules/jsondiffpatch/lib/diffpatcher.js:29:31)
      at Object.generate (file:///repo/adapters.ts:37:42)
      at file:///repo/adapters.ts:91:126
      at Meter.span (file:///repo/core.ts:49:18)
      at Object.diff (file:///repo/adapters.ts:91:34)
      at file:///repo/tests/property.test.ts:74:30
      at exercise (file:///repo/tests/property.test.ts:22:9)
  [{"GM":"d\"_","4,":true,"cNHGob":"O=N*o","pu4 'crlB":7.4673075520917214e+199,"xKQ-}`iz!":"YFZ","":null,"toString":""},{"":true,"bMBd":"k",";Jd)tyd|H2":true,"7@W%E":"YiW","~c":null,"wk*$j":2.5790035940835513e-123,"ng#+":true,"(ZmM":true,"%sJO":null,"SL$(SUgyp":-1.7670574942723115e+229}]: Error: functions are not supported
      at trivialMatchesDiffFilter (file:///repo/node_modules/jsondiffpatch/lib/filters/trivial.js:19:15)
      at Pipe.process (file:///repo/node_modules/jsondiffpatch/lib/pipe.js:21:13)
      at Processor.process (file:///repo/node_modules/jsondiffpatch/lib/processor.js:48:22)
      at DiffPatcher.diff (file:///repo/node_modules/jsondiffpatch/lib/diffpatcher.js:29:31)
      at Object.generate (file:///repo/adapters.ts:37:42)
      at file:///repo/adapters.ts:91:67
      at Meter.span (file:///repo/core.ts:49:18)
      at Object.diff (file:///repo/adapters.ts:91:34)
      at file:///repo/tests/property.test.ts:74:30
      at exercise (file:///repo/tests/property.test.ts:22:9)
  
  3 !== 0
  
      at finish (file:///repo/tests/property.test.ts:28:10)
      at TestContext.<anonymous> (file:///repo/tests/property.test.ts:105:5)
      at Test.runInAsyncScope (node:async_hooks:226:14)
      at Test.run (node:internal/test_runner/test:1402:25)
      at Test.processPendingSubtests (node:internal/test_runner/test:974:18)
      at Test.postRun (node:internal/test_runner/test:1542:19)
      at Test.run (node:internal/test_runner/test:1467:12)
      at async startSubtestAfterBootstrap (node:internal/test_runner/harness:387:3) {
    generatedMessage: false,
    code: 'ERR_ASSERTION',
    actual: 3,
    expected: 0,
    operator: 'strictEqual',
    diff: 'simple'
  }

test at tests/safety.test.ts:230:3
✖ jsondiffpatch: keyed arrays accept missing ids, null and primitive positional values (0.414197ms)
  TypeError [Error]: Cannot convert undefined or null to object
      at Object.hasOwn (<anonymous>)
      at jdp.create.objectHash (file:///repo/adapters.ts:33:29)
      at matchItems (file:///repo/node_modules/jsondiffpatch/lib/filters/arrays.js:43:46)
      at arraysDiffFilter (file:///repo/node_modules/jsondiffpatch/lib/filters/arrays.js:78:9)
      at Pipe.process (file:///repo/node_modules/jsondiffpatch/lib/pipe.js:21:13)
      at Processor.process (file:///repo/node_modules/jsondiffpatch/lib/processor.js:48:22)
      at DiffPatcher.diff (file:///repo/node_modules/jsondiffpatch/lib/diffpatcher.js:29:31)
      at Object.generate (file:///repo/adapters.ts:37:42)
      at file:///repo/adapters.ts:91:67
      at Meter.span (file:///repo/core.ts:49:18)

test at tests/safety.test.ts:238:3
✖ jsondiffpatch: own valueOf JSON key can be removed and restored without inherited method lookup (0.241394ms)
  Error: functions are not supported
      at trivialMatchesDiffFilter (file:///repo/node_modules/jsondiffpatch/lib/filters/trivial.js:19:15)
      at Pipe.process (file:///repo/node_modules/jsondiffpatch/lib/pipe.js:21:13)
      at Processor.process (file:///repo/node_modules/jsondiffpatch/lib/processor.js:48:22)
      at DiffPatcher.diff (file:///repo/node_modules/jsondiffpatch/lib/diffpatcher.js:29:31)
      at Object.generate (file:///repo/adapters.ts:37:42)
      at file:///repo/adapters.ts:91:67
      at Meter.span (file:///repo/core.ts:49:18)
      at Object.diff (file:///repo/adapters.ts:91:34)
      at roundTrip (file:///repo/tests/safety.test.ts:18:26)
      at TestContext.<anonymous> (file:///repo/tests/safety.test.ts:239:5)

test at tests/safety.test.ts:186:3
✖ rfc6902: dangerous own JSON keys remain data and do not mutate prototypes (2.764977ms)
  AssertionError [ERR_ASSERTION]: Expected values to be strictly deep-equal:
  + actual - expected
  
    {
      '-': 2,
  -   ['__proto__']: {
  -     polluted: 3
  -   },
      _t: 'b',
      constructor: {
        prototype: {
          polluted: 4
        }
  
      at roundTrip (file:///repo/tests/safety.test.ts:22:10)
      at TestContext.<anonymous> (file:///repo/tests/safety.test.ts:192:7)
      at Test.runInAsyncScope (node:async_hooks:226:14)
      at Test.run (node:internal/test_runner/test:1402:25)
      at Test.processPendingSubtests (node:internal/test_runner/test:974:18)
      at Test.postRun (node:internal/test_runner/test:1542:19)
      at Test.run (node:internal/test_runner/test:1467:12)
      at async Test.processPendingSubtests (node:internal/test_runner/test:974:7) {
    generatedMessage: true,
    code: 'ERR_ASSERTION',
    actual: { '-': 2, _t: 'b', constructor: { prototype: [Object] }, prototype: 5 },
    expected: { ['__proto__']: { polluted: 3 }, constructor: { prototype: [Object] }, prototype: 5, _t: 'b', '-': 2 },
    operator: 'deepStrictEqual',
    diff: 'simple'
  }
```

## Raw typecheck evidence

```text
npm notice run jsondiffnext-wrapper-validation-spike@0.0.0 typecheck
npm notice run tsc --noEmit
```
