import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parsePlannerText, adaptExternalTasks, detectKind, detectSubject, blockMinutes } from '../src/engine/planner.js';

test('과목·종류 자동 인식', () => {
  assert.equal(detectSubject('쎈 수학 B단계'), 'math');
  assert.equal(detectSubject('영단어 Day 12'), 'english');
  assert.equal(detectKind('국어 수행평가 보고서'), 'performance');
  assert.equal(detectKind('수학 오답 정리'), 'review');
  assert.equal(detectKind('영어 단어'), 'homework');
  assert.equal(detectKind('기말 기출 풀이'), 'exam_prep');
  assert.equal(detectKind('Sabathia 프로젝트'), 'project');
});

test('자정을 넘는 블록', () => {
  assert.equal(blockMinutes('23:00', '00:30'), 90);
});

test('여러 날짜·마감·완료 표시가 섞인 플래너 텍스트', () => {
  const text = `
11/18 (수)
19:00-21:00 수학 숙제
[x] 21~22 국어 숙제
22:00–22:30 영어 단어 마감 11/20
11/19
수학 오답 정리 40분
7시30분~8시 과학 숙제 내일까지
메모만 있는 줄
`;
  const tasks = parsePlannerText(text, '2026-11-18');
  assert.equal(tasks.length, 5);
  assert.deepEqual(
    tasks.map((t) => [t.date, t.start, t.end, t.estimateMin, t.status]),
    [
      ['2026-11-18', '19:00', '21:00', null, 'todo'],
      ['2026-11-18', '21:00', '22:00', null, 'done'],
      ['2026-11-18', '22:00', '22:30', null, 'todo'],
      ['2026-11-19', null, null, 40, 'todo'],
      ['2026-11-19', '07:30', '08:00', null, 'todo'],
    ],
  );
  assert.equal(tasks[2].deadline, '2026-11-20');
  assert.equal(tasks[2].title, '영어 단어');
  assert.equal(tasks[3].kind, 'review');
  assert.equal(tasks[4].deadline, '2026-11-20');
});

test('연말 → 연초 날짜 추론', () => {
  const [t] = parsePlannerText('1/3\n19:00-20:00 수학 숙제', '2026-12-30');
  assert.equal(t.date, '2027-01-03');
});

test('외부 JSON 어댑터 (키 별칭 허용)', () => {
  const tasks = adaptExternalTasks({
    items: [
      { name: '수학 숙제', startTime: '2026-11-18T19:00:00', endTime: '2026-11-18T21:00:00', completed: true },
      { title: '국어 숙제', date: '2026/11/18', start: '21:00', end: '22:00', due: '2026-11-19' },
      { nothing: true },
    ],
  });
  assert.equal(tasks.length, 2);
  assert.equal(tasks[0].date, '2026-11-18');
  assert.equal(tasks[0].start, '19:00');
  assert.equal(tasks[0].status, 'done');
  assert.equal(tasks[1].deadline, '2026-11-19');
});
