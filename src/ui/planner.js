// 플래너: 날짜별 시간 블록 = 예상 소요 시간. 입력은 평소처럼, 완료 표시만.
import { h, icon } from './dom.js';
import { addDays, relDayLabel, weekdayOf, weekdayLabel, fmtDur, fmtTime, parseHM, shortDate } from '../engine/time.js';
import { KINDS } from '../engine/config.js';
import { estimateOf, remainingOf } from '../engine/planner.js';
import { fixedFor } from '../engine/capacity.js';
import { blockRange } from '../engine/decide.js';
import { store, setStatus } from '../store.js';
import { openTaskSheet, openTaskEditor, openImport, subjectPill, STATUS, toast } from './sheets.js';

export function renderPlanner(ctx) {
  const { r, ui } = ctx;
  const sel = ui.plannerDate ?? r.today;
  const tasks = store.state.tasks;
  const dayTasks = sel === 'backlog' ? tasks.filter((t) => !t.date) : tasks.filter((t) => t.date === sel);
  const fixed = sel === 'backlog' ? [] : fixedFor(store.state.fixed, sel);

  const rows = [
    ...dayTasks.map((t) => ({ sort: t.start ? parseHM(t.start) : 10_000 + t.createdAt / 1e13, t })),
    ...fixed.map((f) => ({ sort: new Date(f.start).getHours() * 60 + new Date(f.start).getMinutes(), f })),
  ].sort((a, b) => a.sort - b.sort);

  const planned = dayTasks.reduce((s, t) => s + estimateOf(t), 0);
  const remaining = dayTasks.reduce((s, t) => s + remainingOf(t), 0);
  const dayInfo = r.days.find((d) => d.date === sel);

  const start = ui.plannerWeekStart ?? addDays(r.today, -1);
  const strip = h(
    'div.day-strip',
    h('button.icon-btn', { type: 'button', 'aria-label': '이전 주', onclick: () => ctx.setUI({ plannerWeekStart: addDays(start, -7) }) }, icon('chevL', 18)),
    h(
      'div.day-chips',
      Array.from({ length: 8 }, (_, i) => addDays(start, i)).map((d) => {
        const n = tasks.filter((t) => t.date === d && t.status !== 'done').length;
        const wd = weekdayOf(d);
        return h(
          'button.day-chip',
          { type: 'button', class: [d === sel && 'on', d === r.today && 'today'].filter(Boolean).join(' '), onclick: () => ctx.setUI({ plannerDate: d }) },
          h('span.dc-wd', { class: wd === 0 || wd === 6 ? 'weekend' : '' }, d === r.today ? '오늘' : weekdayLabel(wd)),
          h('span.dc-d', shortDate(d).split('/')[1]),
          n > 0 && h('span.dc-dot', String(n)),
        );
      }),
      h(
        'button.day-chip.backlog',
        { type: 'button', class: sel === 'backlog' ? 'on' : '', onclick: () => ctx.setUI({ plannerDate: 'backlog' }) },
        h('span.dc-wd', '날짜'),
        h('span.dc-d', '미정'),
      ),
    ),
    h('button.icon-btn', { type: 'button', 'aria-label': '다음 주', onclick: () => ctx.setUI({ plannerWeekStart: addDays(start, 7) }) }, icon('chevR', 18)),
  );

  return h(
    'div.view.planner',
    h(
      'header.top',
      h('div', h('div.brand', '플래너'), h('div.sub', sel === 'backlog' ? '날짜를 정하지 않은 작업' : `${relDayLabel(sel, r.today)} · 계획 ${fmtDur(planned)}${remaining !== planned ? ` · 남은 ${fmtDur(remaining)}` : ''}`)),
      h(
        'div.top-actions',
        h('button.icon-btn.glass', { type: 'button', 'aria-label': '플래너 붙여넣기', onclick: () => openImport(ctx, sel === 'backlog' ? r.today : sel) }, icon('paste', 20)),
        h('button.icon-btn.glass.accent', { type: 'button', 'aria-label': '작업 추가', onclick: () => openTaskEditor({ ctx, date: sel === 'backlog' ? null : sel }) }, icon('plus', 22)),
      ),
    ),
    strip,
    dayInfo && sel !== 'backlog' && capacityBar(dayInfo, remaining, sel === r.today),
    h(
      'section.card.glass.list-card',
      rows.length
        ? h('ul.task-list', rows.map((x) => (x.t ? taskRow(x.t, ctx) : fixedRow(x.f))))
        : h(
            'div.empty',
            h('p', '이 날은 비어 있어.'),
            h('button.btn.glassy', { type: 'button', onclick: () => openImport(ctx, sel === 'backlog' ? r.today : sel) }, icon('paste', 16), '기존 플래너 붙여넣기'),
          ),
    ),
    h('p.hint.center', '블록 길이를 예상 소요 시간으로 읽어. 크게 늦어질 때만 "남은 시간"을 고치면 돼.'),
  );
}

