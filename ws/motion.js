// Sabathia WS — 쫀득한 움직임. CSS 전환(위치·크기)은 index.html의 --spring/--bounce가 맡고,
// 여기서는 누름 찌그러짐, 창 열고 닫기 젤리, 창 끌 때 기울기, 숫자 튀기를 Web Animations로 한다.
// transform 대신 개별 속성(scale·rotate·translate)만 써서 CSS의 transform 전환과 겹치지 않는다.
const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

// ---------- 누르면 말랑하게 눌리고, 떼면 출렁이며 돌아온다 ----------
const PRESS = 'button, .hw, .mu-chk, .seg3 span, .chips span, label.mu-daily';
let pressed = null;
function squash(el) {
  const r = el.getBoundingClientRect();
  const k = clamp(7 / Math.max(18, r.height), 0.025, 0.11); // 작은 버튼일수록 많이 눌림
  return { k, sx: 1 - k * 0.55, sy: 1 - k };
}
addEventListener('pointerdown', (e) => {
  if (reduced() || e.button > 0) return;
  const el = e.target.closest(PRESS);
  if (!el || el.disabled || el.closest('.wh') && !el.closest('button')) return;
  const { k, sx, sy } = squash(el);
  pressed = { el, k, sx, sy };
  el.getAnimations().forEach((a) => a.id === 'squish' && a.cancel());
  const a = el.animate([{ scale: '1 1' }, { scale: `${sx} ${sy}` }], { duration: 110, easing: 'cubic-bezier(.3,.7,.4,1)', fill: 'forwards' });
  a.id = 'squish';
}, { capture: true, passive: true });
function release() {
  if (!pressed) return;
  const { el, k, sx, sy } = pressed; pressed = null;
  el.getAnimations().forEach((a) => a.id === 'squish' && a.cancel());
  const a = el.animate([
    { scale: `${sx} ${sy}` },
    { scale: `${1 - k * 0.3} ${1 + k * 0.55}`, offset: 0.28 },
    { scale: `${1 + k * 0.22} ${1 - k * 0.28}`, offset: 0.52 },
    { scale: `${1 - k * 0.08} ${1 + k * 0.1}`, offset: 0.74 },
    { scale: '1 1' },
  ], { duration: 520, easing: 'ease-out' });
  a.id = 'squish';
}
addEventListener('pointerup', release, { capture: true, passive: true });
addEventListener('pointercancel', release, { capture: true, passive: true });

// ---------- 창 열기·닫기 ----------
export function openWin(el, i = 0) {
  if (reduced()) return;
  el.animate([
    { scale: '.82 .74', translate: '0 36px', opacity: 0 },
    { scale: '1.035 .975', translate: '0 -4px', opacity: 1, offset: 0.42 },
    { scale: '.985 1.02', translate: '0 1px', offset: 0.66 },
    { scale: '1.006 .995', translate: '0 0', offset: 0.84 },
    { scale: '1 1', translate: '0 0', opacity: 1 },
  ], { duration: 680, delay: i * 55, easing: 'cubic-bezier(.2,.7,.3,1)', fill: 'backwards' });
}
export function closeWin(el) {
  if (reduced()) return;
  el.animate([
    { scale: '1 1', opacity: 1 },
    { scale: '1.04 .95', opacity: 1, offset: 0.3 },
    { scale: '.7 .6', translate: '0 28px', opacity: 0 },
  ], { duration: 300, easing: 'cubic-bezier(.5,0,.75,.4)' });
}
// 접기·펴기: 머리줄이 살짝 출렁
export function wobble(el, amt = 1) {
  if (reduced()) return;
  const k = 0.02 * amt;
  el.animate([
    { scale: '1 1' },
    { scale: `${1 + k} ${1 - k * 1.4}`, offset: 0.25 },
    { scale: `${1 - k * 0.6} ${1 + k * 0.8}`, offset: 0.55 },
    { scale: `${1 + k * 0.2} ${1 - k * 0.25}`, offset: 0.8 },
    { scale: '1 1' },
  ], { duration: 560, easing: 'ease-out' });
}

