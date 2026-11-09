import test from 'node:test';
import assert from 'node:assert/strict';
import { adapters, SpikeError } from '../adapters.ts';
import type { Adapter, DiffOptions, JsonValue, PatchBundle } from '../adapters.ts';

function wire<T>(value: T): T { return JSON.parse(JSON.stringify(value)) as T; }
function expectCode(action: () => unknown, code: string): void {
  assert.throws(action, (error: unknown) => error instanceof SpikeError && error.code === code);
}
function frozenTree(value: unknown): void {
  if (value !== null && typeof value === 'object') {
    assert.ok(Object.isFrozen(value));
    for (const child of Object.values(value)) frozenTree(child);
  }
}
function roundTrip(adapter: Adapter, before: JsonValue, after: JsonValue, options?: DiffOptions): PatchBundle {
  const originalBefore = wire(before), originalAfter = wire(after);
  const bundle = adapter.diff(before, after, options);
  const serialized = JSON.stringify(bundle);
  const restored = wire(bundle);
  const applied = adapter.applyPatch(before, restored);
  assert.deepEqual(applied, originalAfter);
  assert.deepEqual(adapter.revertPatch(applied, restored), originalBefore);
  assert.deepEqual(adapter.revertPatch(after, restored), originalBefore);
  assert.deepEqual(before, originalBefore);
  assert.deepEqual(after, originalAfter);
  assert.equal(JSON.stringify(bundle), serialized);
  assert.equal(JSON.stringify(restored), serialized);
  return bundle;
}
function nested(depth: number, leaf: JsonValue): JsonValue {
  let result = leaf;
  for (let i = 0; i < depth; i++) result = { child: result };
  return result;
}
function reverseKeys(value: JsonValue): JsonValue {
  if (Array.isArray(value)) return value.map(reverseKeys);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).reverse().map(([key, child]) => [key, reverseKeys(child)]));
  }
  return value;
}
const keyed: DiffOptions = { arrays: { mode: 'keyed' } };

