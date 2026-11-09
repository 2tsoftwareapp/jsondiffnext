import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import * as api from '../index.ts';

const digest = (canonical: string): string => createHash('sha256').update(canonical, 'utf8').digest('hex');
const wire = <T,>(value: T): T => JSON.parse(JSON.stringify(value));

function frozenTree(value: unknown): void {
  if (value !== null && typeof value === 'object') {
    assert.ok(Object.isFrozen(value));
    for (const child of Object.values(value)) frozenTree(child);
  }
}

test('canonical hashes preserve JSON primitives, string escapes and array order', () => {
  const value = { numbers: [333333333.33333329, 1e30, 4.50, 2e-3, 1e-27, -0], literals: [null, true, false], text: '€\u000f\nA\"\\/' };
  const expected = '{"literals":[null,true,false],"numbers":[333333333.3333333,1e+30,4.5,0.002,1e-27,0],"text":"€\\u000f\\nA\\\"\\\\/"}';
  assert.equal(api.canonicalHash(value), digest(expected));
  assert.equal(api.canonicalHash(null), '74234e98afe7498fb5daf1f36ac2d78acc339464f950703b8c019892f982b90b');
  assert.equal(api.canonicalHash(-0), api.canonicalHash(0));
  assert.notEqual(api.canonicalHash([1, 2]), api.canonicalHash([2, 1]));
  assert.notEqual(api.canonicalHash('é'), api.canonicalHash('e\u0301'));
  assert.equal(api.canonicalHash({ a: [{ z: 2, a: 1 }], b: 3 }), api.canonicalHash({ b: 3, a: [{ a: 1, z: 2 }] }));
});

test('canonical hashes preserve own special keys and ignore prototype identity', () => {
  const object = JSON.parse('{"__proto__":1,"constructor":2,"toString":3}');
  const dictionary = Object.assign(Object.create(null), object);
  assert.equal(api.canonicalHash(object), digest('{"__proto__":1,"constructor":2,"toString":3}'));
  assert.equal(api.canonicalHash(dictionary), api.canonicalHash(object));
  assert.equal(Object.hasOwn(Object.prototype, 'polluted'), false);
});

test('canonical hashing rejects invalid JSON without executing getters', () => {
  const cycle: Record<string, unknown> = {}; cycle.self = cycle;
  let getterCalls = 0;
  const getter = Object.defineProperty({}, 'x', { enumerable: true, get() { getterCalls++; return 1; } });
  for (const input of [NaN, Infinity, undefined, 1n, [1, , 3], cycle, getter, { x: undefined }, { [Symbol()]: 1 }, Object.defineProperty({}, 'hidden', { value: 1 }), '\ud800', '\udfff', { '\ud800': 1 }]) {
    assert.throws(() => api.canonicalHash(input as api.JsonValue), { code: 'InvalidJson' });
  }
  assert.equal(getterCalls, 0);
  let deep: api.JsonValue = null;
  for (let i = 0; i < 257; i++) deep = [deep];
  assert.throws(() => api.canonicalHash(deep), { code: 'ResourceLimit' });
});

test('canonical hashes use UTF-16 key order including integer-like keys', () => {
  const input = { '2': 'two', '10': 'ten', '\ufb33': 7, '😀': 6, '€': 5, 'ö': 4, '\u0080': 3, '1': 2, '\r': 1 };
  const expected = '{"\\r":1,"1":2,"10":"ten","2":"two","\u0080":3,"ö":4,"€":5,"😀":6,"דּ":7}';
  assert.equal(api.canonicalHash(input), digest(expected));
});

for (const producer of api.adapters) for (const consumer of api.adapters) {
  test(`${producer.name} -> ${consumer.name}: portable hash bundle round trips across engines`, () => {
    const pairs: [api.JsonValue, api.JsonValue][] = [
      [null, [1, 2]], [[1, 2], { items: [] }],
      [{ items: [{ id: 'a', n: 1 }, { id: 'b', n: 2 }] }, { items: [{ id: 'b', n: 3 }, { id: 'a', n: 1 }, { id: 'c', n: 4 }] }],
      [{ 'a/b': { '~x': 1 }, '': 0 }, { 'a/b': { '~x': 2 }, '': 1 }],
    ];
    for (const [before, after] of pairs) {
      const patch = wire(producer.diff(before, after));
      assert.deepEqual(consumer.applyPatch(before, patch), after);
      assert.deepEqual(consumer.revertPatch(after, patch), before);
    }
  });
}

