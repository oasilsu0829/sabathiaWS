// 실제 데이터 연결 (2026-11-19).
//   Sabathia 일정  : <base>/api/events (토큰이 있으면 Bearer) → "Sabathia 일정" 시트와 같은 레코드 → recordsToState
//   15577 플래너   : planner.js 가 들고 있는 15577 기록(기본 ws/data/15577.json, ID가 있으면 Firestore와 맞춤) → 블록·고정 일정
// 연결 정보(주소·토큰·ID)는 이 기기 localStorage 에만 둔다. 저장소에는 개인 데이터를 넣지 않는다.
import { addDays } from '../src/engine/time.js';
import { layout, fixedFor, catOf, hm } from './planner.js';
import { recordsToState, groupOfTitle, GROUPS } from './engine/sheet.js';

export const SRC_KEY = 'sabathia.ws.src';
export const DEFAULT_BASE = 'https://sabathia.oasilsu0829.workers.dev';
export { ID_RE } from './planner.js';

export function loadSrc() {
  try { return JSON.parse(localStorage.getItem(SRC_KEY)) || null; } catch { return null; }
}
export function saveSrc(src) {
  try { src ? localStorage.setItem(SRC_KEY, JSON.stringify(src)) : localStorage.removeItem(SRC_KEY); } catch {}
}

// ───────── Sabathia 일정 → 시트 레코드 ─────────
const TYPE = { event: '일정', deadline: '마감', task: '할 일' };
const BUNDLE = { report: '보고서 제출', school: '학교 수행', academy: '학원 수행' };
export function eventsToRecords(events) {
  return (events || [])
    .filter((e) => e && /^\d{4}-\d{2}-\d{2}$/.test(e.date) && e.title && TYPE[e.kind])
    .map((e) => ({
      date: e.date,
      start: e.time || '',
      end: e.end || '',
      title: e.title,
      type: TYPE[e.kind],
      bundle: BUNDLE[e.cat] || '',
      done: !!e.done,
      memo: e.note || '',
      id: 'ev:' + e.id,
    }));
}

const apiBase = (base) => String(base || DEFAULT_BASE).replace(/\/+$/, '') + '/api/events';
const authH = (token) => (token ? { Authorization: 'Bearer ' + token } : {});

