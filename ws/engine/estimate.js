// 남은 분량(문제·지문·단계) → 남은 시간 추정.
//
// 추정 근거는 신뢰도 순서로 고른다. 근거가 없으면 숫자를 지어내지 않는다.
//   measured : 이 숙제를 직접 푼 기록 (2단위 이상, 2분 이상) — 기본 페이스와 섞어 급격한 변동을 줄임
//   prior    : 사용자가 적어 둔 1단위당 예상 시간
//   group    : 같은 학원·같은 단위(예: 백인대장 '문제')를 푼 기록
//   plan     : 페이스가 없으면 플래너에 잡아 둔 시간을 그대로 믿음
//   none     : 판단 불가 → 위험 계산에서 빼고 "진행 후 추정"으로 표시

export const remainingUnits = (t) => Math.max(0, (Number(t.total) || 0) - (Number(t.done) || 0));
export const isDone = (t) => remainingUnits(t) <= 0;

const PRIOR_WEIGHT = 2; // 기본 페이스를 "2단위만큼 푼 기록"으로 취급

function tally(sessions, pred) {
  let units = 0;
  let sec = 0;
  for (const s of sessions ?? []) {
    if (!pred(s)) continue;
    units += Math.max(0, Number(s.units) || 0);
    sec += Math.max(0, Number(s.sec) || 0);
  }
  return units >= 2 && sec >= 120 ? { pace: sec / 60 / units, n: units } : null;
}

/** 1단위당 분과 그 근거, 시나리오 배율 */
export function paceOf(task, state) {
  const sessions = state.sessions ?? [];
  const own = tally(sessions, (s) => s.taskId === task.id);
  const prior = Number(task.pace) > 0 ? Number(task.pace) : null;
  if (own) {
    const pace = prior ? (own.pace * own.n + prior * PRIOR_WEIGHT) / (own.n + PRIOR_WEIGHT) : own.pace;
    const k = Math.sqrt(own.n);
    return { pace, source: 'measured', n: own.n, lo: 1 - Math.max(0.1, 0.3 / k), hi: 1 + Math.max(0.15, 0.6 / k) };
  }
  if (prior) return { pace: prior, source: 'prior', n: 0, lo: 0.8, hi: 1.5 };
  const sameUnit = new Set(
    (state.tasks ?? []).filter((t) => t.id !== task.id && t.g === task.g && t.unit === task.unit).map((t) => t.id),
  );
  const grp = tally(sessions, (s) => sameUnit.has(s.taskId));
  if (grp) return { pace: grp.pace, source: 'group', n: grp.n, lo: 0.8, hi: 1.5 };
  return null;
}

/**
 * @param planShareMin 앞으로의 플래너 블록에서 이 숙제 몫으로 잡힌 분 (plan 근거용)
 * @returns {{ lo, exp, hi, source, pace }} 분 단위
 */
export function estimate(task, state, planShareMin = 0) {
  const rem = remainingUnits(task);
  if (rem <= 0) return { lo: 0, exp: 0, hi: 0, source: 'done', pace: null };
  const p = paceOf(task, state);
  if (p) {
    const exp = rem * p.pace;
    return { lo: exp * p.lo, exp, hi: exp * p.hi, source: p.source, pace: p.pace, n: p.n };
  }
  if (planShareMin > 0) {
    return { lo: planShareMin * 0.8, exp: planShareMin, hi: planShareMin * 1.5, source: 'plan', pace: null };
  }
  return { lo: 0, exp: 0, hi: 0, source: 'none', pace: null };
}
