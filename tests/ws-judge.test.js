// Sabathia WS 판단 엔진 테스트
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { judge, lossTxt } from '../ws/engine/judge.js';
import { estimate } from '../ws/engine/estimate.js';
import { sampleState } from '../ws/sample.js';
import { at, MIN } from '../src/engine/time.js';

const D0 = '2026-11-18'; // 수요일
const D1 = '2026-11-19';
const D2 = '2026-11-20';

function mk({ tasks = [], blocks = [], fixed = [], sessions = [] } = {}) {
  return {
    settings: {},
    fixed: [
      ...[D0, D1, D2].map((d, i) => ({ id: 'sc' + i, label: '학교', kind: 'school', date: d, start: '07:00', end: '16:30' })),
      ...fixed,
    ],
    groups: [{ id: 'g', name: '학원', dueTime: '08:00', color: '#fff' }],
    tasks: tasks.map((t, i) => ({ id: 't' + i, g: 'g', kind: 'homework', unit: '문제', done: 0, ...t })),
    blocks,
    sessions,
  };
}
const J = (r, id) => r.tasks.get(id);

test('분량 × 페이스로 남은 시간을 추정하고, 근거가 약할수록 범위를 넓힌다', () => {
  const st = mk({ tasks: [{ total: 83, done: 40, pace: 2.4 }] });
  const e = estimate(st.tasks[0], st);
  assert.equal(e.source, 'prior');
  assert.equal(Math.round(e.exp), 103);
  assert.ok(e.lo < e.exp && e.hi > e.exp * 1.4);

  // 직접 푼 기록이 생기면 기록 쪽으로 이동하고 범위가 좁아진다
  st.sessions = [{ taskId: 't0', start: at(D0, '17:00'), sec: 40 * 3 * 60, units: 40 }];
  const m = estimate(st.tasks[0], st);
  assert.equal(m.source, 'measured');
  assert.ok(m.pace > 2.9 && m.pace < 3, `pace=${m.pace}`);
  assert.ok(m.hi / m.exp < e.hi / e.exp);
});

test('페이스가 없으면 플래너 블록 시간을 믿고, 그것도 없으면 추측하지 않는다', () => {
  const st = mk({
    tasks: [{ title: '국어', total: 24 }, { title: '미정', total: 10 }],
    blocks: [{ id: 'b', date: D0, start: '19:45', end: '20:20', title: '국어', tasks: ['t0'] }],
  });
  const r = judge(st, at(D0, '19:00'));
  assert.equal(J(r, 't0').est.source, 'plan');
  assert.equal(Math.round(J(r, 't0').est.exp), 35);
  assert.equal(J(r, 't0').status, 'ok');
  assert.equal(J(r, 't1').status, 'unknown');
  assert.equal(J(r, 't1').note, null);
  assert.equal(r.mode, 'normal');
});

test('블록 시간은 마감이 빠른 숙제부터 배정하고, 넘치는 숙제는 계획 부족으로 알린다', () => {
  const st = mk({
    tasks: [
      { title: '함수', total: 43, pace: 2.4, due: D2, dueTime: '18:40' },
      { title: '오답', total: 5, pace: 2, due: D1 },
    ],
    blocks: [{ id: 'b', date: D0, start: '20:30', end: '21:15', title: '수학', tasks: ['t0', 't1'] }],
  });
  const r = judge(st, at(D0, '20:00'));
  const a = r.alloc.get('b').alloc;
  assert.equal(a[0].taskId, 't1'); // 내일 마감이 먼저
  assert.equal(Math.round(a[0].min), 10);
  assert.equal(Math.round(a[1].min), 35);
  assert.equal(J(r, 't0').status, 'plan');
  assert.match(J(r, 't0').note, /마감 전 계획 35분 · 약 .+ 더 필요/);
});

test('계획이 모자라도 마감 전 빈 시간이 충분하면 위험 경고를 하지 않는다', () => {
  const st = mk({
    tasks: [{ title: '함수', total: 43, pace: 2.4, due: D2, dueTime: '18:40' }],
    blocks: [{ id: 'b', date: D0, start: '20:30', end: '21:15', title: '수학', tasks: ['t0'] }],
  });
  const r = judge(st, at(D0, '20:00'));
  assert.equal(J(r, 't0').status, 'plan');
  assert.notEqual(J(r, 't0').urgency, 'risk');
  assert.equal(r.mode, 'normal');
  assert.equal(J(r, 't0').mustToday, 0); // 내일 빈 시간으로 미뤄도 됨
});

test('빈 시간을 다 써도 마감 전에 못 끝내면 위험으로 판단하고 부족분을 범위로 말한다', () => {
  // 21:00 기준, 내일 08:00 마감(=오늘 취침 23:20까지 140분)인데 300분 필요
  const st = mk({ tasks: [{ title: '보고서', total: 5, pace: 60, due: D1 }] });
  const r = judge(st, at(D0, '21:00'));
  const j = J(r, 't0');
  assert.equal(j.status, 'risk');
  assert.equal(j.urgency, 'risk');
  assert.equal(r.mode, 'risk');
  assert.equal(Math.round(j.short.exp), 160);
  assert.match(j.note, /남은 시간을 다 써도 마감 전 약 .+ 부족/);
});

