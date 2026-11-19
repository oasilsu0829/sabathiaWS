import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as PL from '../ws/planner.js';

const load = () => PL.normalize(JSON.parse(readFileSync(new URL('../ws/data/15577.json', import.meta.url), 'utf8')));

test('15577 기록: 자습 날은 수업이 비고, 블록은 수업·학원과 안 겹치게 놓인다', () => {
  const P = load();
  assert.ok(PL.fixedFor(P, '2026-11-19').filter((x) => x.f.school).every((x) => x.self)); // 11/19 자습
  const fri = PL.fixedFor(P, '2026-11-20');
  assert.ok(fri.some((x) => x.f.title === '백인대장' && x.s === 1080));
  const k = '2026-11-21';
  const b = PL.addBlock(P, k, { title: '테스트', cat: 'math', kind: 'solve', units: 10, unit: '문제', est: 60, start: 9 * 60 + 30 }, k);
  const a = PL.layout(P, k).find((x) => x.b.id === b.id);
  const busy = PL.fixedFor(P, k).filter((x) => !x.self && !x.f.meal);
  assert.ok(busy.every((f) => a.s >= f.s + f.d || a.s + a.d <= f.s)); // 토 박상현 9:00~12:30 피함
});

test('추가·완료·취소·삭제: 15577과 같은 기록(log)을 남긴다', () => {
  const P = load();
  const k = '2026-11-19';
  const b = PL.addBlock(P, k, { title: '', cat: 'kor', kind: 'review', est: 40, start: 23 * 60 }, k);
  assert.equal(b.title, '국어 정리');
  assert.equal(b.review, true);
  PL.complete(P, b.id, 35);
  assert.equal(P.log[0].id, b.id);
  assert.equal(P.log[0].actual, 35);
  PL.undone(P, b.id);
  assert.ok(!P.log.some((l) => l.id === b.id));
  PL.updateBlock(P, b.id, { title: '어문규정', cat: 'kor', kind: 'solve', units: 43, unit: '문제', est: 50, start: 23 * 60 });
  assert.equal(PL.findB(P, b.id).b.units, 43);
  assert.ok(!PL.findB(P, b.id).b.review);
  assert.ok(PL.removeBlock(P, b.id));
  assert.equal(PL.findB(P, b.id).b, undefined);
});

test('예상 시간은 기록 평균으로 (15577 suggest)', () => {
  const P = load();
  const sg = PL.suggest(P, 'math', 20, '문제');
  assert.ok(sg && sg.min >= 5);
  assert.match(sg.why, /문제당/);
});
