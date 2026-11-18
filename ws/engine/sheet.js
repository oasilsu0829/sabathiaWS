// "Sabathia 일정" 시트(날짜·시작·끝·제목·종류·묶음·완료·메모·출처·id) → WS 판단 엔진 상태.
//
// 읽는 규칙
//   종류=일정 + 시간 있음 → 고정 일정 (학교·학원). 단 "야자"는 숙제할 수 있는 시간이라 고정에서 뺀다.
//   종류=일정 + 시간 없음 → 수행평가·시험 같은 날짜 정보 (events)
//   종류=마감/할 일       → 숙제. 날짜=마감일, 시작 시각이 있으면 그 시각이 마감
//                           없으면 그날 그 학원 수업 시작이 마감 (수업 시간을 모르면 학교 08:00 / 기타 23:00)
//   분량: 제목·메모의 "313~395번", "51문제", "p.141~150", "Day 46~48", "48문제 남음" 등에서 읽는다
//   학원 수업 시간: 시트에 적힌 요일·시간을 매주 반복으로 가정해 앞으로 3주에 펼친다
import { addDays, parseHM, weekdayOf, pad } from '../../src/engine/time.js';

export const GROUPS = [
  { id: 'baekin', name: '백인대장', sub: '수학', badge: '백', color: 'var(--math)', re: /백인대장|수평잡기|올림포스|합성함수|역함수|유리함수|무리함수|명제|절댓값|수학/ },
  { id: 'kor', name: '국어 학원', sub: '국어하기 좋은날', badge: '국', color: 'var(--kor)', re: /국좋|국어|봄봄|어문규정|풀이의 기틀/ },
  { id: 'eng', name: '영어 학원', sub: '일 저녁반', badge: '영', color: 'var(--eng)', re: /영어|능률보카|모고/ },
  { id: 'sci', name: '과학', sub: '박상현', badge: '과', color: 'var(--eng)', re: /과학|박상현/ },
  { id: 'school', name: '학교', sub: '수행평가', badge: '학', color: 'var(--school)', re: /수행|보고서|심카|통합사회|한국사|스피치/ },
  { id: 'etc', name: '기타', sub: '', badge: '기', color: 'var(--ink4)', re: /.*/ },
];
const DEFAULT_DUE = { school: '08:00', etc: '23:00' };
/** 임시 페이스(분/단위). 타이머 기록이 쌓이면 기록으로 바뀐다. */
export const DEFAULT_PACES = {
  baekin: { 문제: 3, 쪽: 4 },
  kor: { 문제: 1.5, 쪽: 2 },
  eng: { 문제: 1.5, Day: 20, 쪽: 3 },
  sci: { 쪽: 3, 문제: 2 },
  school: { 쪽: 5 },
  etc: { 문제: 2, 쪽: 3 },
};
const SCHOOL_RE = /학교|등교/;
const NOT_FIXED_RE = /야자/;
const ERRAND_RE = /챙겨가기|챙기기|지참/;

// ───────── CSV ─────────
export function parseCSV(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') q = false;
      else cell += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += c;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((x) => x.trim() !== ''));
}

const COLS = { date: '날짜', start: '시작', end: '끝', title: '제목', type: '종류', bundle: '묶음', done: '완료', memo: '메모', source: '출처', id: 'id' };

export function rowsToRecords(rows) {
  const [head, ...body] = rows;
  const idx = Object.fromEntries(Object.entries(COLS).map(([k, name]) => [k, head.findIndex((h) => h.trim() === name)]));
  if (idx.date < 0 || idx.title < 0 || idx.type < 0) throw new Error('시트 머리글(날짜·제목·종류)을 찾지 못했어요');
  return body.map((r, i) => {
    const g = (k) => (idx[k] >= 0 ? (r[idx[k]] ?? '').trim() : '');
    return {
      date: g('date'), start: normHM(g('start')), end: normHM(g('end')), title: g('title'), type: g('type'),
      bundle: g('bundle'), done: /^(o|x?o|완료|true|1|y)$/i.test(g('done')), memo: g('memo'), id: g('id') || `row${i + 2}`,
    };
  }).filter((r) => /^\d{4}-\d{2}-\d{2}$/.test(r.date) && r.title);
}

