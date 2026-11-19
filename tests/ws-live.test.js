import { test } from 'node:test';
import assert from 'node:assert/strict';
import { eventsToRecords, planToState } from '../ws/live.js';
import { recordsToState } from '../ws/engine/sheet.js';

const T = '2026-11-19';
const events = [
  { id: 'a', title: '학교', date: T, time: '08:00', end: '16:00', kind: 'event', cat: '', done: false },
  { id: 'b', title: '야자', date: T, time: '16:00', end: '23:00', kind: 'event', cat: '', done: false },
  { id: 'c', title: '수평잡기 함수 396~455번 (백인대장)', date: '2026-11-20', time: null, end: null, kind: 'task', cat: 'academy', done: false },
  { id: 'd', title: '심화아카데미 보고서 제출', date: '2026-11-20', time: null, end: null, kind: 'deadline', cat: 'report', done: false },
  { id: 'e', title: '영어 모고 88문제', date: '2026-11-22', time: null, end: null, kind: 'task', cat: 'academy', done: false },
];

test('Sabathia 일정 → 시트 레코드 → WS 숙제·고정 일정', () => {
  const rec = eventsToRecords(events);
  assert.equal(rec.length, 5);
  assert.equal(rec[2].type, '할 일');
  assert.equal(rec[3].bundle, '보고서 제출');
  const st = recordsToState(rec, T);
  assert.ok(st.fixed.some((f) => f.kind === 'school' && f.date === T));
  assert.ok(!st.fixed.some((f) => f.label === '야자')); // 야자는 숙제 시간
  const hw = st.tasks.find((t) => t.id === 'ev:c');
  assert.equal(hw.g, 'baekin');
  assert.equal(hw.total, 60);
  assert.equal(st.tasks.find((t) => t.id === 'ev:d').g, 'school');
});

test('15577 블록 → WS 블록: 제목이 겹치는 숙제부터 붙이고, 수업은 하루 한 덩어리', () => {
  const st = recordsToState(eventsToRecords(events), T);
  const P = {
    cats: [{ id: 'math', name: '수학' }, { id: 'eng', name: '영어' }],
    days: { [T]: [
      { id: 'b1', title: '수평잡기 함수', cat: 'math', est: 90, dur: 90, start: 17 * 60 },
      { id: 'b2', title: '', cat: 'eng', review: true, dur: 30, start: 19 * 60 },
      { id: 'old', title: '지난 것', cat: 'math', dur: 30, start: 600 },
    ], '2026-11-01': [{ id: 'x', title: '오래된 블록', cat: 'math', dur: 30, start: 600 }] },
    fixed: [
      { id: 'p1', title: '국어', start: 8 * 60 + 20, dur: 50, days: [4], school: true, period: 1 },
      { id: 'p2', title: '수학', start: 9 * 60 + 20, dur: 50, days: [4], school: true, period: 2 },
      { id: 'l', title: '점심', start: 12 * 60 + 10, dur: 60, days: [1, 2, 3, 4, 5], meal: true },
    ],
  };
  const { blocks, fixed } = planToState(P, T, st.tasks);
  assert.equal(blocks.length, 3); // 11/01 블록은 범위 밖
  const b1 = blocks.find((b) => b.id === 'p:b1');
  assert.equal(b1.start, '17:00');
  assert.equal(b1.end, '18:30');
  assert.equal(b1.tasks[0], 'ev:c');
  const b2 = blocks.find((b) => b.id === 'p:b2');
  assert.equal(b2.title, '영어 정리');
  assert.deepEqual(b2.tasks, ['ev:e']);
  const school = fixed.find((f) => f.kind === 'school' && f.date === T);
  assert.deepEqual([school.start, school.end], ['08:20', '10:10']);
  assert.ok(fixed.some((f) => f.kind === 'meal' && f.date === T));
});
