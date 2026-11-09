import test from 'node:test';
import assert from 'node:assert/strict';
import { adapters } from '../adapters.ts';
import type { JsonValue, PatchBundle } from '../core.ts';

for (const a of adapters) {
  test(`${a.name}: imported non-root special-key value is rejected consistently`, () => {
    const before = {}, value = JSON.parse('{"__proto__":{"x":1},"safe":2}');
    const after = { x: value };
    const bundle: PatchBundle = {
      forward: [{ op: 'test', path: '', value: before }, { op: 'add', path: '/x', value }],
      inverse: [{ op: 'test', path: '', value: after }, { op: 'remove', path: '/x' }],
    };
    const bytes = JSON.stringify(bundle);
    assert.throws(() => a.applyPatch(before, bundle), { code: 'InvalidPatch' });
    assert.deepEqual(before, {});
    assert.equal(JSON.stringify(bundle), bytes);
    const replacement = a.diff(before, after);
    assert.deepEqual(a.applyPatch(before, replacement), after);
    assert.deepEqual(a.revertPatch(after, replacement), before);
  });

  test(`${a.name}: move destinations resolve after source removal`, () => {
    const cases: [JsonValue, string, string][] = [
      [['a', 'b'], '/0', '/2'],
      [[{ x: [] }, { x: [] }], '/0', '/1/x/-'],
    ];
    for (const [before, from, path] of cases) {
      const bundle: PatchBundle = {
        forward: [{ op: 'test', path: '', value: before }, { op: 'move', from, path }],
        inverse: [{ op: 'test', path: '', value: before }],
      };
      const bytes = JSON.stringify(before), patchBytes = JSON.stringify(bundle);
      assert.throws(() => a.applyPatch(before, bundle), { code: 'PathNotFound' });
      assert.equal(JSON.stringify(before), bytes);
      assert.equal(JSON.stringify(bundle), patchBytes);
    }
    const before = ['a', 'b'];
    for (const path of ['/1', '/-']) {
      const valid: PatchBundle = {
        forward: [{ op: 'test', path: '', value: before }, { op: 'move', from: '/0', path }],
        inverse: [{ op: 'test', path: '', value: ['b', 'a'] }, { op: 'move', from: '/1', path: '/0' }],
      };
      assert.deepEqual(a.applyPatch(before, valid), ['b', 'a']);
      assert.deepEqual(a.revertPatch(['b', 'a'], valid), before);
    }
  });

  test(`${a.name}: imported apply cannot return a document beyond accepted depth`, () => {
    let value: JsonValue = 0;
    for (let i = 0; i < 255; i++) value = { n: value };
    const before = { x: {} }, after = { x: { y: value } };
    const bundle: PatchBundle = {
      forward: [{ op: 'test', path: '', value: before }, { op: 'add', path: '/x/y', value }],
      inverse: [{ op: 'test', path: '', value: after }, { op: 'remove', path: '/x/y' }],
    };
    assert.throws(() => a.applyPatch(before, bundle), { code: 'ResourceLimit' });
    assert.deepEqual(before, { x: {} });
  });
}
