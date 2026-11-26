// Sabathia WS 판단 엔진 (규칙 기반, AI 호출 없음).
//
// 입력: 학원·학교별 숙제(남은 분량·페이스·마감) + 플래너 블록 + 고정 일정(학교·학원·식사) + 기상/취침.
// 순서:
//   1) 남은 시간 추정 — 분량 × 페이스, 낙관/예상/비관 3개 시나리오 (estimate.js)
//   2) 플래너 배정 — 블록 시간을 블록 안 숙제에 마감 순으로 나눠 줌
//   3) 마감 검사 — 계획에 못 들어간 나머지를 "아직 아무것도 잡히지 않은 빈 시간"에
//      마감 순(EDF)으로 넣어 본다. 수면·고정 일정은 절대 쓰지 않는다.
//        · 예상 시나리오에서도 마감 전에 못 끝냄 → risk  (마감 전 끝내기 어려움)
//        · 비관 시나리오에서만 못 끝냄          → tight (빠듯할 수 있음)
//        · 끝낼 수는 있지만 계획이 모자람       → plan  (계획 더 필요)
//   4) 오늘 꼭 해야 할 양 — 나머지를 마감 직전부터 거꾸로(ALAP) 채웠을 때도 오늘에 걸리는 분
//   5) 지금 판단 — 지금 블록에서 먼저 할 숙제 / 빈 시간에 넣을 숙제 / 30분 미루면 생기는 손실
//
// 경고 원칙: 다음 날로 밀려도 마감이 안전하면 경고하지 않는다. 숫자는 범위로 말한다.
import { MIN, at, daysBetween, fmtDur, fmtRange, fmtTime, roundTo } from '../../src/engine/time.js';
import { buildDays, logicalDay } from '../../src/engine/capacity.js';
import { estimate, isDone } from './estimate.js';

export const DEFAULTS = {
  days: Array.from({ length: 7 }, () => ({ wake: '07:00', sleep: '23:20' })),
  minSlotMin: 10, // 이보다 짧은 빈 시간은 배치에 쓰지 않음
  delayMin: 30, // "미루면?" 비교 간격
  planGapMin: 15, // 계획이 이만큼 모자랄 때부터 알림
  horizonDays: 7,
};

const SC = ['lo', 'exp', 'hi'];
const EPS = 1; // 분. 이하 차이는 무시
const TIER = { performance: 2, homework: 1 };
const SEVERITY = { overdue: 5, risk: 4, tight: 3, plan: 2, ok: 1, unknown: 0, done: -1 };

export const settingsOf = (state) => ({ ...DEFAULTS, ...(state.settings ?? {}) });

export function blockRange(b) {
  const start = at(b.date, b.start);
  let end = at(b.date, b.end);
  if (end <= start) end += 86_400_000;
  return { start, end };
}

export function dueOf(task, group) {
  if (!task.due) return null;
  return at(task.due, task.dueTime ?? group?.dueTime ?? '08:00');
}

export function ddayTxt(d) {
  if (d == null) return '마감 없음';
  if (d < 0) return '지남';
  return d === 0 ? '오늘' : d === 1 ? '내일' : `D-${d}`;
}

const r5 = (v) => Math.max(5, roundTo(v, 5));
/** 불확실성을 담은 분량 표현: "약 40분~1시간", 비관에서만 생기면 "최대 약 20분" */
export function lossTxt(lo, exp, hi) {
  const a = lo >= 5 ? lo : exp >= 5 ? exp : null;
  if (a == null) return `최대 약 ${fmtDur(r5(hi))}`;
  if (r5(a) >= r5(hi)) return `약 ${fmtDur(r5(hi))}`;
  return fmtRange(a, hi);
}
export const estTxt = (e) => (e.exp <= 0 ? '—' : r5(e.lo) >= r5(e.hi) ? `약 ${fmtDur(r5(e.exp))}` : fmtRange(e.lo, e.hi));

// ───────── 시간 창 조작 ─────────
function subtract(windows, busy) {
  let free = windows.map((w) => ({ ...w }));
  for (const b of busy) {
    const next = [];
    for (const f of free) {
      if (b.end <= f.start || b.start >= f.end) next.push(f);
      else {
        if (b.start > f.start) next.push({ start: f.start, end: b.start });
        if (b.end < f.end) next.push({ start: b.end, end: f.end });
      }
    }
    free = next;
  }
  return free;
}

