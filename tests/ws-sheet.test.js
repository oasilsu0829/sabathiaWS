// "Sabathia 일정" 시트 → WS 상태 변환 테스트 (가상의 행)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCSV, rowsToRecords, recordsToState, parseAmount, csvUrlOf } from '../ws/engine/sheet.js';

const CSV = `날짜,시작,끝,제목,종류,묶음,완료,메모,출처,id,고친 시각
2026-11-02,18:00,22:00,백인대장 수학,일정,학원 수행,,,x,a1,
2026-11-18,8:00,16:00,학교,일정,,,,x,s1,
2026-11-18,16:00,23:00,야자,일정,,,,x,y1,
2026-11-23,,,"수평잡기 함수 313~395번",할 일,학원 수행,,,x,t1,
2026-11-22,,,"봄봄 51문제 (국어, 추정 마감 11/22)",할 일,학원 수행,,,x,t2,
2026-11-15,,,합성함수 프린트 챙겨가기,할 일,,,,x,t3,
2026-11-20,23:55,,스피치 PPT 제출,마감,학교 수행,O,,x,t4,
2026-12-09,,,기말고사 시작,일정,학교 수행,,,x,e1,
`;

test('분량 읽기', () => {
  assert.deepEqual(parseAmount('수평잡기 함수 313~395번'), { total: 83, done: 0, unit: '문제', known: true });
  assert.equal(parseAmount('어문규정 1 43문제 · 2 29문제').total, 72);
  assert.equal(parseAmount('자습서 95~133쪽, 239~285쪽').total, 86);
  assert.equal(parseAmount('능률보카 Day 46~48').unit, 'Day');
  assert.deepEqual(parseAmount('역함수 프린트', '역함수 프린트 60문제 중 29문제 남음'), { total: 60, done: 31, unit: '문제', known: true });
  assert.equal(parseAmount('합성함수 프린트 + 개념').known, false);
});

test('일정 행: 학교는 고정, 야자는 공부 시간, 학원 수업은 매주 반복으로 펼친다', () => {
  const s = recordsToState(rowsToRecords(parseCSV(CSV)), '2026-11-18');
  assert.ok(s.fixed.some((f) => f.label === '학교' && f.date === '2026-11-18' && f.start === '08:00'));
  assert.ok(!s.fixed.some((f) => f.label === '야자'));
  assert.ok(s.fixed.some((f) => f.label === '등교 준비' && f.date === '2026-11-18'));
  // 11/2(월) 백인대장 → 11/23(월)에도 반복 가정
  const rep = s.fixed.find((f) => f.label === '백인대장 수학' && f.date === '2026-11-23');
  assert.ok(rep?.assumed);
  assert.equal(s.events[0].title, '기말고사 시작');
});

test('숙제 행: 마감 시각은 그날 학원 수업 시작, 완료 표시는 다 한 것으로', () => {
  const s = recordsToState(rowsToRecords(parseCSV(CSV)), '2026-11-18');
  const t1 = s.tasks.find((t) => t.id === 't1');
  assert.equal(t1.g, 'baekin');
  assert.equal(t1.dueTime, '18:00');
  assert.equal(t1.total, 83);
  const t4 = s.tasks.find((t) => t.id === 't4');
  assert.equal(t4.dueTime, '23:55');
  assert.equal(t4.done, t4.total);
  assert.ok(!s.tasks.some((t) => t.id === 't3')); // 지난 준비물 알림은 버림
  assert.ok(s.groups.find((g) => g.id === 'kor').paces['문제'] > 0);
});

test('시트 링크 → CSV 주소', () => {
  assert.equal(
    csvUrlOf('https://docs.google.com/spreadsheets/d/abcDEF1234567890abcDEF/edit#gid=0'),
    'https://docs.google.com/spreadsheets/d/abcDEF1234567890abcDEF/gviz/tq?tqx=out:csv',
  );
  assert.equal(csvUrlOf('https://docs.google.com/spreadsheets/d/e/xyz/pub?output=csv'), 'https://docs.google.com/spreadsheets/d/e/xyz/pub?output=csv');
});
