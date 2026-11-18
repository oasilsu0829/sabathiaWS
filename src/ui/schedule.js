// 고정 일정: 요일별 기상·취침 + 학교·학원·이동 템플릿
import { h, icon } from './dom.js';
import { weekdayLabel, fmtDur } from '../engine/time.js';
import { FIXED_KINDS } from '../engine/config.js';
import { blockMinutes } from '../engine/planner.js';
import { store } from '../store.js';
import { openFixedEditor, toast } from './sheets.js';

const ORDER = [1, 2, 3, 4, 5, 6, 0];

export function renderSchedule(ctx) {
  const s = store.state;
  const days = s.settings.days;

  const sleepTable = h(
    'div.sleep-table',
    ORDER.map((wd) =>
      h(
        'div.sleep-row',
        h('span.sr-wd', { class: wd === 0 || wd === 6 ? 'weekend' : '' }, weekdayLabel(wd)),
        h('input.input.small', { type: 'time', value: days[wd].wake, 'aria-label': `${weekdayLabel(wd)} 기상`, onchange: (e) => setDay(wd, 'wake', e.target.value) }),
        h('span.muted', '→'),
        h('input.input.small', { type: 'time', value: days[wd].sleep, 'aria-label': `${weekdayLabel(wd)} 취침`, onchange: (e) => setDay(wd, 'sleep', e.target.value) }),
      ),
    ),
  );

  const byKind = [...s.fixed].sort((a, b) => (a.start ?? '').localeCompare(b.start ?? ''));

  return h(
    'div.view.schedule',
    h(
      'header.top',
      h('div', h('div.brand', '고정 일정'), h('div.sub', '변경할 수 없는 일정과 수면은 항상 먼저 지켜.')),
      h('div.top-actions', h('button.icon-btn.glass.accent', { type: 'button', 'aria-label': '고정 일정 추가', onclick: () => openFixedEditor() }, icon('plus', 22))),
    ),
    h(
      'section.card.glass',
      h('h3.card-title', '기상 · 취침'),
      h('p.hint', '취침 시각 이후로는 어떤 작업도 배치하지 않아. 자정 이후 취침(예: 00:30)도 돼.'),
      sleepTable,
      h(
        'button.btn.ghost.small',
        {
          type: 'button',
          onclick: () => {
            const mon = days[1];
            [2, 3, 4, 5].forEach((wd) => (days[wd] = { ...mon }));
            store.commit();
            toast('월요일 설정을 평일 전체에 적용했어.');
          },
        },
        '월요일 시간을 평일 전체에 적용',
      ),
    ),
    h(
      'section.card.glass',
      h('h3.card-title', '학교 · 학원 · 이동 · 식사'),
      byKind.length
        ? h(
            'ul.fixed-list',
            byKind.map((f) =>
              h(
                'li',
                h(
                  'button.fixed-item',
                  { type: 'button', onclick: () => openFixedEditor(f) },
                  h('span.fk', { 'data-kind': f.kind }, FIXED_KINDS[f.kind] ?? '기타'),
                  h('span.fi-main', h('b', f.label), h('span.muted', `${f.start}–${f.end} · ${fmtDur(blockMinutes(f.start, f.end) ?? 0)}`)),
                  h('span.fi-days', f.date ? f.date.slice(5).replace('-', '/') : ORDER.filter((d) => f.weekdays?.includes(d)).map(weekdayLabel).join(' ')),
                ),
              ),
            ),
          )
        : h('p.hint', '아직 없어. + 버튼으로 학교·학원 시간을 넣어 줘.'),
    ),
  );
}

function setDay(wd, key, value) {
  if (!value) return;
  store.state.settings.days[wd] = { ...store.state.settings.days[wd], [key]: value };
  store.commit();
}
