// 바텀 시트(모바일) / 모달(대화면) 기반 입력 화면들
import { h, icon } from './dom.js';
import { SUBJECTS, KINDS, FIXED_KINDS } from '../engine/config.js';
import {
  detectSubject,
  detectKind,
  blockMinutes,
  estimateOf,
  remainingOf,
  parsePlannerText,
  adaptExternalTasks,
  makeTask,
} from '../engine/planner.js';
import { addDays, fmtDur, relDayLabel, weekdayLabel } from '../engine/time.js';
import {
  store,
  upsertTask,
  deleteTask,
  setStatus,
  adjustRemaining,
  addTasks,
  upsertFixed,
  deleteFixed,
  upsertExam,
  deleteExam,
} from '../store.js';

// ───────── 기본 시트 ─────────
export function openSheet(title, build) {
  const prevFocus = document.activeElement;
  const backdrop = h('div.sheet-backdrop');
  const close = () => {
    backdrop.classList.add('closing');
    setTimeout(() => backdrop.remove(), 200);
    document.removeEventListener('keydown', onKey);
    prevFocus?.focus?.();
  };
  const onKey = (e) => e.key === 'Escape' && close();
  const panel = h(
    'div.sheet.glass',
    { role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
    h('div.sheet-grip'),
    h('div.sheet-head', h('h2', title), h('button.icon-btn', { onclick: close, 'aria-label': '닫기' }, icon('x', 20))),
    h('div.sheet-body', build(close)),
  );
  backdrop.append(panel);
  backdrop.addEventListener('click', (e) => e.target === backdrop && close());
  document.addEventListener('keydown', onKey);
  document.body.append(backdrop);
  requestAnimationFrame(() => backdrop.classList.add('open'));
  return close;
}

export function toast(msg, ms = 3200) {
  document.querySelector('.toast')?.remove();
  const t = h('div.toast.glass', { role: 'status' }, msg);
  document.body.append(t);
  requestAnimationFrame(() => t.classList.add('show'));
  setTimeout(() => {
    t.classList.remove('show');
    setTimeout(() => t.remove(), 300);
  }, ms);
}

// ───────── 공용 UI 조각 ─────────
export const subjectPill = (s) =>
  h('span.pill', { style: { '--hue': SUBJECTS[s]?.hue ?? 260 } }, SUBJECTS[s]?.label ?? s);

export const STATUS = { todo: '시작 전', doing: '진행 중', paused: '일시정지', done: '완료' };

function chips(options, value, onChange, { multi = false } = {}) {
  const wrap = h('div.chips', { role: multi ? 'group' : 'radiogroup' });
  const sel = new Set(multi ? value : [value]);
  const paint = () => {
    for (const b of wrap.children) {
      const on = sel.has(b.dataset.v);
      b.classList.toggle('on', on);
      b.setAttribute('aria-pressed', String(on));
    }
  };
  for (const [v, label] of options) {
    wrap.append(
      h(
        'button.chip',
        {
          type: 'button',
          'data-v': v,
          onclick: () => {
            if (multi) sel.has(v) ? sel.delete(v) : sel.add(v);
            else {
              sel.clear();
              sel.add(v);
            }
            paint();
            onChange(multi ? [...sel] : v);
          },
        },
        label,
      ),
    );
  }
  paint();
  wrap.set = (v) => {
    sel.clear();
    (multi ? v : [v]).forEach((x) => sel.add(x));
    paint();
  };
  return wrap;
}

const field = (label, ...control) => h('label.field', h('span.field-label', label), ...control);

// ───────── 작업 상세 (상태 · 남은 시간 수정) ─────────
export function openTaskSheet(taskId, ctx) {
  const t = store.state.tasks.find((x) => x.id === taskId);
  if (!t) return;
  openSheet(t.title, (close) => {
    const est = estimateOf(t);
    let remain = remainingOf(t) || est;
    let reason = null;

    const statusSeg = h(
      'div.segmented',
      ['todo', 'doing', 'paused', 'done'].map((s) =>
        h(
          'button',
          {
            type: 'button',
            class: t.status === s ? 'on' : '',
            onclick: () => {
              setStatus(t.id, s);
              if (s === 'done') toast(`완료! 남은 일정에 여유를 반영했어.`);
              close();
            },
          },
          STATUS[s],
        ),
      ),
    );

    const value = h('output.big-num', String(remain));
    const delta = h('div.delta');
    const note = h('p.note');
    const paintDelta = () => {
      value.textContent = String(remain);
      const base = remainingOf(t) || est;
      const d = remain - base;
      delta.textContent = d === 0 ? '변경 없음' : d > 0 ? `+${d}분 · 이후 일정을 다시 계산해` : `${d}분 · 여유가 생겨`;
      delta.className = 'delta ' + (d > 0 ? 'up' : d < 0 ? 'down' : '');
      note.textContent =
        d > 0 && reason === 'concept'
          ? '늘어난 시간은 일정 비용으로 계산하지만, 개념을 다시 본 시간은 낭비가 아니라 학습으로 기록해.'
          : d > 0
            ? '늘어난 시간만큼 뒤 일정의 가능 시간이 줄어들어 (일정 비용).'
            : '';
    };
    const step = (n) => {
      remain = Math.max(0, remain + n);
      paintDelta();
    };

    const reasons = chips(
      [
        ['difficulty', '문제가 어려움'],
        ['concept', '개념 다시 확인'],
        ['faster', '생각보다 빠름'],
        ['other', '기타'],
      ],
      null,
      (v) => {
        reason = v;
        paintDelta();
      },
    );
    paintDelta();

    const meta = h(
      'div.meta-row',
      subjectPill(t.subject),
      h('span.kind', KINDS[t.kind]),
      t.date && h('span.muted', relDayLabel(t.date, ctx.r.today)),
      t.start && h('span.muted', `${t.start}–${t.end}`),
      t.deadline && h('span.badge.warn', `마감 ${relDayLabel(t.deadline, ctx.r.today)}${t.deadlineTime ? ' ' + t.deadlineTime : ''}`),
    );

    return [
      meta,
      h('h3.section-label', '상태'),
      statusSeg,
      h('p.hint', '시작·진행 기록은 선택이야. 타이머처럼 시간을 재지 않아.'),
      t.status !== 'done' && [
        h('h3.section-label', '남은 필요 시간'),
        h('p.hint', `계획 블록 ${fmtDur(est)} · 예상과 크게 다를 때만 고치면 돼.`),
        h(
          'div.stepper',
          h('button.step', { type: 'button', onclick: () => step(-10) }, '−10'),
          h('div.stepper-val', value, h('span', '분')),
          h('button.step', { type: 'button', onclick: () => step(10) }, '+10'),
          h('button.step', { type: 'button', onclick: () => step(30) }, '+30'),
        ),
        delta,
        reasons,
        note,
        h(
          'button.btn.primary.block',
          {
            type: 'button',
            onclick: () => {
              if (remain === (remainingOf(t) || est)) return close();
              adjustRemaining(t.id, remain, reason ?? 'other');
              toast('남은 시간을 반영해서 이후 일정을 다시 계산했어.');
              close();
            },
          },
          '다시 계산',
        ),
      ],
      h(
        'div.row-actions',
        h(
          'button.btn.ghost',
          {
            type: 'button',
            onclick: () => {
              close();
              setTimeout(() => openTaskEditor({ task: t, ctx }), 210);
            },
          },
          icon('edit', 18),
          '편집',
        ),
      ),
    ];
  });
}

// ───────── 작업 추가 / 편집 ─────────
export function openTaskEditor({ task, date, ctx }) {
  const isNew = !task;
  const t = task ? { ...task } : makeTask({ title: '', date: date ?? ctx.r.today, subject: 'other', kind: 'homework' });
  let touchedSubject = !isNew;
  let touchedKind = !isNew;
  const today = ctx.r.today;

  openSheet(isNew ? '작업 추가' : '작업 편집', (close) => {
    const subj = chips(Object.entries(SUBJECTS).map(([k, v]) => [k, v.label]), t.subject, (v) => {
      t.subject = v;
      touchedSubject = true;
    });
    const kind = chips(Object.entries(KINDS), t.kind, (v) => {
      t.kind = v;
      touchedKind = true;
      projectBox.hidden = v !== 'project';
    });
    const title = h('input.input', {
      value: t.title,
      placeholder: '예: 수학 숙제 쎈 B단계',
      autocomplete: 'off',
      oninput: (e) => {
        t.title = e.target.value;
        if (!touchedSubject) subj.set((t.subject = detectSubject(t.title)));
        if (!touchedKind) {
          t.kind = detectKind(t.title, t.subject);
          kind.set(t.kind);
          projectBox.hidden = t.kind !== 'project';
        }
      },
    });

    const dur = h('span.dur');
    const paintDur = () => {
      const m = blockMinutes(t.start, t.end);
      dur.textContent = m != null ? `예상 소요 ${fmtDur(m)}` : '';
      estBox.hidden = m != null;
    };
    const start = h('input.input', { type: 'time', value: t.start ?? '', oninput: (e) => ((t.start = e.target.value || null), paintDur()) });
    const end = h('input.input', { type: 'time', value: t.end ?? '', oninput: (e) => ((t.end = e.target.value || null), paintDur()) });
    const est = h('input.input', {
      type: 'number',
      inputmode: 'numeric',
      min: '5',
      step: '5',
      value: t.estimateMin ?? '',
      placeholder: '60',
      oninput: (e) => (t.estimateMin = Number(e.target.value) || null),
    });
    const estBox = h('div', field('시간 블록이 없으면 소요 시간(분)', est));

    const dateIn = h('input.input', { type: 'date', value: t.date ?? '', oninput: (e) => (t.date = e.target.value || null) });

    const dlDate = h('input.input', { type: 'date', value: t.deadline ?? '', oninput: (e) => ((t.deadline = e.target.value || null), dlChips.set('')) });
    const dlTime = h('input.input', { type: 'time', value: t.deadlineTime ?? '', oninput: (e) => (t.deadlineTime = e.target.value || null) });
    const dlChips = chips(
      [
        ['none', '없음'],
        ['0', '오늘'],
        ['1', '내일'],
        ['2', '모레'],
      ],
      t.deadline ? '' : 'none',
      (v) => {
        if (v === 'none') t.deadline = null;
        else t.deadline = addDays(today, Number(v));
        dlDate.value = t.deadline ?? '';
      },
    );

    const projectBox = h(
      'div.project-box',
      { hidden: t.kind !== 'project' },
      field('장기적 가치 (반복해서 얻는 이익)', chips([['1', '낮음'], ['2', '보통'], ['3', '높음']], String(t.value), (v) => (t.value = Number(v)))),
      field('실제로 쓸 가능성', chips([['1', '낮음'], ['2', '보통'], ['3', '높음']], String(t.usage), (v) => (t.usage = Number(v)))),
      h(
        'label.check',
        h('input', { type: 'checkbox', checked: t.examRelated, onchange: (e) => (t.examRelated = e.target.checked) }),
        h('span', '지금 시험 준비에 필요한 도구 (문제풀이·암기 아티팩트 등)'),
      ),
    );

    paintDur();
    setTimeout(() => isNew && title.focus(), 250);

    return [
      field('제목', title),
      field('과목', subj),
      field('종류', kind),
      h('div.grid2', field('날짜', dateIn), h('div')),
      h('div.grid2', field('시작', start), field('끝', end)),
      dur,
      estBox,
      field('마감', dlChips),
      h('div.grid2', field('마감일', dlDate), field('마감 시각 (선택)', dlTime)),
      h('p.hint', '마감 시각이 없으면 그날 취침 전까지로 계산해.'),
      projectBox,
      h(
        'div.row-actions',
        !isNew &&
          h(
            'button.btn.danger',
            {
              type: 'button',
              onclick: () => {
                if (!confirm(`"${t.title}"을(를) 삭제할까?`)) return;
                deleteTask(t.id);
                close();
              },
            },
            icon('trash', 18),
            '삭제',
          ),
        h(
          'button.btn.primary',
          {
            type: 'button',
            onclick: () => {
              if (!t.title.trim()) return title.focus();
              if (blockMinutes(t.start, t.end) == null && !t.estimateMin) {
                toast('시간 블록이나 소요 시간을 넣어 줘.');
                return;
              }
              upsertTask(t);
              close();
            },
          },
          isNew ? '추가' : '저장',
        ),
      ),
    ];
  });
}

// ───────── 기존 플래너 가져오기 ─────────
export function openImport(ctx, date) {
  openSheet('기존 플래너 가져오기', (close) => {
    let parsed = [];
    let base = date ?? ctx.r.today;
    const preview = h('div.preview');
    const area = h('textarea.input.area', {
      rows: 8,
      placeholder: '11/18 (수)\n19:00-21:00 수학 숙제\n21:00-22:00 국어 숙제 마감 11/20\n22:00-22:30 영어 단어\n[x] 수학 오답 정리 40분',
      oninput: () => run(),
    });
    const baseIn = h('input.input', { type: 'date', value: base, oninput: (e) => ((base = e.target.value), run()) });
    const run = () => {
      parsed = parsePlannerText(area.value, base);
      preview.replaceChildren(
        parsed.length
          ? h(
              'ul.preview-list',
              parsed.map((t) =>
                h(
                  'li',
                  subjectPill(t.subject),
                  h('span.kind', KINDS[t.kind]),
                  h('b', t.title),
                  h('span.muted', `${relDayLabel(t.date, ctx.r.today)} ${t.start ? `${t.start}–${t.end}` : ''} ${fmtDur(estimateOf(t))}`),
                  t.deadline && h('span.badge.warn', `마감 ${relDayLabel(t.deadline, ctx.r.today)}`),
                  t.status === 'done' && h('span.badge', '완료'),
                ),
              ),
            )
          : h('p.hint', '시간 정보(19:00-21:00 또는 40분)가 있는 줄만 작업으로 읽어.'),
      );
      importBtn.disabled = !parsed.length;
      importBtn.textContent = parsed.length ? `${parsed.length}개 가져오기` : '가져오기';
    };
    const importBtn = h(
      'button.btn.primary.block',
      {
        type: 'button',
        disabled: true,
        onclick: () => {
          addTasks(parsed);
          toast(`${parsed.length}개 작업을 플래너에 넣었어.`);
          close();
        },
      },
      '가져오기',
    );
    const file = h('input', {
      type: 'file',
      accept: 'application/json,.json,.txt',
      hidden: true,
      onchange: async (e) => {
        const f = e.target.files?.[0];
        if (!f) return;
        const text = await f.text();
        try {
          parsed = adaptExternalTasks(JSON.parse(text));
          if (!parsed.length) throw new Error('empty');
          addTasks(parsed);
          toast(`${parsed.length}개 작업을 가져왔어.`);
          close();
        } catch {
          area.value = text;
          run();
        }
      },
    });
    run();
    return [
      h('p.hint', '평소 쓰던 플래너 내용을 그대로 붙여넣어. 시간 블록 길이를 예상 소요 시간으로 읽어.'),
      field('기준 날짜 (날짜 헤더가 없을 때)', baseIn),
      field('플래너 텍스트', area),
      preview,
      importBtn,
      h('button.btn.ghost.block', { type: 'button', onclick: () => file.click() }, '파일(JSON/텍스트)에서 가져오기'),
      file,
    ];
  });
}

// ───────── 고정 일정 ─────────
export function openFixedEditor(fixed) {
  const isNew = !fixed;
  const f = fixed ? structuredClone(fixed) : { label: '', kind: 'academy', weekdays: [1], start: '18:00', end: '20:00' };
  let repeat = f.date ? 'date' : 'weekly';
  openSheet(isNew ? '고정 일정 추가' : '고정 일정 편집', (close) => {
    const label = h('input.input', { value: f.label, placeholder: '예: 수학 학원', oninput: (e) => (f.label = e.target.value) });
    const days = chips(
      [1, 2, 3, 4, 5, 6, 0].map((d) => [String(d), weekdayLabel(d)]),
      (f.weekdays ?? []).map(String),
      (v) => (f.weekdays = v.map(Number)),
      { multi: true },
    );
    const dateIn = h('input.input', { type: 'date', value: f.date ?? '', oninput: (e) => (f.date = e.target.value) });
    const weeklyBox = h('div', { hidden: repeat !== 'weekly' }, field('반복 요일', days));
    const dateBox = h('div', { hidden: repeat !== 'date' }, field('날짜', dateIn));
    return [
      field('이름', label),
      field('종류', chips(Object.entries(FIXED_KINDS), f.kind, (v) => (f.kind = v))),
      field(
        '반복',
        chips(
          [
            ['weekly', '매주'],
            ['date', '이 날짜만'],
          ],
          repeat,
          (v) => {
            repeat = v;
            weeklyBox.hidden = v !== 'weekly';
            dateBox.hidden = v !== 'date';
          },
        ),
      ),
      weeklyBox,
      dateBox,
      h(
        'div.grid2',
        field('시작', h('input.input', { type: 'time', value: f.start, oninput: (e) => (f.start = e.target.value) })),
        field('끝', h('input.input', { type: 'time', value: f.end, oninput: (e) => (f.end = e.target.value) })),
      ),
      h(
        'div.row-actions',
        !isNew &&
          h('button.btn.danger', { type: 'button', onclick: () => (deleteFixed(f.id), close()) }, icon('trash', 18), '삭제'),
        h(
          'button.btn.primary',
          {
            type: 'button',
            onclick: () => {
              if (!f.label.trim()) return label.focus();
              if (repeat === 'weekly') delete f.date;
              else {
                if (!f.date) return dateIn.focus();
                f.weekdays = [];
              }
              upsertFixed(f);
              close();
            },
          },
          isNew ? '추가' : '저장',
        ),
      ),
    ];
  });
}

// ───────── 시험 ─────────
export function openExamEditor(exam) {
  const isNew = !exam;
  const e = exam ? structuredClone(exam) : { name: '', date: '', endDate: '', subjects: [] };
  openSheet(isNew ? '시험 추가' : '시험 편집', (close) => {
    const name = h('input.input', { value: e.name, placeholder: '예: 2학기 기말고사', oninput: (ev) => (e.name = ev.target.value) });
    const date = h('input.input', { type: 'date', value: e.date, oninput: (ev) => (e.date = ev.target.value) });
    return [
      field('이름', name),
      h(
        'div.grid2',
        field('시작일', date),
        field('종료일 (선택)', h('input.input', { type: 'date', value: e.endDate ?? '', oninput: (ev) => (e.endDate = ev.target.value) })),
      ),
      field(
        '시험 과목 (선택 안 하면 전체)',
        chips(
          Object.entries(SUBJECTS).map(([k, v]) => [k, v.label]),
          e.subjects,
          (v) => (e.subjects = v),
          { multi: true },
        ),
      ),
      h('p.hint', '시작일 21일 전부터 시험 집중 모드로 바뀌고, 시험과 관련 없는 프로젝트의 우선순위를 낮춰.'),
      h(
        'div.row-actions',
        !isNew && h('button.btn.danger', { type: 'button', onclick: () => (deleteExam(e.id), close()) }, icon('trash', 18), '삭제'),
        h(
          'button.btn.primary',
          {
            type: 'button',
            onclick: () => {
              if (!e.name.trim()) return name.focus();
              if (!e.date) return date.focus();
              upsertExam(e);
              close();
            },
          },
          isNew ? '추가' : '저장',
        ),
      ),
    ];
  });
}
