/* ==========================================================================
   core — everything the two games share: the sprite registry, sound (and the
   mute switch), the six backgrounds, the colour rail, the settings panel,
   press-and-hold, undo, and the screen router.

   play.js and draw.js each register themselves on App.games; core starts the
   app on the next tick, once both have loaded.
   ========================================================================== */
'use strict';

var App = window.App = {};

App.SHAPES = ['airplane', 'helicopter', 'balloon', 'rocket', 'boat', 'car'];
App.COLORS = ['#ff3b30', '#ff9500', '#ffd60a', '#34c759',
              '#0a84ff', '#af52de', '#ff2d95'];
App.BGS    = ['sky', 'white', 'paper', 'night', 'sea', 'sunset', 'island'];

App.MAX_OBJECTS = 25;
var HOLD_MS = 900;          /* must match the .holding ring in styles.css */
var UNDO_MS = 5000;
App.HOLD_MS = HOLD_MS;

/* ------------------------------- helpers ------------------------------- */

function rand(a, b) { return a + Math.random() * (b - a); }
function pick(arr)  { return arr[(Math.random() * arr.length) | 0]; }
function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }
App.rand = rand; App.pick = pick; App.clamp = clamp;

/* ------------------------------- sprites ------------------------------- */
/* The <symbol>s in index.html are templates we clone as real inline SVG.
   <use> would put them in a shadow tree that document CSS cannot style, and
   the rotor / flame parts are animated by CSS. */

var SPRITE = {};
function spriteSvg(name) {
  if (!(name in SPRITE)) {
    var sym = document.getElementById('s-' + name);
    SPRITE[name] = sym ? sym.innerHTML : '';
  }
  return '<svg viewBox="0 0 100 100">' + SPRITE[name] + '</svg>';
}
App.spriteSvg = spriteSvg;

/* One curve through a run of pointer samples: quadratics whose control points
   are the samples and whose ends are the midpoints between them. Stroking each
   sample as its own little line leaves a round cap at every join, which reads
   as a row of dots. Used by both canvas games. */
App.smoothPath = function (pts) {
  var p = new Path2D(), i, n = pts.length - 1;
  p.moveTo(pts[0].x, pts[0].y);
  if (n === 0) { p.lineTo(pts[0].x + 0.01, pts[0].y); return p; }
  if (n === 1) { p.lineTo(pts[1].x, pts[1].y); return p; }
  for (i = 1; i < n; i++) {
    p.quadraticCurveTo(pts[i].x, pts[i].y,
                       (pts[i].x + pts[i + 1].x) / 2,
                       (pts[i].y + pts[i + 1].y) / 2);
  }
  p.quadraticCurveTo(pts[n].x, pts[n].y, pts[n].x, pts[n].y);
  return p;
};

App.zTop = 1;
App.makeObj = function (type, color) {
  var el = document.createElement('div');
  el.className = 'obj';
  el.style.color = color;
  el.style.zIndex = String(++App.zTop);
  var pop = document.createElement('div');
  pop.className = 'obj-pop popin';
  pop.innerHTML = spriteSvg(type);
  pop.addEventListener('animationend', function () { pop.classList.remove('popin'); });
  el.appendChild(pop);
  return { el: el, pop: pop };
};

/* ------------------------------- prefs -------------------------------- */

var PREFS = 'playcanvas.prefs';
function loadPrefs() {
  try { return JSON.parse(localStorage.getItem(PREFS)) || {}; } catch (e) { return {}; }
}
function savePrefs() {
  try {
    localStorage.setItem(PREFS, JSON.stringify({
      muted: App.muted, play: App.bgFor.play, draw: App.bgFor.draw,
      pop: App.bgFor.pop, scratch: App.bgFor.scratch
    }));
  } catch (e) { /* private browsing, file:// — not worth caring about */ }
}

/* ------------------------------- audio -------------------------------- */
/* Synthesised, so there are no files to load and it works off the
   filesystem. iOS only allows this after a real gesture, so the context is
   created on the first pointerdown. */

var ac = null, master = null, voices = 0;

