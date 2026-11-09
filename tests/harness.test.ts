import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

for (const file of ['benchmark.ts', 'resources.ts']) {
  test(`${file}: PASS payload cannot hide worker exit 7`, async () => {
    const source = readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
    const start = source.indexOf("p.on('exit', (code, signal) => {");
    assert.ok(start >= 0);
    const bodyStart = source.indexOf('{', start);
    let end = bodyStart + 1, depth = 1;
    for (; depth > 0 && end < source.length; end++) {
      if (source[end] === '{') depth++;
      if (source[end] === '}') depth--;
    }
    const handler = source.slice(start, end) + ');';
    const result: any = await new Promise(resolve => {
      const p = spawn(process.execPath, ['-e', 'process.send({status:"PASS"},()=>process.exit(7))'], { stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
      const context: any = { p, timer: null, clearTimeout, payload: undefined, data: undefined,
        library: 'jsondiffpatch', c: { name: 'small', mode: 'keyed' }, a: { name: 'jsondiffpatch' }, n: 2000, stderr: '', resolve };
      p.on('message', m => { context.payload = m; context.data = m; });
      vm.runInNewContext(handler, context);
    });
    assert.equal(result.status, 'FAIL');
    assert.equal(result.exitCode ?? result.code, 7);
  });
}
