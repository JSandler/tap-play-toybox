/* ==========================================================================
   play — the flying-things game. Tap the sky to drop a thing, drag it with as
   many fingers as you like, press play and everything comes alive.
   ========================================================================== */
'use strict';

(function () {

  var rand = App.rand, clamp = App.clamp, sfx = App.sfx, S = App.Stage;
  var TAU = Math.PI * 2;
  var FLING_MAX = 720;      /* px/s ceiling on a flick                     */
  var FLING_MIN = 70;       /* below this a release is a tap, not a throw  */
  var SPEED_EASE = 1.5;     /* how quickly a thrown thing settles back down */
  var UP_EASE    = 1.6;     /* how hard a rocket turns to point upward      */

  /* how each kind of thing behaves once play is on.
     curve = peak turn rate in rad/s, steer = seconds between new turn targets */
  var PERSONA = {
    airplane:   { mode: 'fly',    speed: [95, 155],  rotate: 'heading', curve: 0.40, steer: [2.5, 5] },
    helicopter: { mode: 'fly',    speed: [45, 85],   rotate: 'tilt',    curve: 0.70, steer: [1.2, 2.6], bob: 5 },
    balloon:    { mode: 'float',  speed: [28, 48],   rotate: 'sway' },
    rocket:     { mode: 'escape', speed: [150, 220], rotate: 'heading', curve: 0.50, steer: [1.5, 3] },
    boat:       { mode: 'lane',   speed: [35, 70],   rotate: 'rock',    band: [0.68, 0.86], flip: true },
    car:        { mode: 'lane',   speed: [65, 115],  rotate: 'none',    band: [0.86, 0.94], flip: true }
  };

  var layer   = document.getElementById('objects');
  var row     = document.getElementById('playTools');
  var playBtn = document.getElementById('playBtn');

  var objects = [];
  var drags   = new Map();      /* pointerId -> { obj, ox, oy, hist } */
  var cleared = null;
  var playing = false;
  var raf = 0, lastT = 0;

  /* ------------------------------ chrome ------------------------------ */

  App.SHAPES.forEach(function (type) {
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'toolbtn';
    b.dataset.shape = type;
    b.setAttribute('aria-label', type);
    b.innerHTML = App.spriteSvg(type);
    b.addEventListener('pointerdown', function () {
      App.unlockAudio();
      App.shape = type;
      sfx.grab();
      syncTools();
    });
    row.appendChild(b);
  });

  function syncTools() {
    var bs = row.querySelectorAll('.toolbtn');
    for (var i = 0; i < bs.length; i++) {
      bs[i].setAttribute('aria-pressed', String(bs[i].dataset.shape === App.shape));
    }
  }

  /* ------------------------------ objects ----------------------------- */

  function createObject(type, color, x, y) {
    if (objects.length >= App.MAX_OBJECTS) { removeOldest(); }

    var p = PERSONA[type];
    var made = App.makeObj(type, color);
    var o = {
      type: type, color: color, size: S.obj,
      x: x, y: y, vx: 0, vy: 0, rot: 0, flip: false,
      phase: Math.random() * 12,
      sway: Math.random() * Math.PI * 2,
      base: rand(p.speed[0], p.speed[1]),   /* cruising speed to settle back to */
      turn: 0,                              /* current turn rate, rad/s         */
      turnTarget: p.curve ? pickTurn(p) : 0,
      turnT: p.steer ? rand(p.steer[0], p.steer[1]) : 0,
      rise: rand(p.speed[0], p.speed[1]),
      push: 0,
      bob: p.bob || 0,
      held: false,
      el: made.el, popEl: made.pop
    };
    made.el.__obj = o;
    layer.appendChild(made.el);
    objects.push(o);
    render(o);
    if (playing) { seed(o); }
    App.refreshHint();
    return o;
  }

  function destroyObject(o) {
    var i = objects.indexOf(o);
    if (i >= 0) { objects.splice(i, 1); }
    o.el.classList.add('leaving');
    var el = o.el;
    setTimeout(function () {
      if (el.parentNode) { el.parentNode.removeChild(el); }
    }, 340);
  }

  /* a rocket that has flown off the edge is not coming back, so it goes
     straight out of the list and the DOM rather than shrinking politely */
  function escaped(o) {
    var i = objects.indexOf(o);
    if (i >= 0) { objects.splice(i, 1); }
    if (o.el.parentNode) { o.el.parentNode.removeChild(o.el); }
    App.refreshHint();
  }

  function removeOldest() {
    for (var i = 0; i < objects.length; i++) {
      if (!objects[i].held) { destroyObject(objects[i]); return; }
    }
  }

  function render(o) {
    var half = o.size / 2;
    var bob = o.bob ? Math.sin(o.phase * 2.4 + o.sway) * o.bob : 0;
    o.el.style.transform =
      'translate3d(' + (o.x - half).toFixed(1) + 'px,' +
                       (o.y - half + bob).toFixed(1) + 'px,0)' +
      (o.rot ? ' rotate(' + o.rot.toFixed(1) + 'deg)' : '') +
      (o.flip ? ' scaleX(-1)' : '');
  }

  function clampAll() {
    objects.forEach(function (o) {
      o.size = S.obj;
      var half = o.size / 2;
      o.x = clamp(o.x, half, Math.max(half, S.W - half));
      o.y = clamp(o.y, half, Math.max(half, S.H - half));
      render(o);
    });
  }

  /* ------------------------------ motion ------------------------------ */

  function seed(o) {
    var p = PERSONA[o.type];
    var s = rand(p.speed[0], p.speed[1]);
    var a;
    o.base = s;
    if (p.mode === 'float') {
      o.vy = -s; o.vx = 0; o.rise = s;
    } else if (p.mode === 'lane') {
      o.vx = Math.random() < 0.5 ? s : -s; o.vy = 0;
    } else if (p.mode === 'escape') {
      a = -Math.PI / 2 + rand(-0.45, 0.45);          /* launch upward */
      o.vx = Math.cos(a) * s; o.vy = Math.sin(a) * s;
    } else if (o.type === 'airplane') {
      a = (Math.random() < 0.5 ? 0 : Math.PI) + rand(-0.45, 0.45);
      o.vx = Math.cos(a) * s; o.vy = Math.sin(a) * s;
    } else {
      a = rand(0, TAU);
      o.vx = Math.cos(a) * s; o.vy = Math.sin(a) * s;
    }
  }

  function turnBy(o, a) {
    var c = Math.cos(a), s = Math.sin(a), vx = o.vx, vy = o.vy;
    o.vx = vx * c - vy * s;
    o.vy = vx * s + vy * c;
  }

  /* A throw makes something briefly quick, then it settles back to its own
     cruising speed — the same idea as the balloon's buoyancy, applied to
     everything that flies or drives. */
  function easeSpeed(o, dt) {
    var sp = Math.hypot(o.vx, o.vy);
    if (sp < 0.5 || !o.base) { return; }
    var k = (sp + (o.base - sp) * (1 - Math.exp(-dt * SPEED_EASE))) / sp;
    o.vx *= k;
    o.vy *= k;
  }

  /* Course changes continuously: each thing carries a turn rate that itself
     drifts toward a new random target every few seconds, so the path is a
     series of long gentle arcs instead of straight lines between bounces. */
  function curve(o, p, dt) {
    if (!p.curve) { return; }
    o.turnT -= dt;
    if (o.turnT <= 0) { retarget(o, p); }
    o.turn += (o.turnTarget - o.turn) * (1 - Math.exp(-dt * 1.3));
    turnBy(o, o.turn * dt);
  }

  function pickTurn(p) {
    return (Math.random() < 0.5 ? -1 : 1) * rand(p.curve * 0.35, p.curve);
  }

  function retarget(o, p) {
    if (!p.curve) { return; }
    o.turnT = rand(p.steer[0], p.steer[1]);
    o.turnTarget = pickTurn(p);
  }

  /* rockets want to go up: whichever way one is thrown, its heading arcs back
     toward vertical over a couple of seconds */
  function steerUp(o, dt) {
    var ang = Math.atan2(o.vy, o.vx);
    var diff = ((-Math.PI / 2 - ang + Math.PI) % TAU + TAU) % TAU - Math.PI;
    turnBy(o, diff * (1 - Math.exp(-dt * UP_EASE)));
  }

  /* returns false when the thing has left the canvas for good */
  function step(o, dt) {
    var p = PERSONA[o.type];
    var half = o.size / 2;
    var maxX = Math.max(half, S.W - half);
    var maxY = Math.max(half, S.H - half);

    if (p.mode === 'float') {
      /* buoyancy: however you flick it, it dips and then drifts back up. the
         rate is brisk on purpose — a balloon that takes seconds to recover
         just looks broken to a small child. */
      o.vy += (-o.rise - o.vy) * (1 - Math.exp(-dt * 2.2));
      o.push *= Math.exp(-dt * 1.3);
      o.vx = Math.sin(o.phase * 0.9 + o.sway) * 30 + o.push;
      o.x += o.vx * dt;
      o.y += o.vy * dt;
      if (o.y < -half) { o.y = S.H + half; o.x = rand(half, maxX); }
      o.x = clamp(o.x, half, maxX);
      /* don't let it press into the floor: hand it straight back to buoyancy */
      if (o.y > maxY) { o.y = maxY; if (o.vy > 0) { o.vy = 0; } }

    } else if (p.mode === 'lane') {
      easeSpeed(o, dt);
      o.x += o.vx * dt;
      if (o.x <= half)      { o.x = half; o.vx = Math.abs(o.vx); }
      else if (o.x >= maxX) { o.x = maxX; o.vx = -Math.abs(o.vx); }
      /* eased pull toward its lane, so a child's placement isn't yanked away */
      var lane = clamp(o.y, S.H * p.band[0], S.H * p.band[1]);
      o.y += (lane - o.y) * (1 - Math.exp(-dt * 0.7));

    } else if (p.mode === 'escape') {
      easeSpeed(o, dt);
      curve(o, p, dt);
      steerUp(o, dt);
      o.x += o.vx * dt;
      o.y += o.vy * dt;
      /* no bouncing: once it is fully past an edge it is gone */
      if (o.y < -half || o.y > S.H + half ||
          o.x < -half || o.x > S.W + half) { return false; }

    } else {
      easeSpeed(o, dt);
      curve(o, p, dt);
      o.x += o.vx * dt;
      o.y += o.vy * dt;
      /* a bounce also picks a fresh curve, so the path out is never a mirror
         of the path in */
      if (o.x <= half)      { o.x = half; o.vx = Math.abs(o.vx); retarget(o, p); }
      else if (o.x >= maxX) { o.x = maxX; o.vx = -Math.abs(o.vx); retarget(o, p); }
      if (o.y <= half)      { o.y = half; o.vy = Math.abs(o.vy); retarget(o, p); }
      else if (o.y >= maxY) { o.y = maxY; o.vy = -Math.abs(o.vy); retarget(o, p); }
    }

    switch (p.rotate) {
      case 'heading': o.rot = Math.atan2(o.vy, o.vx) * 180 / Math.PI; break;
      case 'tilt':    o.rot = clamp(o.vx * 0.16, -20, 20); break;
      case 'sway':    o.rot = Math.sin(o.phase * 1.1 + o.sway) * 9; break;
      case 'rock':    o.rot = Math.sin(o.phase * 2.1 + o.sway) * 7; break;
      default:        o.rot = 0;
    }
    if (p.flip) { o.flip = o.vx < 0; }
    return true;
  }

  function tick(t) {
    var dt = lastT ? Math.min((t - lastT) / 1000, 0.05) : 0.016;
    lastT = t;
    /* backwards, because a rocket leaving the canvas removes itself mid-loop */
    for (var i = objects.length - 1; i >= 0; i--) {
      var o = objects[i];
      o.phase += dt;
      if (!o.held && step(o, dt) === false) { escaped(o); continue; }
      render(o);
    }
    raf = playing ? requestAnimationFrame(tick) : 0;
  }

  function startLoop() { lastT = 0; if (!raf) { raf = requestAnimationFrame(tick); } }
  function stopLoop()  { if (raf) { cancelAnimationFrame(raf); raf = 0; } }

  function setPlaying(on) {
    if (playing === on) { return; }
    playing = on;
    document.body.classList.toggle('playing', on);
    playBtn.setAttribute('aria-label', on ? 'stop' : 'play');
    if (on) {
      objects.forEach(function (o) { if (!o.vx && !o.vy) { seed(o); } });
      startLoop();
      sfx.on();
    } else {
      stopLoop();
      sfx.off();
    }
  }

  playBtn.addEventListener('pointerdown', function () {
    App.unlockAudio();
    setPlaying(!playing);
  });

  /* --------------------------- place and drag ------------------------- */

  function onDown(e) {
    App.unlockAudio();
    if (drags.has(e.pointerId)) { return; }

    var x = clamp(S.x(e), 0, S.W);
    var y = clamp(S.y(e), 0, S.H);
    var hitEl = e.target && e.target.closest ? e.target.closest('.obj') : null;
    var o, ox = 0, oy = 0;

    if (hitEl && hitEl.__obj) {
      o = hitEl.__obj;
      ox = o.x - x;                        /* keep the grab offset, no jump */
      oy = o.y - y;
      sfx.grab();
    } else {
      var half = S.obj / 2;
      o = createObject(App.shape, App.pickColor(),
                       clamp(x, half, Math.max(half, S.W - half)),
                       clamp(y, half, Math.max(half, S.H - half)));
      sfx.pop();
    }

    o.held = true;
    o.el.style.zIndex = String(++App.zTop);
    o.popEl.classList.add('grabbed');
    drags.set(e.pointerId, {
      obj: o, ox: ox, oy: oy,
      hist: [{ x: o.x, y: o.y, t: e.timeStamp }]
    });
    try { App.stage.setPointerCapture(e.pointerId); } catch (err) {}
    e.preventDefault();
  }

  function onMove(e) {
    var d = drags.get(e.pointerId);
    if (!d) { return; }
    var o = d.obj;
    var half = o.size / 2;
    o.x = clamp(S.x(e) + d.ox, half, Math.max(half, S.W - half));
    o.y = clamp(S.y(e) + d.oy, half, Math.max(half, S.H - half));
    d.hist.push({ x: o.x, y: o.y, t: e.timeStamp });
    if (d.hist.length > 6) { d.hist.shift(); }
    render(o);
    e.preventDefault();
  }

  function release(pointerId, allowFling) {
    var d = drags.get(pointerId);
    if (!d) { return; }
    drags.delete(pointerId);

    var o = d.obj;
    o.held = false;
    o.popEl.classList.remove('grabbed');

    if (allowFling && playing) {
      var h = d.hist;
      var a = h[0], b = h[h.length - 1];
      var dt = (b.t - a.t) / 1000;
      if (dt > 0.005) {
        var fvx = (b.x - a.x) / dt;
        var fvy = (b.y - a.y) / dt;
        var mag = Math.hypot(fvx, fvy);
        if (mag > FLING_MIN) {
          if (mag > FLING_MAX) { fvx *= FLING_MAX / mag; fvy *= FLING_MAX / mag; }
          var p = PERSONA[o.type];
          if (p.mode === 'float') {
            o.push = fvx;
            o.vy = Math.min(fvy, 200);            /* a shove down is only a dip */
          } else if (p.mode === 'lane') {
            o.vx = fvx;
          } else if (p.mode === 'escape') {
            /* a rocket can be thrown anywhere, but not straight into the floor:
               cap the downward part so it has room to arc back up and soar off */
            o.vx = fvx;
            o.vy = Math.min(fvy, 240);
          } else {
            o.vx = fvx; o.vy = fvy;
          }
        }
      }
      if (!o.vx && !o.vy) { seed(o); }
    }
    sfx.drop();
  }

  /* ----------------------------- interface ---------------------------- */

  App.games.play = {
    onDown: onDown,
    onMove: onMove,
    onUp:     function (e) { release(e.pointerId, true); },
    onCancel: function (e) { release(e.pointerId, false); },

    enter: function () { syncTools(); clampAll(); if (playing) { startLoop(); } },
    leave: function () { stopLoop(); drags.clear(); },
    resize: clampAll,
    wake: function () { lastT = 0; },

    isEmpty: function () { return objects.length === 0; },

    clear: function () {
      if (!objects.length) { return false; }
      cleared = objects.map(function (o) {
        return { type: o.type, color: o.color, x: o.x, y: o.y };
      });
      drags.clear();
      var list = objects.slice();
      objects.length = 0;
      list.forEach(function (o, i) {
        o.held = false;
        setTimeout(function () {
          o.el.classList.add('leaving');
          setTimeout(function () {
            if (o.el.parentNode) { o.el.parentNode.removeChild(o.el); }
          }, 340);
        }, i * 12);
      });
      return true;
    },

    restore: function () {
      var snap = cleared;
      cleared = null;
      if (!snap) { return; }
      var half = S.obj / 2;
      snap.forEach(function (s) {
        createObject(s.type, s.color,
                     clamp(s.x, half, Math.max(half, S.W - half)),
                     clamp(s.y, half, Math.max(half, S.H - half)));
      });
    },

    dropSnapshot: function () { cleared = null; }
  };

}());