function normHM(s) {
  const m = parseHM(s);
  return m == null ? '' : `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
}

// ───────── 분량 ─────────
/** 제목·메모에서 분량을 읽는다. 못 읽으면 1건짜리(완료/미완료만)로 둔다. */
export function parseAmount(title, memo = '') {
  const left = /(\d+)\s*문제\s*중\s*(\d+)\s*문제\s*남음/.exec(memo);
  if (left) return { total: +left[1], done: +left[1] - +left[2], unit: '문제', known: true };
  let total = 0;
  let unit = null;
  const range = [...title.matchAll(/(\d+)\s*[~∼-]\s*(\d+)\s*번/g)];
  if (range.length) { total = range.reduce((s, m) => s + Math.max(0, +m[2] - +m[1] + 1), 0); unit = '문제'; }
  if (!total) {
    const cnt = [...title.matchAll(/(\d+)\s*문제/g)];
    if (cnt.length) { total = cnt.reduce((s, m) => s + +m[1], 0); unit = '문제'; }
  }
  if (!total) {
    const day = /Day\s*(\d+)\s*[~∼-]\s*(\d+)/i.exec(title);
    if (day) { total = +day[2] - +day[1] + 1; unit = 'Day'; }
  }
  if (!total) {
    const pages = [...title.matchAll(/p\.?\s*(\d+)\s*[~∼-]\s*(\d+)/gi), ...title.matchAll(/(\d+)\s*[~∼-]\s*(\d+)\s*쪽/g)];
    if (pages.length) { total = pages.reduce((s, m) => s + Math.max(0, +m[2] - +m[1] + 1), 0); unit = '쪽'; }
  }
  if (!total) return { total: 1, done: 0, unit: '건', known: false };
  const rem = /(\d+)\s*문제\s*남음/.exec(memo);
  const done = rem && unit === '문제' ? Math.max(0, total - +rem[1]) : 0;
  return { total, done, unit, known: true };
}

export const groupOfTitle = (title, bundle = '') =>
  (/학교 수행|보고서/.test(bundle) ? GROUPS.find((g) => g.id === 'school') : GROUPS.find((g) => g.re.test(title))).id;

// ───────── 변환 ─────────
/**
 * @param records rowsToRecords 결과
 * @param today   'YYYY-MM-DD' (논리적 오늘)
 * @param opts    { keepDoneDays=7, overdueDays=7, repeatWeeks=3 }
 */
export function recordsToState(records, today, opts = {}) {
  const keepDoneDays = opts.keepDoneDays ?? 7;
  const overdueDays = opts.overdueDays ?? 7;
  const until = addDays(today, (opts.repeatWeeks ?? 3) * 7);
  const fixed = [];
  const events = [];
  const classes = new Map(); // `${group}|${weekday}` → { start, end, label }
  const schoolDates = new Set();

  for (const r of records) {
    if (r.type !== '일정') continue;
    if (!r.start || !r.end) {
      if (r.date >= today) events.push({ id: r.id, date: r.date, title: r.title, memo: r.memo });
      continue;
    }
    if (NOT_FIXED_RE.test(r.title)) continue; // 야자 = 숙제 가능한 시간
    const school = SCHOOL_RE.test(r.title);
    const kind = school ? 'school' : r.bundle.includes('학원') || /학원|반|대장|좋은날/.test(r.title) ? 'academy' : 'other';
    fixed.push({ id: r.id, label: r.title, kind, date: r.date, start: r.start, end: r.end });
    if (school) schoolDates.add(r.date);
    if (kind === 'academy') {
      const g = groupOfTitle(r.title);
      classes.set(`${g}|${weekdayOf(r.date)}`, { start: r.start, end: r.end, label: r.title, from: r.date });
    }
  }
  // 학원 수업: 적힌 요일을 매주 반복으로 가정 (이미 그 날짜에 적힌 일정이 있으면 건너뜀)
  const datedLabels = new Set(fixed.map((f) => `${f.date}|${f.label}`));
  for (let d = today; d <= until; d = addDays(d, 1)) {
    for (const [key, c] of classes) {
      const [, wd] = key.split('|');
      if (+wd !== weekdayOf(d) || d <= c.from || datedLabels.has(`${d}|${c.label}`)) continue;
      fixed.push({ id: `rep_${key}_${d}`, label: c.label, kind: 'academy', date: d, start: c.start, end: c.end, assumed: true });
    }
  }
  // 등교 날 아침(기상~학교 시작)은 공부 시간으로 치지 않음
  for (const f of fixed.filter((x) => x.kind === 'school')) {
    if (f.start > '07:00') fixed.push({ id: `ready_${f.date}`, label: '등교 준비', kind: 'commute', date: f.date, start: '07:00', end: f.start });
  }

  const classOn = (g, date) => {
    const dated = fixed.find((f) => f.kind === 'academy' && f.date === date && groupOfTitle(f.label) === g);
    if (dated) return dated.start;
    return classes.get(`${g}|${weekdayOf(date)}`)?.start ?? null;
  };

  const tasks = [];
  for (const r of records) {
    if (r.type !== '마감' && r.type !== '할 일') continue;
    if (r.done && r.date < addDays(today, -keepDoneDays)) continue;
    if (!r.done && r.date < addDays(today, -overdueDays)) continue;
    const g = groupOfTitle(r.title, r.bundle);
    const amt = parseAmount(r.title, r.memo);
    const errand = ERRAND_RE.test(r.title);
    if (errand && !r.done && r.date < today) continue; // 지난 준비물 알림은 버림
    tasks.push({
      id: r.id,
      g,
      kind: g === 'school' ? 'performance' : errand ? 'errand' : 'homework',
      title: r.title,
      unit: amt.unit,
      total: amt.total,
      done: r.done ? amt.total : amt.done,
      due: r.date,
      dueTime: r.start || classOn(g, r.date) || DEFAULT_DUE[g] || (schoolDates.has(r.date) ? '08:00' : '23:00'),
      pace: errand ? 1 : undefined,
      memo: r.memo,
      amountKnown: amt.known,
      sheetDone: r.done,
    });
  }

  const used = new Set(tasks.map((t) => t.g));
  const groups = GROUPS.filter((g) => used.has(g.id)).map(({ re, ...g }) => ({
    ...g,
    dueTime: DEFAULT_DUE[g.id] ?? '23:00',
    paces: DEFAULT_PACES[g.id] ?? {},
  }));
  return { fixed, tasks, groups, events, classes: [...classes.entries()].map(([k, c]) => ({ key: k, ...c })) };
}

/** 시트 링크·ID → CSV 주소 */
export function csvUrlOf(input) {
  const s = String(input ?? '').trim();
  if (!s) return null;
  if (/\/pub\?/.test(s) || /output=csv|tqx=out:csv/.test(s)) return s;
  const m = /\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/.exec(s);
  const id = m ? m[1] : /^[a-zA-Z0-9_-]{20,}$/.test(s) ? s : null;
  return id ? `https://docs.google.com/spreadsheets/d/${id}/gviz/tq?tqx=out:csv` : null;
}
