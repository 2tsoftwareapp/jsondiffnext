import { spawnSync } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import assert from 'node:assert/strict';
import { adapters } from './adapters.ts';
import { canonicalClone } from './core.ts';
import type { JsonValue, PatchBundle } from './core.ts';

mkdirSync(new URL('./raw/', import.meta.url), { recursive: true });
// Reuse the exact original repro source, run current pinned environment. No
// research file or its results are modified by this script.
const native = spawnSync(process.execPath, [new URL('./raw/pain-probes.mjs', import.meta.url).pathname], { encoding: 'utf8', timeout: 10_000 });
if (native.status !== 0) throw new Error(`Original native repro failed: ${native.stderr}`);
const nativeResults = JSON.parse(native.stdout);
const wrapperResults = [];
for (const a of adapters) {
  const p1 = a.diff({}, { stages: [] });
  const p2 = a.diff({ stages: [] }, { stages: [{ id: '2' }] });
  const saved = JSON.stringify([p1, p2]);
  const result = a.applyPatch(a.applyPatch({}, p1), p2);
  const replay = a.applyPatch(a.applyPatch({}, p1), p2);
  assert.deepEqual(replay, { stages: [{ id: '2' }] });
  (result as any).stages[0].id = 'caller-change';
  assert.equal(JSON.stringify([p1, p2]), saved);
  const before = Array.from({ length: 20_000 }, (_, i) => String(i));
  const equalPatch = a.diff(before, before.slice());
  assert.deepEqual(a.applyPatch(before, equalPatch), before);
  const arrayBefore = { items: Array.from({ length: 2000 }, (_, i) => i) };
  const arrayAfter = { items: Array.from({ length: 2000 }, (_, i) => 2000 + i) };
  a.resetMetrics();
  const bounded = a.diff(arrayBefore, arrayAfter, { limits: { maxWork: 200_000, maxDepth: 256 } });
  const admission = a.measurements();
  assert.deepEqual(a.applyPatch(arrayBefore, bounded), arrayAfter);
  assert.deepEqual(a.revertPatch(arrayAfter, bounded), arrayBefore);
  const doc: JsonValue = { x: 0, guard: 0, y: 0 };
  const malformed = { forward: [
    { op: 'test', path: '', value: canonicalClone(doc) },
    { op: 'replace', path: '/x', value: 1 },
    { op: 'test', path: '/guard', value: 1 },
    { op: 'replace', path: '/y', value: 2 },
  ], inverse: [{ op: 'test', path: '', value: canonicalClone(doc) }] } as PatchBundle;
  assert.throws(() => a.applyPatch(doc, malformed, { verifyBase: true }), { code: 'PreconditionFailed' });
  assert.deepEqual(doc, { x: 0, guard: 0, y: 0 });
  wrapperResults.push({ library: a.name, historyReplayIndependent: true, historicalBundleUnchanged: true, largeEqual20000: 'PASS', boundedDisjoint2000: 'PASS', admission, atomicLateFailure: 'PASS' });
}
const output = { generatedAt: new Date().toISOString(), node: process.version, nativeSource: '../artifacts/pain-probes.mjs', nativeResults, wrapperResults };
writeFileSync(new URL('./raw/reproductions.json', import.meta.url), JSON.stringify(output, null, 2));
console.log(JSON.stringify(output, null, 2));
