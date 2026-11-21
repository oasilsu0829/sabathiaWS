// Sabathia WS — 효과음. 파일 없이 WebAudio로 그 자리에서 만든다(오프라인·용량 0).
// 첫 터치 때 AudioContext를 연다(브라우저 자동 재생 정책). 켜고 끄기는 이 기기 localStorage에만.
const KEY = 'sabathia.ws.sfx';
let pref = (() => { try { return { on: true, vol: 0.6, ...JSON.parse(localStorage.getItem(KEY)) }; } catch { return { on: true, vol: 0.6 }; } })();
let ctx = null, out = null, wet = null, lastAt = 0;

function init() {
  if (ctx) return ctx;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  ctx = new AC();
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -16; comp.ratio.value = 4; comp.attack.value = 0.002; comp.release.value = 0.12;
  out = ctx.createGain(); out.gain.value = pref.vol;
  out.connect(comp).connect(ctx.destination);
  // 짧은 잔향: 유리판 위에서 울리는 느낌만 조금
  const len = Math.floor(ctx.sampleRate * 0.7), ir = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let c = 0; c < 2; c++) { const d = ir.getChannelData(c); for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3.2); }
  const conv = ctx.createConvolver(); conv.buffer = ir;
  wet = ctx.createGain(); wet.gain.value = 0.22;
  wet.connect(conv).connect(out);
  return ctx;
}
export function unlock() {
  if (!pref.on) return;
  const c = init();
  if (c && c.state === 'suspended') c.resume().catch(() => {});
}

// ---------- 재료 ----------
// 사인·삼각파 한 음: 음높이 미끄러짐(f→f2), 짧은 어택, 지수 감쇠
function tone(t, { f, f2 = f, type = 'sine', a = 0.004, d = 0.18, g = 0.3, rev = 0, detune = 0 }) {
  const o = ctx.createOscillator(), v = ctx.createGain();
  o.type = type; o.detune.value = detune;
  o.frequency.setValueAtTime(f, t);
  if (f2 !== f) o.frequency.exponentialRampToValueAtTime(f2, t + d * 0.7);
  v.gain.setValueAtTime(0.0001, t);
  v.gain.exponentialRampToValueAtTime(g, t + a);
  v.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
  o.connect(v).connect(out);
  if (rev) { const s = ctx.createGain(); s.gain.value = rev; v.connect(s).connect(wet); }
  o.start(t); o.stop(t + a + d + 0.05);
}
let noiseBuf = null;
// 거른 잡음: 바람(휙)·종이(삭)·딸깍
function noise(t, { f = 1200, f2 = f, q = 1, d = 0.12, g = 0.2, type = 'bandpass', a = 0.004, rev = 0 }) {
  if (!noiseBuf) { noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate); const n = noiseBuf.getChannelData(0); for (let i = 0; i < n.length; i++) n[i] = Math.random() * 2 - 1; }
  const s = ctx.createBufferSource(), bf = ctx.createBiquadFilter(), v = ctx.createGain();
  s.buffer = noiseBuf;
  bf.type = type; bf.Q.value = q;
  bf.frequency.setValueAtTime(f, t);
  if (f2 !== f) bf.frequency.exponentialRampToValueAtTime(f2, t + d);
  v.gain.setValueAtTime(0.0001, t);
  v.gain.exponentialRampToValueAtTime(g, t + a);
  v.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
  s.connect(bf).connect(v).connect(out);
  if (rev) { const r = ctx.createGain(); r.gain.value = rev; v.connect(r).connect(wet); }
  s.start(t, Math.random() * 0.5); s.stop(t + a + d + 0.05);
}
const NOTE = (n) => 440 * Math.pow(2, (n - 69) / 12); // MIDI 번호 → Hz

