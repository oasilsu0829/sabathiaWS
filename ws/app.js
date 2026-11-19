import { createTimeline } from './corona.js';
import { mountCity } from './city.js';
// Sabathia WS — 화면. 판단은 전부 engine/judge.js가 하고, 여기서는 그 결과를 그린다.
import { judge, ddayTxt, estTxt, settingsOf } from './engine/judge.js';
import { isDone } from './engine/estimate.js';
import { sampleState } from './sample.js';
import { logicalDay } from '../src/engine/capacity.js';
import { fmtDur, fmtTime, weekdayLabel, weekdayOf, roundTo } from '../src/engine/time.js';

// ---------- Icons ----------
const P = {
  chevron: '<path d="M6 9l6 6 6-6"/>',
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
    scale = Math.min(vw / 1100, vh < 820 ? vh / 820 : vh > 1100 ? vh / 1100 : 1); // 노트북처럼 낮은 화면은 820 높이로 보고 줄인다
  } else {
    FORM = vw < 600 ? 'phone' : 'tall';
    scale = Math.min(1, vw / (FORM === 'phone' ? 360 : 600));
  }
  W = Math.round(vw / scale); VH = Math.round(vh / scale); H = VH;
}
measure();
const ids = ['now', 'today', 'dl', 'pl'];
const NAMES = { now: 'NOW', today: 'TODAY', dl: 'DEADLINES', pl: 'PLANNER' };
const freeDefault = () => {
  if (FORM !== 'wide') {
    const w = Math.min(W - PAD * 2 - 42, 640), h = Math.max(320, Math.min(560, VH - TOP - 200));
    return Object.fromEntries(ids.map((id, i) => [id, { x: PAD + i * 14, y: TOP + 12 + i * 46, w, h }]));
  }
  const sx = W / 1366, sy = H / 1024, r = (x, y, w, h) => ({ x: Math.round(x * sx), y: Math.round(y * sy), w: Math.round(w * sx), h: Math.round(h * sy) });
  return { now: r(48, 96, 560, 540), today: r(640, 88, 680, 268), dl: r(690, 384, 640, 540), pl: r(132, 580, 520, 360) };
};
const S = {
  mode: 'organized', focus: null, collapsed: {}, closed: Object.fromEntries(ids.map((id) => [id, true])), order: ['pl', 'dl', 'today', 'now'],
  free: freeDefault(), selBlock: null, selHw: {}, sort: 'group',
  open: Object.fromEntries(st.groups.map((g, i) => [g.id, i < 3])), pop: null,
};
const anyClosed = () => ids.some((id) => S.closed[id]);

