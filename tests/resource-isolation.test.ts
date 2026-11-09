import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

for (const library of ['jsondiffpatch', 'fast-json-patch', 'rfc6902']) {
  test(`${library}: nested array depth 100 finishes in contained worker`, () => {
    const code = `
      import assert from 'node:assert/strict';
      import { adapter } from './adapters.ts';
      import { fixture } from './fixtures.ts';
      const a = adapter(${JSON.stringify(library)}), f = fixture('deeply-nested-arrays-100');
      const p = a.diff(f.before, f.after);
      assert.deepEqual(a.applyPatch(f.before, p), f.after);
      assert.deepEqual(a.revertPatch(f.after, p), f.before);
      console.log('PASS');
    `;
    const p = spawnSync(process.execPath, ['--input-type=module', '--max-old-space-size=256', '-e', code], {
      cwd: new URL('../', import.meta.url), encoding: 'utf8', timeout: 3000, killSignal: 'SIGKILL',
    });
    assert.equal(p.status, 0, `${p.error ?? p.signal ?? p.stderr}`);
    assert.match(p.stdout, /PASS/);
  });
}
