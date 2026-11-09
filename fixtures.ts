export interface Fixture {
  name: string;
  before: any;
  after: any;
  options?: any;
}

const names = [
  'small', 'nested-200', 'large-object-5000', 'large-array-2000-sparse',
  'array-insert-delete-500', 'array-move-edit-500', 'mostly-unchanged-500',
  'many-changes-500', 'disjoint-500',
  'probe-small', 'probe-nested', 'probe-escaped-keys', 'probe-array-insert',
  'probe-array-remove', 'probe-array-move-edit', 'probe-array-duplicates',
  'probe-null-vs-absent', 'probe-type-change', 'probe-unchanged',
  'probe-disjoint-array-100', 'probe-deep-100',
  'prepend-500', 'reorder-500', 'duplicate-entities', 'large-equal-20000',
  'adversarial-disjoint-2000', 'deeply-nested-arrays-100', 'dangerous-json-keys',
] as const;

function records(n: number): any[] {
  return Array.from({length: n}, (_, i) => ({id: String(i), value: i, label: 'item-' + i}));
}

function nest(n: number, x: any): any {
  for (let i = 0; i < n; i++) x = {a: x};
  return x;
}

// Mỗi lần gọi dựng dữ liệu mới; không import các harness có ghi file/chạy benchmark.
export function fixtures(): Fixture[] {
  return names.map(name => fixture(name));
}

export function fixture(name: string): Fixture {
  let before: any, after: any;
  switch (name) {
    // Giữ nguyên generator: artifacts/pilot-benchmark.mjs:9–20.
    case 'small':
      before = {user: {name: 'Alice', age: 20}, tags: ['js', 'ts']};
      after = {user: {name: 'Alice', age: 21}, tags: ['js', 'rust']};
      break;
    case 'nested-200':
      before = 1; after = 2;
      for (let i = 0; i < 200; i++) { before = {child: before}; after = {child: after}; }
      break;
    case 'large-object-5000':
      before = Object.fromEntries(Array.from({length: 5000}, (_, i) => ['k' + i, i]));
      after = {...before, k2500: -1};
      break;
    case 'large-array-2000-sparse':
      before = {items: records(2000)};
      after = structuredClone(before); after.items[1000].value = -1;
      break;
    case 'array-insert-delete-500':
      before = {items: records(500)};
      after = {items: records(500).slice(50).concat([{id: 'new', value: -1, label: 'new'}])};
      break;
    case 'array-move-edit-500':
      before = {items: records(500)};
      after = structuredClone(before); after.items.unshift(after.items.pop()); after.items[0].value = -1;
      break;
    case 'mostly-unchanged-500':
      before = {items: records(500), meta: {version: 1}};
      after = structuredClone(before); after.meta.version = 2;
      break;
    case 'many-changes-500':
      before = {items: records(500)};
      after = structuredClone(before);
      for (const x of after.items) x.value = -x.value - 1;
      break;
    case 'disjoint-500':
      before = {items: records(500)};
      after = {items: records(500).map(x => ({...x, id: 'new-' + x.id, value: -1}))};
      break;
    // Giữ nguyên dữ liệu: artifacts/probes.mjs:15–29; prefix tránh đụng tên pilot.
    case 'probe-small':
      before = {x: 1, y: true}; after = {x: 2, z: null}; break;
    case 'probe-nested':
      before = {a: {b: [{c: 1}]}}; after = {a: {b: [{c: 2}, {d: 3}]}}; break;
    case 'probe-escaped-keys':
      before = {'a/b': {'~1': 1}, '': 2}; after = {'a/b': {'~1': 3}, '': 4}; break;
    case 'probe-array-insert':
      before = {a: [1, 2, 3]}; after = {a: [0, 1, 2, 3]}; break;
    case 'probe-array-remove':
      before = {a: [0, 1, 2, 3]}; after = {a: [1, 2]}; break;
    case 'probe-array-move-edit':
      before = {a: [{id: 'a', n: 1}, {id: 'b', n: 2}, {id: 'c', n: 3}]};
      after = {a: [{id: 'c', n: 4}, {id: 'a', n: 1}, {id: 'b', n: 2}]};
      break;
    case 'probe-array-duplicates':
      before = {a: [1, 2, 1, 3]}; after = {a: [1, 3, 1, 2]}; break;
    case 'probe-null-vs-absent':
      before = {x: null, y: 1}; after = {y: null}; break;
    case 'probe-type-change':
      before = {a: [1], b: {x: 1}}; after = {a: {x: 1}, b: [1]}; break;
    case 'probe-unchanged':
      before = {a: [1, 2, {b: true}]}; after = {a: [1, 2, {b: true}]}; break;
    case 'probe-disjoint-array-100':
      before = {a: Array.from({length: 100}, (_, i) => i)};
      after = {a: Array.from({length: 100}, (_, i) => i + 100)};
      break;
    case 'probe-deep-100':
      before = nest(100, 1); after = nest(100, 2); break;
    case 'prepend-500':
      before = {items: records(500)};
      after = {items: [{id: 'new', value: -1, label: 'new'}, ...records(500)]};
      break;
    case 'reorder-500':
      before = {items: records(500)}; after = {items: records(500).reverse()}; break;
    case 'duplicate-entities':
      before = {items: [{id: 'dup', value: 1}, {id: 'dup', value: 2}, {id: 'unique', value: 3}]};
      after = {items: [{id: 'unique', value: 3}, {id: 'dup', value: 4}, {id: 'dup', value: 1}]};
      break;
    case 'large-equal-20000':
      // Repro issue72 hiện tại: artifacts/pain-probes.mjs:40–41.
      before = Array.from({length: 20000}, (_, i) => String(i)); after = before.slice(); break;
    case 'adversarial-disjoint-2000':
      before = {items: records(2000)};
      after = {items: records(2000).map(x => ({...x, id: 'new-' + x.id, value: -1}))};
      break;
    case 'deeply-nested-arrays-100':
      before = 1; after = 2;
      for (let i = 0; i < 100; i++) { before = [before]; after = [after]; }
      break;
    case 'dangerous-json-keys':
      // JSON.parse giữ __proto__ thành own property dữ liệu, không đặt prototype.
      before = JSON.parse('{"__proto__":{"value":1},"constructor":{"prototype":{"value":2}},"prototype":{"value":3}}');
      after = JSON.parse('{"__proto__":{"value":4},"constructor":{"prototype":{"value":5}},"prototype":{"value":6},"added":true}');
      break;
    default:
      throw new Error('Unknown fixture: ' + name);
  }
  return {name, before, after};
}