// ---------- 소리 목록 ----------
const S = {
  // 아무 버튼: 작은 나무 딸깍
  tap: (t) => { tone(t, { f: 1500, f2: 900, d: 0.035, g: 0.12 }); noise(t, { f: 4200, q: 2, d: 0.018, g: 0.05 }); },
  // 고르기(블록·숙제·정렬): 맑은 플링
  select: (t) => { tone(t, { f: 1180, d: 0.12, g: 0.13, type: 'triangle', rev: 0.3 }); tone(t + 0.035, { f: 1770, d: 0.1, g: 0.06, rev: 0.3 }); },
  // 창 열기: 물방울이 부풀어 오르는 소리
  open: (t) => { tone(t, { f: 260, f2: 640, d: 0.16, g: 0.26, rev: 0.25 }); tone(t + 0.06, { f: 880, f2: 990, d: 0.16, g: 0.08, type: 'triangle', rev: 0.4 }); noise(t, { f: 600, f2: 2400, q: 1.4, d: 0.12, g: 0.05 }); },
  // 창 닫기: 쪼그라드는 소리
  close: (t) => { tone(t, { f: 620, f2: 210, d: 0.17, g: 0.22, rev: 0.15 }); noise(t, { f: 2400, f2: 500, q: 1.4, d: 0.12, g: 0.05 }); },
  // 접기·펴기: 두 음 내려감 / 올라감
  collapse: (t) => { tone(t, { f: 700, d: 0.07, g: 0.14, type: 'triangle' }); tone(t + 0.055, { f: 470, f2: 440, d: 0.12, g: 0.14, type: 'triangle' }); },
  expand: (t) => { tone(t, { f: 470, d: 0.07, g: 0.14, type: 'triangle' }); tone(t + 0.055, { f: 700, f2: 720, d: 0.12, g: 0.14, type: 'triangle' }); },
  // 크게 보기: 휙 다가옴 + 맑은 종
  focus: (t) => { noise(t, { f: 300, f2: 3200, q: 0.9, d: 0.26, g: 0.11, a: 0.06 }); tone(t + 0.16, { f: NOTE(84), d: 0.4, g: 0.07, rev: 0.6 }); },
  unfocus: (t) => { noise(t, { f: 3000, f2: 280, q: 0.9, d: 0.22, g: 0.1, a: 0.02 }); tone(t + 0.02, { f: 520, f2: 330, d: 0.14, g: 0.1 }); },
  // 정돈·자유 모드: 철컥
  mode: (t) => { noise(t, { f: 900, q: 3, d: 0.03, g: 0.18 }); tone(t, { f: 180, f2: 120, d: 0.09, g: 0.25 }); tone(t + 0.07, { f: 1400, d: 0.05, g: 0.07, type: 'triangle' }); },
  // 체크: 톡 + 딩
  check: (t) => { tone(t, { f: 600, f2: 1100, d: 0.05, g: 0.16 }); tone(t + 0.045, { f: NOTE(88), d: 0.28, g: 0.1, type: 'triangle', rev: 0.5 }); },
  uncheck: (t) => { tone(t, { f: 760, f2: 380, d: 0.1, g: 0.14, type: 'triangle' }); },
  // 전부 끝: 위로 올라가는 화음
  allDone: (t) => { [72, 76, 79, 84, 88].forEach((n, i) => tone(t + i * 0.075, { f: NOTE(n), d: 0.5 - i * 0.04, g: 0.11, type: 'triangle', rev: 0.6 })); tone(t + 0.3, { f: NOTE(96), d: 0.7, g: 0.035, rev: 0.9 }); },
  // 숙제 하나 완료: 짧은 반짝
  complete: (t) => { [76, 83, 88].forEach((n, i) => tone(t + i * 0.06, { f: NOTE(n), d: 0.35, g: 0.12, type: 'triangle', rev: 0.55 })); noise(t + 0.12, { f: 7000, q: 1, d: 0.25, g: 0.03, rev: 0.6 }); },
  // 1문제 +: 진행할수록 음이 올라감 (p = 0~1)
  plus: (t, p = 0) => { const f = NOTE(72 + Math.round(p * 12)); tone(t, { f: f * 0.8, f2: f, d: 0.09, g: 0.16, type: 'triangle', rev: 0.25 }); noise(t, { f: 3000, q: 2, d: 0.015, g: 0.05 }); },
  minus: (t) => { tone(t, { f: 520, f2: 360, d: 0.09, g: 0.13, type: 'triangle' }); },
  // 타이머 시작·종료: 전원 켜짐 / 꺼짐
  start: (t) => { tone(t, { f: 220, f2: 660, d: 0.22, g: 0.18, rev: 0.2 }); [67, 71, 74].forEach((n, i) => tone(t + 0.12 + i * 0.03, { f: NOTE(n), d: 0.4, g: 0.06, type: 'triangle', rev: 0.5 })); },
  stop: (t) => { tone(t, { f: 660, f2: 200, d: 0.26, g: 0.18, rev: 0.2 }); tone(t + 0.05, { f: NOTE(62), d: 0.3, g: 0.05, type: 'triangle', rev: 0.4 }); },
  // 알림 띠: 부드러운 방울
  toast: (t) => { tone(t, { f: 1250, f2: 1320, d: 0.09, g: 0.07, rev: 0.4 }); },
  // 안 됨·주의: 낮은 두 번
  warn: (t) => { tone(t, { f: 233, d: 0.08, g: 0.2, type: 'square', detune: -8 }); tone(t + 0.1, { f: 196, d: 0.12, g: 0.18, type: 'square', detune: -8 }); },
  // 창 집기·놓기: 말랑한 쭉 / 툭
  grab: (t) => { tone(t, { f: 170, f2: 300, d: 0.08, g: 0.2 }); noise(t, { f: 700, q: 2, d: 0.04, g: 0.05 }); },
  drop: (t) => { tone(t, { f: 260, f2: 110, d: 0.11, g: 0.24 }); noise(t, { f: 400, q: 1.5, d: 0.05, g: 0.08 }); },
  // 경계선 끌기 끝: 작은 딸깍
  snap: (t) => { tone(t, { f: 2100, f2: 1600, d: 0.025, g: 0.08 }); },
  // 시트(대화상자) 열고 닫기
  sheet: (t) => { noise(t, { f: 500, f2: 1800, q: 1, d: 0.16, g: 0.08, a: 0.03 }); tone(t + 0.05, { f: 520, f2: 600, d: 0.12, g: 0.08, rev: 0.3 }); },
  sheetClose: (t) => { noise(t, { f: 1800, f2: 500, q: 1, d: 0.13, g: 0.06, a: 0.01 }); },
  // 저장·추가: 위로 톡톡
  save: (t) => { tone(t, { f: NOTE(79), d: 0.09, g: 0.12, type: 'triangle' }); tone(t + 0.07, { f: NOTE(86), d: 0.22, g: 0.11, type: 'triangle', rev: 0.45 }); },
  // 지우기: 종이 구기는 삭
  del: (t) => { noise(t, { f: 2600, f2: 400, q: 0.7, d: 0.18, g: 0.12 }); tone(t, { f: 300, f2: 120, d: 0.12, g: 0.12 }); },
  // 첫 화면 '지금 할 일' 닫기: 휙 날아감
  brief: (t) => { noise(t, { f: 400, f2: 4200, q: 0.8, d: 0.24, g: 0.12, a: 0.03 }); tone(t + 0.02, { f: 330, f2: 990, d: 0.2, g: 0.1, rev: 0.4 }); },
  // 펼침(묶음 열기·닫기)
  fold: (t, open = true) => { tone(t, { f: open ? 520 : 780, f2: open ? 780 : 520, d: 0.09, g: 0.11, type: 'triangle' }); noise(t, { f: 1500, q: 2, d: 0.03, g: 0.04 }); },
};

