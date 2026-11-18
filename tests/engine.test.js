// §11 개발 완료 판단 기준을 그대로 옮긴 테스트.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decide } from '../src/engine/decide.js';
import { makeTask, parsePlannerText, estimateOf, remainingOf } from '../src/engine/planner.js';
import { DEFAULT_SETTINGS } from '../src/engine/config.js';
import { at, MIN } from '../src/engine/time.js';

// 2026-11-18은 수요일
const WED = '2026-11-18';
const THU = '2026-11-19';

function baseState(extra = {}) {
  return {
    settings: structuredClone({ ...DEFAULT_SETTINGS, ...(extra.settings ?? {}) }),
    fixed: [
      { id: 'school', label: '학교', kind: 'school', weekdays: [1, 2, 3, 4, 5], start: '08:00', end: '16:30' },
      { id: 'dinner', label: '저녁', kind: 'meal', weekdays: [0, 1, 2, 3, 4, 5, 6], start: '18:00', end: '18:40' },
      ...(extra.fixed ?? []),
    ],
    tasks: extra.tasks ?? [],
  };
}

const inSleep = (ms) => {
  const d = new Date(ms);
  const m = d.getHours() * 60 + d.getMinutes();
  return m > 23 * 60 + 30 || m < 7 * 60;
};

test('플래너에 수학 숙제를 2시간 배치하면 예상 시간 120분으로 읽는다', () => {
  const [t] = parsePlannerText('19:00-21:00 수학 숙제', WED);
  assert.equal(t.subject, 'math');
  assert.equal(t.kind, 'homework');
  assert.equal(estimateOf(t), 120);
  assert.equal(remainingOf(t), 120);
});

test('내일 마감 숙제를 미뤄도 내일 시간이 충분하면 과장된 손실 경고를 표시하지 않는다', () => {
  // 오늘은 학원 때문에 21:30~23:30 (120분)만 비어 있고 숙제도 딱 120분 → 30분 미루면 일부가 내일로 넘어간다
  const state = baseState({
    fixed: [{ id: 'aca', label: '학원', kind: 'academy', weekdays: [3], start: '18:40', end: '21:30' }],
    tasks: [makeTask({ title: '수학 숙제', date: WED, start: '21:30', end: '23:30', deadline: THU })],
  });
  const r = decide(state, at(WED, '21:30'));
  assert.equal(r.delay.severity, 'none');
  assert.notEqual(r.mode, 'risk');
  assert.ok(!['delay', 'deadline'].includes(r.card.type), `card=${r.card.type}`);
  // 정보로서 "일부가 내일로 이동"은 기록하지만 경고는 아니다
  assert.ok(r.delay.pushed.length >= 1);
});

test('실제 위험이 있으면 지연 경고를 범위로 표시한다', () => {
  const state = baseState({
    tasks: [
      makeTask({ title: '수학 숙제', date: WED, start: '21:00', end: '23:00', deadline: WED }),
      makeTask({ title: '수학 복습', date: WED, start: '23:00', end: '23:30' }),
    ],
  });
  const r = decide(state, at(WED, '21:00'));
  assert.ok(['medium', 'high'].includes(r.delay.severity));
  assert.equal(r.mode, 'risk');
  assert.ok(/약 \d+(~\d+)?분/.test(r.card.message), r.card.message);
});

test('국어 숙제에 40분이 더 필요하면 이후 일정을 다시 계산한다', () => {
  const ko = makeTask({ title: '국어 숙제', date: WED, start: '19:00', end: '20:00' });
  const en = makeTask({ title: '영어 단어', date: WED, start: '20:00', end: '20:30' });
  const before = decide(baseState({ tasks: [ko, en] }), at(WED, '19:00'));
  const enStartBefore = before.timelineToday.find((p) => p.taskId === en.id).start;

  const after = decide(baseState({ tasks: [{ ...ko, remainingMin: 100 }, en] }), at(WED, '19:00'));
  const enStartAfter = after.timelineToday.find((p) => p.taskId === en.id).start;
  assert.equal((enStartAfter - enStartBefore) / MIN, 40);
  assert.equal(Math.round(after.today_.work.exp - before.today_.work.exp), 40);
});