/** 일정 하나 고치기·추가·지우기. method: PATCH(id) · POST · DELETE(id) */
export async function sendEvent(src, method, id, body) {
  const url = apiBase(src.base) + (id ? '/' + encodeURIComponent(id) : '');
  const r = await fetch(url, {
    method,
    headers: { ...authH(src.token), ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const d = await r.json().catch(() => ({}));
  if (r.status === 401) throw new Error('토큰이 맞지 않아요 · 연결 화면에서 토큰을 넣어 주세요');
  if (!r.ok) throw new Error(d.error || '저장 실패 ' + r.status);
  return d;
}

export async function fetchEvents(base, token) {
  const r = await fetch(apiBase(base), { headers: authH(token), cache: 'no-store' });
  if (r.status === 401) throw new Error('토큰이 필요해요');
  if (!r.ok) throw new Error('일정 ' + r.status);
  const d = await r.json();
  return Array.isArray(d) ? d : d.events || [];
}

// ───────── 15577 → WS ─────────
const COLOR = { baekin: 'var(--math)', kor: 'var(--kor)', eng: 'var(--eng)', sci: 'var(--eng)', school: 'var(--school)', etc: 'var(--ink3)' };
const words = (s) => String(s || '').split(/[\s()·,+~\-_/]+/).filter((w) => w.length >= 2);

/**
 * 15577 기록 → WS 블록 + 고정 일정. 블록 자리는 15577 layout(수업·학원을 피해 밀린 자리)을 쓴다.
 * 블록의 숙제는 제목이 겹치는 숙제 → 같은 과목(학원) 숙제 순으로 마감이 빠른 것부터 3개까지 붙인다.
 */
export function planToState(P, today, tasks, { from = addDays(today, -1), to = addDays(today, 6) } = {}) {
  const blocks = [];
  const fixed = [];
  if (!P) return { blocks, fixed };
  for (const k of Object.keys(P.days || {})) {
    if (k < from || k > to) continue;
    for (const { b, s, d } of layout(P, k)) {
      if (b.buffer || b.start == null) continue;
      const cat = catOf(P, b.cat).name;
      const title = b.title || (b.review ? `${cat} 정리` : b.lecture ? `${cat} 인강` : cat || '블록');
      const g = groupOfTitle(`${title} ${cat}`);
      const open = tasks.filter((t) => t.done < t.total && t.due >= k);
      const tw = new Set(words(title));
      const byTitle = open.filter((t) => words(t.title).some((w) => tw.has(w)));
      const byGroup = open.filter((t) => t.g === g && !byTitle.includes(t));
      const linked = [...byTitle, ...byGroup].sort((x, y) => (x.due + (x.dueTime || '')).localeCompare(y.due + (y.dueTime || ''))).slice(0, 3);
      blocks.push({ id: 'p:' + b.id, date: k, start: hm(s), end: hm(s + Math.max(5, d)), title, color: COLOR[g] || 'var(--ink3)', tasks: linked.map((t) => t.id), from15577: true, doneIn15577: !!b.done });
    }
  }
  // 고정 블록: 수업은 하루 한 덩어리(첫 교시~끝 교시, 자습 교시는 뺌), 식사는 식사로, 나머지는 그대로
  for (let k = from; k <= to; k = addDays(k, 1)) {
    const on = fixedFor(P, k).filter((x) => !x.self);
    const school = on.filter((x) => x.f.school);
    if (school.length) {
      const s = Math.min(...school.map((x) => x.s)), e = Math.max(...school.map((x) => x.s + x.d));
      fixed.push({ id: `p_school_${k}`, label: '학교', kind: 'school', date: k, start: hm(s), end: hm(e), from15577: true });
    }
    for (const { f, s, d } of on.filter((x) => !x.f.school)) {
      fixed.push({ id: `p_${f.id}_${k}`, label: f.title || '고정', kind: f.meal ? 'meal' : /학원|반|대장|좋은날|클리닉|본수업|영어|박상현/.test(f.title || '') ? 'academy' : 'other', date: k, start: hm(s), end: hm(s + d), from15577: true });
    }
  }
  return { blocks, fixed };
}

/** 같은 날 같은 종류(학교 등)·같은 시각이 겹치면 하나만 남긴다. 일정 앱 쪽을 우선 */
export function mergeFixed(a, b) {
  const key = (f) => `${f.date}|${f.kind === 'school' ? 'school' : f.label}|${f.start}`;
  const seen = new Set(a.map(key));
  const schoolDays = new Set(a.filter((f) => f.kind === 'school').map((f) => f.date));
  return [...a, ...b.filter((f) => !seen.has(key(f)) && !(f.kind === 'school' && schoolDays.has(f.date)))];
}

/** Sabathia 일정을 읽어 시트 상태를 만든다. 15577은 화면이 들고 있는 기록(P)을 받아 합친다 */
export async function loadEvents(src, today) {
  const ev = await fetchEvents(src.base, src.token);
  return { raw: ev, sheet: recordsToState(eventsToRecords(ev), today) };
}
export function combine(sheet, P, today) {
  const p = planToState(P, today, sheet.tasks);
  const used = new Set(sheet.groups.map((g) => g.id));
  const extra = GROUPS.filter((g) => !used.has(g.id) && g.id !== 'etc' && p.blocks.some((b) => groupOfTitle(b.title) === g.id))
    .map(({ re, ...g }) => ({ ...g, dueTime: '23:00', paces: {} }));
  return { fixed: mergeFixed(sheet.fixed, p.fixed), tasks: sheet.tasks, groups: [...sheet.groups, ...extra], events: sheet.events, blocks: p.blocks };
}

/** 예전 상태(진행 기록)를 살려서 새 조각을 덮는다. 같은 숙제(id·분량 단위 같음)의 진행은 큰 쪽을 쓴다 */
export function applyLive(st, part) {
  const prev = new Map((st.tasks || []).map((t) => [t.id, t]));
  for (const t of part.tasks) {
    const o = prev.get(t.id);
    if (o && o.unit === t.unit && o.total === t.total && !t.sheetDone) t.done = Math.max(t.done, o.done || 0);
  }
  Object.assign(st, part, { source: 'live' });
  if (st.running && !part.tasks.some((t) => t.id === st.running.task)) st.running = null;
  return st;
}
