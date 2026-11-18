// 체험용 샘플 데이터 (가상의 일주일)
import { makeTask } from './engine/planner.js';
import { addDays, toDateStr } from './engine/time.js';

export function sampleData(now = Date.now()) {
  const d = (n) => addDays(toDateStr(now), n);
  return {
    fixed: [
      { id: 'f_school', label: '학교', kind: 'school', weekdays: [1, 2, 3, 4, 5], start: '08:00', end: '16:30' },
      { id: 'f_commute', label: '하교·이동', kind: 'commute', weekdays: [1, 2, 3, 4, 5], start: '16:30', end: '17:10' },
      { id: 'f_dinner', label: '저녁', kind: 'meal', weekdays: [0, 1, 2, 3, 4, 5, 6], start: '18:00', end: '18:40' },
      { id: 'f_math', label: '수학 학원', kind: 'academy', weekdays: [1, 3, 5], start: '18:40', end: '21:00' },
      { id: 'f_eng', label: '영어 학원', kind: 'academy', weekdays: [2, 4], start: '18:40', end: '20:40' },
      { id: 'f_ko', label: '국어 학원', kind: 'academy', weekdays: [6], start: '10:00', end: '13:00' },
    ],
    tasks: [
      makeTask({ title: '수학 숙제', date: d(0), start: '21:10', end: '22:40', deadline: d(2), deadlineTime: '18:40' }),
      makeTask({ title: '국어 숙제', date: d(0), start: '22:40', end: '23:20', deadline: d(3) }),
      makeTask({ title: '영어 단어', date: d(1), start: '20:50', end: '21:20', deadline: d(1), deadlineTime: '18:40' }),
      makeTask({ title: '과학 숙제', date: d(1), start: '21:20', end: '22:00' }),
      makeTask({ title: '수학 오답 복습', date: d(1), start: '22:00', end: '22:40' }),
      makeTask({ title: '국어 수행평가 보고서', date: d(2), estimateMin: 90, deadline: d(4) }),
      makeTask({ title: '학습 시스템 개선', kind: 'project', estimateMin: 120, value: 3, usage: 3 }),
    ],
  };
}
