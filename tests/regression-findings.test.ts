import test from 'node:test';
import assert from 'node:assert/strict';
import { adapter } from '../adapters.ts';
import { canonicalClone, SpikeError } from '../core.ts';
import type { PatchBundle } from '../core.ts';

test('NULL-PROTOTYPE: canonicalClone preserves prototype identity: canonicalClone preserves null-prototype dictionaries', () => {
  const nullProtoObj = Object.create(null);
  nullProtoObj.key = 'value';
  assert.equal(Object.getPrototypeOf(nullProtoObj), null);
  assert.equal(typeof (nullProtoObj as any).toString, 'undefined');

  const cloned = canonicalClone(nullProtoObj);
  // Prototype identity survives the clone
  assert.equal(Object.getPrototypeOf(cloned), null);
  assert.equal(typeof (cloned as any).toString, 'undefined');
});

test('KEY-GUARDS: data keys do not force root replacement for compatible backends: data keys no longer force root-replacement; per-adapter guards only', () => {
  const a = adapter('fast-json-patch');
  // _t is a common timestamp or telemetry abbreviation in JSON APIs
  const before = { telemetry: { cpu: 10, _t: 1731135000000 } };
  const after = { telemetry: { cpu: 20, _t: 1731135000001 } };

  a.resetMetrics();
  const diff = a.diff(before, after);
  const metrics = a.measurements();

  // Fine-grained native diff is used; _t stays plain payload data
  assert.equal(metrics.fallback, 'native');
  assert.equal(diff.forward[1]?.op, 'test');
  assert.equal(diff.forward[2]?.op, 'replace');
});

test('KEY-GUARDS: nested payload allows safe data keys for compatible backends: guard scope narrowed to per-adapter restrictions and write channels', () => {
  const a = adapter('fast-json-patch');
  const doc = { metrics: { cpu: 10 } };
  // fast-json-patch has no backend restrictions beyond __proto__: `_t` in a
  // nested patch value is now accepted (key guards scope).
  const incomingPatch: PatchBundle = {
    forward: [
      { op: 'test', path: '', value: doc },
      { op: 'add', path: '/metrics/timestamp', value: { _t: 12345 } as any }
    ],
    inverse: [
      { op: 'test', path: '', value: { metrics: { cpu: 10, timestamp: { _t: 12345 } } } as any },
      { op: 'remove', path: '/metrics/timestamp' }
    ]
  };

  const result = a.applyPatch(doc, incomingPatch);
  assert.deepEqual(result, { metrics: { cpu: 10, timestamp: { _t: 12345 } } });
  assert.deepEqual(doc, { metrics: { cpu: 10 } });
});

test('CUBIC-THRESHOLD: rfc6902 adapter cubic admission threshold abandons native diff for moderate arrays (>250 items)', () => {
  const a = adapter('rfc6902');
  const n = 300;
  const before = { items: Array.from({ length: n }, (_, i) => ({ id: String(i), val: i })) };
  const after = { items: Array.from({ length: n }, (_, i) => ({ id: String(i), val: i === 0 ? 999 : i })) };

  a.resetMetrics();
  const diff = a.diff(before, after, { arrays: { mode: 'keyed' } });
  const metrics = a.measurements();

  // 300 items is sufficient to trigger cubic work penalty > 20_000_000 default maxWork
  assert.equal(metrics.fallback, 'native-admission-root-replace');
  assert.equal(diff.forward[1]?.path, '');
  assert.equal(diff.forward[1]?.op, 'replace');
});

test('BUNDLE-BLOAT: Mandatory root test guard bloats bundle and root-replace doubles wire payload', () => {
  const jdpAdapter = adapter('jsondiffpatch');
  const rfcAdapter = adapter('rfc6902');
  const n = 500;
  const before = { items: Array.from({ length: n }, (_, i) => ({ id: String(i), val: i })) };
  const after = { items: Array.from({ length: n }, (_, i) => ({ id: String(i), val: i === 0 ? 999 : i })) };

  const jdpPatch = jdpAdapter.diff(before, after, { arrays: { mode: 'keyed' } });
  const rfcPatch = rfcAdapter.diff(before, after, { arrays: { mode: 'keyed' } });

  const jdpBytes = Buffer.byteLength(JSON.stringify(jdpPatch));
  const rfcBytes = Buffer.byteLength(JSON.stringify(rfcPatch));

  // Even with a fine-grained 1-field modification, jdp patch is > 22 KB because of root test operations in forward & inverse
  assert.ok(jdpBytes > 20000, `Expected root-test bloat, got ${jdpBytes} bytes`);
  // rfc6902 triggers root-replace fallback, replacing entire root in forward & inverse, doubling the bundle size to ~45 KB
  assert.ok(rfcBytes > 40000, `Expected double-payload root-replace, got ${rfcBytes} bytes`);
  assert.ok(rfcBytes > jdpBytes * 1.8, 'Root-replace fallback must be roughly ~2x native fine-grained bundle');
});

test('IMMUTABLE-STAGING: atomic: false does not mutate target in-place; enforces immutable staging clone', () => {
  const a = adapter('fast-json-patch');
  const document = { counter: 1 };
  const patch = a.diff(document, { counter: 2 });

  const result = a.applyPatch(document, patch, { verifyBase: true });
  assert.equal((result as any).counter, 2);
  // Input document is still unchanged (wrapper is strictly non-mutating)
  assert.equal(document.counter, 1);
});
