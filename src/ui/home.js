// 홈: 판단 엔진이 고른 메인 카드 + 오늘 요약 + 지연 시뮬레이션 + 오늘 배치 + 주간 부하
import { h, icon } from './dom.js';
import { fmtTime, fmtDur, relDayLabel, weekdayOf, weekdayLabel, shortDate, roundTo, toDateStr } from '../engine/time.js';
import { KINDS, SUBJECTS } from '../engine/config.js';
import { remainingOf, estimateOf } from '../engine/planner.js';
import { fmtLoss, blockRange } from '../engine/decide.js';
import { setStatus, ackTask, store } from '../store.js';
import { openTaskSheet, openTaskEditor, openImport, subjectPill, STATUS, toast } from './sheets.js';
import { sampleData } from '../sample.js';

const MODE_LABEL = { normal: '평상시', risk: '일정 위험', exam: '시험 집중' };

export function renderHome(ctx) {
  const { r } = ctx;
  const d = new Date(r.now);
  return h(
    'div.view.home',
    h(
      'header.top',
      h(
        'div',
        h('div.brand', 'SABATHIA'),
        h('div.sub', `${d.getMonth() + 1}월 ${d.getDate()}일 ${weekdayLabel(d.getDay())}요일 · ${fmtTime(r.now)}`),
      ),
      h('span.mode-chip', { 'data-mode': r.mode }, MODE_LABEL[r.mode]),
    ),
    mainCard(ctx),
    nowStrip(ctx),
    todayStats(ctx),
    delayCard(ctx),
    checkins(ctx),
    timeline(ctx),
    r.exam.active && examNeeds(ctx),
    weekLoad(ctx),
  );
}

function mainCard(ctx) {
  const { r } = ctx;
  const c = r.card;
  const task = c.taskId ? store.state.tasks.find((t) => t.id === c.taskId) : null;
  const actions = [];
  if (task && task.status !== 'done') {
    if (task.status !== 'doing')
      actions.push(
        h('button.btn.primary', { type: 'button', onclick: () => setStatus(task.id, 'doing') }, icon('play', 16), '시작'),
      );
    actions.push(
      h(
        'button.btn.glassy',
        {
          type: 'button',
          onclick: () => {
            setStatus(task.id, 'done');
            toast('완료! 남은 일정에 여유를 반영했어.');
          },
        },
        icon('check', 16),
        '완료',
      ),
      h('button.btn.glassy', { type: 'button', onclick: () => openTaskSheet(task.id, ctx) }, icon('clock', 16), '시간 수정'),
    );
  }
  if (c.type === 'empty') {
    actions.push(
      h('button.btn.primary', { type: 'button', onclick: () => openImport(ctx) }, icon('paste', 16), '플래너 붙여넣기'),
      h('button.btn.glassy', { type: 'button', onclick: () => openTaskEditor({ ctx }) }, icon('plus', 16), '직접 추가'),
      h(
        'button.btn.glassy',
        {
          type: 'button',
          onclick: () => {
            const s = sampleData();
            store.state.fixed = s.fixed;
            store.state.tasks = s.tasks;
            store.commit();
            toast('샘플 일주일을 불러왔어. 설정에서 언제든 초기화할 수 있어.');
          },
        },
        '샘플로 체험',
      ),
    );
  }
  return h(
    'section.main-card.glass',
    { 'data-type': c.type },
    h('div.eyebrow', c.eyebrow),
    h('h1.main-title', c.title),
    h('p.main-msg', c.message),
    task && h('div.meta-row', subjectPill(task.subject), h('span.kind', KINDS[task.kind]), h('span.muted', fmtDur(remainingOf(task)))),
    c.type === 'sleep' &&
      c.next &&
      h('p.main-next', `다음: ${relDayLabel(toDateStr(c.next.start), r.today)} ${fmtTime(c.next.start)} ${c.next.task?.title ?? ''}`),
    c.type === 'deadline' &&
      c.others?.length > 0 &&
      h('p.main-next', `그 외 마감 위험 ${c.others.length}건`),
    actions.length > 0 && h('div.card-actions', actions),
  );
}