test('숙제가 아무리 많아도 수면 시간을 침범하도록 추천하지 않는다', () => {
  const tasks = ['수학', '국어', '영어', '과학'].map((s) =>
    makeTask({ title: `${s} 숙제`, date: WED, estimateMin: 150, deadline: THU, deadlineTime: '08:00' }),
  );
  const r = decide(baseState({ tasks }), at(WED, '19:00'));
  for (const sc of Object.values(r.scenarios)) {
    for (const p of sc.base.timeline) {
      assert.ok(!inSleep(p.start) && !inSleep(p.end - 1), `배치가 수면 시간에 있음: ${new Date(p.start)}`);
    }
  }
  assert.equal(r.card.type, 'deadline'); // 실현 불가능한 계획은 정상 계획으로 보이지 않는다
  assert.match(r.card.message, /수면 시간을 줄이는 계획은 추천하지 않아/);
});

test('시험 D-21 이후에는 시험 대비가 장기 프로젝트보다 우선한다', () => {
  const tasks = [
    makeTask({ title: '학습 시스템 개선', kind: 'project', estimateMin: 90, value: 3, usage: 3 }),
    makeTask({ title: '영어 시험 공부', kind: 'exam_prep', estimateMin: 90 }),
  ];
  const exam = { id: 'e', name: '기말고사', date: '2026-12-09', subjects: [] }; // D-21
  const r = decide(baseState({ tasks, settings: { exams: [exam] } }), at(WED, '19:00'));
  assert.equal(r.exam.active, true);
  assert.equal(r.mode, 'exam');
  assert.notEqual(r.card.type, 'project');
  const tl = r.scenarios.exp.base.timeline;
  assert.ok(tl.some((p) => p.taskId === tasks[1].id)); // 시험 공부는 배치
  assert.ok(!tl.some((p) => p.taskId === tasks[0].id)); // 무관한 프로젝트는 보류

  // D-22에는 평상시 → 여유가 있으면 프로젝트 카드
  const r2 = decide(
    baseState({ tasks, settings: { exams: [{ ...exam, date: '2026-12-10' }] } }),
    at(WED, '19:00'),
  );
  assert.equal(r2.exam.active, false);
  assert.equal(r2.card.type, 'project');
});

test('숙제 위험이 해소되면 손실 경고 대신 현재 유용한 작업을 보여준다', () => {
  const hw = makeTask({ title: '수학 숙제', date: WED, estimateMin: 400, deadline: WED });
  const proj = makeTask({ title: '학습 시스템 개선', kind: 'project', estimateMin: 60 });
  const risky = decide(baseState({ tasks: [hw, proj] }), at(WED, '19:00'));
  assert.equal(risky.card.type, 'deadline');

  const resolved = decide(baseState({ tasks: [{ ...hw, status: 'done' }, proj] }), at(WED, '19:00'));
  assert.notEqual(resolved.mode, 'risk');
  assert.equal(resolved.card.type, 'project');
});

test('진행 상태가 불분명하면 실제로 공부 중인지 임의로 추측하지 않는다', () => {
  const t = makeTask({ title: '수학 숙제', date: WED, start: '19:00', end: '21:00' });
  const r = decide(baseState({ tasks: [t] }), at(WED, '20:15'));
  assert.equal(r.plannedNow.id, t.id);
  assert.equal(r.plannedNow.status, 'todo'); // 상태를 바꾸지 않는다
  assert.equal(remainingOf(r.plannedNow), 120); // 경과 시간을 차감하지 않는다
  assert.equal(Math.round(r.today_.work.exp), 120);
});

