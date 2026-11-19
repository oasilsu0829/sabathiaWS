import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as MU from '../ws/must.js';

test('안하면 병신: 추가·체크·날 바뀜', () => {
  let m = MU.normalize(null);
  m = MU.add(m, ' 영단어 50개 ', true, 'a');
  m = MU.add(m, '보고서 메일', false, 'b');
  m = MU.add(m, '   ', true, 'c');
  assert.equal(m.items.length, 2);
  assert.equal(m.items[0].t, '영단어 50개');
  assert.equal(MU.left(m, '2026-11-19').length, 2);
  m = MU.toggle(m, 'a', '2026-11-19');
  m = MU.toggle(m, 'b', '2026-11-19');
  assert.equal(MU.left(m, '2026-11-19').length, 0);
  assert.equal(MU.leaveText(m, '2026-11-19'), null);
  // 다음 날: 매일 항목은 다시 남고, 끝낸 한 번 항목은 사라진다
  const next = MU.rollover(m, '2026-11-20');
  assert.deepEqual(next.items.map((x) => x.id), ['a']);
  assert.equal(MU.left(next, '2026-11-20').length, 1);
  // 안 끝낸 한 번 항목은 남는다
  let k = MU.add(MU.normalize(null), 'x', false, 'x');
  assert.equal(MU.rollover(k, '2026-11-20').items.length, 1);
  k = MU.toggle(k, 'x', '2026-11-19');
  k = MU.toggle(k, 'x', '2026-11-19');
  assert.equal(MU.left(k, '2026-11-19').length, 1);
});

test('나갈 때 알림 문구·간격', () => {
  let m = MU.normalize({ notify: true });
  for (const t of ['a', 'b', 'c', 'd']) m = MU.add(m, t, true, t);
  const tx = MU.leaveText(m, '2026-11-19');
  assert.equal(tx.title, '안하면 병신 · 4개 남음');
  assert.equal(tx.body, 'a · b · c 외 1개');
  assert.equal(MU.shouldPing(m, 1e12), true);
  m.lastPing = 1e12;
  assert.equal(MU.shouldPing(m, 1e12 + 60_000), false);
  assert.equal(MU.shouldPing(m, 1e12 + MU.PING_GAP), true);
  assert.equal(MU.shouldPing({ ...m, notify: false }, 2e12), false);
});