function nowStrip(ctx) {
  const { r } = ctx;
  const p = r.plannedNow;
  if (!p && !r.fixedNow) return null;
  return h(
    'section.now-strip.glass.thin',
    h('span.now-dot'),
    r.fixedNow
      ? h('span', h('b', r.fixedNow.label), ` 중 · ${fmtTime(r.fixedNow.end)}까지`)
      : h(
          'button.linkish',
          { type: 'button', onclick: () => openTaskSheet(p.id, ctx) },
          h('span.muted', '계획상 지금 '),
          h('b', p.title),
          h('span.muted', ` ${p.start}–${p.end} · 기록: ${STATUS[p.status]}`),
        ),
  );
}

function stat(label, value, sub) {
  return h('div.stat', h('div.stat-label', label), h('div.stat-value', value), sub && h('div.stat-sub', sub));
}

function todayStats(ctx) {
  const { r } = ctx;
  const t = r.today_;
  const lo = roundTo(t.slack.lo, 5);
  const hi = roundTo(t.slack.hi, 5);
  return h(
    'section.stats.glass',
    stat('남은 가용 시간', fmtDur(t.freeMin), `취침 ${fmtTime(t.end)} 전까지`),
    stat('오늘 배치된 작업', fmtDur(t.work.exp), t.work.high - t.work.low >= 5 ? `길어지면 최대 ${fmtDur(t.work.high)}` : '예상대로'),
    stat('여유', lo === hi ? fmtDur(lo) : `${lo}~${hi}분`, lo === 0 && hi === 0 ? '여유 없음' : '오차 범위 반영'),
  );
}

function delayCard(ctx) {
  const { r } = ctx;
  const dl = r.delay;
  const mins = store.state.settings.delayMin;
  if (r.sleeping || !dl.per) return null;
  const tasks = new Map(store.state.tasks.map((t) => [t.id, t]));
  const rows = [];
  const [hLo, hHi] = dl.hardRange;
  const [rLo, rHi] = dl.reviewLossRange;
  rows.push(row('마감 부족', hHi > 1 ? fmtLoss(hLo, dl.per.exp.hardDiff, hHi) : '영향 없음', hHi > 1));
  rows.push(row('복습 가능 시간', rHi > 1 ? `${fmtLoss(rLo, dl.per.exp.reviewLoss, rHi)} 감소` : '영향 없음', rHi >= 15));
  if (dl.pushed.length)
    rows.push(
      row(
        '다음 날로 밀림',
        dl.pushed
          .slice(0, 3)
          .map((p) => `${tasks.get(p.taskId)?.title} ${Math.round(p.minutes)}분`)
          .join(', '),
        false,
      ),
    );
  const quiet = dl.severity === 'none';
  return h(
    'details.sim.glass',
    { open: !quiet, 'data-severity': dl.severity },
    h(
      'summary',
      h('span.sim-title', `${mins}분 미루면?`),
      h('span.sim-verdict', quiet ? '큰 영향 없음' : dl.severity === 'low' ? '오래 걸리면 영향' : '영향 있음'),
    ),
    h('div.sim-body', rows, h('p.hint', '지금 시작하는 기준 계획과 미룬 계획을 7일 범위로 비교했어. 과목별 오차 범위를 반영한 값이야.')),
  );
}

const row = (k, v, hot) => h('div.sim-row', { class: hot ? 'hot' : '' }, h('span', k), h('b', v));

function checkins(ctx) {
  const { r } = ctx;
  if (!r.checkins.length) return null;
  return h(
    'section.card.glass',
    h('h3.card-title', '확인 필요'),
    h('p.hint', '계획 시간이 지났는데 완료 표시가 없어. 실제로 어땠는지는 추측하지 않을게.'),
    r.checkins.map((t) =>
      h(
        'div.check-row',
        h('div', h('b', t.title), h('div.muted', `${relDayLabel(t.date, r.today)} ${t.start}–${t.end}`)),
        h(
          'div.check-actions',
          h('button.btn.small.primary', { type: 'button', onclick: () => setStatus(t.id, 'done') }, '완료'),
          h('button.btn.small.glassy', { type: 'button', onclick: () => openTaskSheet(t.id, ctx) }, '남은 시간'),
          h('button.btn.small.ghost', { type: 'button', onclick: () => ackTask(t.id) }, '아직'),
        ),
      ),
    ),
  );
}