test('취침까지 150분, 숙제 120분 + 복습 60분 → 숙제 120분 + 복습 30분', () => {
  const hw = makeTask({ title: '수학 숙제', date: WED, start: '21:00', end: '23:00', deadline: THU });
  const rv = makeTask({ title: '수학 복습', date: WED, estimateMin: 60 });
  const r = decide(baseState({ tasks: [rv, hw] }), at(WED, '21:00'));
  const minsToday = (id) =>
    r.timelineToday.filter((p) => p.taskId === id).reduce((s, p) => s + (p.end - p.start) / MIN, 0);
  assert.equal(minsToday(hw.id), 120);
  assert.equal(minsToday(rv.id), 30);
  assert.equal(r.timelineToday[0].taskId, hw.id);
});

test('시험 직전에는 마감이 안전한 범위에서 복습이 숙제보다 앞설 수 있다', () => {
  const hw = makeTask({ title: '영어 숙제', date: WED, estimateMin: 60, deadline: '2026-11-21' });
  const rv = makeTask({ title: '수학 오답 복습', date: WED, estimateMin: 60 });
  const exam = { id: 'e', name: '기말고사', date: '2026-11-23', subjects: ['math'] }; // D-5
  const r = decide(baseState({ tasks: [hw, rv], settings: { exams: [exam] } }), at(WED, '19:00'));
  assert.equal(r.timelineToday[0].taskId, rv.id);
  assert.equal(r.risks.exp.length, 0);
});

test('고정 일정과 겹치는 시간에는 배치하지 않는다', () => {
  const t = makeTask({ title: '과학 숙제', date: WED, estimateMin: 60 });
  const r = decide(baseState({ tasks: [t] }), at(WED, '17:30'));
  for (const p of r.timelineToday) {
    const overlapsDinner = p.start < at(WED, '18:40') && p.end > at(WED, '18:00');
    assert.ok(!overlapsDinner);
  }
});

test('자정 이후 취침도 처리한다', () => {
  const settings = { days: DEFAULT_SETTINGS.days.map(() => ({ wake: '07:00', sleep: '00:30' })) };
  const t = makeTask({ title: '국어 숙제', date: WED, estimateMin: 60 });
  const r = decide(baseState({ tasks: [t], settings }), at(THU, '00:05'));
  assert.equal(r.today, WED); // 아직 안 잤으므로 수요일의 연장
  assert.equal(r.sleeping, false);
  assert.ok(r.today_.freeMin <= 25);
});

test('여유가 없을 때는 마감 없는 지난 계획보다 오늘 마감 작업을 먼저 추천한다', () => {
  const math = makeTask({ title: '수학 숙제', date: WED, start: '21:00', end: '23:00', deadline: WED });
  const ko = makeTask({ title: '국어 숙제', date: WED, start: '19:00', end: '20:00' });
  const r = decide(baseState({ tasks: [ko, math] }), at(WED, '21:00'));
  assert.equal(r.timelineToday[0].taskId, math.id);
  assert.equal(r.next.taskId, math.id);
});

test('시험 집중 모드에서는 시험과 무관한 프로젝트를 배치하지 않는다', () => {
  const proj = makeTask({ title: '학습 시스템 개선', kind: 'project', estimateMin: 60 });
  const tool = makeTask({ title: '영어 단어 암기 아티팩트', kind: 'project', estimateMin: 25, examRelated: true });
  const exam = { id: 'e', name: '기말고사', date: '2026-12-01', subjects: [] };
  const r = decide(baseState({ tasks: [proj, tool], settings: { exams: [exam] } }), at(WED, '19:00'));
  assert.ok(r.held.some((t) => t.id === proj.id));
  assert.ok(!r.scenarios.exp.base.timeline.some((p) => p.taskId === proj.id));
  assert.ok(r.timelineToday.some((p) => p.taskId === tool.id)); // 시험 대비 도구 제작은 허용
});
