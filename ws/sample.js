// 체험용 샘플 (초안의 11/18 수요일 저녁을 오늘 날짜 기준으로 재현)
import { addDays, at } from '../src/engine/time.js';

export function sampleState(today) {
  const d = (n) => addDays(today, n);
  const school = [0, 1, 2].flatMap((n) => [
    { id: `f_ready${n}`, label: '등교 준비', kind: 'commute', date: d(n), start: '07:00', end: '08:00' },
    { id: `f_school${n}`, label: '학교', kind: 'school', date: d(n), start: '08:00', end: '16:30' },
  ]);
  const s = (taskId, day, hm, min, units) => ({ taskId, start: at(d(day), hm), sec: Math.round(min * 60), units });
  return {
    version: 1,
    settings: {},
    fixed: [
      ...school,
      { id: 'f_dinner', label: '저녁', kind: 'meal', weekdays: [0, 1, 2, 3, 4, 5, 6], start: '18:00', end: '18:40' },
      { id: 'f_eng', label: '영어 학원', kind: 'academy', date: d(1), start: '17:00', end: '18:00' },
      { id: 'f_kor', label: '국어 학원', kind: 'academy', date: d(1), start: '19:00', end: '21:30' },
      { id: 'f_math', label: '백인대장', kind: 'academy', date: d(2), start: '18:40', end: '22:00' },
    ],
    groups: [
      { id: 'baekin', name: '백인대장', sub: '수학', badge: '백', color: 'var(--math)', dueTime: '18:40' },
      { id: 'school', name: '학교', sub: '수행평가', badge: '학', color: 'var(--school)', dueTime: '08:00' },
      { id: 'kor', name: '국어 학원', sub: '', badge: '국', color: 'var(--kor)', dueTime: '19:00' },
      { id: 'eng', name: '영어 학원', sub: '', badge: '영', color: 'var(--eng)', dueTime: '17:00' },
    ],
    tasks: [
      { id: 'm1', g: 'baekin', kind: 'homework', title: '수평잡기 명제 오답 및 마무리', done: 9, total: 14, unit: '문항', due: d(1), dueTime: '08:00', pace: 2.5 },
      { id: 'm2', g: 'baekin', kind: 'homework', title: '수평잡기 함수 313~395번', done: 40, total: 83, unit: '문제', due: d(2), pace: 2.4 },
      { id: 'm4', g: 'baekin', kind: 'homework', title: '합성함수 프린트', done: 4, total: 12, unit: '문제', due: d(2), pace: 2.5 },
      { id: 'm3', g: 'baekin', kind: 'homework', title: '수평잡기 함수 396~455번', done: 0, total: 60, unit: '문제', due: d(6) },
      { id: 's1', g: 'school', kind: 'performance', title: '심화아카데미 보고서 제출', done: 2, total: 5, unit: '단계', due: d(3), dueTime: '09:00', pace: 55 },
      { id: 'k1', g: 'kor', kind: 'homework', title: '국어 숙제', done: 0, total: 24, unit: '문제', due: d(1) },
      { id: 'e1', g: 'eng', kind: 'homework', title: '영어 문법 문제풀이', done: 12, total: 30, unit: '문제', due: d(1), pace: 1.2 },
      { id: 'e2', g: 'eng', kind: 'homework', title: '영어 독해 문제풀이', done: 2, total: 6, unit: '지문', due: d(1), pace: 6 },
    ],
    blocks: [
      { id: 'b1', date: d(0), start: '17:10', end: '18:00', title: '수학 오답', color: 'var(--math)', tasks: ['m1'] },
      { id: 'b2', date: d(0), start: '18:52', end: '19:37', title: '영어 풀이', color: 'var(--eng)', tasks: ['e1', 'e2'] },
      { id: 'b3', date: d(0), start: '19:45', end: '20:20', title: '국어 숙제', color: 'var(--kor)', tasks: ['k1'] },
      { id: 'b4', date: d(0), start: '20:30', end: '21:15', title: '수학 숙제', color: 'var(--math)', tasks: ['m2', 'm4'] },
      { id: 'b5', date: d(0), start: '21:25', end: '21:40', title: '보고서 개요', color: 'var(--school)', tasks: ['s1'] },
    ],
    sessions: [
      s('m2', -1, '20:00', 92, 40),
      s('m4', -1, '21:40', 11, 4),
      s('s1', -2, '20:00', 120, 2),
      s('e1', -1, '22:00', 13, 12),
      s('e2', -1, '22:20', 13, 2),
      s('m1', 0, '17:10', 46, 9),
    ],
    running: null,
  };
}
