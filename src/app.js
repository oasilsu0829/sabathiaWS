// Sabathia 앱 셸: 판단 → 렌더. 스마트폰은 탭 + 간결한 보기, 넓은 화면은 창형(OS 스타일) 배치.
import { h, icon } from './ui/dom.js';
import { store } from './store.js';
import { decide } from './engine/decide.js';
import { renderHome } from './ui/home.js';
import { renderPlanner } from './ui/planner.js';
import { renderSchedule } from './ui/schedule.js';
import { renderSettings } from './ui/settings.js';

const VIEWS = {
  home: { label: '홈', icon: 'home', render: renderHome },
  planner: { label: '플래너', icon: 'list', render: renderPlanner },
  schedule: { label: '일정', icon: 'calendar', render: renderSchedule },
  settings: { label: '설정', icon: 'gear', render: renderSettings },
};

const ui = loadUI();
const root = document.getElementById('app');
const wideQuery = window.matchMedia('(min-width: 1024px) and (orientation: landscape), (min-width: 1280px)');

function loadUI() {
  const base = { tab: 'home', plannerDate: null, plannerWeekStart: null, wins: ['home', 'planner', 'schedule'] };
  try {
    return { ...base, ...JSON.parse(sessionStorage.getItem('sabathia.ui') ?? '{}') };
  } catch {
    return base;
  }
}

function setUI(patch) {
  Object.assign(ui, patch);
  try {
    sessionStorage.setItem('sabathia.ui', JSON.stringify(ui));
  } catch {
    /* 무시 */
  }
  render();
}

function nowMs() {
  // 개발·검증용: ?now=2026-11-18T19:30 으로 시각을 고정할 수 있다
  const q = new URLSearchParams(location.search).get('now');
  const t = q ? new Date(q).getTime() : NaN;
  return Number.isFinite(t) ? t : Date.now();
}

function layoutMode() {
  const pref = store.state.settings.layout;
  if (pref === 'windows' || pref === 'compact') return pref;
  return wideQuery.matches ? 'windows' : 'compact';
}

function render() {
  const r = decide(store.state, nowMs());
  const ctx = { r, ui, setUI };
  const mode = layoutMode();
  document.documentElement.dataset.mode = r.mode;
  document.documentElement.dataset.layout = mode;
  const scrollY = mode === 'compact' ? window.scrollY : 0;
  const winScroll = [...root.querySelectorAll('.win-body')].map((el) => [el.dataset.view, el.scrollTop]);

  if (mode === 'windows') root.replaceChildren(desktop(ctx));
  else root.replaceChildren(h('main.compact', VIEWS[ui.tab].render(ctx)), tabbar());

  if (mode === 'compact') window.scrollTo(0, scrollY);
  for (const [v, top] of winScroll) {
    const el = root.querySelector(`.win-body[data-view="${v}"]`);
    if (el) el.scrollTop = top;
  }
}

function tabbar() {
  return h(
    'nav.tabbar.glass',
    { 'aria-label': '주요 화면' },
    Object.entries(VIEWS).map(([k, v]) =>
      h(
        'button.tab',
        {
          type: 'button',
          class: ui.tab === k ? 'on' : '',
          'aria-current': ui.tab === k ? 'page' : null,
          onclick: () => {
            if (ui.tab !== k) window.scrollTo(0, 0);
            setUI({ tab: k });
          },
        },
        icon(v.icon, 22),
        h('span', v.label),
      ),
    ),
  );
}

function desktop(ctx) {
  const wins = ui.wins.filter((w) => VIEWS[w]);
  return h(
    'div.desktop',
    h(
      'div.win-grid',
      { 'data-count': String(wins.length) },
      wins.map((k) =>
        h(
          'section.window.glass',
          { 'data-view': k },
          h(
            'div.win-bar',
            h(
              'span.lights',
              h('button.light.red', { type: 'button', 'aria-label': `${VIEWS[k].label} 창 닫기`, onclick: () => toggleWin(k) }),
              h('i.light.yellow'),
              h('i.light.green'),
            ),
            h('span.win-title', VIEWS[k].label),
          ),
          h('div.win-body', { 'data-view': k }, VIEWS[k].render(ctx)),
        ),
      ),
    ),
    h(
      'nav.dock.glass',
      { 'aria-label': '창 열기' },
      Object.entries(VIEWS).map(([k, v]) =>
        h(
          'button.dock-item',
          { type: 'button', class: wins.includes(k) ? 'open' : '', 'aria-pressed': String(wins.includes(k)), onclick: () => toggleWin(k), title: v.label },
          icon(v.icon, 24),
          h('span', v.label),
        ),
      ),
      h('span.dock-sep'),
      h(
        'button.dock-item',
        { type: 'button', title: '간결한 보기', onclick: () => (store.state.settings.layout = 'compact', store.commit()) },
        icon('compact', 24),
        h('span', '간결'),
      ),
    ),
  );
}

function toggleWin(k) {
  let wins = [...ui.wins];
  if (wins.includes(k)) {
    if (wins.length === 1) return;
    wins = wins.filter((w) => w !== k);
  } else {
    wins.push(k);
    if (wins.length > 3) wins.splice(wins.findIndex((w) => w !== 'home'), 1);
  }
  setUI({ wins });
}

store.subscribe(render);
wideQuery.addEventListener?.('change', render);
document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && render());
setInterval(() => {
  if (document.visibilityState === 'visible' && !document.querySelector('.sheet-backdrop')) render();
}, 30_000);
render();

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => {}));
}