// ---------- Layout ----------
// 창 내용 높이(머리 + 본문). 내용이 STACK보다 짧으면 그만큼만 차지한다
function natural(id) {
  const wb = win(id).querySelector('.wb');
  let end = 0;
  for (const c of wb.children) end = Math.max(end, c.offsetTop - wb.offsetTop + c.offsetHeight);
  return end ? HEAD + end + 22 : STACK[id];
}
const restack = () => { if (S.mode === 'organized' && !S.focus) layoutOnce(); };
// 폰·세로 화면: 열린 창을 한 줄로 쌓는다. 화면보다 짧으면 남는 높이를 나눠 채운다.
const STACK = { now: 640, today: 330, dl: 560, pl: 620 };
function stackRects() {
  const open = ids.filter((id) => !S.closed[id]);
  const avail = VH - TOP - PAD - (anyClosed() ? 64 : 0);
  const want = open.map((id) => (S.collapsed[id] ? HEAD : Math.min(STACK[id], natural(id))));
  const used = want.reduce((a, b) => a + b, 0) + GAP * Math.max(0, open.length - 1);
  const grow = open.filter((id) => !S.collapsed[id]).length;
  const extra = used < avail && grow ? (avail - used) / grow : 0;
  const out = {};
  let y = TOP;
  open.forEach((id, i) => { const h = Math.round(want[i] + (S.collapsed[id] ? 0 : extra)); out[id] = { x: PAD, y, w: W - PAD * 2, h }; y += h + GAP; });
  return out;
}
function orgRects() {
  if (FORM !== 'wide') return stackRects();
  const avail = H - TOP - PAD - (anyClosed() ? 64 : 0);
  const L = ['now', 'pl'].filter((id) => !S.closed[id]), Rr = ['today', 'dl'].filter((id) => !S.closed[id]);
  const full = W - PAD * 2;
  let lw = Math.round(clamp(full * 0.443, 480, 820)), rx = PAD + lw + GAP, rw = full - lw - GAP;
  if (!L.length) { rx = PAD; rw = full; }
  if (!Rr.length) lw = full;
  // 위 창 높이 = 내용만큼(NOW 240~72%, TODAY 160~50%), 남는 높이는 아래 창(PLANNER·DEADLINES)
  const pref = { now: clamp(natural('now'), 240, Math.round(avail * 0.72)), today: clamp(natural('today'), 160, Math.round(avail * 0.5)) };
  const col = (list, x, w) => {
    if (!list.length) return {};
    if (list.length === 1) { const a = list[0]; return { [a]: { x, y: TOP, w, h: S.collapsed[a] ? HEAD : avail } }; }
    const [a, b] = list, ca = S.collapsed[a], cb = S.collapsed[b];
    const ha = ca ? HEAD : cb ? avail - GAP - HEAD : pref[a];
    const hb = cb ? HEAD : avail - GAP - ha;
    return { [a]: { x, y: TOP, w, h: ha }, [b]: { x, y: TOP + ha + GAP, w, h: hb } };
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
let settleT;
// 창 폭이 바뀌면 애니메이션이 끝난 뒤(0.6초) 내용 높이를 다시 재서 맞춘다
function applyLayout() { layoutOnce(); clearTimeout(settleT); if (S.mode === 'organized' && !S.focus) settleT = setTimeout(layoutOnce, 650); }
function layoutOnce() {
  if (FORM === 'phone' && S.mode === 'free') S.mode = 'organized';
  stage.className = (S.mode === 'free' ? 'free' : 'organized') + ' f-' + FORM;
  stage.classList.toggle('has-closed', anyClosed());
  document.getElementById('dayRing').hidden = ids.some((id) => !S.closed[id]);
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
  document.getElementById('scrim').classList.toggle('on', !!S.focus);
  document.querySelectorAll('[data-act="mode"]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.mode === S.mode)));
  renderDock();
}
const front = (id) => { S.order = S.order.filter((x) => x !== id).concat(id); };

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
const renderTimeline = createTimeline(document.getElementById('dayRing'),nowMs);
mountCity(document.getElementById('city'),nowMs);

function renderNow() {
  renderTimeline(R.now,settingsOf(st),st.fixed ?? [],R.blocks);
  if (!briefDismissed) {
    document.getElementById('briefTitle').textContent = R.decision.title;
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
  if (S.sort === 'group') {
    R.groups.forEach((gs) => {
      const g = G(gs.id);
      const ts = st.tasks.filter((t) => t.g === g.id).sort((a, b) => isDone(a) - isDone(b) || dueSort(a, b));
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
    const ts = [...st.tasks].sort((a, b) => isDone(a) - isDone(b) || dueSort(a, b) || sev[J(b.id).urgency] - sev[J(a.id).urgency]);
    html = `<div class="grp open"><div class="grp-items">${ts.map((t) => { const g = groupOf(t); return dlRow(t, `${g.name}${g.sub ? ' · ' + g.sub : ''}`); }).join('')}</div></div>`;
  }
  html += `<div class="dl-legend"><span><i style="background:${RAIL.calm}"></i>여유</span><span><i style="background:${RAIL.attention}"></i>주의</span><span><i style="background:${RAIL.near}"></i>임박·오늘 필요</span><span class="sep"></span><span><i style="background:var(--red)"></i>마감 전 끝내기 어려움</span></div>`;
  document.getElementById('b-dl').innerHTML = html;
  document.querySelectorAll('[data-act="sort"]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.sort === S.sort)));
}

// ---------- PLANNER ----------
function renderPl() {
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

// ---------- Dock ----------
function renderDock() {
  document.getElementById('dock').innerHTML = Object.keys(NAMES).map((id) => {
    const off = !!S.closed[id];
    const minimized = S.collapsed[id] && !off;
    return `<button data-act="dock" data-id="${id}" class="${minimized ? 'min' : ''}" aria-label="${NAMES[id]} ${off ? '창 다시 열기' : '창 앞으로'}">${NAMES[id]}</button>`;
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
  renderHeader(); renderNow(); renderToday(); renderDl(); renderPl();
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
    case 'reset': S.free = freeDefault(); S.collapsed = {}; S.closed = {}; applyLayout(); break;
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
    case 'group': {
      const g = a.dataset.id; S.open[g] = !S.open[g];
      a.closest('.grp').classList.toggle('open', S.open[g]); a.setAttribute('aria-expanded', String(S.open[g]));
      setTimeout(restack, 520);
      break;
    }
    case 'selblock': selectBlock(a.dataset.id); break;
    case 'follow': S.selBlock = null; render(); break;
    case 'opentask': {
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
  const head = e.target.closest('.wh'), rz = e.target.closest('.rz');
  if ((!head && !rz) || e.target.closest('button') || S.focus || FORM === 'phone') return;
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
    } else {
      r.w = clamp(r0.w + dx, 340, W - r.x - 8); r.h = clamp(r0.h + dy, 200, H - r.y - 8);
      w.style.width = r.w + 'px'; w.style.height = r.h + 'px';
    }
  };
  const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); w.classList.remove('dragging', 'resizing'); };
  window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
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
  if (was !== FORM) S.free = freeDefault();
  else ids.forEach((id) => { const r = S.free[id]; r.w = Math.min(r.w, W - 16); r.h = Math.min(r.h, Math.max(200, H - TOP - 8)); r.x = clamp(r.x, 0, W - r.w); r.y = clamp(r.y, TOP - 10, Math.max(TOP, H - r.h)); });
  sizeStage();
}
let fitT;
window.addEventListener('resize', () => { clearTimeout(fitT); fitT = setTimeout(() => { fit(); applyLayout(); }, 80); });
fit(); applyLayout(); render();
document.fonts && document.fonts.ready.then(applyLayout);
