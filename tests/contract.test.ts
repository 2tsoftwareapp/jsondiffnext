import test from 'node:test';
import assert from 'node:assert/strict';
import { adapters } from '../adapters.ts';

for (const adapter of adapters) {
  test(`${adapter.name}: serialized guarded forward/inverse round trip`, () => {
    const before = { user: { age: 20 }, tags: ['js', 'ts'] };
    const after = { user: { age: 21 }, tags: ['js', 'rust'] };
    const patch = adapter.diff(before, after);
    const wire = JSON.parse(JSON.stringify(patch));
    assert.deepEqual(adapter.applyPatch(before, wire), after);
    assert.deepEqual(adapter.revertPatch(after, wire), before);
    assert.throws(() => adapter.applyPatch({ ...before, other: 1 }, wire), { code: 'PreconditionFailed' });
  });
}
