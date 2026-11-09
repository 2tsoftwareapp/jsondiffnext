import test from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import { adapters, SpikeError } from '../adapters.ts';
import type { JsonValue, PatchBundle } from '../adapters.ts';

// Compare observable JSON values: in particular, JSON wire semantics turn -0 into 0.
function wire<T>(value: T): T { return JSON.parse(JSON.stringify(value)) as T; }
function mutateContainers(value: unknown): void {
  if (value === null || typeof value !== 'object') return;
  for (const child of Object.values(value)) mutateContainers(child);
  if (Array.isArray(value)) value.push({ callerMutation: true });
  else Object.defineProperty(value, '__caller_mutation__', { value: ['changed'], configurable: true, writable: true, enumerable: true });
}
function conflict(action: () => unknown): void {
  assert.throws(action, (error: unknown) => error instanceof SpikeError && error.code === 'PreconditionFailed');
}
// Collect failures at the public seam so one bad value does not prevent the
// remaining seeded cases from running. Deterministic safety tests retain the
// minimal regressions found by the initial shrinking run.
function exercise(failures: string[], inputs: unknown[], action: () => void): void {
  try { action(); } catch (error) {
    failures.push(`${fc.stringify(inputs)}: ${error instanceof Error ? error.stack : String(error)}`);
  }
}
function finish(cases: number, failures: string[]): void {
  assert.equal(cases, 300, 'Every seeded case must execute');
  assert.equal(failures.length, 0, `${failures.length}/300 generated cases failed; first three:\n${failures.slice(0, 3).join('\n')}`);
}
const settings = { seed: 20261109, numRuns: 300 };
const json = fc.jsonValue({ maxDepth: 4 });
const keyedEntities = fc.uniqueArray(fc.record({
  id: fc.integer({ min: -20, max: 20 }),
  value: json,
  rank: fc.integer({ min: -100, max: 100 }),
  keep: fc.boolean(),
}), { selector: entity => entity.id, maxLength: 10 });

for (const adapter of adapters) {
  test(`${adapter.name}: seeded JSON root forward/inverse wire round trips (300 cases)`, () => {
    const failures: string[] = [];
    let cases = 0;
    fc.assert(fc.property(json, json, (a, b) => {
      cases++;
      exercise(failures, [a, b], () => {
      const before = a as JsonValue, after = b as JsonValue;
      const originalBefore = structuredClone(before), originalAfter = structuredClone(after);
      const bundle = adapter.diff(before, after);
      const serialized = JSON.stringify(bundle);
      const restored = JSON.parse(serialized) as PatchBundle;
      const applied = adapter.applyPatch(before, restored);
      assert.deepEqual(applied, wire(after));
      assert.deepEqual(adapter.revertPatch(applied, restored), wire(before));
      assert.deepEqual(adapter.revertPatch(after, restored), wire(before));
      assert.deepEqual(adapter.applyPatch(before, restored), wire(after));
      assert.deepEqual(before, originalBefore);
      assert.deepEqual(after, originalAfter);
      assert.equal(JSON.stringify(restored), serialized);
      assert.equal(JSON.stringify(bundle), serialized);
      });
    }), settings);
    finish(cases, failures);
  });

  test(`${adapter.name}: seeded ownership, caller edits and untargeted conflicts (300 cases)`, () => {
    const failures: string[] = [];
    let cases = 0;
    fc.assert(fc.property(json, json, (a, b) => {
      cases++;
      exercise(failures, [a, b], () => {
      const before = { payload: structuredClone(a) as JsonValue, untargeted: 0 };
      const after = { payload: structuredClone(b) as JsonValue, untargeted: 0 };
      const originalBefore = wire(before), originalAfter = wire(after);
      const bundle = adapter.diff(before, after);
      const serialized = JSON.stringify(bundle);
      const restored = wire(bundle);
      const applied = adapter.applyPatch(originalBefore, restored);
      const reverted = adapter.revertPatch(originalAfter, restored);
      mutateContainers(before);
      mutateContainers(after);
      assert.equal(JSON.stringify(bundle), serialized);
      assert.deepEqual(applied, originalAfter);
      assert.deepEqual(reverted, originalBefore);
      mutateContainers(applied);
      mutateContainers(reverted);
      assert.deepEqual(adapter.applyPatch(originalBefore, restored), originalAfter);
      assert.deepEqual(adapter.revertPatch(originalAfter, restored), originalBefore);
      const staleBefore = { ...wire(originalBefore), untargeted: 1 };
      const staleAfter = { ...wire(originalAfter), untargeted: 1 };
      const staleBeforeSnapshot = wire(staleBefore), staleAfterSnapshot = wire(staleAfter);
      conflict(() => adapter.applyPatch(staleBefore, restored));
      conflict(() => adapter.revertPatch(staleAfter, restored));
      assert.deepEqual(staleBefore, staleBeforeSnapshot);
      assert.deepEqual(staleAfter, staleAfterSnapshot);
      assert.equal(JSON.stringify(restored), serialized);
      // A caller may also edit their deserialized patch after use. Earlier results
      // and the original immutable bundle must retain their own snapshots.
      const independent = adapter.applyPatch(originalBefore, restored);
      mutateContainers(restored);
      assert.deepEqual(independent, originalAfter);
      assert.equal(JSON.stringify(bundle), serialized);
      assert.deepEqual(adapter.applyPatch(originalBefore, bundle), originalAfter);
      });
    }), settings);
    finish(cases, failures);
  });

  test(`${adapter.name}: seeded small keyed entity shuffle/edit/insert/delete round trips (300 cases)`, () => {
    const failures: string[] = [];
    let cases = 0;
    fc.assert(fc.property(keyedEntities, entries => {
      cases++;
      exercise(failures, [entries], () => {
      const before = entries.map(entry => ({ id: entry.id, value: entry.value as JsonValue }));
      const after: { id: number | string; value: JsonValue }[] = entries
        .filter(entry => entry.keep)
        .sort((a, b) => a.rank - b.rank || b.id - a.id)
        .map(entry => ({ id: entry.id, value: { edited: true, previous: entry.value as JsonValue } }));
      after.splice(Math.floor(after.length / 2), 0, { id: 'inserted', value: { added: [1, 2] } });
      const beforeSnapshot = structuredClone(before), afterSnapshot = structuredClone(after);
      const bundle = adapter.diff(before, after, { arrays: { mode: 'keyed' } });
      const serialized = JSON.stringify(bundle);
      const restored = wire(bundle);
      const applied = adapter.applyPatch(before, restored);
      assert.deepEqual(applied, wire(after));
      assert.deepEqual(adapter.revertPatch(applied, restored), wire(before));
      mutateContainers(applied);
      assert.deepEqual(adapter.applyPatch(before, restored), wire(after));
      assert.deepEqual(adapter.revertPatch(after, restored), wire(before));
      assert.deepEqual(before, beforeSnapshot);
      assert.deepEqual(after, afterSnapshot);
      assert.equal(JSON.stringify(bundle), serialized);
      assert.equal(JSON.stringify(restored), serialized);
      });
    }), settings);
    finish(cases, failures);
  });
}
