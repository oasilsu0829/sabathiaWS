// 실제 데이터 연결 (2026-11-19).
//   Sabathia 일정  : <base>/api/events (토큰이 있으면 Bearer) → "Sabathia 일정" 시트와 같은 레코드 → recordsToState
//   15577 플래너   : 온라인 저장 ID → Firestore planners/{ID} 문서(기록 전체 JSON) → 블록·고정 일정
// 연결 정보(주소·토큰·ID)는 이 기기 localStorage 에만 둔다. 저장소에는 개인 데이터를 넣지 않는다.
import { addDays, weekdayOf, pad } from '../src/engine/time.js';
import { recordsToState, groupOfTitle, GROUPS } from './engine/sheet.js';

export const SRC_KEY = 'sabathia.ws.src';
export const DEFAULT_BASE = 'https://sabathia.oasilsu0829.workers.dev';
// 15577 온라인 저장 (Block-planner 의 CLOUD 와 같은 값. 브라우저용 공개 키)
const FIRESTORE = { projectId: 'p15577', apiKey: 'AIzaSyCMxJrxsFFEh9A9gDmbT4_rda9XLo8JgPE' };
export const ID_RE = /^[a-z0-9_-]{3,24}$/;

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

// ───────── 15577 ─────────
export async function fetchPlan(id) {
  if (!ID_RE.test(id || '')) throw new Error('15577 ID 형식이 아니에요');
  const url = `https://firestore.googleapis.com/v1/projects/${FIRESTORE.projectId}/databases/(default)/documents/planners/${id}?key=${FIRESTORE.apiKey}`;
  const r = await fetch(url, { cache: 'no-store' });
  if (r.status === 404) throw new Error(`'${id}'로 저장된 15577 기록이 없어요`);
  if (!r.ok) throw new Error('15577 ' + r.status);
  const doc = await r.json();
  return JSON.parse(doc.fields?.data?.stringValue || '{}');
}

const hm = (m) => `${pad(Math.floor(m / 60) % 24)}:${pad(Math.round(m) % 60)}`;
const COLOR = { baekin: 'var(--math)', kor: 'var(--kor)', eng: 'var(--eng)', sci: 'var(--eng)', school: 'var(--school)', etc: 'var(--ink3)' };
const words = (s) => String(s || '').split(/[\s()·,+~\-_/]+/).filter((w) => w.length >= 2);

// 15577 고정 블록이 그날 있는지 (Block-planner fixedFor 와 같은 규칙)
function fixedOn(P, f, k) {
  const off = (P.schoolOff || []).includes(k);
  return (f.days || []).includes(weekdayOf(k)) && (!f.only || f.only === k) && (!f.from || k >= f.from) && (!f.until || k <= f.until)
    && !(f.skip || []).includes(k) && !(off && f.school);
}
function selfOn(P, f, k) {
  const base = !!f.selfStudy || (!!f.school && (P.selfDay || []).includes(k));
  const flip = ((P.selfFlip || {})[k] || []).includes(f.id);
  return base !== flip;
}

/**
 * 15577 기록 → WS 블록 + 고정 일정.
 * 블록의 숙제는 제목이 겹치는 숙제 → 같은 과목(학원) 숙제 순으로 마감이 빠른 것부터 3개까지 붙인다.
 */