test('backend-specific pointer restrictions remain enforced for external hash bundles', () => {
  const consumer = api.adapter('jsondiffpatch');
  for (const producer of [api.adapter('fast-json-patch'), api.adapter('rfc6902')]) {
    for (const key of ['_t', 'constructor', 'toString', '-']) {
      const before = { [key]: 1 }, after = { [key]: 2 };
      const patch = wire(producer.diff(before, after));
      const saved = JSON.stringify([before, after, patch]);
      const code = key === '-' ? 'PatchFailed' : 'InvalidPatch';
      assert.throws(() => consumer.applyPatch(before, patch), { code });
      assert.throws(() => consumer.revertPatch(after, patch), { code });
      assert.equal(JSON.stringify([before, after, patch]), saved);
    }
  }
});

for (const adapter of api.adapters) {
  test(`${adapter.name}: malformed hash headers cannot downgrade to legacy verification`, () => {
    const before = { x: 1 }, after = { x: 2 };
    const patch = adapter.diff(before, after);
    const legacy: api.LegacyPatchBundle = {
      forward: [{ op: 'test', path: '', value: before }, ...patch.forward],
      inverse: [{ op: 'test', path: '', value: after }, ...patch.inverse],
    };
    const invalid: unknown[] = [null, [], {}, { ...patch, version: 2 }, { ...patch, version: '1' },
      { ...patch, algorithm: 'sha384' }, { ...patch, baseHash: 'A'.repeat(64) }, { ...patch, resultHash: '0'.repeat(63) },
      { ...patch, baseHash: 123 }, { ...patch, resultHash: null }, { ...legacy, version: 1 },
      { ...legacy, baseHash: patch.baseHash }, { ...patch, forward: legacy.forward },
      { ...patch, inverse: legacy.inverse }, { ...patch, forward: {} }, { ...patch, inverse: null },
      { ...patch, forward: [{ op: 'replace', path: '/bad~2', value: 1 }] },
      { ...patch, inverse: [{ op: 'replace', path: '/__proto__/polluted', value: 1 }] }];
    for (const key of ['version', 'algorithm', 'baseHash', 'resultHash', 'forward', 'inverse']) {
      const missing = wire(patch) as unknown as Record<string, unknown>; delete missing[key]; invalid.push(missing);
    }
    for (const bad of invalid) for (const verifyBase of [true, false]) {
      assert.throws(() => adapter.applyPatch(before, bad as api.PatchBundle, { verifyBase }), { code: 'InvalidPatch' });
      assert.throws(() => adapter.revertPatch(after, bad as api.PatchBundle, { verifyBase }), { code: 'InvalidPatch' });
    }
    assert.deepEqual(before, { x: 1 }); assert.deepEqual(after, { x: 2 });
    assert.deepEqual(adapter.applyPatch(before, wire(legacy)), after);
    assert.deepEqual(adapter.revertPatch(after, wire(legacy)), before);
    assert.throws(() => adapter.applyPatch({ x: 99 }, legacy), { code: 'PreconditionFailed' });
  });

  test(`${adapter.name}: no-op hashes are guarded and payload size stays constant for a small edit`, () => {
    for (const size of [100_000, 1_000_000]) {
      const before = { unchanged: 'x'.repeat(size), edited: 1 }, after = { ...before, edited: 2 };
      const patch = adapter.diff(before, after);
      assert.ok(Buffer.byteLength(JSON.stringify(patch)) < 700);
      assert.deepEqual(adapter.applyPatch(before, wire(patch)), after);
      assert.deepEqual(adapter.revertPatch(after, wire(patch)), before);
      const noop = adapter.diff(before, before);
      assert.deepEqual(noop.forward, []); assert.deepEqual(noop.inverse, []);
      assert.equal(noop.baseHash, noop.resultHash);
      assert.ok(Buffer.byteLength(JSON.stringify(noop)) < 300);
      assert.deepEqual(adapter.applyPatch(before, noop), before);
      assert.throws(() => adapter.applyPatch(after, noop), { code: 'PreconditionFailed' });
      assert.throws(() => adapter.applyPatch(after, noop, { verifyBase: false }), { code: 'PreconditionFailed' });
    }
  });

  test(`${adapter.name}: hash bundles retain atomic staging and nested immutability`, () => {
    const before = { x: 1, nested: { values: [0] } }, after = { x: 2, nested: { values: [1] } };
    const patch = adapter.diff(before, after);
    const output = adapter.applyPatch(before, patch);
    const reverted = adapter.revertPatch(after, patch);
    frozenTree(output); frozenTree(reverted); frozenTree(patch);
    assert.notEqual((output as typeof after).nested, after.nested);
    assert.throws(() => (output as typeof after).nested.values.push(99), TypeError);
    const bad = { ...patch, forward: [
      { op: 'replace', path: '/x', value: 99 }, { op: 'test', path: '/nested/values/0', value: 999 },
    ] } as api.HashPatchBundle;
    assert.throws(() => adapter.applyPatch(before, bad), { code: 'PreconditionFailed', operationIndex: 1 });
    assert.deepEqual(before, { x: 1, nested: { values: [0] } });
    assert.deepEqual(after, { x: 2, nested: { values: [1] } });
    for (const value of ['\ud800', { '\udfff': 1 }]) {
      assert.throws(() => adapter.diff(value, null), { code: 'InvalidJson' });
      assert.throws(() => adapter.diff(null, value), { code: 'InvalidJson' });
    }
  });

  test(`${adapter.name}: hashes enforce both directions before returning immutable results`, () => {
    const before = { x: 1, untouched: 0 }, after = { x: 2, untouched: 0 };
    const patch = adapter.diff(before, after);
    const stale = { x: 1, untouched: 99 };
    assert.throws(() => adapter.applyPatch(stale, patch), { code: 'PreconditionFailed', message: 'Base document hash mismatch' });
    assert.throws(() => adapter.revertPatch({ ...after, untouched: 99 }, patch), { code: 'PreconditionFailed', message: 'Base document hash mismatch' });
    assert.throws(() => adapter.applyPatch(stale, patch, { verifyBase: false }), { code: 'PreconditionFailed', message: 'Result document hash mismatch' });
    assert.throws(() => adapter.revertPatch({ ...after, untouched: 99 }, patch, { verifyBase: false }), { code: 'PreconditionFailed', message: 'Result document hash mismatch' });
    assert.deepEqual(stale, { x: 1, untouched: 99 });
    for (const [run, doc, field] of [
      [adapter.applyPatch, before, 'forward'], [adapter.revertPatch, after, 'inverse'],
    ] as const) {
      const tampered = JSON.parse(JSON.stringify(patch));
      tampered[field] = [{ op: 'replace', path: '/x', value: 999 }];
      const saved = JSON.stringify([doc, tampered]);
      assert.throws(() => run(doc, tampered), { code: 'PreconditionFailed', message: 'Result document hash mismatch' });
      assert.equal(JSON.stringify([doc, tampered]), saved);
    }
    const output = adapter.applyPatch(before, patch);
    assert.ok(Object.isFrozen(output));
    assert.deepEqual(output, after);
    assert.deepEqual(adapter.applyPatch(before, { ...patch, baseHash: digest('{}') }, { verifyBase: false }), after);
    assert.deepEqual(adapter.revertPatch(after, { ...patch, resultHash: digest('{}') }, { verifyBase: false }), before);
  });

  test(`${adapter.name}: versioned hash bundles carry only deltas and replay after serialization`, () => {
    const before = { x: 1 }, after = { x: 2 };
    const patch = adapter.diff(before, after);
    assert.equal(patch.version, 1);
    assert.equal(patch.algorithm, 'sha256');
    assert.equal(patch.baseHash, digest('{"x":1}'));
    assert.equal(patch.resultHash, digest('{"x":2}'));
    for (const ops of [patch.forward, patch.inverse]) {
      assert.ok(ops.every(op => !(op.op === 'test' && op.path === '')));
    }
    const wire = JSON.parse(JSON.stringify(patch));
    assert.deepEqual(adapter.applyPatch(before, wire), after);
    assert.deepEqual(adapter.revertPatch(after, wire), before);
  });
}
