import test from 'node:test';
import assert from 'node:assert/strict';
import {
  diff,
  applyPatch,
  revertPatch,
  adapter,
  DEFAULT_ENGINE,
  SpikeError,
} from '../index.ts';

test('top-level diff defaults to fast-json-patch engine', () => {
  assert.equal(DEFAULT_ENGINE, 'fast-json-patch');
  const a = adapter();
  assert.equal(a.name, 'fast-json-patch');

  const before = { value: 1 };
  const after = { value: 2 };
  const bundle = diff(before, after);

  assert.equal(bundle.version, 1);
  assert.ok(bundle.forward.every(op => !(op.op === 'test' && op.path === '')));
  const result = applyPatch(before, bundle);
  assert.deepEqual(result, after);
  assert.deepEqual(before, { value: 1 });

  const reverted = revertPatch(after, bundle);
  assert.deepEqual(reverted, before);
});

test('top-level diff accepts explicit engine option', () => {
  const before = { x: 1 };
  const after = { x: 2 };
  const bundle = diff(before, after, { engine: 'jsondiffpatch' });
  const applied = applyPatch(before, bundle, { engine: 'jsondiffpatch' });
  assert.deepEqual(applied, after);
});

test('adapter() rejects unknown engine name', () => {
  assert.throws(
    () => adapter('non-existent' as any),
    (err: unknown) => {
      assert.ok(err instanceof SpikeError);
      assert.equal((err as SpikeError).code, 'InvalidOptions');
      return true;
    }
  );
});

test('rfc6902 records diagnostics on cubic admission fallback', () => {
  const a = adapter('rfc6902');
  const n = 300;
  const before = { items: Array.from({ length: n }, (_, i) => ({ id: String(i), val: i })) };
  const after = { items: Array.from({ length: n }, (_, i) => ({ id: String(i), val: i === 0 ? 999 : i })) };

  a.resetMetrics();
  a.diff(before, after, { arrays: { mode: 'keyed' } });
  const metrics = a.measurements();

  assert.equal(metrics.fallback, 'native-admission-root-replace');
  assert.ok(Array.isArray(metrics.diagnostics));
  assert.ok(metrics.diagnostics.length > 0);
  assert.match(metrics.diagnostics[0]!, /rfc6902 cubic array diff exceeded admission budget/);
});

test('rfc6902 records diagnostics on nested arrays fallback', () => {
  const a = adapter('rfc6902');
  const before = { grid: [[1, 2], [3, 4]] };
  const after = { grid: [[1, 9], [3, 4]] };

  a.resetMetrics();
  a.diff(before, after);
  const metrics = a.measurements();

  assert.equal(metrics.fallback, 'nested-arrays-root-replace');
  assert.ok(Array.isArray(metrics.diagnostics));
  assert.match(metrics.diagnostics[0]!, /rfc6902 does not safely diff nested arrays/);
});
