import test from 'node:test';
import assert from 'node:assert/strict';
import { adapters, canonicalHash } from '../index.ts';
import type { JsonValue, JsonPatchOperation, HashPatchBundle, LegacyPatchBundle } from '../index.ts';

function bundle(before: JsonValue, after: JsonValue, forward: JsonPatchOperation[]): HashPatchBundle {
  return {
    version: 1, algorithm: 'sha256', baseHash: canonicalHash(before), resultHash: canonicalHash(after),
    forward, inverse: [{ op: 'replace', path: '', value: before }],
  };
}

for (const adapter of adapters) {
  const cases: { label: string; before: JsonValue; after: JsonValue; from: string; path: string }[] = [
    { label: 'array insertion', before: { items: ['a', 'b'] }, after: { items: ['a', 'a', 'b'] }, from: '/items/0', path: '/items/1' },
    { label: 'array append', before: { items: ['a', 'b'] }, after: { items: ['a', 'b', 'a'] }, from: '/items/0', path: '/items/-' },
    { label: 'array end index', before: { items: ['a', 'b'] }, after: { items: ['a', 'b', 'a'] }, from: '/items/0', path: '/items/2' },
    { label: 'object replacement', before: { a: 1, b: 2 }, after: { a: 1, b: 1 }, from: '/a', path: '/b' },
    { label: 'literal dash member', before: { a: 1 }, after: { a: 1, '-': 1 }, from: '/a', path: '/-' },
    { label: 'root destination', before: { a: null }, after: null, from: '/a', path: '' },
    { label: 'descendant destination', before: { a: { n: 1 } }, after: { a: { n: 1, b: { n: 1 } } }, from: '/a', path: '/a/b' },
  ];
  for (const { label, before, after, from, path } of cases) {
    test(`${adapter.name}: copy uses add semantics for ${label}`, () => {
      const patch = bundle(before, after, [{ op: 'copy', from, path }]);
      const legacy: LegacyPatchBundle = {
        forward: [{ op: 'test', path: '', value: before }, ...patch.forward],
        inverse: [{ op: 'test', path: '', value: after }, ...patch.inverse],
      };
      for (const candidate of [patch, legacy]) {
        const wire = JSON.parse(JSON.stringify(candidate));
        const saved = JSON.stringify([before, after, wire]);
        assert.deepEqual(adapter.applyPatch(before, wire), after);
        assert.deepEqual(adapter.revertPatch(after, wire), before);
        assert.equal(JSON.stringify([before, after, wire]), saved);
      }
    });
  }
  test(`${adapter.name}: copy owns its value before a later source edit`, () => {
    const before = { a: { n: 1 } }, after = { a: { n: 2 }, b: { n: 1 } };
    const patch = bundle(before, after, [
      { op: 'copy', from: '/a', path: '/b' }, { op: 'replace', path: '/a/n', value: 2 },
    ]);
    const legacy: LegacyPatchBundle = {
      forward: [{ op: 'test', path: '', value: before }, ...patch.forward],
      inverse: [{ op: 'test', path: '', value: after }, ...patch.inverse],
    };
    for (const candidate of [patch, legacy]) {
      const wire = JSON.parse(JSON.stringify(candidate));
      const saved = JSON.stringify([before, after, wire]);
      const result = adapter.applyPatch(before, wire);
      assert.deepEqual(result, after);
      assert.notEqual((result as typeof after).a, (result as typeof after).b);
      assert.deepEqual(adapter.revertPatch(after, wire), before);
      assert.equal(JSON.stringify([before, after, wire]), saved);
    }
  });
}