function unlockAudio() {
  if (ac) { if (ac.state === 'suspended') { ac.resume(); } return; }
  var Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) { return; }
  try {
    ac = new Ctx();
    master = ac.createGain();
    master.gain.value = 0.16;
    master.connect(ac.destination);
    if (ac.state === 'suspended') { ac.resume(); }
  } catch (e) { ac = null; }
}
App.unlockAudio = unlockAudio;

function blip(freq, to, dur, type, gain, delay) {
  if (App.muted || !ac || voices > 8) { return; }
  var t0 = ac.currentTime + (delay || 0);
  var osc = ac.createOscillator();
  var g = ac.createGain();
  osc.type = type || 'triangle';
  osc.frequency.setValueAtTime(freq, t0);
  if (to) { osc.frequency.exponentialRampToValueAtTime(to, t0 + dur); }
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.linearRampToValueAtTime(gain, t0 + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(g); g.connect(master);
  voices++;
  osc.onended = function () { voices--; };
  osc.start(t0);
  osc.stop(t0 + dur + 0.03);
}

var sfx = App.sfx = {
  pop:   function () { blip(420, 940, 0.14, 'triangle', 0.9, 0); },
  grab:  function () { blip(300, null, 0.05, 'sine', 0.5, 0); },
  drop:  function () { blip(210, null, 0.06, 'sine', 0.45, 0); },
  tick:  function () { blip(660, null, 0.04, 'sine', 0.35, 0); },
  on:    function () { [523, 659, 784].forEach(function (f, i) { blip(f, null, 0.13, 'triangle', 0.7, i * 0.07); }); },
  off:   function () { blip(659, null, 0.11, 'triangle', 0.6, 0); blip(392, null, 0.15, 'triangle', 0.6, 0.08); },
  clear: function () { [784, 587, 392].forEach(function (f, i) { blip(f, null, 0.17, 'sine', 0.7, i * 0.08); }); },
  undo:  function () { [392, 587, 784].forEach(function (f, i) { blip(f, null, 0.13, 'sine', 0.7, i * 0.06); }); },
  sparkle: function () { blip(1180, 1760, 0.09, 'triangle', 0.35, 0); },
  burst: function () { blip(900, 170, 0.08, 'square', 0.45, 0);
                       blip(330, 90, 0.13, 'triangle', 0.5, 0.01); },
  hide:  function () { blip(560, 330, 0.10, 'sine', 0.5, 0); },
  show:  function () { blip(400, 780, 0.11, 'triangle', 0.6, 0); }
};

/* ------------------------------- the dom ------------------------------ */

var stage      = document.getElementById('stage');
var hint       = document.getElementById('hint');
var rail       = document.getElementById('rail');
var bar        = document.getElementById('bar');
var resetBtn   = document.getElementById('resetBtn');
var settingsBtn = document.getElementById('settingsBtn');
var scrim      = document.getElementById('scrim');
var tray       = document.getElementById('tray');
var bgtiles    = document.getElementById('bgtiles');
var muteBtn    = document.getElementById('muteBtn');
var homeBtn    = document.getElementById('homeBtn');
var closeBtn   = document.getElementById('closeBtn');

App.stage = stage;
App.tray = tray;

/* --------------------------- stage geometry --------------------------- */

var probe = document.createElement('div');
probe.style.cssText = 'position:absolute;left:0;top:0;width:var(--obj);' +
                      'height:var(--obj);visibility:hidden;pointer-events:none;';
stage.appendChild(probe);

var Stage = App.Stage = {
  W: 0, H: 0, L: 0, T: 0, obj: 104,
  measure: function () {
    var r = stage.getBoundingClientRect();
    Stage.L = r.left; Stage.T = r.top; Stage.W = r.width; Stage.H = r.height;
    Stage.obj = probe.offsetWidth || 104;
  },
  x: function (e) { return e.clientX - Stage.L; },
  y: function (e) { return e.clientY - Stage.T; }
};

/* ------------------------------- state -------------------------------- */

App.screen  = null;
App.bg      = 'sky';                /* the one currently painted        */
/* Background is per game, not global. The card game is pinned to the dotted
   grid; the other two remember whatever was last picked for them. */
App.bgFor   = { play: 'sky', draw: 'paper', pop: 'sky', scratch: 'paper' };
var BG_FIXED = { cards: 'paper' };
App.muted   = false;
App.color   = App.COLORS[0];
App.rainbow = false;
App.shape   = 'airplane';   /* flying-things game */
App.tool    = 'crayon';     /* drawing game       */
App.sticker = 'airplane';
App.games   = {};

App.pickColor = function () {
  return App.rainbow ? pick(App.COLORS) : App.color;
};

/* ------------------------------ colours ------------------------------- */

function buildRail() {
  App.COLORS.concat(['rainbow']).forEach(function (c) {
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'sw' + (c === 'rainbow' ? ' rainbow' : '');
    b.dataset.color = c;
    b.setAttribute('aria-label', c === 'rainbow' ? 'surprise colour' : c);
    if (c !== 'rainbow') { b.style.background = c; }
    b.addEventListener('pointerdown', function () {
      unlockAudio();
      App.rainbow = (c === 'rainbow');
      if (!App.rainbow) { App.color = c; }
      sfx.grab();
      syncColor();
    });
    rail.appendChild(b);
  });
}

function syncColor() {
  document.body.style.setProperty('--ink', App.rainbow ? App.COLORS[0] : App.color);
  document.body.classList.toggle('rainbow', App.rainbow);
  var sws = rail.querySelectorAll('.sw');
  for (var i = 0; i < sws.length; i++) {
    var v = sws[i].dataset.color;
    sws[i].setAttribute('aria-pressed',
      String(App.rainbow ? v === 'rainbow' : v === App.color));
  }
  var g = App.games[App.screen];
  if (g && g.colorChanged) { g.colorChanged(); }
}
App.syncColor = syncColor;

/* ----------------------------- backgrounds ---------------------------- */

function buildBgTiles() {
  App.BGS.forEach(function (name) {
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'bgtile';
    b.dataset.bg = name;
    b.setAttribute('aria-label', name);
    b.addEventListener('pointerdown', function () {
      unlockAudio();
      setBackground(name);
      sfx.tick();
    });
    bgtiles.appendChild(b);
  });
}

/* paint one, without deciding anything */
function applyBackground(name) {
  App.bg = name;
  document.body.dataset.bg = name;
  var tiles = bgtiles.querySelectorAll('.bgtile');
  for (var i = 0; i < tiles.length; i++) {
    tiles[i].setAttribute('aria-pressed', String(tiles[i].dataset.bg === name));
  }
}

/* which background a given screen should be wearing */
function bgFor(screen) {
  if (BG_FIXED[screen]) { return BG_FIXED[screen]; }
  return App.bgFor[screen] || App.bg || 'sky';
}

/* the child picked one from the settings panel */
function setBackground(name) {
  var s = App.screen;
  if (BG_FIXED[s]) { return; }              /* pinned here, nothing to change */
  if (App.bgFor.hasOwnProperty(s)) { App.bgFor[s] = name; savePrefs(); }
  applyBackground(name);
}
App.setBackground = setBackground;
App.applyBackground = applyBackground;

/* the starfield and the bubbles are too repetitive to write out by hand */
(function decorate() {
  var stars = document.querySelector('.stars');
  var i, el, d;
  for (i = 0; i < 44; i++) {
    el = document.createElement('div');
    el.className = 'star';
    d = rand(1.2, 2.8);
    el.style.cssText = 'left:' + rand(0, 99).toFixed(2) + '%;top:' + rand(0, 84).toFixed(2) +
      '%;width:' + d.toFixed(1) + 'px;height:' + d.toFixed(1) +
      'px;animation-duration:' + rand(1.8, 5).toFixed(2) +
      's;animation-delay:-' + rand(0, 5).toFixed(2) + 's';
    stars.appendChild(el);
  }
  var bubbles = document.querySelector('.bubbles');
  for (i = 0; i < 14; i++) {
    el = document.createElement('div');
    el.className = 'bubble';
    d = rand(9, 26);
    el.style.cssText = 'left:' + rand(2, 95).toFixed(2) + '%;width:' + d.toFixed(0) +
      'px;height:' + d.toFixed(0) + 'px;animation-duration:' + rand(9, 20).toFixed(1) +
      's;animation-delay:-' + rand(0, 18).toFixed(1) + 's';
    bubbles.appendChild(el);
  }
  var waves = document.querySelector('.waves');
  for (i = 0; i < 14; i++) {
    el = document.createElement('div');
    el.className = 'wave';
    d = rand(3, 8);
    el.style.cssText = 'left:' + rand(0, 88).toFixed(1) + '%;top:' + rand(10, 92).toFixed(1) +
      '%;width:' + d.toFixed(1) + 'vmin;animation-duration:' + rand(5, 11).toFixed(1) +
      's;animation-delay:-' + rand(0, 11).toFixed(1) + 's';
    waves.appendChild(el);
  }
})();

/* ------------------------------- panels ------------------------------- */

function openPanel(which) {
  document.body.classList.add('panel', 'panel-' + which);
}
function closePanels() {
  document.body.classList.remove('panel', 'panel-tray', 'panel-settings');
}
App.openPanel = openPanel;
App.closePanels = closePanels;

scrim.addEventListener('pointerdown', function () { closePanels(); sfx.drop(); });
closeBtn.addEventListener('pointerdown', function () { closePanels(); sfx.drop(); });

muteBtn.addEventListener('pointerdown', function () {
  App.muted = !App.muted;
  document.body.classList.toggle('muted', App.muted);
  muteBtn.setAttribute('aria-label', App.muted ? 'sound off' : 'sound on');
  savePrefs();
  unlockAudio();
  sfx.tick();                 /* silent when muting, a chirp when unmuting */
});

homeBtn.addEventListener('pointerdown', function () {
  closePanels();
  setScreen('home');
});

/* --------------------------- press and hold -------------------------- */
/* The two grown-up buttons (settings, clear) need a deliberate hold so a
   stray toddler tap can't trigger them. */

function attachHold(el, ms, onDone, onDown) {
  var timer = 0, from = null;
  function cancel() {
    if (timer) { clearTimeout(timer); timer = 0; }
    from = null;
    el.classList.remove('holding');
  }
  el.addEventListener('pointerdown', function (e) {
    unlockAudio();
    if (onDown && onDown(e) === false) { return; }
    cancel();
    from = { x: e.clientX, y: e.clientY };
    el.classList.add('holding');
    timer = setTimeout(function () { cancel(); onDone(); }, ms);
  });
  el.addEventListener('pointermove', function (e) {
    if (!from) { return; }
    if (Math.hypot(e.clientX - from.x, e.clientY - from.y) > 44) { cancel(); }
  });
  el.addEventListener('pointerup', cancel);
  el.addEventListener('pointercancel', cancel);
  el.addEventListener('pointerleave', cancel);
  return cancel;
}
App.attachHold = attachHold;

attachHold(settingsBtn, HOLD_MS, function () {
  openPanel('settings');
  sfx.tick();
});

/* ------------------------------- undo -------------------------------- */

var undoTimer = 0;

function armUndo() {
  resetBtn.classList.add('undo');
  resetBtn.setAttribute('aria-label', 'bring it all back');
  if (undoTimer) { clearTimeout(undoTimer); }
  undoTimer = setTimeout(disarmUndo, UNDO_MS);
}

function disarmUndo() {
  if (undoTimer) { clearTimeout(undoTimer); undoTimer = 0; }
  if (!resetBtn.classList.contains('undo')) { return; }
  resetBtn.classList.remove('undo');
  resetBtn.setAttribute('aria-label', 'clear everything (hold)');
  var g = App.games[App.screen];
  if (g && g.dropSnapshot) { g.dropSnapshot(); }
}

attachHold(resetBtn, HOLD_MS, function () {
  var g = App.games[App.screen];
  if (!g || !g.clear) { return; }
  if (g.clear()) { sfx.clear(); armUndo(); refreshHint(); }
}, function () {
  var g = App.games[App.screen];
  if (resetBtn.classList.contains('undo')) {
    if (g && g.restore) { g.restore(); sfx.undo(); }
    disarmUndo();
    refreshHint();
    return false;                          /* a tap, not a hold */
  }
  if (!g || (g.isEmpty && g.isEmpty())) { sfx.drop(); return false; }
  return true;
});

/* -------------------------------- hint ------------------------------- */

function refreshHint() {
  var g = App.games[App.screen];
  hint.classList.toggle('gone', !(g && g.isEmpty && g.isEmpty()));
}
App.refreshHint = refreshHint;

/* ------------------------------ routing ------------------------------ */

var bound = null;

function bindStage(g) {
  if (bound) {
    stage.removeEventListener('pointerdown', bound.onDown);
    stage.removeEventListener('pointermove', bound.onMove);
    stage.removeEventListener('pointerup', bound.onUp);
    stage.removeEventListener('pointercancel', bound.onCancel);
    stage.removeEventListener('lostpointercapture', bound.onCancel);
    bound = null;
  }
  if (!g || !g.onDown) { return; }
  bound = g;
  stage.addEventListener('pointerdown', g.onDown, { passive: false });
  stage.addEventListener('pointermove', g.onMove, { passive: false });
  stage.addEventListener('pointerup', g.onUp);
  stage.addEventListener('pointercancel', g.onCancel);
  stage.addEventListener('lostpointercapture', g.onCancel);
}

function setScreen(name) {
  var prev = App.games[App.screen];
  if (prev && App.screen !== name && prev.leave) { prev.leave(); }
  closePanels();
  disarmUndo();
  App.screen = name;
  document.body.dataset.screen = name;
  applyBackground(bgFor(name));
  bindStage(App.games[name]);
  Stage.measure();                          /* the stage just changed size */
  var g = App.games[name];
  if (g && g.enter) { g.enter(); }
  refreshHint();
}
App.setScreen = setScreen;

var cards = document.querySelectorAll('.gamecard');
for (var ci = 0; ci < cards.length; ci++) {
  cards[ci].addEventListener('pointerdown', function (e) {
    unlockAudio();
    var name = e.currentTarget.dataset.game;
    sfx.on();
    setScreen(name);
  });
}

/* --------------------------- ipad hardening -------------------------- */

['gesturestart', 'gesturechange', 'gestureend'].forEach(function (n) {
  document.addEventListener(n, function (e) { e.preventDefault(); }, { passive: false });
});
document.addEventListener('dblclick', function (e) { e.preventDefault(); }, { passive: false });
document.addEventListener('contextmenu', function (e) { e.preventDefault(); });
document.addEventListener('touchmove', function (e) {
  if (e.touches.length > 1) { e.preventDefault(); }
}, { passive: false });

function onResize() {
  Stage.measure();
  var g = App.games[App.screen];
  if (g && g.resize) { g.resize(); }
}
window.addEventListener('resize', onResize);
window.addEventListener('orientationchange', function () { setTimeout(onResize, 250); });
if (window.ResizeObserver) { new ResizeObserver(onResize).observe(stage); }
document.addEventListener('visibilitychange', function () {
  var g = App.games[App.screen];
  if (g && g.wake) { g.wake(); }
  if (!document.hidden) { Stage.measure(); }
});

/* -------------------------------- start ------------------------------ */

setTimeout(function start() {
  var p = loadPrefs();
  buildRail();
  buildBgTiles();
  App.muted = !!p.muted;
  document.body.classList.toggle('muted', App.muted);
  muteBtn.setAttribute('aria-label', App.muted ? 'sound off' : 'sound on');
  App.bgFor.play = App.BGS.indexOf(p.play) >= 0 ? p.play : 'sky';
  App.bgFor.draw = App.BGS.indexOf(p.draw) >= 0 ? p.draw : 'paper';
  App.bgFor.pop = App.BGS.indexOf(p.pop) >= 0 ? p.pop : 'sky';
  App.bgFor.scratch = App.BGS.indexOf(p.scratch) >= 0 ? p.scratch : 'paper';
  applyBackground(App.bgFor.play);
  syncColor();
  setScreen('home');
}, 0);