/** windows에서 until 이전 부분만 써서 minutes를 채운다. back=true면 가장 늦은 시간부터. */
function take(windows, minutes, until, back = false) {
  let need = minutes * MIN;
  const parts = windows.map((w) => [w]);
  const order = [...parts.keys()];
  if (back) order.reverse();
  const segments = [];
  for (const i of order) {
    if (need <= 0) break;
    const w = parts[i][0];
    const end = Math.min(w.end, until);
    if (end <= w.start) continue;
    const g = Math.min(end - w.start, need);
    if (back) {
      segments.push({ start: end - g, end });
      parts[i] = [{ start: w.start, end: end - g }, { start: end, end: w.end }];
    } else {
      segments.push({ start: w.start, end: w.start + g });
      parts[i] = [{ start: w.start + g, end: w.end }];
    }
    need -= g;
  }
  const rest = parts.flat().filter((w) => w.end - w.start > 0).sort((a, b) => a.start - b.start);
  segments.sort((a, b) => a.start - b.start);
  return { segments, rest, placed: minutes - need / MIN };
}

const sumMin = (segs, from = -Infinity, to = Infinity) =>
  segs.reduce((s, g) => s + Math.max(0, Math.min(g.end, to) - Math.max(g.start, from)) / MIN, 0);

// ───────── 핵심 계산 ─────────
export function core(state, nowMs) {
  const settings = settingsOf(state);
  const tasks = state.tasks ?? [];
  const groups = new Map((state.groups ?? []).map((g) => [g.id, g]));
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const idx = new Map(tasks.map((t, i) => [t.id, i]));
  const { date: today, sleeping } = logicalDay(settings, nowMs);
  const open = tasks.filter((t) => !isDone(t));
  const dues = new Map(tasks.map((t) => [t.id, dueOf(t, groups.get(t.g))]));
  const dueKey = (t) => dues.get(t.id) ?? Infinity;
  const order = (a, b) =>
    dueKey(a) - dueKey(b) || (TIER[b.kind] ?? 0) - (TIER[a.kind] ?? 0) || idx.get(a.id) - idx.get(b.id);

  let far = settings.horizonDays;
  for (const t of open) if (t.due) far = Math.max(far, daysBetween(today, t.due) + 1);
  const days = buildDays({ settings, fixed: state.fixed ?? [] }, nowMs, Math.min(far, 28));
  const todayInfo = days[0];
  const todayStart = todayInfo.awake.start;
  const todayEnd = todayInfo.awake.end;

  const blocks = (state.blocks ?? [])
    .map((b) => ({ ...b, ...blockRange(b) }))
    .sort((a, b) => a.start - b.start);
  const future = blocks.filter((b) => b.end > nowMs && !b.doneIn15577 &&
    !(b.tasks?.length && b.tasks.every((id) => byId.has(id) && isDone(byId.get(id))))).map((b) => ({ ...b, from: Math.max(b.start, nowMs) }));
  const openIn = (b) => (b.tasks ?? []).map((id) => byId.get(id)).filter((t) => t && !isDone(t));

  // 아직 아무 블록도 잡히지 않은 빈 시간 (수면·고정 일정 제외)
  const gaps = subtract(
    days.flatMap((d) => d.free),
    future.map((b) => ({ start: b.from, end: b.end })),
  );
  const unplanned = gaps.filter((w) => w.end - w.start >= settings.minSlotMin * MIN);

  // 1) 추정 — 페이스가 없으면 블록 시간을 숙제 수로 나눈 몫을 믿는다
  const share = new Map();
  for (const b of future) {
    const ts = openIn(b);
    for (const t of ts) share.set(t.id, (share.get(t.id) ?? 0) + (b.end - b.from) / MIN / ts.length);
  }
  const est = new Map(open.map((t) => [t.id, estimate(t, state, share.get(t.id) ?? 0)]));

  // 2) 플래너 배정 — 블록 안에서 마감이 빠른 숙제부터 필요한 만큼
  const allocate = (s) => {
    const left = new Map(open.map((t) => [t.id, est.get(t.id)[s]]));
    const planned = new Map(open.map((t) => [t.id, 0]));
    const perBlock = new Map();
    for (const b of future) {
      let cursor = b.from;
      const alloc = [];
      for (const t of openIn(b).sort(order)) {
        const due = dueKey(t);
        const give = Math.min(left.get(t.id), Math.max(0, (Math.min(b.end, due) - cursor) / MIN));
        if (give <= 0) {
          alloc.push({ taskId: t.id, min: 0, start: cursor, end: cursor, afterDue: b.from >= due });
          continue;
        }
        alloc.push({ taskId: t.id, min: give, start: cursor, end: cursor + give * MIN });
        cursor += give * MIN;
        left.set(t.id, left.get(t.id) - give);
        planned.set(t.id, planned.get(t.id) + give);
      }
      perBlock.set(b.id, { alloc, slackMin: (b.end - cursor) / MIN });
    }
    return { left, planned, perBlock };
  };
  const A = Object.fromEntries(SC.map((s) => [s, allocate(s)]));

  // 3) 마감 검사 — 나머지를 빈 시간에 마감 순으로 (마감 이후 시간은 쓰지 않음)
  const asap = (left) => {
    let win = unplanned;
    const res = new Map();
    for (const t of open.filter((x) => left.get(x.id) > 0).sort(order)) {
      const need = left.get(t.id);
      const p = take(win, need, dueKey(t));
      win = p.rest;
      res.set(t.id, { segments: p.segments, short: dues.get(t.id) == null ? 0 : Math.max(0, need - p.placed) });
    }
    return res;
  };
  const P = Object.fromEntries(SC.map((s) => [s, asap(A[s].left)]));

  // 4) 오늘 꼭 해야 할 양 — 가장 늦게 미뤄도 오늘에 걸리는 부분 (예상 시나리오)
  const must = new Map();
  {
    let win = unplanned;
    const late = open.filter((t) => A.exp.left.get(t.id) > 0 && dues.get(t.id) != null).sort((a, b) => order(b, a));
    for (const t of late) {
      const need = A.exp.left.get(t.id);
      const p = take(win, need, dueKey(t), true);
      win = p.rest;
      must.set(t.id, sumMin(p.segments, -Infinity, todayEnd) + Math.max(0, need - p.placed));
    }
  }

  // 숙제별 판단
  const th = settings.planGapMin;
  const perTask = new Map();
  for (const t of tasks) {
    const due = dues.get(t.id);
    const dday = t.due ? daysBetween(today, t.due) : null;
    const base = { id: t.id, due, dday, group: groups.get(t.g) };
    if (isDone(t)) {
      perTask.set(t.id, { ...base, status: 'done', urgency: 'calm', est: { lo: 0, exp: 0, hi: 0, source: 'done' }, planned: 0, note: null });
      continue;
    }
    const e = est.get(t.id);
    const planned = A.exp.planned.get(t.id);
    const leftover = Object.fromEntries(SC.map((s) => [s, A[s].left.get(t.id)]));
    const short = Object.fromEntries(SC.map((s) => [s, P[s].get(t.id)?.short ?? 0]));
    const mustToday = must.get(t.id) ?? 0;
    const firstSlot = P.exp.get(t.id)?.segments[0] ?? null;
    let status;
    if (due != null && due <= nowMs) status = 'overdue';
    else if (e.source === 'none') status = 'unknown';
    else if (short.exp > EPS) status = 'risk';
    else if (short.hi > EPS) status = 'tight';
    else if (leftover.exp >= th || (mustToday >= 5 && leftover.exp >= 5)) status = 'plan';
    else status = 'ok';

    let note = null;
    if (status === 'overdue') note = '마감이 지났어요';
    else if (status === 'risk') note = `남은 시간을 다 써도 마감 전 ${lossTxt(short.lo, short.exp, short.hi)} 부족`;
    else if (status === 'tight') note = `오래 걸리면 마감 전 ${lossTxt(0, 0, short.hi)} 부족할 수 있음`;
    else if (status === 'plan') {
      const need = lossTxt(leftover.lo, leftover.exp, leftover.hi);
      note = planned > EPS ? `마감 전 계획 ${fmtDur(planned)} · ${need} 더 필요` : `계획 없음 · ${need} 필요`;
      if (mustToday >= 5) note += ' · 오늘 안에';
    }

    let urgency;
    if (status === 'overdue' || status === 'risk') urgency = 'risk';
    else if ((dday != null && dday <= 1) || mustToday >= 5) urgency = 'near';
    else if (status === 'tight' || status === 'plan' || (dday != null && dday <= 3)) urgency = 'attention';
    else urgency = 'calm';

    perTask.set(t.id, {
      ...base,
      status,
      urgency,
      est: e,
      planned,
      leftover,
      short,
      mustToday,
      firstSlot,
      note,
      noteLevel: urgency === 'risk' ? 'risk' : note ? 'watch' : null,
    });
  }

  // 학원·학교별 요약
  const groupSum = (state.groups ?? []).map((g) => {
    const ts = tasks.filter((t) => t.g === g.id);
    const left = ts.filter((t) => !isDone(t));
    const worst = left.map((t) => perTask.get(t.id).status).sort((a, b) => SEVERITY[b] - SEVERITY[a])[0] ?? 'done';
    return {
      id: g.id,
      left: left.length,
      exp: left.reduce((s, t) => s + perTask.get(t.id).est.exp, 0),
      unknown: left.some((t) => perTask.get(t.id).status === 'unknown'),
      soonest: left.length ? Math.min(...left.map((t) => perTask.get(t.id).dday ?? Infinity)) : null,
      pct: ts.length ? ts.reduce((s, t) => s + Math.min(1, (t.done || 0) / (t.total || 1)), 0) / ts.length : 0,
      worst,
      flag:
        worst === 'overdue' || worst === 'risk'
          ? { txt: '마감 위험', hot: true }
          : worst === 'tight'
            ? { txt: '빠듯할 수 있음', hot: false }
            : worst === 'plan'
              ? { txt: '계획 더 필요', hot: false }
              : null,
    };
  });

  // 오늘 요약
  const todayBlocks = blocks.filter((b) => b.start < todayEnd && b.end > todayStart);
  const avail = sleeping ? 0 : todayInfo.freeMin;
  const unalloc = sleeping ? 0 : sumMin(gaps, nowMs, todayEnd);
  const plannedRem = Math.max(0, avail - unalloc);
  const completed = (state.sessions ?? [])
    .filter((x) => x.start >= todayStart && x.start < todayEnd)
    .reduce((s, x) => s + (x.sec || 0) / 60, 0);
  const mustExtra = [...must.values()].reduce((s, v) => s + v, 0);
  const totalShort = Object.fromEntries(SC.map((s) => [s, [...P[s].values()].reduce((m, r) => m + r.short, 0)]));

  const statuses = [...perTask.values()].map((x) => x.status);
  const mode = statuses.some((s) => s === 'risk' || s === 'overdue') ? 'risk' : statuses.includes('tight') ? 'tight' : 'normal';

  return {
    now: nowMs,
    today,
    sleeping,
    mode,
    settings,
    days,
    todayInfo,
    todayStart,
    todayEnd,
    blocks,
    todayBlocks,
    future,
    unplanned,
    alloc: A.exp.perBlock,
    tasks: perTask,
    groups: groupSum,
    totalShort,
    todaySum: {
      avail,
      planTotal: todayBlocks.reduce((s, b) => s + (b.end - b.start) / MIN, 0),
      plannedRem,
      unalloc,
      remain: Math.max(0, unalloc - mustExtra),
      completed,
      mustExtra,
    },
    order,
  };
}

