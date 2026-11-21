import { mountCity } from './city.js';
import { loadSrc, saveSrc, loadEvents, combine, applyLive, sendEvent, DEFAULT_BASE, ID_RE } from './live.js';
import * as PL from './planner.js';
import { mountPlanner } from './planpanel.js';
import * as MU from './must.js';
// Sabathia WS — 화면. 판단은 전부 engine/judge.js가 하고, 여기서는 그 결과를 그린다.
import { judge, ddayTxt, estTxt, settingsOf } from './engine/judge.js';
import { isDone } from './engine/estimate.js';
import { sampleState } from './sample.js';
import { logicalDay } from '../src/engine/capacity.js';
import { fmtDur, fmtTime, weekdayLabel, weekdayOf, roundTo, addDays } from '../src/engine/time.js';

// ---------- Icons ----------
const P = {
  chevron: '<path d="M6 9l6 6 6-6"/>',
  left: '<path d="M15 5l-7 7 7 7"/>',
  right: '<path d="M9 5l7 7-7 7"/>',
  trash: '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6"/>',
  undo: '<path d="M9 14L4 9l5-5M4 9h10a6 6 0 0 1 0 12h-3"/>',
  expand: '<path d="M14 4h6v6M10 20H4v-6M20 4l-6.5 6.5M4 20l6.5-6.5"/>',
  shrink: '<path d="M4 14h6v6M20 10h-6V4M10 14l-6.5 6.5M14 10l6.5-6.5"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  play: '<path d="M8 5.5v13l11-6.5z" fill="currentColor" stroke="none"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  stop: '<rect x="7" y="7" width="10" height="10" fill="currentColor" stroke="none"/>',
  grid: '<rect x="4" y="4" width="7" height="7"/><rect x="13" y="4" width="7" height="7"/><rect x="4" y="13" width="7" height="7"/><rect x="13" y="13" width="7" height="7"/>',
  free: '<rect x="3.5" y="4.5" width="10" height="8"/><rect x="10.5" y="11.5" width="10" height="8"/>',
  arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  reset: '<path d="M4 12a8 8 0 1 0 2.4-5.7M4 4v4h4"/>',
  link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
};
const ic = (n, s = 16) =>
  `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="square" stroke-linejoin="miter" aria-hidden="true">${P[n]}</svg>`;
document.querySelectorAll('[data-ic]').forEach((el) => (el.outerHTML = ic(el.dataset.ic)));

// ---------- Time ----------
// ?now=2026-11-18T18:58 로 시각을 고정(이후 실제 시간만큼 흐름). ?reset 으로 샘플 다시 불러오기.
const q = new URLSearchParams(location.search);
const pinned = q.get('now') ? new Date(q.get('now')).getTime() : NaN;
const T0 = Date.now();
const nowMs = () => (Number.isFinite(pinned) ? pinned + (Date.now() - T0) : Date.now());
const MINMS = 60_000;

// ---------- Store ----------
const KEY = 'sabathia.ws.v1';
function load() {
  if (!q.has('reset')) {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) return JSON.parse(raw);
    } catch {}
  }
  return sampleState(logicalDay(settingsOf({}), nowMs()).date);
}
const st = load();
// 실제 데이터 연결 상태 (아래 '실제 데이터' 절에서 씀). 첫 render 전에 선언해 둔다
// 기본은 Sabathia 일정에 바로 연결(사용자 결정: 공개돼도 됨). '연결 끊기'를 누른 기기만 샘플
let src = loadSrc();
if (!src) src = { base: DEFAULT_BASE, token: '', planId: '' };
if (src.off) src = null;
let liveInfo = null;
let PLAN = PL.loadLocal();   // 15577 기록 (planner.js)
let SHEET = null;            // 마지막으로 읽은 Sabathia 일정 → 시트 상태
let seeded = false;          // 이번에 ws/data/15577.json 과 비교했는지
const liveRaw = new Map();   // 일정 원본 (id → 이벤트), 마감 고치기에 씀
st.sessions ??= [];
function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify(st));
  } catch {}
}
save();

// ---------- Helpers ----------
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const dur = (m) => fmtDur(Math.max(0, Math.round(m)));
const hmShort = (m) => `${Math.floor(m / 60)}:${String(Math.round(m) % 60).padStart(2, '0')}`;
const r5 = (v) => Math.max(5, roundTo(v, 5));
const T = (id) => st.tasks.find((t) => t.id === id);
const G = (id) => st.groups.find((g) => g.id === id);
const groupOf = (t) => G(t.g) ?? { name: '', color: 'var(--ink3)' };
let R = judge(st, nowMs());
const J = (id) => R.tasks.get(id);
const blk = (id) => R.blocks.find((b) => b.id === id);
const blockState = (b) => (b.end <= R.now ? 'done' : b.start <= R.now ? 'now' : 'next');
const blockOfTask = (tid) =>
  R.blocks.find((b) => b.tasks?.includes(tid) && b.end > R.now) ?? R.blocks.find((b) => b.tasks?.includes(tid));
const dateLabel = (ds) => {
  const [, m, d] = ds.split('-').map(Number);
  return { m, d, w: weekdayLabel(weekdayOf(ds)) };
};

// ---------- UI state ----------
const TOP = 76, PAD = 20, GAP = 12, HEAD = 48;
// 화면 모양 (2026-11-19): 예전엔 1366×1024(패드 가로) 무대를 폭에 맞춰 줄이기만 했다.
// 이제 무대 크기를 화면 비율에 맞춘다. wide = 가로 화면(두 줄 배치), tall = 세로 태블릿, phone = 폰(한 줄로 쌓고 아래로 스크롤).
let W = 1366, H = 1024, VH = 1024, FORM = 'wide', scale = 1;
function measure() {
  const vw = document.documentElement.clientWidth || innerWidth, vh = innerHeight || vw;
  if (vw >= vh * 1.05) {
    FORM = 'wide';
    scale = Math.min(vw / 1100, vh < 640 ? vh / 640 : vh > 1100 ? vh / 1100 : 1);
  } else {
    FORM = vw < 600 ? 'phone' : 'tall';
    scale = Math.min(1, vw / (FORM === 'phone' ? 360 : 600));
  }
  W = Math.round(vw / scale); VH = Math.round(vh / scale); H = VH;
}
measure();
const ids = ['now', 'must', 'today', 'dl', 'pl'];
const NAMES = { now: 'NOW', must: '안하면 병신', today: 'TODAY', dl: 'DEADLINES', pl: 'PLANNER' };
const freeDefault = () => {
  if (FORM !== 'wide') {
    const w = Math.min(W - PAD * 2 - 42, 640), h = Math.max(320, Math.min(560, VH - TOP - 200));
    return Object.fromEntries(ids.map((id, i) => [id, { x: PAD + i * 14, y: TOP + 12 + i * 46, w, h }]));
  }
  const sx = W / 1366, sy = H / 1024, r = (x, y, w, h) => ({ x: Math.round(x * sx), y: Math.round(y * sy), w: Math.round(w * sx), h: Math.round(h * sy) });
  return { now: r(48, 96, 560, 540), must: r(470, 250, 440, 400), today: r(640, 88, 680, 268), dl: r(690, 384, 640, 540), pl: r(132, 580, 520, 360) };
};
const S = {
  mode: 'organized', focus: null, collapsed: {}, closed: Object.fromEntries(ids.map((id) => [id, true])), order: ['pl', 'dl', 'today', 'must', 'now'],
  free: freeDefault(), selBlock: null, selHw: {}, sort: 'group',
  open: Object.fromEntries(st.groups.map((g, i) => [g.id, i < 3])), pop: null,
  split: { col: null, L: null, R: null, M: null }, // 정돈 모드 비율 (경계를 끌어 바꿈)
  stackH: {},                              // 세로·폰: 창마다 높이
};
// 창 크기·배치는 이 기기에 남긴다 (2026-11-19 사용자 요청: 창 크기 조절)
const LAYOUT_KEY = 'sabathia.ws.layout';
try {
  const L = JSON.parse(localStorage.getItem(LAYOUT_KEY));
  if (L) { if (L.mode) S.mode = L.mode; if (L.split) Object.assign(S.split, L.split); if (L.stackH) S.stackH = L.stackH; if (L.free && L.form) S._savedFree = L; }
} catch {}
function saveLayout() {
  try { localStorage.setItem(LAYOUT_KEY, JSON.stringify({ mode: S.mode, split: S.split, stackH: S.stackH, free: S.free, form: FORM })); } catch {}
}
const anyClosed = () => ids.some((id) => S.closed[id]);