test('수면 시간은 절대 쓰지 않는다 — 취침 이후 시간이 있어도 부족분으로 남긴다', () => {
  const st = mk({ tasks: [{ title: '숙제', total: 10, pace: 30, due: D1, dueTime: '07:00' }] });
  const r = judge(st, at(D0, '22:20'));
  // 22:20~23:20 60분만 가능, 300분 필요
  assert.equal(Math.round(J(r, 't0').short.exp), 240);
  assert.ok(J(r, 't0').firstSlot.end <= at(D0, '23:20'));
});

test('비관 시나리오에서만 모자라면 "빠듯할 수 있음"으로 낮춰 말한다', () => {
  // 120분 가능, 예상 100분, 비관 150분
  const st = mk({ tasks: [{ title: '숙제', total: 10, pace: 10, due: D1 }] });
  const r = judge(st, at(D0, '21:20'));
  const j = J(r, 't0');
  assert.equal(j.status, 'tight');
  assert.match(j.note, /오래 걸리면 마감 전 최대 약 30분 부족할 수 있음/);
  assert.equal(r.mode, 'tight');
});

test('내일 아침 마감처럼 미룰 수 없는 분량은 "오늘 꼭 필요"로 계산한다', () => {
  const st = mk({
    tasks: [
      { title: '오답', total: 5, pace: 4, due: D1 },
      { title: '함수', total: 30, pace: 2, due: D2, dueTime: '18:40' },
    ],
  });
  const r = judge(st, at(D0, '19:00'));
  assert.equal(Math.round(J(r, 't0').mustToday), 20);
  assert.equal(J(r, 't1').mustToday, 0);
  assert.equal(Math.round(r.todaySum.mustExtra), 20);
  assert.equal(J(r, 't0').urgency, 'near');
});

test('지금 블록에서는 마감이 빠른 숙제를 먼저 추천한다', () => {
  const st = mk({
    tasks: [
      { title: '독해', total: 6, done: 2, pace: 6, due: D2 },
      { title: '문법', total: 30, done: 12, pace: 1.2, due: D1 },
    ],
    blocks: [{ id: 'b', date: D0, start: '18:52', end: '19:37', title: '영어', tasks: ['t0', 't1'] }],
  });
  const r = judge(st, at(D0, '18:58'));
  assert.equal(r.decision.type, 'block');
  assert.equal(r.decision.taskId, 't1');
  assert.equal(r.decision.delay.level, 'none');
});

test('30분 미루면 마감이 깨지는 경우에만 지금 시작하라고 경고한다', () => {
  // 22:00 블록, 80분 필요, 내일 08:00 마감 → 지금 시작해야 23:20 직전에 끝남
  const st = mk({
    tasks: [{ title: '숙제', total: 8, pace: 10, due: D1 }],
    blocks: [{ id: 'b', date: D0, start: '22:00', end: '23:20', title: '숙제', tasks: ['t0'] }],
  });
  const r = judge(st, at(D0, '22:00'));
  assert.equal(r.decision.type, 'block');
  assert.equal(r.decision.delay.level, 'high');
  assert.match(r.decision.delay.text, /30분 미루면 마감 전 약 15~30분 부족해져요/);
});

test('블록 사이 빈 시간에는 계획이 모자란 숙제를 넣자고 제안한다', () => {
  const st = mk({
    tasks: [{ title: '오답', total: 5, pace: 4, due: D1 }],
    blocks: [{ id: 'b', date: D0, start: '22:00', end: '22:30', title: '영어', tasks: [] }],
  });
  const r = judge(st, at(D0, '21:00'));
  assert.equal(r.decision.type, 'gap');
  assert.equal(r.decision.taskId, 't0');
  assert.equal(Math.round(r.decision.gapMin), 60);
});

test('학원 같은 고정 일정 중에는 공부를 시키지 않고, 취침 후에는 쉬라고 한다', () => {
  const st = mk({
    tasks: [{ title: '숙제', total: 10, pace: 3, due: D2 }],
    fixed: [{ id: 'ac', label: '국어 학원', kind: 'academy', date: D0, start: '19:00', end: '21:30' }],
  });
  assert.equal(judge(st, at(D0, '20:00')).decision.type, 'fixed');
  assert.equal(judge(st, at(D0, '23:40')).decision.type, 'rest');
});

test('마감이 지난 숙제는 지남으로 표시한다', () => {
  const st = mk({ tasks: [{ title: '숙제', total: 10, pace: 3, due: D0, dueTime: '18:00' }] });
  const j = J(judge(st, at(D0, '19:00')), 't0');
  assert.equal(j.status, 'overdue');
  assert.equal(j.urgency, 'risk');
});

test('샘플(초안 화면) — 18:58에는 영어 문법을 먼저, 명제 오답은 오늘 안에 해야 한다고 판단', () => {
  const st = sampleState(D0);
  const r = judge(st, at(D0, '18:58'));
  assert.equal(r.decision.blockId, 'b2');
  assert.equal(r.decision.taskId, 'e1');
  assert.ok(J(r, 'm1').mustToday > 15);
  assert.equal(J(r, 'm2').status, 'plan');
  assert.equal(r.mode, 'normal'); // 마감이 깨지는 숙제는 없음
});

test('범위 표현', () => {
  assert.equal(lossTxt(0, 0, 28), '최대 약 30분');
  assert.equal(lossTxt(20, 30, 45), '약 20~45분');
  assert.equal(lossTxt(40, 55, 70), '약 40분~1시간 10분');
  assert.equal(lossTxt(60, 80, 100), '약 1시간~1시간 40분');
});