// ───────── 지금 판단 ─────────
function delayCheck(state, C, nowMs) {
  const d = C.settings.delayMin;
  const D = core(state, nowMs + d * MIN);
  const diff = Object.fromEntries(SC.map((s) => [s, Math.max(0, D.totalShort[s] - C.totalShort[s])]));
  if (diff.exp > EPS) return { level: 'high', diff, text: `${d}분 미루면 마감 전 ${lossTxt(diff.lo, diff.exp, diff.hi)} 부족해져요` };
  if (diff.hi > EPS) return { level: 'medium', diff, text: `${d}분 미루면, 오래 걸릴 경우 마감 전 ${lossTxt(0, 0, diff.hi)} 부족할 수 있어요` };
  return { level: 'none', diff, text: `${d}분 미뤄도 마감은 안전해요` };
}

function dueTxt(j) {
  if (j.due == null) return null;
  return `${ddayTxt(j.dday)} ${fmtTime(j.due)} 마감`;
}

export function decide(state, C, nowMs) {
  const byId = new Map((state.tasks ?? []).map((t) => [t.id, t]));
  const J = (id) => C.tasks.get(id);
  const nextB = C.future.find((b) => b.start > nowMs && b.start < C.todayEnd) ?? null;

  if (C.sleeping || nowMs >= C.todayEnd) {
    const tomorrow = C.future.find((b) => b.start >= C.todayEnd) ?? null;
    return {
      type: 'rest',
      eyebrow: 'REST',
      title: '지금은 쉬는 시간',
      message:
        C.mode === 'risk'
          ? '수면 시간은 줄이지 않아요. 부족한 마감은 다른 숙제를 줄이거나 마감 조정이 필요해요.'
          : '수면 시간은 줄이지 않아요. 남은 숙제는 다음 일정에 반영해 뒀어요.',
      blockId: tomorrow?.id ?? null,
    };
  }

  const cur = C.future.find((b) => b.start <= nowMs && nowMs < b.end);
  if (cur) {
    const a = C.alloc.get(cur.id);
    const first = a.alloc.find((x) => x.min > 0) ?? a.alloc[0];
    const taskId = first?.taskId ?? null;
    if (taskId) {
      const j = J(taskId);
      const bits = [dueTxt(j), first.min > 0 ? `이 블록 배정 ${fmtDur(Math.round(first.min))}` : null].filter(Boolean);
      const later = a.alloc.filter((x) => x.taskId !== taskId && x.min <= 0 && !x.afterDue);
      if (later.length) bits.push(`${later.map((x) => `‘${byId.get(x.taskId).title}’`).join(', ')}는 이 블록에 안 들어가요`);
      return {
        type: 'block',
        eyebrow: 'NOW · 판단',
        title: `‘${byId.get(taskId).title}’ 먼저`,
        message: bits.join(' · '),
        blockId: cur.id,
        taskId,
        delay: delayCheck(state, C, nowMs),
      };
    }
  }

  const fixedNow = C.todayInfo.busy.find((f) => f.start <= nowMs && nowMs < f.end);
  if (fixedNow) {
    return {
      type: 'fixed',
      eyebrow: 'FIXED',
      title: `${fixedNow.label} 중`,
      message: `${fmtTime(fixedNow.end)}까지${nextB ? ` · 다음 ‘${nextB.title}’ ${fmtTime(nextB.start)}` : ''}`,
      blockId: nextB?.id ?? null,
    };
  }

  // 빈 시간: 지금 들어갈 수 있는 창
  // (블록 숙제를 다 끝냈다면 남은 블록 시간도 빈 시간으로 본다)
  const w = cur ? { start: nowMs, end: cur.end } : C.unplanned.find((x) => x.start <= nowMs + MIN && x.end > nowMs);
  // 후보: 오늘 꼭 필요 → 위험·빠듯·계획 부족(마감순) → 시간 추정 전(마감순) → 마감 지난 것
  const rank = (j) =>
    j.mustToday >= 5 ? 0 : ['risk', 'tight', 'plan'].includes(j.status) ? 1 : j.status === 'unknown' ? 2 : 3;
  const cands = (state.tasks ?? [])
    .filter((t) => {
      const j = J(t.id);
      if (t.kind === 'errand') return false;
      if (['risk', 'tight', 'plan'].includes(j.status)) return (j.leftover?.exp ?? 0) >= 5;
      return j.status === 'unknown' || j.status === 'overdue';
    })
    .sort((a, b) => rank(J(a.id)) - rank(J(b.id)) || C.order(a, b));
  if (w && cands.length) {
    const t = cands[0];
    const j = J(t.id);
    const gapMin = (w.end - nowMs) / MIN;
    return {
      type: 'gap',
      eyebrow: 'GAP · 빈 시간',
      title: `빈 시간에 ‘${t.title}’`,
      message: `${fmtTime(w.end)}까지 ${fmtDur(Math.floor(gapMin))} 비어 있어요 · ${
        j.status === 'unknown' ? `${dueTxt(j)} · 분량을 몰라 시간은 시작해 보고 잴게요` : j.note ?? dueTxt(j)
      }`,
      taskId: t.id,
      gapMin,
      gapEnd: w.end,
      blockId: null,
      delay: delayCheck(state, C, nowMs),
    };
  }
  if (nextB) {
    return {
      type: 'next',
      eyebrow: 'NEXT',
      title: `${fmtTime(nextB.start)} ‘${nextB.title}’`,
      message: `${fmtDur(Math.round((nextB.start - nowMs) / MIN))} 후 시작 · 그 전엔 쉬어도 돼요`,
      blockId: nextB.id,
    };
  }
  return {
    type: 'clear',
    eyebrow: 'ALL CLEAR',
    title: '오늘 할 일 끝',
    message: !w
      ? '오늘 쓸 수 있는 빈 시간이 없어요'
      : C.mode === 'normal'
        ? '마감 위험 없음 · 남은 시간은 복습이나 휴식에 써도 돼요'
        : '남은 숙제는 다른 날 빈 시간에 들어가 있어요',
    blockId: null,
  };
}

/** 화면이 쓰는 판단 결과 전체 */
export function judge(state, nowMs) {
  const C = core(state, nowMs);
  C.decision = decide(state, C, nowMs);
  return C;
}