// ---------- Layout ----------
// 창 내용 높이(머리 + 본문). 내용이 STACK보다 짧으면 그만큼만 차지한다
function natural(id) {
  const wb = win(id).querySelector('.wb');
  let end = 0;
  for (const c of wb.children) end = Math.max(end, c.offsetTop - wb.offsetTop + c.offsetHeight);
  return end ? HEAD + end + 22 : STACK[id];
}
const restack = () => { if (FORM !== 'wide' && S.mode === 'organized' && !S.focus) applyLayout(); };
// 폰·세로 화면: 열린 창을 한 줄로 쌓는다. 화면보다 짧으면 남는 높이를 나눠 채운다.
const STACK = { now: 640, must: 420, today: 330, dl: 560, pl: 900 };
function stackRects() {
  const open = ids.filter((id) => !S.closed[id]);
  const avail = VH - TOP - PAD - (anyClosed() ? 64 : 0);
  const want = open.map((id) => (S.collapsed[id] ? HEAD : S.stackH[id] ?? Math.min(STACK[id], natural(id))));
  const used = want.reduce((a, b) => a + b, 0) + GAP * Math.max(0, open.length - 1);
  const grow = open.filter((id) => !S.collapsed[id] && S.stackH[id] == null).length;
  const extra = used < avail && grow ? (avail - used) / grow : 0;
  const out = {};
  let y = TOP;
  open.forEach((id, i) => { const h = Math.round(want[i] + (S.collapsed[id] || S.stackH[id] != null ? 0 : extra)); out[id] = { x: PAD, y, w: W - PAD * 2, h }; y += h + GAP; });
  return out;
}
function orgRects() {
  if (FORM !== 'wide') return stackRects();
  const avail = H - TOP - PAD - (anyClosed() ? 64 : 0);
  const L = ['now', 'pl'].filter((id) => !S.closed[id]), Rr = ['must', 'today', 'dl'].filter((id) => !S.closed[id]);
  const full = W - PAD * 2;
  let lw = Math.round(S.split.col ? clamp(full * S.split.col, 340, full - 340 - GAP) : clamp(full * 0.443, 480, 820)), rx = PAD + lw + GAP, rw = full - lw - GAP;
  if (!L.length) { rx = PAD; rw = full; }
  if (!Rr.length) lw = full;
  const lim = (r, av) => clamp(Math.round(av * r), HEAD + 120, av - GAP - HEAD - 120);
  const ratio = { now: S.split.L ?? 0.7, today: S.split.R ?? 0.343 };
  // 오른쪽 맨 위 '안하면 병신'은 높이 비율 S.split.M, 그 아래 TODAY·DEADLINES가 남은 높이를 나눈다
  const col = (list, x, w) => {
    if (!list.length) return {};
    const out = {};
    let y = TOP, av = avail;
    if (list[0] === 'must' && list.length > 1) {
      const h = S.collapsed.must ? HEAD : clamp(Math.round(avail * (S.split.M ?? 0.3)), HEAD + 100, avail - (GAP + HEAD) * (list.length - 1) - 100);
      out.must = { x, y, w, h }; y += h + GAP; av -= h + GAP; list = list.slice(1);
    }
    if (list.length === 1) { const a = list[0]; out[a] = { x, y, w, h: S.collapsed[a] ? HEAD : av }; return out; }
    const [a, b] = list, ca = S.collapsed[a], cb = S.collapsed[b];
    const ha = ca ? HEAD : cb ? av - GAP - HEAD : lim(ratio[a], av);
    const hb = cb ? HEAD : av - GAP - ha;
    out[a] = { x, y, w, h: ha }; out[b] = { x, y: y + ha + GAP, w, h: hb };
    return out;
  };
  return { ...col(L, PAD, lw), ...col(Rr, rx, rw) };
}
function focusRect() {
  if (FORM === 'wide') return { x: Math.round(W * 0.088), y: 88, w: Math.round(W * 0.824), h: H - 144 };
  const sy = scrollY / scale, y = Math.max(TOP, Math.round(sy + 12));
  return { x: 10, y, w: W - 20, h: Math.round(sy + VH - 12 - y) };
}
const stage = document.getElementById('stage');
const win = (id) => document.getElementById('w-' + id);
const brief = document.getElementById('brief');
let briefDismissed = false;
brief.addEventListener('click', () => {
  briefDismissed = true;
  document.querySelector('#dock button')?.focus({ preventScroll: true });
  if (matchMedia('(prefers-reduced-motion: no-preference)').matches) {
    brief.classList.add('leaving');
    setTimeout(() => { brief.hidden = true; }, 320);
  } else {
    brief.hidden = true;
  }
});
function applyLayout() {
  if (FORM === 'phone' && S.mode === 'free') S.mode = 'organized';
  stage.className = (S.mode === 'free' ? 'free' : 'organized') + ' f-' + FORM;
  stage.classList.toggle('has-closed', anyClosed());
  if (ids.some((id) => !S.closed[id])) {
    briefDismissed = true;
    brief.hidden = true;
  }
  const org = S.mode === 'organized' ? orgRects() : null;
  const fr = S.focus ? focusRect() : null;
  // 무대 높이: 가로 화면은 화면 높이 그대로, 폰·세로는 쌓인 창 길이만큼 늘어난다(페이지 스크롤)
  let bottom = 0;
  if (FORM !== 'wide') ids.forEach((id) => { if (S.closed[id]) return; const r = org ? org[id] : S.free[id]; bottom = Math.max(bottom, r.y + (org || !S.collapsed[id] ? r.h : HEAD)); });
  H = Math.max(VH, bottom ? bottom + PAD + (anyClosed() ? 64 : 0) : 0);
  sizeStage();
  ids.forEach((id) => {
    const el = win(id), closed = !!S.closed[id];
    el.classList.toggle('closed', closed);
    el.inert = closed;
    if (!closed) {
      const r = S.focus === id ? fr : org ? org[id] : { ...S.free[id], h: S.collapsed[id] ? HEAD : S.free[id].h };
      Object.assign(el.style, { left: r.x + 'px', top: r.y + 'px', width: r.w + 'px', height: r.h + 'px' });
    }
    el.style.zIndex = S.focus === id ? 100 : 10 + S.order.indexOf(id);
    el.classList.toggle('collapsed', !!S.collapsed[id] && S.focus !== id);
    el.classList.toggle('focused', S.focus === id);
    el.classList.toggle('dim', !!S.focus && S.focus !== id);
    el.classList.toggle('front', S.mode === 'free' && S.order[S.order.length - 1] === id);
    const fb = el.querySelector('.foc');
    fb.innerHTML = ic(S.focus === id ? 'shrink' : 'expand');
    fb.setAttribute('aria-label', S.focus === id ? '집중 보기 닫기' : '집중 보기');
    el.querySelector('.col').setAttribute('aria-expanded', String(!S.collapsed[id]));
  });
  placeSplits(org);
  saveLayout();
  document.getElementById('scrim').classList.toggle('on', !!S.focus);
  document.querySelectorAll('[data-act="mode"]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.mode === S.mode)));
  renderDock();
}
const front = (id) => { S.order = S.order.filter((x) => x !== id).concat(id); };

// 정돈 모드(가로)에서 창 사이 경계: 세로선 = 왼쪽·오른쪽 너비, 가로선 = 위아래 창 높이
function placeSplits(org) {
  stage.querySelectorAll('.split').forEach((el) => el.remove());
  if (!org || FORM !== 'wide' || S.focus) return;
  const add = (cls, data, r) => {
    const el = document.createElement('div');
    el.className = 'split ' + cls; Object.assign(el.dataset, data);
    el.setAttribute('aria-hidden', 'true');
    Object.assign(el.style, { left: r.x + 'px', top: r.y + 'px', width: r.w + 'px', height: r.h + 'px' });
    stage.append(el);
  };
  const l = org.now ?? org.pl, r = org.must ?? org.today ?? org.dl;
  if (l && r) { const bot = Math.max(...ids.filter((id) => org[id]).map((id) => org[id].y + org[id].h)); add('v', { s: 'col' }, { x: l.x + l.w - 4, y: TOP, w: GAP + 8, h: bot - TOP }); }
  const underM = org.today ? 'today' : 'dl';
  for (const [a, b, key] of [['now', 'pl', 'L'], ['must', underM, 'M'], ['today', 'dl', 'R']]) {
    if (org[a] && org[b] && !S.collapsed[a] && !S.collapsed[b]) add('h', { s: key }, { x: org[a].x, y: org[a].y + org[a].h - 4, w: org[a].w, h: GAP + 8 });
  }
}
// 창마다 여덟 방향 손잡이 (자유 모드) — 세로·폰의 정돈 모드에서는 아래쪽만
ids.forEach((id) => {
  const w = win(id);
  w.querySelector('.rz')?.remove();
  for (const d of ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw']) {
    const h = document.createElement('span');
    h.className = 'rh rh-' + d; h.dataset.dir = d; h.setAttribute('aria-hidden', 'true');
    w.append(h);
  }
});

// ---------- Progress & estimate views ----------
const prevW = {};
function prog(t, key) {
  const p = (t.done / t.total) * 100;
  if (t.total <= 30) {
    return `<div class="segs" style="--c:${groupOf(t).color}">${Array.from({ length: t.total }, (_, i) =>
      `<span class="${i < t.done ? 'on' : ''}${S.pop === t.id && i === t.done - 1 ? ' pop' : ''}"></span>`).join('')}</div>`;
  }
  return `<div class="track ticks" style="--c:${groupOf(t).color};--tick:${(1000 / t.total).toFixed(3)}%"><i class="fill" data-k="${key}" data-p="${p}" style="width:${prevW[key] ?? 0}%"></i></div>`;
}
function estView(t) {
  const j = J(t.id);
  if (j.status === 'done') return { main: '완료', sub: '' };
  const e = j.est;
  if (e.source === 'none') return { main: '—', sub: '진행 후 추정' };
  if (e.source === 'plan') return { main: `계획 ${dur(e.exp)}`, sub: '진행 후 추정' };
  const basis = e.source === 'measured' ? `${e.pace.toFixed(1)}분/${t.unit}` : e.source === 'group' ? '같은 학원 페이스' : '예상 페이스';
  return { main: estTxt(e), sub: basis, short: `약 ${dur(r5(e.exp))}`, upper: `~${dur(r5(e.hi))}` };
}
const RAIL = { calm: 'var(--line2)', attention: 'var(--ink3)', near: 'var(--ink)', risk: 'var(--hot)' };
const DUE = {
  calm: ['rgba(241,240,236,.07)', 'var(--ink3)'],
  attention: ['rgba(241,240,236,.18)', 'var(--ink)'],
  near: ['var(--ink)', 'var(--bg)'],
  risk: ['var(--hot)', '#111'],
};
const dueDate = (t) => {
  if (!t.due) return '';
  const { m, d, w } = dateLabel(t.due);
  return `${m}/${d} ${w}`;
};

// ---------- NOW ----------
function nowView() {
  const D = R.decision;
  if (st.running) return st.running.block ? { kind: 'block', id: st.running.block } : { kind: 'gap', task: st.running.task };
  if (S.selBlock && blk(S.selBlock)) return { kind: 'block', id: S.selBlock, manual: S.selBlock !== D.blockId };
  if (D.type === 'gap') return { kind: 'gap', task: D.taskId };
  if (D.blockId && D.type !== 'rest') return { kind: 'block', id: D.blockId };
  return { kind: 'msg' };
}
function judgeBanner(manual) {
  const D = R.decision;
  const warn = D.delay && D.delay.level !== 'none';
  const hot = warn || R.mode === 'risk';
  return `<div class="judge${hot ? ' hot' : ''}">
    <div class="judge-k"><span>${manual ? '직접 선택 · 판단은' : esc(D.eyebrow)}</span>${manual ? '<button data-act="follow">판단 따르기</button>' : ''}</div>
    <div class="judge-t">${esc(D.title)}</div>
    <div class="judge-m">${esc(D.message)}</div>
    ${D.delay ? `<div class="judge-d${warn ? ' warn' : ''}"><i></i>${esc(D.delay.text)}</div>` : ''}
  </div>`;
}
function hwCard(t, on) {
  const e = estView(t), j = J(t.id), c = isDone(t);
  return `<button class="hw${c ? ' complete' : ''}" role="radio" aria-checked="${on}" data-act="selhw" data-id="${t.id}" data-task="${t.id}">
    <span class="hw-head"><span class="radio"></span><span class="hw-title">${esc(t.title)}</span></span>
    ${j.note ? `<span class="hw-note${j.noteLevel === 'risk' ? ' risk' : ''}">${esc(j.note)}</span>` : ''}
    ${prog(t, 'now-' + t.id)}
    <span class="hw-sub"><span class="num"><b>${t.done}</b> / ${t.total}${esc(t.unit)}</span><span>${esc(e.main)}</span></span>
  </button>`;
}
function runBar() {
  const t = T(st.running.task);
  return `<div class="run"><div class="run-info"><span>진행 중 · ${esc(t.title)}</span><span class="run-timer num" id="timer">00:00</span></div>
    <button class="btn-sm ghost sq" data-act="minus" aria-label="1개 취소">${ic('minus')}</button>
    <button class="btn-sm pri" data-act="plus">${ic('plus')}1${esc(t.unit)} 완료</button>
    <button class="btn-sm ghost" data-act="stop">${ic('stop', 12)}종료</button></div>`;
}
function nextRow(after) {
  const nx = R.future.find((x) => x.start > after && x.start < R.todayEnd);
  return nx
    ? `<button class="next-row" data-act="selblock" data-id="${nx.id}" style="--c:${nx.color}"><span class="k">NEXT</span><span class="sw"></span><b>${esc(nx.title)}</b><span class="num">${fmtTime(nx.start)}</span><span class="arr">${ic('arrow', 15)}</span></button>`
    : '';
}
// 배경: Unsplash 사진 한 장(bg.webp, ran liwen). 주소 끝 #city 를 붙이면 도시 24시간 사진(city.js)
if (/city/.test(location.hash)) mountCity(document.getElementById('city'),nowMs);
else {
  const bg = new Image();
  bg.className = 'ws-bg'; bg.alt = ''; bg.draggable = false; bg.decoding = 'async';
  bg.src = new URL('./bg.webp', import.meta.url).href;
  document.getElementById('city').replaceWith(bg);
}

function renderNow() {
  if (!briefDismissed) {
    const bt = document.getElementById('briefTitle');
    bt.textContent = R.decision.title;
    // 긴 제목은 글자를 줄인다(두 줄 안쪽으로): 10자까지 그대로, 길수록 작게
    bt.style.setProperty('--fit', String(Math.max(0.5, Math.min(1, 10 / Math.max(10, [...bt.textContent].length * 0.82)))));
    document.getElementById('briefDetail').textContent = R.decision.message;
    brief.hidden = false;
  }
  const n = R.now, v = nowView(), D = R.decision;
  const box = document.getElementById('b-now');
  const link = document.getElementById('nowLink');
  if (v.kind === 'block') {
    const b = blk(v.id);
    const st_ = blockState(b), len = (b.end - b.start) / MINMS;
    const el = clamp((n - b.start) / MINMS, 0, len);
    const list = (b.tasks ?? []).map(T).filter(Boolean);
    let sel = st.running?.block === b.id ? st.running.task : S.selHw[b.id];
    if (!sel || !b.tasks.includes(sel) || (!st.running && isDone(T(sel)))) {
      const a = R.alloc.get(b.id)?.alloc.find((x) => x.min > 0);
      sel = (D.blockId === b.id && D.taskId) || a?.taskId || (list.find((t) => !isDone(t)) || list[0])?.id;
    }
    S.curSel = sel;
    const pill = st_ === 'now' ? '<span class="pill live"><i></i>Live · 지금</span>' : st_ === 'done' ? `<span class="pill done">${ic('check', 12)}완료</span>` : '<span class="pill">Next · 다음 예정</span>';
    const big = st_ === 'now' ? { v: Math.ceil(len - el), k: 'MIN LEFT', s: '남음' } : st_ === 'next' ? { v: Math.round((b.start - n) / MINMS), k: 'MIN TO GO', s: '후 시작' } : { v: '—', k: 'ENDED', s: '블록 종료' };
    const pips = Array.from({ length: Math.ceil(len / 15) }, (_, i) => {
      const f = clamp((el - i * 15) / Math.min(15, len - i * 15), 0, 1) * 100;
      return `<span class="pip" title="15분"><i data-k="pip-${b.id}-${i}" data-p="${f}" style="width:${prevW['pip-' + b.id + '-' + i] ?? 0}%"></i></span>`;
    }).join('');
    const actions = st.running ? runBar() : st_ === 'done' ? '<button class="btn-primary" disabled>이미 지난 블록</button>'
      : sel ? `<button class="btn-primary" data-act="start">${ic('play', 15)}선택한 숙제 시작<small>${esc(T(sel).title)}</small></button>` : '';
    box.innerHTML = `
      <div class="now-top">${pill}<span class="now-time num">${fmtTime(b.start)}–${fmtTime(b.end)}</span><span class="now-plan num">PLAN ${dur(len)}</span></div>
      <div class="now-hero"><h2 class="now-title">${esc(b.title)}</h2>
        <div class="now-left"><span class="big num">${big.v}</span><span class="cap"><b>${big.k}</b>${big.s}</span></div></div>
      <div class="pips" aria-label="15분 단위 진행"><span class="lbl">15′ × ${Math.ceil(len / 15)}</span>${pips}</div>
      ${judgeBanner(v.manual)}
      <div class="sec-label"><span class="kr">이 블록의 숙제</span><span>[${String(list.length).padStart(2, '0')}]</span></div>
      <div class="hw-list" role="radiogroup" aria-label="숙제 선택">${list.map((t) => hwCard(t, t.id === sel)).join('')}</div>
      <div class="now-actions">${actions}</div>
      ${nextRow(b.start)}`;
    link.innerHTML = `${ic('link', 12)}PL ${fmtTime(b.start)}`;
  } else if (v.kind === 'gap') {
    const t = T(v.task);
    const end = D.type === 'gap' && D.taskId === t.id ? D.gapEnd : (R.future.find((x) => x.start > n)?.start ?? R.todayEnd);
    const free = Math.max(0, Math.floor((end - n) / MINMS));
    box.innerHTML = `
      <div class="now-top"><span class="pill${st.running ? ' live' : ''}">${st.running ? '<i></i>Live · ' : ''}Gap · 빈 시간</span><span class="now-time num">${fmtTime(n)}–${fmtTime(end)}</span><span class="now-plan num">FREE ${dur(free)}</span></div>
      <div class="now-hero"><h2 class="now-title sm">${esc(t.title)}</h2>
        <div class="now-left"><span class="big num">${free}</span><span class="cap"><b>MIN FREE</b>비어 있음</span></div></div>
      ${judgeBanner(false)}
      <div class="sec-label"><span class="kr">빈 시간에 넣을 숙제</span><span>${esc(groupOf(t).name)}</span></div>
      <div class="hw-list" role="radiogroup" aria-label="숙제">${hwCard(t, true)}</div>
      <div class="now-actions">${st.running ? runBar() : `<button class="btn-primary" data-act="startgap" data-id="${t.id}">${ic('play', 15)}지금 시작<small>${esc(t.title)}</small></button>`}</div>
      ${nextRow(n)}`;
    link.innerHTML = `${ic('link', 12)}GAP ${fmtTime(n)}`;
  } else {
    const tomorrow = D.blockId ? blk(D.blockId) : null;
    box.innerHTML = `
      <div class="now-top"><span class="pill">${esc(D.eyebrow)}</span><span class="now-time num">${fmtTime(n)}</span></div>
      <div class="now-hero"><h2 class="now-title sm">${esc(D.title)}</h2></div>
      ${judgeBanner(false)}
      ${tomorrow ? `<button class="next-row" data-act="selblock" data-id="${tomorrow.id}" style="--c:${tomorrow.color}"><span class="k">NEXT</span><span class="sw"></span><b>${esc(tomorrow.title)}</b><span class="num">${fmtTime(tomorrow.start)}</span><span class="arr">${ic('arrow', 15)}</span></button>` : ''}`;
    link.innerHTML = `${ic('link', 12)}${esc(D.eyebrow)}`;
  }
  tickTimer();
}

// ---------- TODAY ----------
function tile(segs, key, past) {
  const qs = [25, 50, 75].map((p) => `<span class="q${past ? '' : ' dk'}" style="left:${p}%"></span>`).join('');
  return `<div class="tile${past ? ' past' : ''}">${segs.map((s, i) => `<span class="s ${s.t}" data-k="${key}-${i}" data-p="${s.w}" style="left:${s.l}%;width:${prevW[key + '-' + i] ?? 0}%"></span>`).join('')}${qs}</div>`;
}
function renderToday() {
  const d = R.todaySum;
  const live = st.running ? (nowMs() - st.running.t0) / MINMS : 0;
  const completed = d.completed + live;
  const must = d.mustExtra >= 5 ? Math.min(d.mustExtra, d.unalloc) : 0;
  let html = '';
  const pastN = Math.max(1, Math.ceil(completed / 60));
  for (let i = 0; i < pastN; i++) {
    const w = (clamp(completed - i * 60, 0, 60) / 60) * 100;
    html += `<div class="tile-wrap" style="flex:.8">${tile([{ t: 'done', l: 0, w }], 'tp' + i, true)}<span class="tile-lbl">${i === 0 ? 'DONE' : ''}</span></div>`;
  }
  html += `<span class="now-mark" aria-hidden="true"><span class="num">${fmtTime(R.now)}</span></span>`;
  const nT = Math.max(1, Math.ceil(d.avail / 60));
  const marks = [['plan', d.plannedRem], ['must', must], ['free', Math.max(0, d.avail - d.plannedRem - must)]];
  for (let i = 0; i < nT; i++) {
    const a = i * 60, segs = [];
    let acc = 0;
    for (const [t, m] of marks) {
      const s0 = clamp(acc - a, 0, 60), s1 = clamp(acc + m - a, 0, 60);
      if (s1 > s0) segs.push({ t, l: (s0 / 60) * 100, w: ((s1 - s0) / 60) * 100 });
      acc += m;
    }
    const rest = d.avail - a;
    html += `<div class="tile-wrap">${tile(segs, 'tf' + i, false)}<span class="tile-lbl">${rest >= 60 ? `+${i + 1}H` : `+${Math.round(rest)}M`}</span></div>`;
  }
  // 시간대별 흐름
  const firstB = R.todayBlocks[0];
  const s0 = Math.floor(Math.min(firstB ? firstB.start : R.now, R.now) / 3_600_000) * 3_600_000;
  const s1 = Math.max(R.todayEnd, s0 + 3_600_000), span = s1 - s0;
  const pos = (ms) => clamp(((ms - s0) / span) * 100, 0, 100);
  const fixedBars = R.todayInfo.busy.filter((f) => f.end > s0 && f.start < s1)
    .map((f) => `<i style="left:${pos(f.start)}%;width:${pos(f.end) - pos(f.start)}%;background:rgba(241,240,236,.1)" title="${esc(f.label)}"></i>`).join('');
  const bars = R.todayBlocks.map((b) => `<i style="left:${pos(b.start)}%;width:${pos(b.end) - pos(b.start)}%;background:${blockState(b) === 'done' ? 'var(--ink)' : 'var(--plan)'}" title="${esc(b.title)}"></i>`).join('');
  const ticks = [];
  for (let t = s0; t < s1; t += 3_600_000) ticks.push(t);
  ticks.push(s1);
  const ax = ticks.map((t) => `<span style="left:${pos(t)}%">${fmtTime(t)}</span>`).join('');
  const risky = [...R.tasks.values()].filter((j) => j.urgency === 'risk');
  const mustT = [...R.tasks.values()].filter((j) => j.mustToday >= 5).sort((a, b) => b.mustToday - a.mustToday);
  const line = risky.length
    ? { warn: true, txt: `마감 전 끝내기 어려운 숙제 ${risky.length}개 · ${T(risky[0].id).title}` }
    : mustT.length
      ? { warn: true, txt: `계획 밖으로 오늘 약 ${dur(r5(d.mustExtra))} 더 필요 · ‘${T(mustT[0].id).title}’${mustT.length > 1 ? ` 외 ${mustT.length - 1}개` : ''}` }
      : R.mode === 'tight'
        ? { warn: false, txt: '오래 걸리면 빠듯한 숙제가 있어요 · 마감순 탭에서 확인' }
        : { warn: false, txt: '오늘 계획대로면 마감 위험 없음' };
  document.getElementById('b-today').innerHTML = `
    <div class="td-head"><span class="td-big num">${hmShort(d.avail)}</span><span class="td-cap"><b>H:MM AVAILABLE</b>남은 가용 시간 · 취침 ${fmtTime(R.todayEnd)}까지</span><span class="td-key"><i></i>1 Block = 1H</span></div>
    <div class="tiles">${html}</div>
    <div class="legend">
      <span class="done"><i></i>완료 <b class="num">${dur(completed)}</b></span>
      <span class="plan"><i></i>계획 남음 <b class="num">${dur(d.plannedRem)}</b><span class="of">/ 오늘 ${dur(d.planTotal)}</span></span>
      ${must ? `<span class="must"><i></i>계획 밖 필요 <b class="num">${dur(r5(d.mustExtra))}</b></span>` : ''}
      <span class="free"><i></i>미배정 <b class="num">${dur(d.unalloc - must)}</b></span>
    </div>
    <div class="td-judge${line.warn ? ' warn' : ''}"><i></i>${esc(line.txt)}</div>
    <div class="strip"><div class="sec-label" style="margin-top:0"><span class="kr">시간대별 흐름</span><span>${fmtTime(s0)} — ${fmtTime(s1)}</span></div>
      <div class="strip-bar">${fixedBars}${bars}<span style="position:absolute;top:0;bottom:0;left:${pos(R.now)}%;width:2px;background:var(--ink2)"></span></div>
      <div class="strip-ax">${ax}</div></div>`;
}

// ---------- DEADLINES ----------
function dlRow(t, tag) {
  const j = J(t.id), lv = j.urgency, e = estView(t), [dbg, dfg] = DUE[lv], c = isDone(t);
  const note = j.note && !c ? `<div class="dl-note ${j.noteLevel === 'risk' ? 'risk' : 'watch'}"><i></i>${esc(j.note)}</div>` : '';
  return `<button class="dl-row lv-${lv}${c ? ' complete' : ''}" data-act="opentask" data-id="${t.id}" data-task="${t.id}" style="--rail:${RAIL[lv]};--dbg:${dbg};--dfg:${dfg}">
    <span class="rail"></span>
    <div style="min-width:0">${tag ? `<div class="dl-tag">${esc(tag)}</div>` : ''}<div class="dl-title">${esc(t.title)}</div>${note}</div>
    <div class="dl-prog">${prog(t, 'dl-' + t.id)}<span class="dl-count num"><span><b>${t.done}</b> / ${t.total}${esc(t.unit)}</span><span>${Math.round((t.done / t.total) * 100)}%</span></span></div>
    <div class="dl-due"><span class="due-chip">${c ? '완료' : ddayTxt(j.dday)}</span><span class="due-date">${dueDate(t)}${j.due ? ` ${fmtTime(j.due)}` : ''}</span></div>
    <div class="dl-est" title="${esc(e.sub)}">${esc(e.short ?? e.main)}<small>${esc(e.upper ?? (e.sub || '남은 작업'))}</small></div>
  </button>`;
}
function ring(p, c) {
  const r = 11, C = 2 * Math.PI * r;
  return `<svg class="ring" viewBox="0 0 28 28" aria-hidden="true"><circle cx="14" cy="14" r="${r}" fill="none" stroke="rgba(241,240,236,.1)" stroke-width="4"/><circle cx="14" cy="14" r="${r}" fill="none" stroke="${c}" stroke-width="4" stroke-dasharray="${C}" stroke-dashoffset="${C * (1 - p)}" transform="rotate(-90 14 14)" style="transition:stroke-dashoffset 1s var(--spring)"/></svg>`;
}
function renderDl() {
  let html = '';
  const dueSort = (a, b) => (J(a.id).due ?? Infinity) - (J(b.id).due ?? Infinity);
  // 끝낸 숙제는 휴지통으로 (2026-11-19 사용자 요청). 목록에는 남은 것만, 휴지통을 열면 끝낸 것
  const doneTs = st.tasks.filter(isDone).sort((a, b) => (b.due || '').localeCompare(a.due || ''));
  if (S.sort === 'group') {
    R.groups.forEach((gs) => {
      const g = G(gs.id);
      const ts = st.tasks.filter((t) => t.g === g.id && !isDone(t)).sort(dueSort);
      if (!ts.length) return;
      const mins = gs.exp > 0 ? `약 ${dur(r5(gs.exp))}${gs.unknown ? ' + 미추정' : ''}` : gs.unknown ? '시간 미추정' : '0분';
      html += `<div class="grp${S.open[g.id] ? ' open' : ''}" data-g="${g.id}" style="--c:${g.color}">
        <button class="grp-h" data-act="group" data-id="${g.id}" aria-expanded="${!!S.open[g.id]}">
          <span class="badge">${esc(g.badge)}</span>
          <span><div class="grp-name">${esc(g.name)}${g.sub ? `<em> · ${esc(g.sub)}</em>` : ''}</div>
          <div class="grp-meta">남은 숙제 ${gs.left}개 · ${mins}${gs.soonest != null && gs.soonest !== Infinity ? ` · 가장 빠른 마감 ${ddayTxt(gs.soonest)}` : ''}${gs.flag ? ` · <span class="${gs.flag.hot ? 'warn' : ''}">${gs.flag.txt}</span>` : ''}</div></span>
          <span class="grp-right"><span class="grp-pct">${Math.round(gs.pct * 100)}%</span>${ring(gs.pct, g.color)}<span class="chev">${ic('chevron', 18)}</span></span>
        </button>
        <div class="grp-b"><div><div class="grp-items">${ts.map((t) => dlRow(t)).join('')}</div></div></div>
      </div>`;
    });
  } else {
    const sev = { risk: 3, near: 2, attention: 1, calm: 0 };
    const ts = st.tasks.filter((t) => !isDone(t)).sort((a, b) => dueSort(a, b) || sev[J(b.id).urgency] - sev[J(a.id).urgency]);
    html = `<div class="grp open"><div class="grp-items">${ts.map((t) => { const g = groupOf(t); return dlRow(t, `${g.name}${g.sub ? ' · ' + g.sub : ''}`); }).join('')}</div></div>`;
  }
  if (!st.tasks.some((t) => !isDone(t))) html += '<p class="empty-hero" style="margin:14px 0">남은 숙제가 없어요.</p>';
  if (doneTs.length) {
    html += `<div class="grp trash${S.trash ? ' open' : ''}" style="--c:var(--ink4)">
      <button class="grp-h" data-act="trash" aria-expanded="${!!S.trash}"><span class="badge">${ic('trash', 16)}</span>
        <span><div class="grp-name">휴지통<em> · 끝낸 숙제</em></div><div class="grp-meta">${doneTs.length}개 · 눌러서 ${S.trash ? '닫기' : '보기'}${canEdit() ? ' · 항목을 누르면 완료 취소·삭제' : ''}</div></span>
        <span class="grp-right"><span class="chev">${ic('chevron', 18)}</span></span></button>
      <div class="grp-b"><div><div class="grp-items">${S.trash ? doneTs.map((t) => dlRow(t)).join('') : ''}</div></div></div>
    </div>`;
  }
  html += `<div class="dl-legend"><span><i style="background:${RAIL.calm}"></i>여유</span><span><i style="background:${RAIL.attention}"></i>주의</span><span><i style="background:${RAIL.near}"></i>임박·오늘 필요</span><span class="sep"></span><span><i style="background:var(--red)"></i>마감 전 끝내기 어려움</span></div>`;
  document.getElementById('b-dl').innerHTML = html;
  document.querySelectorAll('[data-act="sort"]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.sort === S.sort)));
}

// ---------- PLANNER ----------
function renderPl() {
  if (src && PLAN && st.source === 'live') return renderPlEdit();
  const n = R.now;
  const first = R.todayBlocks[0];
  const from = first ? Math.min(first.start, n) : n;
  const items = [
    ...R.todayInfo.busy.filter((f) => f.end > from && f.start < R.todayEnd).map((f) => ({ ...f, fixed: true })),
    ...R.todayBlocks,
    ...R.unplanned.filter((w) => w.start < R.todayEnd).map((w) => ({ ...w, gap: true })),
  ].sort((a, b) => a.start - b.start || (a.gap ? 1 : 0) - (b.gap ? 1 : 0));
  const D = R.decision;
  const rows = items.map((b) => {
    const len = (b.end - b.start) / MINMS;
    if (b.fixed) return `<div class="pl-row fixed small" style="--c:var(--ink4)"><span class="pl-time num">${fmtTime(b.start)}</span><span class="pl-rail"><i></i></span><span class="pl-card"><span class="pl-title">${esc(b.label)} · ${dur(len)}</span></span></div>`;
    if (b.gap) {
      const sugg = D.type === 'gap' && D.gapEnd === b.end ? ` → <b>${esc(T(D.taskId).title)}</b>` : '';
      return `<div class="pl-row gap small" style="--c:var(--ink4)"><span class="pl-time num">${fmtTime(b.start)}</span><span class="pl-rail"><i></i></span><span class="pl-card"><span class="pl-title">${ic('plus', 13)}빈 시간 ${dur(len)}${sugg}</span></span></div>`;
    }
    const st_ = blockState(b), ts = (b.tasks ?? []).map(T).filter(Boolean);
    const a = R.alloc.get(b.id);
    const over = a && a.alloc.some((x) => x.min <= 0 && !isDone(T(x.taskId)));
    const pill = st_ === 'now' ? '<span class="pill live"><i></i>Now</span>' : st_ === 'done' ? `<span class="pill done">${ic('check', 11)}Done</span>` : '';
    const nowbar = st_ === 'now' ? `<span class="pl-nowbar"><i data-k="pl-nb" data-p="${((n - b.start) / (b.end - b.start)) * 100}" style="width:${prevW['pl-nb'] ?? 0}%"></i></span>` : '';
    const sel = (S.selBlock ?? nowView().id) === b.id;
    return `<button class="pl-row st-${st_}${sel ? ' sel' : ''}" data-act="selblock" data-id="${b.id}" data-tasks="${esc((b.tasks ?? []).join(' '))}" style="--c:${b.color};--h:${Math.max(64, len * 1.35)}px" aria-pressed="${sel}">
      <span class="pl-time num">${fmtTime(b.start)}<small>${fmtTime(b.end)}</small></span><span class="pl-rail"><i></i></span>
      <span class="pl-card"><span class="pl-title">${esc(b.title)}${pill}</span><span class="pl-sub">${dur(len)} · ${over ? '<span class="ov">일부 안 들어감</span> · ' : ''}${esc(ts.map((t) => t.title).join(', '))}</span>${nowbar}</span>
    </button>`;
  });
  rows.push(`<div class="pl-row fixed small" style="--c:var(--ink)"><span class="pl-time num">${fmtTime(R.todayEnd)}</span><span class="pl-rail"><i></i></span><span class="pl-card"><span class="pl-title">취침</span></span></div>`);
  const sb = blk(S.selBlock ?? nowView().id) ?? R.todayBlocks.find((b) => b.end > n) ?? R.todayBlocks.at(-1);
  let detail = '';
  if (sb) {
    const a = R.alloc.get(sb.id);
    const am = (id) => a?.alloc.find((x) => x.taskId === id)?.min ?? 0;
    detail = `<div class="pl-detail"><div class="pl-detail-card" style="--c:${sb.color}">
      <div class="pd-k">Selected · NOW에 연결됨</div>
      <div class="pd-t">${esc(sb.title)}</div>
      <div class="pd-m num">${fmtTime(sb.start)}–${fmtTime(sb.end)} · ${dur((sb.end - sb.start) / MINMS)}</div>
      <div class="sec-label"><span class="kr">연결된 숙제 · 배정</span><span>[${String(sb.tasks.length).padStart(2, '0')}]</span></div>
      ${sb.tasks.map(T).filter(Boolean).map((t) => {
        const j = J(t.id), e = estView(t);
        return `<div class="pd-task" data-task="${t.id}"><span class="t">${esc(t.title)}</span>${prog(t, 'pd-' + t.id)}
          <span class="a"><span>${a && sb.end > n ? `배정 ${dur(am(t.id))}` : '지난 블록'}</span><span>필요 ${esc(e.main)}</span></span>
          <span class="c"><span class="num">${t.done} / ${t.total}${esc(t.unit)}</span><span>${esc(groupOf(t).name)} · ${ddayTxt(j.dday)}</span></span>
          ${j.note ? `<span class="n${j.noteLevel === 'risk' ? ' risk' : ''}">${esc(j.note)}</span>` : ''}</div>`;
      }).join('')}
      ${a && sb.end > n && a.slackMin >= 5 ? `<div class="pd-slack">블록 여유 ${dur(a.slackMin)} · 다른 숙제를 넣어도 돼요</div>` : ''}
    </div></div>`;
  }
  document.getElementById('b-pl').innerHTML = `<div class="pl-wrap"><div class="pl-list">${rows.join('')}</div>${detail}</div>`;
}

// ---------- PLANNER = 15577 계획 (2026-11-21) ----------
// 15577에서 타임라인을 뺀 '계획' 부분만 WS 디자인으로 옮겼다(planpanel.js, Sabathia public/decide/planpanel.js와 같은 파일).
// 날짜 고르기 · 블록 목록 · 추가/고치기 · 완료 · 순서(↑↓) · 어제 못 끝낸 것 붙이기. 고치면 planChanged()가 저장·15577 온라인 저장·다시 계산.
const minOf = (ms) => { const d = new Date(ms); return d.getHours() * 60 + d.getMinutes(); };
const panel = mountPlanner(document.getElementById('b-pl'), {
  PL,
  get: () => PLAN,
  changed: (msg) => planChanged(msg),
  today: () => R.today,
  nowMin: () => minOf(R.now),
  toast: (m) => toast(m),
  readOnly: () => !(src && st.source === 'live'),
  // 이 블록에 연결된 숙제(제목·과목으로 엔진이 묶은 것)
  extra: (b) => {
    const ts = (blk('p:' + b.id)?.tasks ?? []).map(T).filter(Boolean);
    return ts.length ? esc(ts.map((t) => t.title).join(', ')) : '';
  },
  // 오늘: 엔진이 본 지금 블록과 배정
  side: (k) => {
    if (k !== R.today) return '';
    const sb = blk(S.selBlock ?? nowView().id) ?? R.todayBlocks.find((x) => x.end > R.now);
    if (!sb) return '';
    const a = R.alloc.get(sb.id);
    const am = (id) => a?.alloc.find((x) => x.taskId === id)?.min ?? 0;
    return `<div class="pl-detail-card" style="--c:${sb.color};position:static">
      <div class="pd-k">NOW · 엔진 배정</div><div class="pd-t">${esc(sb.title)}</div>
      <div class="pd-m num">${fmtTime(sb.start)}–${fmtTime(sb.end)} · ${dur((sb.end - sb.start) / MINMS)}</div>
      <div class="sec-label"><span class="kr">연결된 숙제</span><span>[${String(sb.tasks.length).padStart(2, '0')}]</span></div>
      ${sb.tasks.map(T).filter(Boolean).map((t) => { const e = estView(t), j = J(t.id); return `<div class="pd-task"><span class="t">${esc(t.title)}</span><span class="a"><span>${a && sb.end > R.now ? `배정 ${dur(am(t.id))}` : '지난 블록'}</span><span>필요 ${esc(e.main)}</span></span><span class="c"><span class="num">${t.done} / ${t.total}${esc(t.unit)}</span><span>${ddayTxt(j.dday)}</span></span></div>`; }).join('') || '<div class="pd-slack">제목이 겹치거나 같은 과목인 숙제가 없어요</div>'}
    </div>`;
  },
});
function renderPlEdit() {
  const p = PL.dayProg(PLAN, R.today);
  document.getElementById('plSub').textContent = p.n ? `오늘 ${p.doneN}/${p.n}` : '오늘 계획';
  panel.render();
}

// ---------- 안하면 병신 (오늘 꼭 할 일, must.js) ----------
// 날짜는 판단과 같은 '논리적 하루'(취침 전까지 오늘). 닫을 때 남은 게 있으면 확인 창, 나갈 때 알림(켰을 때)
let MUST = (() => { try { return MU.normalize(JSON.parse(localStorage.getItem(MU.MUST_KEY))); } catch { return MU.normalize(null); } })();
const mustDay = () => logicalDay(settingsOf(st), nowMs()).date;
function saveMust() { try { localStorage.setItem(MU.MUST_KEY, JSON.stringify(MUST)); } catch {} }
function mustLeft() { return MU.left(MUST, mustDay()).length; }
function renderMust() {
  const day = mustDay();
  const rolled = MU.rollover(MUST, day);
  if (JSON.stringify(rolled) !== JSON.stringify(MUST)) { MUST = rolled; saveMust(); }
  const n = MUST.items.length, l = mustLeft();
  document.getElementById('mustSub').textContent = n ? (l ? `${l}개 남음` : '오늘 끝') : '오늘 꼭';
  win('must').classList.toggle('must-left', l > 0);
  const top = `<div class="mu-top${l ? ' hot' : ''}"><span class="big num">${n ? l : '—'}</span><span class="cap"><b>${!n ? 'EMPTY' : l ? 'LEFT' : 'CLEAR'}</b>${!n ? '꼭 할 것을 아래에 적어 두세요' : l ? `${n}개 중 ${l}개 남음 · 안 하면 병신` : '오늘 할 건 다 했음'}</span></div>`;
  const rows = MUST.items.map((x) => {
    const on = MU.isDoneOn(MUST, x.id, day);
    return `<li class="mu-row${on ? ' done' : ''}">
      <button class="mu-chk" data-act="mtog" data-id="${esc(x.id)}" aria-pressed="${on}"><span class="mu-box">${on ? ic('check', 14) : ''}</span><span class="mu-t">${esc(x.t)}</span>${x.daily ? '' : '<span class="mu-once">한 번</span>'}</button>
      <button class="wbtn mu-del" data-act="mdel" data-id="${esc(x.id)}" aria-label="${esc(x.t)} 지우기">${ic('close', 14)}</button></li>`;
  }).join('');
  document.getElementById('mustList').innerHTML = top + (n ? `<ul class="mu-list">${rows}</ul>` : '');
  const notifyOk = 'Notification' in window;
  document.getElementById('mustOpts').innerHTML = `
    <button data-act="mwarn" aria-pressed="${MUST.warn}">닫을 때 확인 ${MUST.warn ? '켬' : '끔'}</button>
    <button data-act="mnotify" aria-pressed="${MUST.notify && notifyOk && Notification.permission === 'granted'}">나갈 때 알림 ${MUST.notify && notifyOk && Notification.permission === 'granted' ? '켬' : '끔'}</button>`;
}
document.getElementById('mustAdd').addEventListener('submit', (e) => {
  e.preventDefault();
  const f = e.target, t = f.t.value.trim();
  if (!t) return;
  MUST = MU.add(MUST, t, f.daily.checked);
  saveMust(); f.t.value = '';
  renderMust(); renderDock(); restack();
});
async function mustAction(act, a) {
  const day = mustDay();
  if (act === 'mtog') {
    MUST = MU.toggle(MUST, a.dataset.id, day);
    if (!mustLeft() && MUST.items.length) toast('오늘 꼭 할 건 다 했어요');
  } else if (act === 'mdel') {
    const x = MUST.items.find((i) => i.id === a.dataset.id);
    if (x && !confirm(`‘${x.t}’을(를) 목록에서 지울까요?`)) return;
    MUST = MU.remove(MUST, a.dataset.id);
  } else if (act === 'mwarn') {
    MUST = { ...MUST, warn: !MUST.warn };
    toast(MUST.warn ? '남은 게 있으면 창을 닫기 전에 한 번 묻습니다 (컴퓨터 브라우저)' : '닫을 때 확인을 껐어요');
  } else if (act === 'mnotify') {
    if (MUST.notify && 'Notification' in window && Notification.permission === 'granted') {
      MUST = { ...MUST, notify: false }; toast('나갈 때 알림을 껐어요');
    } else if (!('Notification' in window) || !navigator.serviceWorker) {
      toast('이 브라우저는 알림을 못 써요 · 아이폰·아이패드는 홈 화면에 추가한 앱에서만 돼요');
    } else {
      const p = await Notification.requestPermission();
      if (p === 'granted') { MUST = { ...MUST, notify: true, lastPing: 0 }; toast('앱을 나갈 때 남은 걸 알림으로 알려 줄게요 (30분에 한 번까지)'); }
      else toast('알림 권한이 꺼져 있어요 · 설정에서 허용해 주세요');
    }
  }
  saveMust(); renderMust(); renderDock(); restack();
}
// 닫기 전에: 컴퓨터 브라우저(맥 사파리·크롬)는 '이 페이지를 나가시겠습니까' 확인 창이 뜬다(문구는 브라우저가 정함).
// 아이폰·아이패드 사파리는 탭·앱을 닫을 때 막을 방법이 없어서, 화면을 떠나는 순간 알림을 보낸다(홈 화면 앱 + 알림 허용일 때).
addEventListener('beforeunload', (e) => {
  if (!MUST.warn || !mustLeft()) return;
  e.preventDefault();
  e.returnValue = '';
});
let swReg = null;
if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('./notify-sw.js').then((r) => { swReg = r; }).catch(() => {});
}
function pingLeave() {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  const now = Date.now();
  if (!MU.shouldPing(MUST, now)) return;
  const tx = MU.leaveText(MUST, mustDay());
  if (!tx) return;
  MUST = { ...MUST, lastPing: now }; saveMust();
  const opt = { body: tx.body, tag: 'sabathia-must', renotify: true, data: { url: location.href.split('#')[0] } };
  try { if (swReg) swReg.showNotification(tx.title, opt); else new Notification(tx.title, opt); } catch {}
}
document.addEventListener('visibilitychange', () => { if (document.hidden) pingLeave(); });
addEventListener('pagehide', pingLeave);

// ---------- Dock ----------
function renderDock() {
  document.getElementById('dock').innerHTML = Object.keys(NAMES).map((id) => {
    const off = !!S.closed[id];
    const minimized = S.collapsed[id] && !off;
    const n = id === 'must' ? mustLeft() : 0;
    return `<button data-act="dock" data-id="${id}" class="${minimized ? 'min' : ''}${n ? ' must-on' : ''}" aria-label="${NAMES[id]}${n ? ` ${n}개 남음` : ''} ${off ? '창 다시 열기' : '창 앞으로'}">${NAMES[id]}${n ? `<b class="num">${n}</b>` : ''}</button>`;
  }).join('');
}

// ---------- Render all ----------
function renderHeader() {
  const { m, d, w } = dateLabel(R.today);
  const y = R.today.slice(2, 4);
  document.getElementById('dateTxt').textContent = `${m}월 ${d}일 ${w}요일`;
  document.getElementById('plSub').textContent = `${m}/${d} (${w}) 계획`;
  document.getElementById('volTag').textContent = `Vol.${y} / No.${m}`;
  document.getElementById('volMeta').textContent = `Vol.${y} No.${m}`;
}
function render() {
  R = judge(st, nowMs());
  renderHeader(); renderNow(); renderMust(); renderToday(); renderDl(); renderPl(); renderDock();
  restack();
  flush();
  S.pop = null;
}

// ---------- Timer ----------
function tickTimer() {
  const el = document.getElementById('timer');
  if (el && st.running) {
    const s = Math.max(0, Math.floor((nowMs() - st.running.t0) / 1000));
    el.textContent = `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
  }
  document.getElementById('clock').textContent = fmtTime(nowMs());
}
let lastMin = Math.floor(nowMs() / MINMS);
setInterval(() => {
  tickTimer();
  const m = Math.floor(nowMs() / MINMS);
  if (m !== lastMin) { lastMin = m; render(); }
}, 1000);

// ---------- Toast ----------
let tt;
function toast(msg) { const t = document.getElementById('toast'); t.textContent = msg; t.classList.add('on'); clearTimeout(tt); tt = setTimeout(() => t.classList.remove('on'), 2400); }

// ---------- Actions ----------
function selectBlock(id, hw) {
  if (st.running) { toast('진행 중인 숙제를 종료한 뒤 블록을 바꿀 수 있어요'); return; }
  S.selBlock = id === R.decision.blockId && !hw ? null : id;
  if (hw) S.selHw[id] = hw;
  render();
  win('now').animate([{ boxShadow: '0 0 0 6px rgba(241,240,236,.35)' }, { boxShadow: '0 0 0 0 rgba(241,240,236,0)' }], { duration: 700, easing: 'ease-out' });
}
function toFree(msg) {
  if (S.mode === 'free') return;
  const o = orgRects();
  ids.forEach((id) => { if (o[id]) S.free[id] = { ...o[id], h: S.collapsed[id] ? S.free[id]?.h || 400 : o[id].h }; });
  S.mode = 'free'; applyLayout(); if (msg) toast(msg);
}
function startTask(block, task) {
  st.running = { block, task, t0: nowMs(), units: 0 };
  save(); render();
}
document.addEventListener('click', (e) => {
  const a = e.target.closest('[data-act]'); if (!a) return;
  const act = a.dataset.act, w = a.closest('.win'), wid = w && w.dataset.id;
  switch (act) {
    case 'mode': if (a.dataset.mode === 'free') toFree(); else { S.mode = 'organized'; applyLayout(); } break;
    case 'reset': S.free = freeDefault(); S.collapsed = {}; S.closed = {}; S.split = { col: null, L: null, R: null, M: null }; S.stackH = {}; applyLayout(); toast('창 크기와 배치를 처음대로 돌렸어요'); break;
    case 'collapse': if (S.focus === wid) S.focus = null; S.collapsed[wid] = !S.collapsed[wid]; applyLayout(); break;
    case 'focus': S.focus = S.focus === wid ? null : wid; if (S.focus) front(wid); applyLayout(); break;
    case 'close':
      if (S.focus === wid) S.focus = null;
      S.closed[wid] = true; applyLayout();
      toast(`${NAMES[wid]} 창을 닫았어요 · 아래 독에서 다시 열 수 있어요`);
      break;
    case 'unfocus': S.focus = null; applyLayout(); break;
    case 'dock': { const id = a.dataset.id; S.closed[id] = false; S.collapsed[id] = false; front(id); applyLayout(); break; }
    case 'sort': S.sort = a.dataset.sort; render(); break;
    case 'mtog': case 'mdel': case 'mwarn': case 'mnotify': mustAction(act, a); break;
    case 'trash': S.trash = !S.trash; renderDl(); flush(); restack(); break;
    case 'group': {
      const g = a.dataset.id; S.open[g] = !S.open[g];
      a.closest('.grp').classList.toggle('open', S.open[g]); a.setAttribute('aria-expanded', String(S.open[g]));
      setTimeout(restack, 520);
      break;
    }
    case 'selblock': selectBlock(a.dataset.id); break;
    case 'follow': S.selBlock = null; render(); break;
    case 'opentask': {
      if (canEdit() && !a.dataset.now) { openEv(a.dataset.id); break; }
      const b = blockOfTask(a.dataset.id), j = J(a.dataset.id);
      if (b) { selectBlock(b.id, a.dataset.id); if (!st.running) toast(`NOW에 ‘${b.title}’ 블록을 표시했어요`); }
      else if (j.firstSlot) toast(`아직 블록이 없는 숙제예요 · ${fmtTime(j.firstSlot.start)} 빈 시간에 넣을 수 있어요`);
      else toast('아직 플래너 블록에 배치되지 않은 숙제예요');
      break;
    }
    case 'selhw': {
      if (st.running) { toast('진행 중에는 숙제를 바꿀 수 없어요'); break; }
      const v = nowView();
      if (v.kind === 'block') S.selHw[v.id] = a.dataset.id;
      renderNow(); renderPl(); flush(); restack();
      break;
    }
    case 'start': { const v = nowView(); startTask(v.id, S.curSel); break; }
    case 'startgap': startTask(null, a.dataset.id); break;
    case 'stop': {
      const r = st.running, sec = Math.round((nowMs() - r.t0) / 1000);
      if (sec >= 30 || r.units > 0) st.sessions.push({ taskId: r.task, start: r.t0, sec, units: Math.max(0, r.units) });
      st.running = null; save(); render();
      toast(sec >= 30 || r.units > 0 ? '기록했어요 · 페이스와 오늘 완료 시간에 반영됨' : '30초 미만이라 기록하지 않았어요');
      break;
    }
    case 'plus': {
      const t = T(st.running.task);
      if (t.done < t.total) { t.done++; st.running.units++; S.pop = t.id; }
      if (t.done >= t.total) toast(`‘${t.title}’ 완료!`);
      save(); render();
      break;
    }
    case 'minus': { const t = T(st.running.task); if (t.done > 0) { t.done--; st.running.units--; } save(); render(); break; }
  }
});
function flush() { requestAnimationFrame(() => requestAnimationFrame(() => document.querySelectorAll('[data-k]').forEach((el) => { el.style.width = el.dataset.p + '%'; prevW[el.dataset.k] = +el.dataset.p; }))); }
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && S.focus) { S.focus = null; applyLayout(); } });

// hover link: deadline/NOW task ↔ planner block
document.addEventListener('mouseover', (e) => {
  const t = e.target.closest('[data-task]');
  document.querySelectorAll('.hl').forEach((x) => x.classList.remove('hl'));
  if (!t) return;
  const id = t.dataset.task;
  document.querySelectorAll(`.pl-row[data-tasks~="${id}"], .dl-row[data-task="${id}"]`).forEach((x) => x.classList.add('hl'));
});

// ---------- Drag & resize ----------
stage.addEventListener('pointerdown', (e) => {
  const w = e.target.closest('.win'); if (!w) return;
  const id = w.dataset.id;
  if (S.mode === 'free' && !S.focus) { front(id); ids.forEach((x) => { win(x).style.zIndex = 10 + S.order.indexOf(x); win(x).classList.toggle('front', S.order[S.order.length - 1] === x); }); }
  const head = e.target.closest('.wh'), rh = e.target.closest('.rh');
  if (rh && !S.focus) return resizeWin(e, w, id, rh.dataset.dir);
  if (!head || e.target.closest('button') || S.focus || FORM === 'phone') return;
  e.preventDefault();
  const sx = e.clientX, sy = e.clientY;
  let started = false, r0;
  const move = (ev) => {
    const dx = (ev.clientX - sx) / scale, dy = (ev.clientY - sy) / scale;
    if (!started) {
      if (Math.hypot(dx, dy) < 4) return;
      started = true;
      toFree(head ? '자유 모드로 전환했어요 · 창을 원하는 곳에 두세요' : null);
      r0 = { ...S.free[id] };
      w.classList.add(head ? 'dragging' : 'resizing');
    }
    const r = S.free[id];
    if (head) {
      r.x = clamp(r0.x + dx, -r.w + 120, W - 120); r.y = clamp(r0.y + dy, TOP - 10, H - HEAD);
      w.style.left = r.x + 'px'; w.style.top = r.y + 'px';
    }
  };
  const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); w.classList.remove('dragging', 'resizing'); saveLayout(); };
  window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
});
// 창 크기 바꾸기: 자유 모드는 여덟 방향, 세로·폰 정돈 모드는 아래쪽(높이)만
const MINW = 320, MINH = 160;
function drag(e, onMove, onEnd) {
  e.preventDefault();
  const sx = e.clientX, sy = e.clientY;
  const move = (ev) => onMove((ev.clientX - sx) / scale, (ev.clientY - sy) / scale, ev);
  const up = () => { removeEventListener('pointermove', move); removeEventListener('pointerup', up); removeEventListener('pointercancel', up); onEnd?.(); saveLayout(); };
  addEventListener('pointermove', move); addEventListener('pointerup', up); addEventListener('pointercancel', up);
}
function resizeWin(e, w, id, dir) {
  if (S.mode === 'organized' && FORM !== 'wide') {
    if (dir !== 's') return;
    const h0 = w.offsetHeight;
    w.classList.add('resizing');
    return drag(e, (dx, dy) => { S.stackH[id] = Math.round(clamp(h0 + dy, MINH, 2400)); applyLayout(); }, () => w.classList.remove('resizing'));
  }
  if (S.mode !== 'free') return;
  const r = S.free[id], r0 = { ...r };
  w.classList.add('resizing');
  drag(e, (dx, dy) => {
    if (dir.includes('e')) r.w = clamp(r0.w + dx, MINW, W - r0.x - 4);
    if (dir.includes('s')) r.h = clamp(r0.h + dy, MINH, H - r0.y - 4);
    if (dir.includes('w')) { const nw = clamp(r0.w - dx, MINW, r0.x + r0.w); r.x = r0.x + r0.w - nw; r.w = nw; }
    if (dir.includes('n')) { const nh = clamp(r0.h - dy, MINH, r0.y + r0.h - (TOP - 10)); r.y = r0.y + r0.h - nh; r.h = nh; }
    Object.assign(w.style, { left: r.x + 'px', top: r.y + 'px', width: r.w + 'px', height: r.h + 'px' });
  }, () => w.classList.remove('resizing'));
}
// 정돈 모드 경계 끌기
stage.addEventListener('pointerdown', (e) => {
  const sp = e.target.closest('.split'); if (!sp) return;
  const key = sp.dataset.s, org = orgRects(), full = W - PAD * 2, avail = H - TOP - PAD - (anyClosed() ? 64 : 0);
  const l = org.now ?? org.pl, top = key === 'L' ? org.now : key === 'M' ? org.must : org.today;
  const av = key === 'R' && org.must ? avail - org.must.h - GAP : avail;
  sp.classList.add('on');
  drag(e, (dx, dy) => {
    if (key === 'col') S.split.col = clamp((l.w + dx) / full, 0.25, 0.75);
    else S.split[key] = clamp((top.h + dy) / av, 0.15, 0.85);
    applyLayout(); restack?.();
  }, () => stage.querySelector('.split.on')?.classList.remove('on'));
});
stage.addEventListener('dblclick', (e) => {
  const h = e.target.closest('.wh'); if (!h || e.target.closest('button')) return;
  const id = h.closest('.win').dataset.id; S.focus = S.focus === id ? null : id; if (S.focus) front(id); applyLayout();
});

// ---------- Fit to viewport ----------
function sizeStage() {
  Object.assign(stage.style, { width: W + 'px', height: H + 'px', transform: scale === 1 ? 'none' : `scale(${scale})` });
  stage.style.setProperty('--W', W + 'px'); stage.style.setProperty('--VH', VH + 'px'); stage.style.setProperty('--SH', H + 'px');
  document.body.style.height = Math.ceil(H * scale) + 'px';
}
function fit() {
  const was = FORM;
  measure();
  if (S._savedFree) { const L = S._savedFree; delete S._savedFree; if (L.form === FORM) S.free = { ...freeDefault(), ...L.free }; }
  else if (was !== FORM) S.free = freeDefault();
  ids.forEach((id) => { const r = S.free[id]; r.w = Math.min(r.w, W - 16); r.h = Math.min(r.h, Math.max(200, H - TOP - 8)); r.x = clamp(r.x, 0, W - r.w); r.y = clamp(r.y, TOP - 10, Math.max(TOP, H - r.h)); });
  sizeStage();
}
let fitT;
window.addEventListener('resize', () => { clearTimeout(fitT); fitT = setTimeout(() => { fit(); applyLayout(); }, 80); });
fit(); applyLayout(); render();

// ---------- 실제 데이터 (Sabathia 일정 + 15577) ----------
// 연결하지 않은 기기는 샘플로 동작. 연결하면 열 때·5분마다·화면으로 돌아올 때 다시 읽는다
// 기본은 Sabathia 일정에 바로 연결(사용자 결정: 공개돼도 됨). '연결 끊기'를 누른 기기만 샘플
const todayKey = () => logicalDay(settingsOf(st), nowMs()).date;
function paintConn() {
  document.getElementById('dlAdd').hidden = !canEdit();
  const b = document.getElementById('connBtn');
  const live = !!src && st.source === 'live';
  b.classList.toggle('live', live);
  b.textContent = !src ? '샘플 데이터' : live ? '실제 데이터' : '연결 중…';
  const el = document.getElementById('connSt');
  if (!el) return;
  if (!liveInfo) { el.textContent = src ? '' : '지금은 샘플 데이터예요.'; return; }
  const parts = [];
  if (liveInfo.events != null) parts.push(`일정 ${liveInfo.events}개`);
  if (liveInfo.blocks != null) parts.push(`15577 블록 ${liveInfo.blocks}개`);
  el.textContent = (parts.length ? parts.join(' · ') + ' 읽음' : '') + (liveInfo.errors.length ? (parts.length ? ' — ' : '') + liveInfo.errors.join(' / ') : '');
}
// 일정이 아직 없을 때(오프라인 등)는 지금 상태에서 15577 몫을 뺀 것을 시트로 쓴다
const sheetOf = () => SHEET ?? { fixed: (st.fixed || []).filter((f) => !f.from15577), tasks: st.tasks || [], groups: st.groups || [], events: st.events || [] };
function rebuild() {
  if (!src || !PLAN) return;
  const part = combine(sheetOf(), PLAN, todayKey());
  applyLive(st, part); save(); render(); paintConn();
}
let liveBusy = false;
async function refreshLive(manual) {
  if (!src || liveBusy) return;
  liveBusy = true;
  const errors = [];
  try {
    const today = todayKey();
    if (!seeded) {
      const seed = await PL.loadSeed(new URL('./data/15577.json', import.meta.url));
      PLAN = PL.newer(PLAN, seed) ?? PL.normalize(null);
      seeded = true;
    }
    await Promise.all([
      (async () => {
        try { const r = await loadEvents(src, today); SHEET = r.sheet; liveRaw.clear(); for (const e of r.raw) liveRaw.set(e.id, e); }
        catch (e) { errors.push('일정: ' + e.message); }
      })(),
      (async () => {
        if (!src.planId) return;
        try {
          const remote = await PL.cloudGet(src.planId);
          if (remote && (remote.updatedAt || 0) > (PLAN.updatedAt || 0)) PLAN = remote;
          else if ((PLAN.updatedAt || 0) > (remote?.updatedAt || 0)) cloudQueue();
        } catch (e) { errors.push('15577: ' + e.message); }
      })(),
    ]);
    PL.saveLocal(PLAN);
    liveInfo = { events: SHEET ? liveRaw.size : null, blocks: Object.values(PLAN.days).reduce((n, l) => n + l.length, 0), errors };
    rebuild();
    if (manual) toast(errors.length ? errors.join(' / ') : `실제 데이터로 바꿨어요 · 숙제 ${st.tasks.length}개 · 15577 블록 ${st.blocks.length}개`);
    else if (errors.length && !SHEET) toast(errors.join(' / '));
  } finally { liveBusy = false; paintConn(); }
}
// 15577 온라인 저장 ID가 있으면 고친 뒤 1.5초 있다가 올린다 (15577과 같은 문서, updatedAt 최신 쪽이 이김)
let cloudT = null;
function cloudQueue() {
  if (!src?.planId) return;
  clearTimeout(cloudT);
  cloudT = setTimeout(() => PL.cloudPut(src.planId, PLAN).catch((e) => toast(e.message)), 1500);
}
function planChanged(msg) {
  PLAN.updatedAt = Date.now();
  PL.saveLocal(PLAN); cloudQueue(); rebuild();
  if (msg) toast(msg);
}
const dlg = document.getElementById('conn');
function openConn() {
  const f = dlg.querySelector('form');
  f.base.value = src?.base || DEFAULT_BASE;
  f.token.value = src?.token || '';
  f.planId.value = src?.planId || '';
  paintConn();
  dlg.showModal();
}
dlg.addEventListener('close', async () => {
  const f = dlg.querySelector('form');
  if (dlg.returnValue === 'off') {
    src = null; liveInfo = null; saveSrc({ off: true });
    if (st.source === 'live') { Object.assign(st, sampleState(logicalDay(settingsOf({}), nowMs()).date)); delete st.source; save(); render(); }
    paintConn(); toast('연결을 끊고 샘플로 돌아왔어요');
    return;
  }
  if (dlg.returnValue !== 'ok') return;
  const planId = f.planId.value.trim().toLowerCase();
  if (planId && !ID_RE.test(planId)) { toast('15577 ID는 영어 소문자·숫자·-·_ 3~24자예요'); return; }
  src = { base: f.base.value.trim() || DEFAULT_BASE, token: f.token.value.trim(), planId };
  saveSrc(src); paintConn();
  await refreshLive(true);
});
document.addEventListener('click', (e) => {
  if (e.target.closest('[data-act="conn"]')) openConn();
  if (e.target.closest('[data-act="evadd"]')) openEv(null);
});

// ---------- 마감 고치기 (Sabathia 일정 API로 바로 저장) ----------
function canEdit() { return !!src && st.source === 'live' && liveRaw.size > 0; }
const evDlg = document.getElementById('evDlg');
let evId = null;
function openEv(taskId) {
  const f = evDlg.querySelector('form');
  evId = taskId && taskId.startsWith('ev:') ? taskId.slice(3) : null;
  const e = evId ? liveRaw.get(evId) : null;
  if (taskId && !e) { toast('일정 앱에서 온 숙제가 아니라 여기서 고칠 수 없어요'); return; }
  const today = logicalDay(settingsOf(st), nowMs()).date;
  document.getElementById('evH').textContent = e ? '마감 고치기' : '마감 추가';
  f.title.value = e?.title ?? '';
  f.date.value = e?.date ?? today;
  f.time.value = e?.time ?? '';
  f.kind.value = e?.kind === 'task' ? 'task' : 'deadline';
  f.cat.value = ['academy', 'school', 'report'].includes(e?.cat) ? e.cat : e ? '' : 'academy';
  f.note.value = e?.note ?? '';
  f.done.checked = !!e?.done;
  document.getElementById('evDel').hidden = !e;
  document.getElementById('evNow').hidden = !e;
  evDlg.dataset.task = taskId || '';
  evDlg.showModal();
}
evDlg.addEventListener('close', async () => {
  const v = evDlg.returnValue, f = evDlg.querySelector('form');
  if (v === 'now') { const b = document.createElement('button'); b.dataset.act = 'opentask'; b.dataset.id = evDlg.dataset.task; b.dataset.now = '1'; document.body.append(b); b.click(); b.remove(); return; }
  if (v !== 'save' && v !== 'del') return;
  try {
    if (v === 'del') {
      if (!confirm(`‘${f.title.value}’을(를) 일정에서 지울까요?`)) return;
      await sendEvent(src, 'DELETE', evId);
      toast('지웠어요');
    } else {
      const body = { title: f.title.value.trim(), date: f.date.value, time: f.time.value || null, kind: f.kind.value, cat: f.cat.value, note: f.note.value.trim(), done: f.done.checked };
      if (!body.title || !body.date) { toast('제목과 날짜를 넣어 주세요'); return; }
      if (evId) await sendEvent(src, 'PATCH', evId, body);
      else await sendEvent(src, 'POST', null, { ...body, source: 'ws' });
      toast(evId ? '저장했어요 · 일정 앱에도 반영됨' : '추가했어요 · 일정 앱에도 반영됨');
    }
    await refreshLive(false);
  } catch (err) { toast(err.message); }
});
paintConn();
refreshLive(false);
setInterval(() => refreshLive(false), 5 * 60_000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) refreshLive(false); });
document.fonts && document.fonts.ready.then(applyLayout);