// ---------- 창 끌기: 집으면 부풀고, 움직이는 방향으로 기울고, 놓으면 출렁 ----------
const dragS = new WeakMap();
export function grab(el) {
  if (reduced()) return;
  dragS.set(el, { rot: 0, vx: 0, lx: null, lt: performance.now() });
  el.animate([{ scale: '1 1' }, { scale: '1.045 1.03', offset: 0.45 }, { scale: '1.02 1.02' }], { duration: 300, easing: 'ease-out', fill: 'forwards' }).id = 'lift';
}
export function dragTo(el, x) {
  const s = dragS.get(el); if (!s) return;
  const now = performance.now(), dt = Math.max(8, now - s.lt);
  if (s.lx != null) s.vx = s.vx * 0.7 + ((x - s.lx) / dt) * 0.3; // px/ms, 부드럽게
  s.lx = x; s.lt = now;
  s.rot = clamp(s.vx * 3.2, -5, 5);
  el.style.rotate = s.rot.toFixed(2) + 'deg';
}
export function drop(el) {
  const s = dragS.get(el); if (!s) return;
  dragS.delete(el);
  const r = s.rot;
  el.style.rotate = '';
  el.getAnimations().forEach((a) => a.id === 'lift' && a.cancel());
  el.animate([
    { rotate: r + 'deg', scale: '1.02 1.02' },
    { rotate: -r * 0.45 + 'deg', scale: '.975 1.03', offset: 0.3 },
    { rotate: r * 0.18 + 'deg', scale: '1.012 .99', offset: 0.58 },
    { rotate: '0deg', scale: '1 1' },
  ], { duration: 560, easing: 'ease-out' });
}

// ---------- 숫자·체크 튀기 ----------
export function bump(el, amt = 1) {
  if (!el || reduced()) return;
  const k = 0.18 * amt;
  el.animate([
    { scale: '1 1' },
    { scale: `${1 + k * 1.2} ${1 - k * 0.5}`, offset: 0.18 },
    { scale: `${1 - k * 0.4} ${1 + k * 0.7}`, offset: 0.42 },
    { scale: `${1 + k * 0.15} ${1 - k * 0.15}`, offset: 0.7 },
    { scale: '1 1' },
  ], { duration: 520, easing: 'ease-out' });
}
// 체크 상자: 쏙 들어갔다 튀어나옴 + 체크 표시가 그려짐
export function pop(el) {
  if (!el || reduced()) return;
  el.animate([
    { scale: '.4 .4', rotate: '-14deg' },
    { scale: '1.28 1.18', rotate: '6deg', offset: 0.4 },
    { scale: '.92 .96', rotate: '-2deg', offset: 0.65 },
    { scale: '1 1', rotate: '0deg' },
  ], { duration: 480, easing: 'ease-out' });
  const p = el.querySelector('path');
  if (p && p.getTotalLength) {
    const L = p.getTotalLength();
    p.animate([{ strokeDasharray: L, strokeDashoffset: L }, { strokeDasharray: L, strokeDashoffset: 0 }], { duration: 260, delay: 90, easing: 'cubic-bezier(.3,.7,.3,1)', fill: 'backwards' });
  }
}
// 줄 전체가 한 번 출렁 (완료·추가)
export function jiggle(el) {
  if (!el || reduced()) return;
  el.animate([
    { translate: '0 0' }, { translate: '6px 0', offset: 0.2 }, { translate: '-3px 0', offset: 0.45 }, { translate: '1px 0', offset: 0.7 }, { translate: '0 0' },
  ], { duration: 420, easing: 'ease-out' });
}
// 안 되는 동작: 고개 젓기
export function shake(el) {
  if (!el || reduced()) return;
  el.animate([
    { translate: '0 0' }, { translate: '-9px 0', offset: 0.15 }, { translate: '8px 0', offset: 0.32 }, { translate: '-5px 0', offset: 0.5 }, { translate: '3px 0', offset: 0.68 }, { translate: '-1px 0', offset: 0.84 }, { translate: '0 0' },
  ], { duration: 460, easing: 'ease-out' });
}
