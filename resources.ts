import { fork } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { adapters, adapter } from './adapters.ts';
import { canonicalClone } from './core.ts';

const sourceHashes = () => Object.fromEntries(['core.ts', 'adapters.ts', 'resources.ts', 'package-lock.json'].map(f => [f, createHash('sha256').update(readFileSync(new URL(f, import.meta.url))).digest('hex')]));
const startSourceHashes = sourceHashes();
mkdirSync(new URL('./raw/', import.meta.url), { recursive: true });
if (process.argv[2] === 'worker') {
  const name = process.argv[3]!, n = Number(process.argv[4]);
  const a = adapter(name);
  const before = { items: Array.from({ length: n }, (_, i) => i) };
  const after = { items: Array.from({ length: n }, (_, i) => n + i) };
  const options = { limits: { maxWork: 500_000, maxDepth: 256 } };
  const samples: any[] = [];
  global.gc?.();
  const initialHeap = process.memoryUsage().heapUsed;
  for (let i = 0; i < 8; i++) {
    const start = performance.now();
    const p = a.diff(before, after, options);
    const fallback = a.measurements().fallback;
    const wire = JSON.parse(JSON.stringify(p));
    assert.deepEqual(a.applyPatch(before, wire), after);
    assert.deepEqual(a.revertPatch(after, wire), before);
    samples.push({ ms: performance.now() - start, fallback, bytes: Buffer.byteLength(JSON.stringify(p)) });
  }
  global.gc?.();
  const postGcHeap = process.memoryUsage().heapUsed;
  const cloneRows: any[] = [];
  for (let i = 0; i < 21; i++) {
    const heapBefore = process.memoryUsage().heapUsed, start = performance.now();
    const pair = [canonicalClone(before), canonicalClone(after)];
    const ms = performance.now() - start, heapAfter = process.memoryUsage().heapUsed;
    assert.equal(pair[0]!.items.length, n);
    cloneRows.push({ ms, positiveHeapDeltaBytes: Math.max(0, heapAfter - heapBefore) });
  }
  process.send?.({ status: 'PASS', workerSourceHashes: startSourceHashes, workerSourcesUnchanged: JSON.stringify(startSourceHashes) === JSON.stringify(sourceHashes()), library: name, size: n, initialHeap, postGcHeap, retainedDeltaBytes: postGcHeap - initialHeap, peakRSSKiB: process.resourceUsage().maxRSS, samples, cloneRows });
  process.disconnect?.();
} else {
  const results: any[] = [];
  for (const n of [2000, 10_000, 20_000]) {
    for (const a of adapters) {
      const result = await new Promise(resolve => {
        const p = fork(new URL(import.meta.url), ['worker', a.name, String(n)], { silent: true, execArgv: ['--expose-gc', '--max-old-space-size=256'] });
        let data: unknown, stderr = '';
        p.on('message', d => { data = d; }); p.stderr!.on('data', d => { stderr += d; });
        const timer = setTimeout(() => p.kill('SIGKILL'), 20_000);
        p.on('exit', (code, signal) => { clearTimeout(timer); resolve(code === 0 && signal === null && data ? data : { status: 'FAIL', library: a.name, size: n, code, signal, stderr }); });
      });
      results.push(result);
    }
    console.log(`Resource sweep ${n}`);
  }
  const sourcesUnchanged = JSON.stringify(startSourceHashes) === JSON.stringify(sourceHashes())
    && results.every(r => r.status === 'PASS' && r.workerSourcesUnchanged && JSON.stringify(r.workerSourceHashes) === JSON.stringify(startSourceHashes));
  const report = { generatedAt: new Date().toISOString(), node: process.version, sourceHashes: startSourceHashes, sourcesUnchanged, limits: { maxWork: 500_000, maxDepth: 256 }, heapOldSpaceLimitMiB: 256, workerBudgetMs: 20_000, note: 'Eight cycles per cell; retained heap and positive clone heap deltas are observational, not leak proof or exact allocations. Clone timing is isolated copy of two snapshots only, not a different safety baseline.', results };
  writeFileSync(new URL(`./raw/resources-${report.generatedAt.replace(/[:.]/g, '-')}.json`, import.meta.url), JSON.stringify(report, null, 2));
  writeFileSync(new URL('./raw/resources.json', import.meta.url), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(results.map(({ library, size, status, retainedDeltaBytes, peakRSSKiB, ...rest }) => ({ library, size, status, retainedDeltaBytes, peakRSSKiB, error: rest.stderr })), null, 2));
  if (!sourcesUnchanged || results.some(r => r.status !== 'PASS')) process.exitCode = 1;
}