const PREF_HAPTIC = { check: 12, complete: [10, 40, 18], allDone: [12, 50, 12, 50, 30], warn: [30, 40, 30], grab: 8, drop: 10, plus: 6 };

// 소리 하나 재생. arg는 소리마다 다르다(plus: 진행 비율, fold: 열림 여부)
export function play(name, arg) {
  lastAt = performance.now();
  if (!pref.on || document.hidden) return;
  const c = init(); if (!c || !S[name]) return;
  if (c.state === 'suspended') c.resume().catch(() => {});
  try { S[name](c.currentTime + 0.005, arg); } catch {}
  const h = PREF_HAPTIC[name];
  if (h && navigator.vibrate) { try { navigator.vibrate(h); } catch {} }
}
// 방금(ms 안에) 다른 소리가 났으면 건너뛴다 — 알림 띠처럼 겹치기 쉬운 소리용
export function soft(name, within = 160) { if (performance.now() - lastAt > within) play(name); }
export const playedSince = (t) => lastAt >= t;
export const isOn = () => pref.on;
export function toggle() {
  pref = { ...pref, on: !pref.on };
  try { localStorage.setItem(KEY, JSON.stringify(pref)); } catch {}
  if (pref.on) { unlock(); play('check'); }
  return pref.on;
}

// 첫 터치에 소리 길을 연다
addEventListener('pointerdown', unlock, { capture: true, passive: true });
addEventListener('keydown', unlock, { capture: true });