function timeline(ctx) {
  const { r } = ctx;
  const items = r.timelineToday;
  const fixed = r.days[0].busy.filter((b) => b.end > r.now);
  const merged = [
    ...items.map((p) => ({ type: 'task', start: p.start, end: p.end, p })),
    ...fixed.map((b) => ({ type: 'fixed', start: Math.max(b.start, r.now), end: b.end, b })),
  ].sort((a, b) => a.start - b.start);
  return h(
    'section.card.glass',
    h('h3.card-title', r.sleeping ? '다음 날 계획' : '오늘의 일정', h('span.muted.small', ' 엔진 추천 순서')),
    merged.length
      ? h(
          'ol.timeline',
          merged.map((m) =>
            m.type === 'fixed'
              ? h('li.tl.fixed', h('span.tl-time', `${fmtTime(m.start)}`), h('span.tl-title', m.b.label), h('span.tl-dur', `~${fmtTime(m.end)}`))
              : h(
                  'li.tl',
                  {
                    style: { '--hue': SUBJECTS[m.p.task.subject]?.hue },
                    class: m.p.task.status === 'doing' ? 'doing' : '',
                    onclick: () => openTaskSheet(m.p.task.id, ctx),
                  },
                  h('span.tl-time', fmtTime(m.start)),
                  h(
                    'span.tl-title',
                    m.p.task.title,
                    planShift(m.p, r) && h('span.tl-note', planShift(m.p, r)),
                  ),
                  h('span.tl-dur', fmtDur((m.end - m.start) / 60000)),
                ),
          ),
        )
      : h('p.hint', '오늘 남은 작업이 없어.'),
  );
}

/** 엔진 배치가 플래너 블록과 다르면 짧게 알려준다 */
function planShift(p, r) {
  const br = blockRange(p.task);
  if (!br) return null;
  const rest = remainingOf(p.task);
  const est = estimateOf(p.task);
  if (rest !== est) return `남은 ${rest}분으로 수정됨`;
  if (Math.abs(p.start - br.start) >= 15 * 60000 && br.start > r.now) return `계획 ${p.task.start}`;
  return null;
}

function examNeeds(ctx) {
  const { r } = ctx;
  const max = Math.max(1, ...r.needs.map((n) => n.minutes));
  return h(
    'section.card.glass',
    h('h3.card-title', `${r.exam.exam.name} 공부 필요도`),
    h('p.hint', '고정된 과목 순위보다 실제로 남은 시험 공부량을 우선해.'),
    r.needs.map((n) =>
      h(
        'div.need-row',
        subjectPill(n.subject),
        h('div.need-bar', h('i', { style: { width: `${(n.minutes / max) * 100}%`, '--hue': SUBJECTS[n.subject]?.hue } })),
        h('span.need-val', n.minutes ? fmtDur(n.minutes) : '—'),
        n.practiceDone >= 180 && h('span.muted.small', `최근 숙제 풀이 ${fmtDur(n.practiceDone)}`),
      ),
    ),
  );
}

function weekLoad(ctx) {
  const { r } = ctx;
  const max = Math.max(60, ...r.week.map((d) => d.freeMin));
  return h(
    'section.card.glass',
    h('h3.card-title', '7일 가용 시간'),
    h(
      'div.week',
      r.week.map((d) => {
        const over = d.workMin > d.freeMin + 1;
        const wd = weekdayOf(d.date);
        return h(
          'div.wk-col',
          { title: `${shortDate(d.date)} 가용 ${fmtDur(d.freeMin)} · 배치 ${fmtDur(d.workMin)}` },
          h(
            'div.wk-bar',
            h('i.wk-free', { style: { height: `${(d.freeMin / max) * 100}%` } }),
            h('i.wk-work', { class: over ? 'over' : '', style: { height: `${(Math.min(d.workMin, d.freeMin) / max) * 100}%` } }),
          ),
          h('div.wk-label', { class: wd === 0 || wd === 6 ? 'weekend' : '' }, d.date === r.today ? '오늘' : weekdayLabel(wd)),
          d.dues.length > 0 && h('div.wk-due', `마감 ${d.dues.length}`),
        );
      }),
    ),
    h('div.legend', h('span', h('i.lg-free'), '가용'), h('span', h('i.lg-work'), '배치된 작업')),
  );
}
