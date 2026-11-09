import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';

const read = (name: string) => JSON.parse(readFileSync(new URL(name, import.meta.url), 'utf8'));
const report = read('./raw/benchmark-latest.json');
for (const [path, expected] of Object.entries(report.sourceHashes)) {
  const actual = createHash('sha256').update(readFileSync(new URL(path, import.meta.url))).digest('hex');
  assert.equal(actual, expected, `Benchmark source changed since measurement: ${path}; rerun benchmark`);
}
const q = (values: number[], p: number): number => {
  const s = values.slice().sort((a, b) => a - b);
  return s[Math.max(0, Math.ceil(p * s.length) - 1)]!;
};
const fmt = (x: number | undefined, digits = 3): string => x === undefined ? '—' : x.toFixed(digits);
const table = (headers: string[], rows: unknown[][]): string => `| ${headers.join(' | ')} |\n| ${headers.map(() => '---').join(' | ')} |\n${rows.map(r => '| ' + r.join(' | ') + ' |').join('\n')}\n`;
const summaries = report.results.map((cell: any) => {
  if (cell.status !== 'PASS') return cell;
  const result: any = {
    status: cell.status, library: cell.library, fixture: cell.fixture, mode: cell.mode,
    inputBytes: cell.inputBytes, samples: cell.rows.length,
    forwardOps: cell.rows[0].forwardOps, inverseOps: cell.rows[0].inverseOps,
    bundleBytes: cell.rows[0].bytes, peakRSSMiB: cell.peakRSSKiB / 1024,
    sampledPeakHeapMiB: cell.sampledPeakHeapUsedBytes / 1024 / 1024,
    retainedHeapMiB: (cell.finalMemory.heapUsed - cell.initialMemory.heapUsed) / 1024 / 1024,
    fallbacks: [...new Set(cell.rows.map((r: any) => r.metrics.fallback))].join(','),
    deterministic: cell.deterministicAcrossSamples,
  };
  for (const field of ['diffMs', 'serializationMs', 'applyMs', 'revertMs', 'endToEndMs']) {
    result[field + 'P50'] = q(cell.rows.map((r: any) => r[field]), .5);
    result[field + 'P95'] = q(cell.rows.map((r: any) => r[field]), .95);
  }
  for (const field of ['clone', 'validation', 'guard', 'nativeDiff', 'nativeApply', 'freeze', 'hash']) {
    result[field + 'MsP50'] = q(cell.rows.map((r: any) => r.metrics.times[field] ?? 0), .5);
  }
  result.hashOfEndToEndPercentP50 = q(cell.rows.map((r: any) =>
    (r.metrics.times.hash ?? 0) / r.endToEndMs * 100), .5);
  result.validationAndGuardsMsP50 = q(cell.rows.map((r: any) => (r.metrics.times.validation ?? 0) + (r.metrics.times.guard ?? 0)), .5);
  result.clonePositiveHeapDeltaMiBP50 = q(cell.rows.map((r: any) => r.metrics.clonePositiveHeapDeltaBytes / 1024 / 1024), .5);
  result.cloneBoundarySampledPeakHeapMiB = Math.max(...cell.rows.map((r: any) => r.metrics.cloneHeapSampleMaxBytes / 1024 / 1024));
  return result;
});
const fields: string[] = [...new Set<string>(summaries.flatMap((r: any) => Object.keys(r)))];
writeFileSync(new URL('./raw/summary.json', import.meta.url), JSON.stringify({ runId: report.runId, summaries }, null, 2));
writeFileSync(new URL('./raw/summary.csv', import.meta.url), fields.map(x => JSON.stringify(x)).join(',') + '\n' + summaries.map((r: any) => fields.map(f => JSON.stringify(r[f] ?? '')).join(',')).join('\n') + '\n');
const passed = summaries.filter((s: any) => s.status === 'PASS');
const failed = summaries.filter((s: any) => s.status !== 'PASS');
const e2e = passed.map((s: any) => [s.fixture + '/' + s.mode, s.library, fmt(s.endToEndMsP50), fmt(s.endToEndMsP95), fmt(s.hashOfEndToEndPercentP50, 1), s.bundleBytes, fmt(s.peakRSSMiB, 1), s.fallbacks]);
const phases = passed.map((s: any) => [s.fixture + '/' + s.mode, s.library, fmt(s.diffMsP50), fmt(s.serializationMsP50), fmt(s.applyMsP50), fmt(s.revertMsP50), fmt(s.hashMsP50), fmt(s.cloneMsP50), fmt(s.validationAndGuardsMsP50)]);
const memory = passed.map((s: any) => [s.fixture + '/' + s.mode, s.library, fmt(s.peakRSSMiB, 1), fmt(s.sampledPeakHeapMiB, 1), fmt(s.cloneBoundarySampledPeakHeapMiB, 1), fmt(s.clonePositiveHeapDeltaMiBP50, 2)]);
let resourceText = 'NOT VERIFIED: chưa có raw/resources.json.';
try {
  const resources = read('./raw/resources.json');
  resourceText = table(['n', 'Adapter', 'Trạng thái', '8-cycle max ms', 'Peak RSS MiB', 'Retained Δ heap MiB', 'Clone-pair p50 ms', 'Clone-pair +heap median MiB', 'Fallback'], resources.results.map((s: any) => s.status === 'PASS' ? [
    s.size, s.library, s.status, fmt(Math.max(...s.samples.map((r: any) => r.ms))), fmt(s.peakRSSKiB / 1024, 1), fmt(s.retainedDeltaBytes / 1024 / 1024, 2), fmt(q(s.cloneRows.map((r: any) => r.ms), .5)), fmt(q(s.cloneRows.map((r: any) => r.positiveHeapDeltaBytes / 1024 / 1024), .5), 2), [...new Set(s.samples.map((r: any) => r.fallback))].join(','),
  ] : [s.size, s.library, 'FAIL', '—', '—', '—', '—', '—', s.signal ?? s.stderr]));
} catch (error) {
  if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
}
const out = `# Kết quả đo wrapper spike\n\nNgày: ${report.generatedAt} · Run: ${report.runId} · JSONDiffNext · Hermes Agent\n\n## Trạng thái và phương pháp\n\n**${failed.length ? 'FAIL' : 'PASS'}:** ${passed.length}/${summaries.length} cell hoàn thành và kiểm tra correctness; failures: ${failed.length}. Mọi cell thành công phải có bundle hash ổn định qua các sample. Đây là số liệu **exploratory** trên một máy/runtime, không là tuyên bố throughput sản phẩm hoặc engine mới.\n\n- Node ${report.environment.node}; ${report.environment.platform}/${report.environment.arch}; CPU ${report.environment.cpu}.\n- Mỗi cell là process mới, ${report.warmups} warmups + ${report.samples} measured cycles; p95 dùng nearest-rank ceil(0.95×N). Với 21 samples, p95 là phần tử thứ 20; không có confidence interval hay process replication cho mỗi cell trong một run.\n- Input fixtures dựng ngoài timer; correctness và hash input chạy ngoài E2E timer. Diff gồm clone/canonicalization, validation, identity, inverse generation, freeze. E2E gồm diff + bundle stringify/parse + apply + revert, bao gồm instrumentation. Guard/atomicity luôn bật. Không so với diff-only pilot cũ để tuyên bố speedup.\n- Thứ tự adapters xoay theo fixture. OS noise/GC/JIT và hoạt động máy có thể ảnh hưởng p95; không cộng các p50 phase để thay p50 E2E.\n- Budget ${report.workerBudgetMs} ms cho **toàn worker**, bao gồm imports, correctness, warmups, cycles. Old-space ${report.oldSpaceLimitMiB} MiB không phải hard RSS cap. Không có cell bị kill được diễn giải thành một operation vượt budget đó.\n- Peak RSS là OS high-water của whole worker, gồm imports, fixture, assertions, warmups, cycles. Cả ba library đều import trong worker. Heap chỉ sampled sau mỗi cycle và clone boundaries, **không phải peak heap chính xác**. Memory time series không chứng minh không có leak.\n- Clone time gồm canonical key sort. +heap là tổng positive delta ở clone boundaries; GC có thể làm thiếu/đếm không chính xác allocation. Clone-pair sweep chỉ đo copy hai snapshots, không phải baseline với safety tương đương.\n- Root-replace fallback giữ nguyên mọi guarantee nhưng có thể tăng đáng kể payload; unchanged có guards-only. Cùng semantics không có nghĩa cùng patch minimization.\n\n## End-to-end và payload\n\n${table(['Fixture/mode', 'Adapter', 'E2E p50 ms', 'E2E p95 ms', 'Hash/E2E p50 %', 'Bundle bytes (forward+inverse+guards)', 'Peak RSS MiB', 'Đường chạy'], e2e)}\n## Phân rã thời gian\n\nĐơn vị ms, mọi cột là median riêng. Validation+guards có scan JSON, schema/path checks và equality. Clone/validation là thành phần **đã nằm trong** các cột diff/apply/revert; không cộng lần nữa.\n\n${table(['Fixture/mode', 'Adapter', 'Diff p50', 'Wire p50', 'Apply p50', 'Revert p50', 'Hash p50', 'Clone p50', 'Validation+guard p50'], phases)}\n## Bộ nhớ quan sát\n\n${table(['Fixture/mode', 'Adapter', 'Peak RSS MiB', 'Cycle sampled peak heap MiB', 'Clone boundary sampled max heap MiB', 'Clone +heap median MiB'], memory)}\n## Resource sweep và isolated clone\n\nRaw: [resources.json](raw/resources.json). maxWork=500.000, maxDepth=256; 8 cycles/cell trên disjoint primitive arrays; process mới/cell. +heap, retained heap và RSS có thể không tăng đơn điệu vì fallback, JIT và GC. Một mẫu/cell chưa đủ chứng minh scaling bound hoặc không có leak.\n\n${resourceText}\n## Failures\n\n${failed.length ? '```json\n' + JSON.stringify(failed, null, 2) + '\n```' : 'Không có failed cell trong run này. Các run trước và test trước sửa được giữ trong raw; kết quả này không xóa lịch sử lỗi.'}\n\n## Truy vết và tái lập\n\n[Raw đầy đủ](raw/benchmark-latest.json), [stream append-only theo run](raw/benchmark-${report.runId}.ndjson), [summary JSON](raw/summary.json), [CSV](raw/summary.csv), [repro](raw/reproductions.json). Hash mã nguồn/dependency lock nằm trong raw; summarize từ chối nếu source khác phiên bản đã đo.\n\nLệnh: \`npm run bench\`, \`node --expose-gc resources.ts\`, \`npm run summarize\`. Hướng dẫn đầy đủ: [REPRODUCE.md](REPRODUCE.md).\n`;
writeFileSync(new URL('./RESULTS.md', import.meta.url), out);
console.log(JSON.stringify({ runId: report.runId, cells: summaries.length, passed: passed.length, failures: failed.length, deterministic: passed.every((s: any) => s.deterministic) }, null, 2));
if (failed.length || passed.some((s: any) => !s.deterministic)) process.exitCode = 1;
