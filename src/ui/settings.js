// 설정: 시험, 판단 기준, 오차 범위(임시값), 데이터 관리, 화면 배치
import { h, icon } from './dom.js';
import { SUBJECTS, DEFAULT_UNCERTAINTY } from '../engine/config.js';
import { daysBetween, shortDate } from '../engine/time.js';
import { store, updateSettings, exportJSON } from '../store.js';
import { openExamEditor, openImport, toast } from './sheets.js';
import { sampleData } from '../sample.js';

export function renderSettings(ctx) {
  const s = store.state.settings;
  const log = store.state.log.filter((l) => l.type === 'adjust');

  const seg = (options, value, onPick) =>
    h(
      'div.segmented',
      options.map(([v, label]) => h('button', { type: 'button', class: String(value) === String(v) ? 'on' : '', onclick: () => onPick(v) }, label)),
    );

  const exams = [...s.exams].sort((a, b) => a.date.localeCompare(b.date));

  return h(
    'div.view.settings',
    h('header.top', h('div', h('div.brand', '설정'), h('div.sub', 'Your time, intelligently organized.'))),

    h(
      'section.card.glass',
      h('h3.card-title', '시험', h('button.icon-btn.small', { type: 'button', 'aria-label': '시험 추가', onclick: () => openExamEditor() }, icon('plus', 18))),
      exams.length
        ? h(
            'ul.exam-list',
            exams.map((e) => {
              const d = daysBetween(ctx.r.today, e.date);
              return h(
                'li',
                h(
                  'button.exam-item',
                  { type: 'button', onclick: () => openExamEditor(e) },
                  h('b', e.name),
                  h('span.muted', `${shortDate(e.date)}${e.endDate ? '–' + shortDate(e.endDate) : ''} · ${e.subjects?.length ? e.subjects.map((x) => SUBJECTS[x].label).join(' ') : '전 과목'}`),
                  h('span.badge', { class: d <= s.examModeDays && d >= 0 ? 'violet' : '' }, d > 0 ? `D-${d}` : d === 0 ? 'D-DAY' : '지남'),
                ),
              );
            }),
          )
        : h('p.hint', `시험을 추가하면 D-${s.examModeDays}부터 시험 집중 모드로 전환돼.`),
    ),

    h(
      'section.card.glass',
      h('h3.card-title', '판단 기준'),
      h('div.setting', h('span', '지연 시뮬레이션'), seg([[15, '15분'], [30, '30분'], [60, '60분']], s.delayMin, (v) => updateSettings({ delayMin: v }))),
      h('div.setting', h('span', '시험 집중 모드 시작'), seg([[14, 'D-14'], [21, 'D-21'], [28, 'D-28']], s.examModeDays, (v) => updateSettings({ examModeDays: v }))),
      h('div.setting', h('span', '시험 직전 (복습 우선)'), seg([[3, 'D-3'], [7, 'D-7'], [10, 'D-10']], s.nearExamDays, (v) => updateSettings({ nearExamDays: v }))),
      h(
        'div.setting',
        h('span', '지연 경고 기준 (복습 손실)'),
        seg([[10, '10분'], [15, '15분'], [30, '30분']], s.thresholds.reviewLossMin, (v) => updateSettings({ thresholds: { ...s.thresholds, reviewLossMin: v } })),
      ),
    ),

    h(
      'section.card.glass',
      h('h3.card-title', '과목별 소요 시간 오차 (임시값)'),
      h('p.hint', '플래너 블록 대비 실제로 얼마나 빨리/늦게 끝날 수 있는지. 사용 기록이 쌓이면 보정할 예정이야.'),
      h(
        'div.unc-table',
        Object.keys(SUBJECTS).map((k) => {
          const [lo, hi] = s.uncertainty[k] ?? DEFAULT_UNCERTAINTY[k];
          const mine = log.filter((l) => l.subject === k && l.estimate > 0);
          const avg = mine.length ? mine.reduce((a, l) => a + (l.to - l.from) / l.estimate, 0) / mine.length : null;
          return h(
            'div.unc-row',
            h('span.pill', { style: { '--hue': SUBJECTS[k].hue } }, SUBJECTS[k].label),
            h('span', `${Math.round(lo * 100)}% ~ +${Math.round(hi * 100)}%`),
            h(
              'input',
              {
                type: 'range',
                min: '0',
                max: '100',
                step: '5',
                value: String(Math.round(hi * 100)),
                'aria-label': `${SUBJECTS[k].label} 상한 오차`,
                onchange: (e) => updateSettings({ uncertainty: { ...s.uncertainty, [k]: [lo, Number(e.target.value) / 100] } }),
              },
            ),
            h('span.muted.small', mine.length ? `수정 ${mine.length}건 · 평균 ${avg >= 0 ? '+' : ''}${Math.round(avg * 100)}%` : '기록 없음'),
          );
        }),
      ),
      log.length > 0 &&
        h(
          'p.hint',
          `지금까지 늘어난 일정 비용 ${log.reduce((a, l) => a + Math.max(0, l.scheduleCostMin), 0)}분 중 ${log
            .filter((l) => l.learning)
            .reduce((a, l) => a + Math.max(0, l.scheduleCostMin), 0)}분은 개념 확인(학습)으로 기록됐어.`,
        ),
    ),

    h(
      'section.card.glass',
      h('h3.card-title', '화면'),
      h(
        'div.setting',
        h('span', '배치'),
        seg([['auto', '자동'], ['windows', '창형'], ['compact', '간결']], s.layout, (v) => updateSettings({ layout: v })),
      ),
      h('p.hint', '자동: iPad 가로처럼 넓은 화면에서는 창형, 스마트폰에서는 간결한 보기.'),
    ),

    h(
      'section.card.glass',
      h('h3.card-title', '데이터'),
      h('p.hint', '모든 데이터는 이 기기 브라우저에만 저장돼. 기기를 바꾸기 전에 내보내 둬.'),
      !store.persistOk && h('p.badge.danger', '이 브라우저에서는 저장이 되지 않고 있어 (사생활 보호 모드?)'),
      h(
        'div.btn-grid',
        h('button.btn.glassy', { type: 'button', onclick: () => openImport(ctx) }, '플래너 붙여넣기'),
        h('button.btn.glassy', { type: 'button', onclick: download }, '백업 내보내기'),
        h('button.btn.glassy', { type: 'button', onclick: () => restoreInput.click() }, '백업 복원'),
        h(
          'button.btn.glassy',
          {
            type: 'button',
            onclick: () => {
              if (store.state.tasks.length && !confirm('지금 데이터에 샘플 일정을 덮어쓸까?')) return;
              const d = sampleData();
              store.state.fixed = d.fixed;
              store.state.tasks = d.tasks;
              store.commit();
              toast('샘플 일주일을 불러왔어.');
            },
          },
          '샘플 데이터',
        ),
        h(
          'button.btn.danger',
          {
            type: 'button',
            onclick: () => {
              if (!confirm('모든 작업·일정·설정을 지울까? 되돌릴 수 없어.')) return;
              store.replace({});
              toast('초기화했어.');
            },
          },
          '전체 초기화',
        ),
      ),
      restoreInput,
    ),
    h('p.hint.center', 'Sabathia Decision Engine v1.0 · 규칙 기반 판단 (AI 호출 없음)'),
  );
}

function download() {
  const blob = new Blob([exportJSON()], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `sabathia-backup-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

const restoreInput = h('input', {
  type: 'file',
  accept: 'application/json,.json',
  hidden: true,
  onchange: async (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    try {
      const data = JSON.parse(await f.text());
      if (!data.tasks || !data.settings) throw new Error('not a backup');
      if (!confirm('백업으로 현재 데이터를 바꿀까?')) return;
      store.replace(data);
      toast('백업을 복원했어.');
    } catch {
      toast('Sabathia 백업 파일이 아니야. 다른 플래너 데이터라면 "플래너 붙여넣기 → 파일"을 써 줘.');
    } finally {
      e.target.value = '';
    }
  },
});