for (const adapter of adapters) {
  const name = adapter.name;
  test(`${name}: diff captures independent inputs and freezes all history values`, () => {
    const before = { items: [{ id: 1, nested: { value: 'old' } }], removed: { values: [1] } };
    const after = { items: [{ id: 1, nested: { value: 'new' } }, { id: 2, nested: { value: 'added' } }] };
    const base = wire(before), target = wire(after);
    const bundle = adapter.diff(before, after);
    const bytes = JSON.stringify(bundle);
    assert.deepEqual(before, base);
    assert.deepEqual(after, target);
    frozenTree(bundle);
    assert.throws(() => { (bundle.forward as unknown as unknown[]).push({}); }, TypeError);
    const payload = [...bundle.forward, ...bundle.inverse].find(op => 'value' in op && op.value !== null && typeof op.value === 'object');
    assert.ok(payload && 'value' in payload);
    assert.throws(() => { (payload.value as Record<string, JsonValue>).injected = true; }, TypeError);
    before.items[0]!.nested.value = 'caller changed base';
    before.removed.values.push(9);
    after.items[0]!.nested.value = 'caller changed target';
    after.items.push({ id: 3, nested: { value: 'later' } });
    assert.equal(JSON.stringify(bundle), bytes);
    assert.deepEqual(adapter.applyPatch(base, bundle), target);
    assert.deepEqual(adapter.revertPatch(target, bundle), base);
  });

  test(`${name}: legacy apply/revert targets own their nested values independently of wire history`, () => {
    const before = { items: [{ nested: [0] }], obsolete: { list: ['old'] } };
    const after = { items: [{ nested: [1, 2] }, { nested: [3] }] };
    const generated = adapter.diff(before, after);
    const bundle: PatchBundle = wire({
      forward: [{ op: 'test', path: '', value: before }, ...generated.forward],
      inverse: [{ op: 'test', path: '', value: after }, ...generated.inverse],
    });
    const bytes = JSON.stringify(bundle);
    const output = adapter.applyPatch(before, bundle) as typeof after;
    const replay = adapter.applyPatch(before, bundle) as typeof after;
    output.items[0]!.nested.push(99);
    output.items[1]!.nested[0] = 88;
    assert.deepEqual(replay, after);
    assert.deepEqual(adapter.applyPatch(before, bundle), after);
    const reverted = adapter.revertPatch(after, bundle) as typeof before;
    reverted.items[0]!.nested.push(7);
    reverted.obsolete.list.push('edited');
    assert.deepEqual(adapter.revertPatch(after, bundle), before);
    assert.equal(JSON.stringify(bundle), bytes);
    assert.deepEqual(before, { items: [{ nested: [0] }], obsolete: { list: ['old'] } });
    assert.deepEqual(after, { items: [{ nested: [1, 2] }, { nested: [3] }] });
  });

  test(`${name}: issue #377 nested array patch chain leaves earlier history and replay unchanged`, () => {
    const s0 = {};
    const s1 = { stages: [[]] as { id: string; value: number }[][] };
    const s2 = { stages: [[{ id: 'item', value: 1 }]] };
    const s3 = { stages: [[{ id: 'item', value: 2 }, { id: 'later', value: 3 }]] };
    const p1 = adapter.diff(s0, s1);
    const bytes1 = JSON.stringify(p1);
    const first = adapter.applyPatch(s0, p1);
    const p2 = adapter.diff(first, s2);
    const bytes2 = JSON.stringify(p2);
    const second = adapter.applyPatch(first, p2);
    const p3 = adapter.diff(second, s3);
    const bytes3 = JSON.stringify(p3);
    const third = adapter.applyPatch(second, p3);
    assert.deepEqual(first, s1);
    assert.deepEqual(second, s2);
    assert.deepEqual(third, s3);
    const replay1 = adapter.applyPatch(s0, wire(p1));
    assert.deepEqual(replay1, s1);
    assert.deepEqual(adapter.applyPatch(replay1, wire(p2)), s2);
    assert.deepEqual(adapter.applyPatch(adapter.applyPatch(replay1, wire(p2)), wire(p3)), s3);
    const undone2 = adapter.revertPatch(third, p3);
    const undone1 = adapter.revertPatch(undone2, p2);
    assert.deepEqual(adapter.revertPatch(undone1, p1), s0);
    frozenTree(third);
    assert.throws(() => (third as typeof s3).stages[0]!.push({ id: 'caller', value: 9 }), TypeError);
    assert.equal(JSON.stringify(p1), bytes1);
    assert.equal(JSON.stringify(p2), bytes2);
    assert.equal(JSON.stringify(p3), bytes3);
    assert.deepEqual(adapter.applyPatch(s0, p1), s1);
  });

  test(`${name}: stale targeted and untargeted fields reject apply and revert without mutation`, () => {
    const before = { edited: 1, untouched: { value: 10 } };
    const after = { edited: 2, untouched: { value: 10 } };
    const bundle = wire(adapter.diff(before, after));
    const bytes = JSON.stringify(bundle);
    for (const stale of [{ edited: 99, untouched: { value: 10 } }, { edited: 1, untouched: { value: 99 } }]) {
      const snapshot = wire(stale);
      expectCode(() => adapter.applyPatch(stale, bundle), 'PreconditionFailed');
      assert.deepEqual(stale, snapshot);
    }
    for (const stale of [{ edited: 99, untouched: { value: 10 } }, { edited: 2, untouched: { value: 99 } }]) {
      const snapshot = wire(stale);
      expectCode(() => adapter.revertPatch(stale, bundle), 'PreconditionFailed');
      assert.deepEqual(stale, snapshot);
    }
    assert.equal(JSON.stringify(bundle), bytes);
  });

  test(`${name}: legacy verifyBase false permits an untargeted edit while retaining input ownership`, () => {
    const before = { x: 1, untouched: 0 }, after = { x: 2, untouched: 0 };
    const generated = adapter.diff(before, after);
    const bundle: PatchBundle = {
      forward: [{ op: 'test', path: '', value: before }, ...generated.forward],
      inverse: [{ op: 'test', path: '', value: after }, ...generated.inverse],
    };
    const stale = { x: 1, untouched: 99 };
    const output = adapter.applyPatch(stale, bundle, { verifyBase: false });
    assert.deepEqual(output, { x: 2, untouched: 99 });
    assert.deepEqual(stale, { x: 1, untouched: 99 });
    assert.deepEqual(adapter.revertPatch(output, bundle, { verifyBase: false }), stale);
  });

  test(`${name}: late operation failure is isolated for apply/revert (apply is always atomic)`, () => {
    const document = { x: 0, y: { value: 0 } };
    const operations = [
      { op: 'test', path: '', value: wire(document) },
      { op: 'replace', path: '/x', value: 1 },
      { op: 'test', path: '/y/value', value: 999 },
      { op: 'replace', path: '/y/value', value: 2 },
    ];
    const bundle = { forward: wire(operations), inverse: wire(operations) } as PatchBundle;
    const bytes = JSON.stringify(bundle);
    for (const run of [adapter.applyPatch, adapter.revertPatch]) {
      assert.throws(() => run(document, bundle, { verifyBase: true }), (error: unknown) => {
          assert.ok(error instanceof SpikeError);
          assert.equal(error.code, 'PreconditionFailed');
          assert.equal(error.operationIndex, 2);
          assert.equal(error.path, '/y/value');
          return true;
        });
        assert.deepEqual(document, { x: 0, y: { value: 0 } });
        assert.equal(JSON.stringify(bundle), bytes);
      }
  });

  test(`${name}: root primitives and every root type transition survive wire replay`, () => {
    const roots: JsonValue[] = [null, false, true, 0, 12.5, '', 'text', [], [1, null], {}, { value: [1] }];
    for (const before of roots) for (const after of roots) roundTrip(adapter, before, after);
    const bundle = wire(adapter.diff(-0, { negativeZero: -0 }));
    assert.deepEqual(adapter.applyPatch(-0, bundle), { negativeZero: 0 });
    assert.equal(Object.is(adapter.revertPatch({ negativeZero: -0 }, bundle), -0), false);
  });

  test(`${name}: escaped and empty JSON Pointer keys round trip`, () => {
    const before = { '': { '/': { '~': [1, 2] } }, 'a/b': 1, 'x~y': { '~1/': 'old' } };
    const after = { '': { '/': { '~': [2, 3, 1] } }, 'a/b': 2, 'x~y': { '~1/': 'new', '': true } };
    roundTrip(adapter, before, after);
  });

  test(`${name}: dangerous own JSON keys remain data and do not mutate prototypes`, () => {
    const before = JSON.parse('{"__proto__":{"polluted":1},"constructor":{"prototype":{"polluted":2}},"prototype":0,"_t":"a","-":1}');
    const after = JSON.parse('{"__proto__":{"polluted":3},"constructor":{"prototype":{"polluted":4}},"prototype":5,"_t":"b","-":2}');
    const objectPrototype = Object.getOwnPropertyDescriptors(Object.prototype);
    const arrayPrototype = Object.getOwnPropertyDescriptors(Array.prototype);
    try {
      roundTrip(adapter, before, after);
    } finally {
      assert.deepEqual(Object.getOwnPropertyDescriptors(Object.prototype), objectPrototype);
      assert.deepEqual(Object.getOwnPropertyDescriptors(Array.prototype), arrayPrototype);
    }
  });

  const positional: [string, JsonValue, JsonValue][] = [
    ['prepend', [1, 2], [0, 1, 2]],
    ['append', [1, 2], [1, 2, 3]],
    ['remove', [1, 2, 3], [1, 3]],
    ['reorder', [1, 2, 3, 4], [4, 3, 2, 1]],
    ['move plus edit', [{ id: 'a', value: 1 }, { id: 'b', value: 2 }, { id: 'c', value: 3 }], [{ id: 'c', value: 30 }, { id: 'a', value: 1 }, { id: 'b', value: 2 }]],
    ['duplicate positional values and ids', [{ id: 'a', value: 1 }, { id: 'a', value: 2 }, 1, 1], [1, { id: 'a', value: 3 }, 1, { id: 'a', value: 1 }]],
  ];
  for (const [label, before, after] of positional) {
    test(`${name}: positional ${label}`, () => { roundTrip(adapter, before, after, { arrays: { mode: 'position' } }); });
  }

  test(`${name}: keyed reorder, move plus edit, insertion and deletion retain entity values`, () => {
    const before = [{ id: 'a', value: { count: 1 } }, { id: 'b', value: { count: 2 } }, { id: 'c', value: { count: 3 } }];
    const after = [{ id: 'c', value: { count: 30 } }, { id: 'new', value: { count: 4 } }, { id: 'a', value: { count: 1 } }];
    roundTrip(adapter, before, after, keyed);
  });

  test(`${name}: duplicate keyed identities fail in either input and nested arrays`, () => {
    const duplicate = [{ id: 'same', value: 1 }, { id: 'same', value: 2 }];
    for (const [before, after] of [[duplicate, []], [[], duplicate], [{ nested: duplicate }, {}]] as [JsonValue, JsonValue][]) {
      const original = JSON.stringify([before, after]);
      expectCode(() => adapter.diff(before, after, keyed), 'DuplicateIdentity');
      assert.equal(JSON.stringify([before, after]), original);
    }
  });

  test(`${name}: keyed numeric and string ids are distinct`, () => {
    roundTrip(adapter, [{ id: 1, v: 'number' }, { id: '1', v: 'string' }], [{ id: '1', v: 'edited' }, { id: 1, v: 'number' }], keyed);
  });

  test(`${name}: keyed arrays accept missing ids, null and primitive positional values`, () => {
    roundTrip(adapter, [{ id: 'a', v: 1 }, { v: 2 }, null, 3], [null, { v: 4 }, { id: 'a', v: 2 }, 3], keyed);
  });

  test(`${name}: invalid keyed identity is rejected explicitly`, () => {
    expectCode(() => adapter.diff([{ id: null }], [], keyed), 'InvalidIdentity');
  });

  test(`${name}: own valueOf JSON key can be removed and restored without inherited method lookup`, () => {
    roundTrip(adapter, { valueOf: 0 }, {});
  });

  test(`${name}: equal and changed 20000 element arrays avoid native stack failures`, () => {
    const before = Array.from({ length: 20_000 }, (_, i) => String(i));
    roundTrip(adapter, before, before.slice());
    const changed = before.slice();
    changed[10_000] = 'changed';
    roundTrip(adapter, before, changed);
  });

  test(`${name}: configured maxDepth boundary and hard depth limit fail predictably`, () => {
    roundTrip(adapter, nested(4, 1), nested(4, 2), { limits: { maxWork: 100_000, maxDepth: 4 } });
    expectCode(() => adapter.diff(nested(5, 1), nested(5, 2), { limits: { maxWork: 100_000, maxDepth: 4 } }), 'ResourceLimit');
    roundTrip(adapter, nested(256, 1), nested(256, 2));
    expectCode(() => adapter.diff(nested(257, 1), null), 'ResourceLimit');
    expectCode(() => adapter.diff(null, null, { limits: { maxWork: 100_000, maxDepth: 257 } }), 'InvalidOptions');
  });

  test(`${name}: maxWork rejects the input scan but native admission falls back to a valid root patch`, () => {
    expectCode(() => adapter.diff('long input', 'other', { limits: { maxWork: 3, maxDepth: 4 } }), 'ResourceLimit');
    const before = Array.from({ length: 100 }, (_, i) => i);
    const after = before.slice().reverse();
    adapter.resetMetrics();
    const bundle = adapter.diff(before, after, { limits: { maxWork: 10_000, maxDepth: 4 } });
    const metrics = adapter.measurements();
    assert.ok(metrics.scanWork! < 10_000);
    if (name === 'fast-json-patch') {
      assert.equal(metrics.fallback, 'native');
    } else {
      assert.ok(metrics.estimatedNativeWork! + metrics.scanWork! > 10_000);
      assert.equal(metrics.fallback, 'native-admission-root-replace');
      assert.deepEqual(bundle.forward[0], { op: 'replace', path: '', value: after });
    }
    assert.deepEqual(adapter.applyPatch(before, wire(bundle)), after);
    assert.deepEqual(adapter.revertPatch(after, wire(bundle)), before);
  });

  test(`${name}: strict JSON rejects cycles, accessors, sparse arrays and non JSON values before execution`, () => {
    const cyclic: Record<string, unknown> = {}; cyclic.self = cyclic;
    let getterCalls = 0;
    const getter = Object.defineProperty({}, 'value', { enumerable: true, get() { getterCalls++; return 1; } });
    const invalid: unknown[] = [cyclic, getter, new Array(2), [1, , 3], NaN, Infinity, -Infinity, undefined, () => 1, 1n, Symbol('x'), new Date(), { x: undefined }, { [Symbol('key')]: 1 }, Object.defineProperty({}, 'hidden', { value: 1 })];
    const patch = adapter.diff({ x: 1 }, { x: 2 });
    for (const value of invalid) {
      expectCode(() => adapter.diff(value as JsonValue, null), 'InvalidJson');
      expectCode(() => adapter.diff(null, value as JsonValue), 'InvalidJson');
      expectCode(() => adapter.applyPatch(value as JsonValue, patch), 'InvalidJson');
      expectCode(() => adapter.revertPatch(value as JsonValue, patch), 'InvalidJson');
    }
    assert.equal(getterCalls, 0);
  });

  test(`${name}: invalid and inherited patch pointers fail without changing input or globals`, () => {
    const before = { safe: 0 };
    for (const path of ['/constructor/prototype/polluted', '/__proto__/polluted', '/missing/child', '/bad~2escape']) {
      const bundle = { forward: [{ op: 'test', path: '', value: before }, { op: 'add', path, value: 1 }], inverse: [{ op: 'test', path: '', value: before }] } as PatchBundle;
      const snapshot = Object.getOwnPropertyDescriptors(Object.prototype);
      assert.throws(() => adapter.applyPatch(before, bundle), SpikeError);
      assert.deepEqual(before, { safe: 0 });
      assert.deepEqual(Object.getOwnPropertyDescriptors(Object.prototype), snapshot);
    }
  });

  test(`${name}: serialized bundles are deterministic across recursive key insertion orders`, () => {
    const before: JsonValue = { z: { beta: 2, alpha: 1 }, a: [{ id: 'x', z: 0, a: 1 }, { id: 'y', z: 2, a: 3 }], 'a/b': { '~': 1 } };
    const after: JsonValue = { 'a/b': { '~': 2 }, a: [{ id: 'y', a: 4, z: 2 }, { id: 'x', a: 1, z: 0 }], z: { alpha: 5, beta: 2 }, added: { z: 1, a: 2 } };
    for (const options of [undefined, keyed]) {
      const bytes: string = JSON.stringify(adapter.diff(before, after, options));
      assert.equal(JSON.stringify(adapter.diff(reverseKeys(before), reverseKeys(after), options)), bytes);
      assert.equal(JSON.stringify(adapter.diff(before, after, options)), bytes);
      const restored = JSON.parse(bytes) as PatchBundle;
      assert.deepEqual(adapter.applyPatch(before, restored), wire(after));
      assert.deepEqual(adapter.revertPatch(after, restored), wire(before));
    }
  });
}
