// 상태 저장소: localStorage에 저장, 변경 시 구독자에게 알림.
import { DEFAULT_SETTINGS } from './engine/config.js';
import { makeTask, uid, estimateOf, remainingOf } from './engine/planner.js';

const KEY = 'sabathia.v1';
const SCHEMA = 1;

function blank() {
  return { schema: SCHEMA, settings: structuredClone(DEFAULT_SETTINGS), fixed: [], tasks: [], log: [], onboarded: false };
}

function migrate(raw) {
  const s = { ...blank(), ...raw };
  s.settings = { ...structuredClone(DEFAULT_SETTINGS), ...(raw.settings ?? {}) };
  s.settings.thresholds = { ...DEFAULT_SETTINGS.thresholds, ...(raw.settings?.thresholds ?? {}) };
  s.settings.uncertainty = { ...DEFAULT_SETTINGS.uncertainty, ...(raw.settings?.uncertainty ?? {}) };
  s.tasks = (raw.tasks ?? []).map((t) => makeTask(t));
  s.schema = SCHEMA;
  return s;
}

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? migrate(JSON.parse(raw)) : blank();
  } catch {
    return blank();
  }
}

export const store = {
  state: load(),
  subs: new Set(),
  persistOk: true,
  subscribe(fn) {
    this.subs.add(fn);
    return () => this.subs.delete(fn);
  },
  commit() {
    try {
      localStorage.setItem(KEY, JSON.stringify(this.state));
      this.persistOk = true;
    } catch {
      this.persistOk = false;
    }
    for (const fn of this.subs) fn(this.state);
  },
  replace(next) {
    this.state = migrate(next);
    this.commit();
  },
};

// ───────── 작업 ─────────
export function upsertTask(partial) {
  const s = store.state;
  const i = s.tasks.findIndex((t) => t.id === partial.id);
  if (i >= 0) s.tasks[i] = makeTask({ ...s.tasks[i], ...partial });
  else s.tasks.push(makeTask(partial));
  store.commit();
}

export function addTasks(list) {
  store.state.tasks.push(...list);
  store.commit();
}

export function deleteTask(id) {
  store.state.tasks = store.state.tasks.filter((t) => t.id !== id);
  store.commit();
}

export function setStatus(id, status) {
  const t = store.state.tasks.find((x) => x.id === id);
  if (!t) return;
  t.status = status;
  t.completedAt = status === 'done' ? Date.now() : null;
  if (status === 'doing' && !t.startedAt) t.startedAt = Date.now();
  store.commit();
}

/** 체크인 "아직이야": 상태를 바꾸지 않고 확인 요청만 닫는다 */
export function ackTask(id) {
  const t = store.state.tasks.find((x) => x.id === id);
  if (t) t.ackAt = Date.now();
  store.commit();
}

/**
 * 남은 필요 시간 수정. 일정 비용(분)과 사유(학습 가치 여부)를 분리해 기록한다.
 * reason: 'difficulty' | 'concept' | 'faster' | 'other'
 */
export function adjustRemaining(id, minutes, reason) {
  const t = store.state.tasks.find((x) => x.id === id);
  if (!t) return;
  const from = remainingOf(t);
  t.remainingMin = Math.max(0, Math.round(minutes));
  store.state.log.push({
    id: uid('log'),
    type: 'adjust',
    taskId: id,
    subject: t.subject,
    kind: t.kind,
    estimate: estimateOf(t),
    from,
    to: t.remainingMin,
    scheduleCostMin: t.remainingMin - from, // 일정 비용: 다른 작업의 가능 시간이 줄어든 양
    learning: reason === 'concept', // 학습 가치: 개념 확인 등 실제 학습이었을 가능성
    reason,
    at: Date.now(),
  });
  store.commit();
}

// ───────── 고정 일정 ─────────
export function upsertFixed(f) {
  const s = store.state;
  const i = s.fixed.findIndex((x) => x.id === f.id);
  if (i >= 0) s.fixed[i] = { ...s.fixed[i], ...f };
  else s.fixed.push({ id: uid('f'), ...f });
  store.commit();
}

export function deleteFixed(id) {
  store.state.fixed = store.state.fixed.filter((f) => f.id !== id);
  store.commit();
}

// ───────── 설정 ─────────
export function updateSettings(patch) {
  Object.assign(store.state.settings, patch);
  store.commit();
}

export function upsertExam(e) {
  const list = store.state.settings.exams;
  const i = list.findIndex((x) => x.id === e.id);
  if (i >= 0) list[i] = { ...list[i], ...e };
  else list.push({ id: uid('e'), ...e });
  store.commit();
}

export function deleteExam(id) {
  store.state.settings.exams = store.state.settings.exams.filter((e) => e.id !== id);
  store.commit();
}

export function exportJSON() {
  return JSON.stringify({ app: 'sabathia', exportedAt: new Date().toISOString(), ...store.state }, null, 2);
}