function capacityBar(day, remaining, isToday) {
  const free = day.freeMin;
  const pct = free > 0 ? Math.min(100, (remaining / free) * 100) : 100;
  const over = remaining > free + 1;
  return h(
    'div.cap.glass.thin',
    h('div.cap-text', h('span', `${isToday ? '지금부터 ' : ''}가용 ${fmtDur(free)}`), h('span', { class: over ? 'warn' : '' }, over ? `${fmtDur(remaining - free)} 초과` : `남는 시간 ${fmtDur(free - remaining)}`)),
    h('div.cap-bar', h('i', { class: over ? 'over' : '', style: { width: `${pct}%` } })),
  );
}

function taskRow(t, ctx) {
  const { r } = ctx;
  const est = estimateOf(t);
  const rem = remainingOf(t);
  const br = blockRange(t);
  const overlap = br && r.days.find((d) => d.date === t.date)?.busy.find((b) => b.start < br.end && b.end > br.start);
  const sim = r.scenarios.exp.base.byTask.get(t.id);
  const late = sim && sim.hardLateMin > 1;
  const held = r.held.some((x) => x.id === t.id);
  return h(
    'li.task',
    { class: [t.status === 'done' && 'done', t.status === 'doing' && 'doing'].filter(Boolean).join(' ') },
    h(
      'button.check-btn',
      {
        type: 'button',
        'aria-label': t.status === 'done' ? '완료 취소' : '완료',
        onclick: (e) => {
          e.stopPropagation();
          const next = t.status === 'done' ? 'todo' : 'done';
          setStatus(t.id, next);
          if (next === 'done') toast('완료! 남은 일정에 여유를 반영했어.');
        },
      },
      t.status === 'done' && icon('check', 16),
    ),
    h(
      'button.task-main',
      { type: 'button', onclick: () => openTaskSheet(t.id, ctx) },
      h('div.task-time', t.start ? `${t.start}–${t.end}` : '시간 미정'),
      h('div.task-title', t.title),
      h(
        'div.meta-row',
        subjectPill(t.subject),
        h('span.kind', KINDS[t.kind]),
        h('span.muted', rem !== est && t.status !== 'done' ? `남은 ${fmtDur(rem)} / 계획 ${fmtDur(est)}` : fmtDur(est)),
        t.status !== 'todo' && t.status !== 'done' && h('span.badge', STATUS[t.status]),
        t.deadline && h('span.badge.warn', `마감 ${relDayLabel(t.deadline, r.today)}${t.deadlineTime ? ' ' + t.deadlineTime : ''}`),
        late && h('span.badge.danger', '마감 위험'),
        held && h('span.badge.violet', '시험 후로 보류'),
        overlap && h('span.badge', `${overlap.label}와 겹침`),
      ),
    ),
  );
}

function fixedRow(f) {
  return h('li.fixed-row', h('span.task-time', `${fmtTime(f.start)}–${fmtTime(f.end)}`), h('span', f.label), h('span.muted.small', '고정'));
}
