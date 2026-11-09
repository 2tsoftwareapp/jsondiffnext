import { fork } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, appendFileSync, mkdirSync } from 'node:fs';
import os from 'node:os';
import assert from 'node:assert/strict';
import { adapters, adapter } from './adapters.ts';
import { canonicalClone } from './core.ts';
import { fixture } from './fixtures.ts';
import type { JsonValue } from './core.ts';

const raw = new URL('./raw/', import.meta.url);
mkdirSync(raw, { recursive: true });
const cases = [
  ...['small', 'nested-200', 'large-object-5000', 'large-array-2000-sparse', 'array-insert-delete-500', 'array-move-edit-500', 'mostly-unchanged-500', 'many-changes-500', 'disjoint-500', 'prepend-500', 'reorder-500', 'large-equal-20000', 'adversarial-disjoint-2000', 'deeply-nested-arrays-100', 'dangerous-json-keys'].map(name => ({ name, mode: 'keyed' as const })),
  ...['array-move-edit-500', 'prepend-500', 'reorder-500', 'duplicate-entities'].map(name => ({ name, mode: 'position' as const })),
];
const samples = Number(process.env.SPIKE_SAMPLES ?? 21);
const warmups = 3;
const sourceFiles = ['core.ts', 'adapters.ts', 'fixtures.ts', 'benchmark.ts', 'package-lock.json'];
function sourceHashes(): Record<string, string> {
  return Object.fromEntries(sourceFiles.map(f => [f, createHash('sha256').update(readFileSync(new URL(f, import.meta.url))).digest('hex')]));
}
const startSourceHashes = sourceHashes();
const workerBudgetMs = 20_000;
function hash(x: unknown): string { return createHash('sha256').update(JSON.stringify(x)).digest('hex'); }
function env() { return { node: process.version, platform: process.platform, arch: process.arch, cpu: os.cpus()[0]?.model, memoryBytes: os.totalmem(), versions: process.versions }; }

if (process.argv[2] === 'worker') {
  const [name, caseName, mode] = process.argv.slice(3);
  const a = adapter(name!);
  const f = fixture(caseName!);
  const options = { arrays: { mode: mode as 'position' | 'keyed' } };
  const before = canonicalClone(f.before) as JsonValue, after = canonicalClone(f.after) as JsonValue;
  global.gc?.();
  const initialMemory = process.memoryUsage();
  function cycle() {
    a.resetMetrics();
    const started = performance.now();
    const bundle = a.diff(before, after, options);
    const diffEnd = performance.now();
    const wire = JSON.stringify(bundle);
    const transported = JSON.parse(wire);
    const serializeEnd = performance.now();
    const updated = a.applyPatch(before, transported, { verifyBase: true });
    const applyEnd = performance.now();
    const restored = a.revertPatch(updated, transported, { verifyBase: true });
    const end = performance.now();
    const memory = process.memoryUsage();
    assert.deepEqual(updated, after); assert.deepEqual(restored, before);
    assert.equal(hash(before), inputHashes.before); assert.equal(hash(after), inputHashes.after);
    return {
      diffMs: diffEnd - started, serializationMs: serializeEnd - diffEnd,
      applyMs: applyEnd - serializeEnd, revertMs: end - applyEnd, endToEndMs: end - started,
      bytes: Buffer.byteLength(wire), metrics: a.measurements(), heapUsed: memory.heapUsed, rss: memory.rss,
      forwardOps: bundle.forward.length, inverseOps: bundle.inverse.length,
      patchHash: hash(bundle), correct: true,
    };
  }
  const inputHashes = { before: hash(before), after: hash(after) };
  for (let i = 0; i < warmups; i++) cycle();
  global.gc?.();
  const rows = Array.from({ length: samples }, () => cycle());
  global.gc?.();
  const finalMemory = process.memoryUsage();
  process.send?.({ status: 'PASS', library: name, fixture: caseName, mode, inputHashes,
    inputBytes: Buffer.byteLength(JSON.stringify(before)) + Buffer.byteLength(JSON.stringify(after)),
    rows, initialMemory, finalMemory, peakRSSKiB: process.resourceUsage().maxRSS,
    sampledPeakHeapUsedBytes: Math.max(initialMemory.heapUsed, ...rows.map(r => r.heapUsed), finalMemory.heapUsed),
    workerSourceHashes: startSourceHashes,
    workerSourcesUnchanged: JSON.stringify(startSourceHashes) === JSON.stringify(sourceHashes()),
    deterministicAcrossSamples: new Set(rows.map(r => r.patchHash)).size === 1,
  });
  process.disconnect?.();
} else {
  if (!Number.isSafeInteger(samples) || samples < 3) throw new Error('SPIKE_SAMPLES must be an integer >=3');
  const runId = new Date().toISOString().replace(/[:.]/g, '-');
  const stream = new URL(`benchmark-${runId}.ndjson`, raw);
  writeFileSync(stream, '');
  const results: any[] = [];
  // Rotate the adapter order to reduce systematic ordering/thermal bias.
  for (let i = 0; i < cases.length; i++) {
    const c = cases[i]!;
    for (let k = 0; k < adapters.length; k++) {
      const library = adapters[(k + i) % adapters.length]!.name;
      const result: any = await new Promise(resolve => {
        const p = fork(new URL(import.meta.url), ['worker', library, c.name, c.mode], {
          silent: true, execArgv: ['--expose-gc', '--max-old-space-size=256'],
        });
        let payload: unknown, stderr = '';
        p.on('message', m => { payload = m; });
        p.stderr!.on('data', d => { stderr += d.toString(); });
        p.on('error', e => { stderr += String(e); });
        const timer = setTimeout(() => p.kill('SIGKILL'), workerBudgetMs);
        p.on('exit', (code, signal) => {
          clearTimeout(timer);
          resolve(code === 0 && signal === null && payload ? payload : { status: 'FAIL', library, fixture: c.name, mode: c.mode, exitCode: code, signal, stderr });
        });
      });
      results.push(result); appendFileSync(stream, JSON.stringify(result) + '\n');
    }
    console.log(`Completed ${c.name}/${c.mode}`);
  }
  const endSourceHashes = sourceHashes();
  const sourcesUnchanged = JSON.stringify(startSourceHashes) === JSON.stringify(endSourceHashes)
    && results.every(r => r.status === 'PASS' && r.workerSourcesUnchanged && JSON.stringify(r.workerSourceHashes) === JSON.stringify(startSourceHashes));
  const report = { generatedAt: new Date().toISOString(), runId, kind: 'exploratory-equivalent-safety-end-to-end', environment: env(), samples, warmups,
    workerBudgetMs, oldSpaceLimitMiB: 256, sourceHashes: startSourceHashes, endSourceHashes, sourcesUnchanged,
    contract: { atomic: true, verifyBase: true, immutable: true, fullDocumentGuards: true, inverseGeneration: true, wireStringifyAndParse: true },
    memoryMethod: 'Fresh process per cell; OS maxRSS includes imports, fixture, assertions, warmups, GC, samples. Heap peak is sampled after cycles, not exact live heap peak. All adapter imports are loaded in each worker.',
    results,
  };
  writeFileSync(new URL(`benchmark-${runId}.json`, raw), JSON.stringify(report, null, 2));
  writeFileSync(new URL('benchmark-latest.json', raw), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ runId, cells: results.length, passed: results.filter(r => r.status === 'PASS').length, failures: results.filter(r => r.status !== 'PASS') }, null, 2));
  if (!sourcesUnchanged || results.some(r => r.status !== 'PASS' || !r.deterministicAcrossSamples)) process.exitCode = 1;
}