export function planToState(P, today, tasks, { from = addDays(today, -1), to = addDays(today, 6) } = {}) {
  const cats = Object.fromEntries((P?.cats || []).map((c) => [c.id, c]));
  const blocks = [];
  const fixed = [];
  if (!P) return { blocks, fixed };
  for (const [k, list] of Object.entries(P.days || {})) {
    if (k < from || k > to || !Array.isArray(list)) continue;
    for (const b of list) {
      if (b.buffer || b.start == null) continue;
      const cat = cats[b.cat]?.name || '';
      const title = b.title || (b.review ? `${cat} 정리` : b.lecture ? `${cat} 인강` : cat || '블록');
      const g = groupOfTitle(`${title} ${cat}`);
      const open = tasks.filter((t) => t.done < t.total && t.due >= k);
      const tw = new Set(words(title));
      const byTitle = open.filter((t) => words(t.title).some((w) => tw.has(w)));
      const byGroup = open.filter((t) => t.g === g && !byTitle.includes(t));
      const linked = [...byTitle, ...byGroup].sort((a, c) => (a.due + (a.dueTime || '')).localeCompare(c.due + (c.dueTime || ''))).slice(0, 3);
      const len = Math.max(5, b.dur || b.est || 30);
      blocks.push({ id: 'p:' + b.id, date: k, start: hm(b.start), end: hm(b.start + len), title, color: COLOR[g] || 'var(--ink3)', tasks: linked.map((t) => t.id), from15577: true, doneIn15577: !!b.done });
    }
  }
  // 고정 블록: 수업은 하루 한 덩어리(첫 교시~끝 교시)로, 식사는 식사로, 나머지는 그대로
  for (let k = from; k <= to; k = addDays(k, 1)) {
    const on = (P.fixed || []).filter((f) => fixedOn(P, f, k) && !selfOn(P, f, k));
    const school = on.filter((f) => f.school);
    if (school.length) {
      const s = Math.min(...school.map((f) => f.start)), e = Math.max(...school.map((f) => f.start + f.dur));
      fixed.push({ id: `p_school_${k}`, label: '학교', kind: 'school', date: k, start: hm(s), end: hm(e), from15577: true });
    }
    for (const f of on.filter((x) => !x.school)) {
      fixed.push({ id: `p_${f.id}_${k}`, label: f.title || '고정', kind: f.meal ? 'meal' : /학원|반|대장|좋은날/.test(f.title || '') ? 'academy' : 'other', date: k, start: hm(f.start), end: hm(f.start + f.dur), from15577: true });
    }
  }
  return { blocks, fixed };
}

/** 같은 날 같은 종류(학교 등)·같은 시각이 겹치면 하나만 남긴다. 일정 앱 쪽을 우선 */
function mergeFixed(a, b) {
  const key = (f) => `${f.date}|${f.kind === 'school' ? 'school' : f.label}|${f.start}`;
  const seen = new Set(a.map(key));
  const schoolDays = new Set(a.filter((f) => f.kind === 'school').map((f) => f.date));
  return [...a, ...b.filter((f) => !seen.has(key(f)) && !(f.kind === 'school' && schoolDays.has(f.date)))];
}

/**
 * 연결된 곳에서 모두 읽어 WS 상태 조각을 만든다.
 * @returns {{ part, info: { events: number|null, blocks: number|null, errors: string[] } }}
 */
export async function loadLive(src, today) {
  const errors = [];
  let records = [];
  let plan = null;
  let nEvents = null;
  let raw = [];
  await Promise.all([
    (async () => {
      try { const ev = await fetchEvents(src.base, src.token); raw = ev; records = eventsToRecords(ev); nEvents = ev.length; }
      catch (e) { errors.push('일정: ' + e.message); }
    })(),
    (async () => {
      if (!src.planId) return;
      try { plan = await fetchPlan(src.planId); } catch (e) { errors.push('15577: ' + e.message); }
    })(),
  ]);
  const sheet = recordsToState(records, today);
  const p = planToState(plan, today, sheet.tasks);
  // 15577 블록에서 처음 나오는 과목 묶음도 보이게
  const used = new Set([...sheet.groups.map((g) => g.id)]);
  const extra = GROUPS.filter((g) => !used.has(g.id) && p.blocks.some((b) => groupOfTitle(b.title) === g.id) && g.id !== 'etc')
    .map(({ re, ...g }) => ({ ...g, dueTime: '23:00', paces: {} }));
  const part = {
    fixed: mergeFixed(sheet.fixed, p.fixed),
    tasks: sheet.tasks,
    groups: [...sheet.groups, ...extra],
    events: sheet.events,
    blocks: p.blocks,
  };
  return { part, raw, ok: nEvents != null || plan != null, info: { events: nEvents, blocks: plan ? p.blocks.length : null, errors } };
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
