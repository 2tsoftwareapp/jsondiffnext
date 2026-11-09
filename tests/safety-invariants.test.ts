import test from 'node:test';
import assert from 'node:assert/strict';
import { adapter } from '../adapters.ts';
import { canonicalClone, sameJson, scanJson, tokens, validateOperations, SpikeError } from '../core.ts';
import type { PatchBundle, JsonPatchOperation, JsonValue } from '../core.ts';

const wire = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

// ---------------------------------------------------------------- key guards: three layers
test('KEY-GUARDS: JSON_DATA_KEYS — key dữ liệu hợp lệ trong payload không bị cấm oan', () => {
  const a = adapter('fast-json-patch');
  // _t, constructor, prototype, toString là dữ liệu JSON hợp lệ khi nằm trong payload
  const before = { telemetry: { _t: 1, constructor: 'A', prototype: 0, toString: 'x' } };
  const after = { telemetry: { _t: 2, constructor: 'B', prototype: 1, toString: 'y' } };
  a.resetMetrics();
  const bundle = a.diff(before, after);
  const metrics = a.measurements();
  // Không còn bị ép root-replace chỉ vì key dữ liệu
  assert.equal(metrics.fallback, 'native', `expected native diff, got ${metrics.fallback}`);
  assert.deepEqual(a.applyPatch(before, wire(bundle)), wire(after));
  assert.deepEqual(a.revertPatch(after, wire(bundle)), wire(before));
});

test('KEY-GUARDS: BACKEND_RESTRICTIONS — _t chỉ bị giới hạn với jsondiffpatch adapter, không áp dụng cho adapter khác', () => {
  for (const name of ['fast-json-patch', 'rfc6902'] as const) {
    const a = adapter(name);
    const bundle = a.diff({ v: { _t: 1 } }, { v: { _t: 2 } });
    assert.notEqual(a.measurements().fallback, 'special-key-root-replace');
    assert.deepEqual(a.applyPatch({ v: { _t: 1 } }, wire(bundle)), wire({ v: { _t: 2 } }));
  }
});

test('KEY-GUARDS: POLLUTION_GUARDS — pointer ghi nguy hiểm vẫn bị chặn, input và global không đổi', () => {
  const a = adapter('fast-json-patch');
  const before = { safe: 0 };
  for (const path of ['/__proto__/polluted', '/constructor/prototype/polluted']) {
    const bundle = {
      forward: [{ op: 'test', path: '', value: wire(before) }, { op: 'add', path, value: 1 }],
      inverse: [{ op: 'test', path: '', value: wire(before) }],
    } as PatchBundle;
    const snapshot = Object.getOwnPropertyDescriptors(Object.prototype);
    assert.throws(() => a.applyPatch(before, bundle), SpikeError);
    assert.deepEqual(before, { safe: 0 });
    assert.deepEqual(Object.getOwnPropertyDescriptors(Object.prototype), snapshot);
  }
});

// ---------------------------------------------------------------- validator accepts valid RFC 6902 operations
test('RFC6902-COMPAT: copy op hợp lệ được chấp nhận trong bundle', () => {
  const a = adapter('fast-json-patch');
  const doc = { a: { b: 1 } };
  const bundle = {
    forward: [
      { op: 'test', path: '', value: wire(doc) },
      { op: 'copy', from: '/a/b', path: '/a/c', } as unknown as JsonPatchOperation,
    ],
    inverse: [
      { op: 'test', path: '', value: wire({ a: { b: 1, c: 1 } }) },
      { op: 'remove', path: '/a/c' },
    ],
  } as PatchBundle;
  const result = a.applyPatch(doc, bundle);
  assert.deepEqual(result, { a: { b: 1, c: 1 } });
  assert.deepEqual(doc, { a: { b: 1 } });
});

test('RFC6902-COMPAT: pointer trỏ vào key dữ liệu hợp lệ hoạt động end-to-end', () => {
  const a = adapter('fast-json-patch');
  const before = { metrics: { constructor: 1, prototype: 2, toString: 3, valueOf: 4, hasOwnProperty: 5 } };
  const after = { metrics: { constructor: 9, prototype: 8, toString: 7, valueOf: 6, hasOwnProperty: 4 } };
  const bundle = a.diff(before, after);
  assert.deepEqual(a.applyPatch(before, wire(bundle)), wire(after));
  assert.deepEqual(a.revertPatch(after, wire(bundle)), wire(before));
});

// ---------------------------------------------------------------- null-prototype preservation
test('NULL-PROTOTYPE: canonicalClone bảo toàn null-prototype', () => {
  const nullProto = Object.create(null);
  nullProto.key = 'value';
  const cloned = canonicalClone(nullProto);
  assert.equal(Object.getPrototypeOf(cloned), null);
  assert.equal(typeof (cloned as any).toString, 'undefined');
});

test('NULL-PROTOTYPE: sameJson so sánh structural JSON, bất kể prototype', () => {
  const nullProto = Object.create(null);
  nullProto.a = 1;
  assert.equal(sameJson(nullProto, { a: 1 }), true);
  assert.equal(sameJson({ a: 1 }, nullProto), true);
});

test('NULL-PROTOTYPE: null-prototype document đi qua đầy đủ diff/apply/revert', () => {
  const a = adapter('fast-json-patch');
  const before = Object.create(null);
  before.x = 1;
  const after = Object.create(null);
  after.x = 2;
  const bundle = a.diff(before, after);
  const result = a.applyPatch(before, wire(bundle));
  assert.deepEqual(JSON.parse(JSON.stringify(result)), { x: 2 });
  const reverted = a.revertPatch(after, wire(bundle));
  assert.deepEqual(JSON.parse(JSON.stringify(reverted)), { x: 1 });
});

// ---------------------------------------------------------------- apply is always atomic
test('ATOMIC-DEFAULT: API mới không còn option atomic — apply luôn atomic trên staging', () => {
  const a = adapter('fast-json-patch');
  const document = { x: 0, y: { value: 0 } };
  const operations = [
    { op: 'test', path: '', value: wire(document) },
    { op: 'replace', path: '/x', value: 1 },
    { op: 'test', path: '/y/value', value: 999 },
    { op: 'replace', path: '/y/value', value: 2 },
  ];
  const bundle = { forward: wire(operations), inverse: wire(operations) } as PatchBundle;
  // atomic:false bị loại — lỗi giữa chuỗi không đổi document
  assert.throws(() => a.applyPatch(document, bundle, { verifyBase: true } as any), (e: unknown) => {
    assert.ok(e instanceof SpikeError);
    assert.equal((e as SpikeError).code, 'PreconditionFailed');
    return true;
  });
  assert.deepEqual(document, { x: 0, y: { value: 0 } });
});

test('ATOMIC-DEFAULT: verifyBase:false vẫn hoạt động (verifyBase is independent)', () => {
  const a = adapter('fast-json-patch');
  const bundle = a.diff({ x: 1, untouched: 0 }, { x: 2, untouched: 0 });
  const stale = { x: 1, untouched: 99 };
  const output = a.applyPatch(stale, bundle, { verifyBase: false } as any);
  assert.deepEqual(output, { x: 2, untouched: 99 });
  assert.deepEqual(stale, { x: 1, untouched: 99 });
});
