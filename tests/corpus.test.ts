import test from 'node:test';
import assert from 'node:assert/strict';
import { adapters } from '../adapters.ts';
import { fixtures } from '../fixtures.ts';

for (const source of adapters) {
  for (const f of fixtures()) {
    for (const mode of ['position', 'keyed'] as const) {
      test(`${source.name}: corpus ${f.name}/${mode}`, () => {
        if (f.name === 'duplicate-entities' && mode === 'keyed') {
          assert.throws(() => source.diff(f.before, f.after, { arrays: { mode } }), { code: 'DuplicateIdentity' });
          return;
        }
        const beforeBytes = JSON.stringify(f.before), afterBytes = JSON.stringify(f.after);
        const bundle = JSON.parse(JSON.stringify(source.diff(f.before, f.after, { arrays: { mode } })));
        // Every wire bundle must be consumable by every adapter. This also tests
        // root guards, move ops, escaped paths, and backend-specific test counts.
        for (const target of adapters) {
          assert.deepEqual(target.applyPatch(f.before, bundle), f.after, `${source.name} → ${target.name}`);
          assert.deepEqual(target.revertPatch(f.after, bundle), f.before, `${source.name} → ${target.name}`);
        }
        assert.equal(JSON.stringify(f.before), beforeBytes);
        assert.equal(JSON.stringify(f.after), afterBytes);
      });
    }
  }
}
