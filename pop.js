/* ==========================================================================
   pop — balloons drift up from the bottom, tap one and it bursts. No rules,
   no way to lose, nothing to read. The spawner keeps a steady population, so
   there is always something to reach for.
   ========================================================================== */
'use strict';

(function () {

  var rand = App.rand, clamp = App.clamp, pick = App.pick, sfx = App.sfx, S = App.Stage;
  var TARGET = 9;                 /* how many to keep in the air     */
  var SCALE  = 1.25;              /* balloons run larger than pieces  */

  var layer = document.getElementById('balloons');
  var balloons = [];
  var raf = 0, lastT = 0, spawnT = 0, running = false;
  var snap = null;

  /* ------------------------------ balloons ---------------------------- */

  function make(color, x, y, size, rise) {
    var made = App.makeObj('balloon', color);
    made.el.classList.add('balloon');
    made.el.style.width = size + 'px';
    made.el.style.height = size + 'px';
    var b = {
      el: made.el, popEl: made.pop, color: color, size: size,
      x: x, y: y, rise: rise,
      sway: rand(10, 28), phase: rand(0, Math.PI * 2), wobble: rand(0.5, 1.2)
    };
    made.el.__b = b;
    layer.appendChild(made.el);
    balloons.push(b);
    render(b);
    return b;
  }

  function spawn(atY) {
    var size = S.obj * SCALE * rand(0.7, 1.15);
    var half = size / 2;
    make(pick(App.COLORS),
         rand(half, Math.max(half, S.W - half)),
         atY === undefined ? S.H + half * 1.2 : atY,
         size, rand(28, 64));
  }

  function fill() {
    while (balloons.length < TARGET) {
      var size = S.obj * SCALE;
      spawn(rand(size / 2, Math.max(size / 2, S.H - size / 2)));
    }
  }

  function render(b) {
    var half = b.size / 2;
    b.el.style.transform =
      'translate3d(' + (b.x - half).toFixed(1) + 'px,' + (b.y - half).toFixed(1) + 'px,0)' +
      ' rotate(' + (Math.sin(b.phase) * 7).toFixed(1) + 'deg)';
  }

  function drop(b, i) {
    if (i === undefined) { i = balloons.indexOf(b); }
    if (i >= 0) { balloons.splice(i, 1); }
  }

  function burst(b) {
    drop(b);
    confetti(b.x, b.y, b.color);
    b.el.classList.add('bursting');
    var el = b.el;
    setTimeout(function () {
      if (el.parentNode) { el.parentNode.removeChild(el); }
    }, 240);
    sfx.burst();
  }

  /* short-lived bits of paper, animated by CSS so they cost the loop nothing */
  function confetti(x, y, color) {
    var n = 9, i, p, a, d, node;
    for (i = 0; i < n; i++) {
      p = document.createElement('div');
      p.className = 'confetti';
      a = (i / n) * Math.PI * 2 + rand(-0.35, 0.35);
      d = rand(38, 108);
      p.style.cssText =
        'left:' + x.toFixed(0) + 'px;top:' + y.toFixed(0) + 'px;' +
        'width:' + rand(7, 13).toFixed(0) + 'px;height:' + rand(7, 13).toFixed(0) + 'px;' +
        'background:' + (Math.random() < 0.3 ? '#fff' : color) + ';' +
        '--dx:' + (Math.cos(a) * d).toFixed(0) + 'px;' +
        '--dy:' + (Math.sin(a) * d + 34).toFixed(0) + 'px;' +
        '--rot:' + rand(-320, 320).toFixed(0) + 'deg';
      layer.appendChild(p);
      node = p;
      setTimeout(function (el) {
        return function () { if (el.parentNode) { el.parentNode.removeChild(el); } };
      }(node), 820);
    }
  }

  /* -------------------------------- loop ------------------------------ */

  function tick(t) {
    var dt = lastT ? Math.min((t - lastT) / 1000, 0.05) : 0.016;
    lastT = t;

    spawnT -= dt;
    if (balloons.length < TARGET && spawnT <= 0) {
      spawn();
      spawnT = rand(0.25, 0.9);
    }

    for (var i = balloons.length - 1; i >= 0; i--) {
      var b = balloons[i];
      var half = b.size / 2;
      b.phase += dt * b.wobble;
      b.y -= b.rise * dt;
      b.x = clamp(b.x + Math.sin(b.phase) * b.sway * dt, half, Math.max(half, S.W - half));
      if (b.y < -half * 1.3) {            /* drifted off the top, let it go */
        drop(b, i);
        if (b.el.parentNode) { b.el.parentNode.removeChild(b.el); }
        continue;
      }
      render(b);
    }
    raf = running ? requestAnimationFrame(tick) : 0;
  }

  function start() { if (!running) { running = true; lastT = 0; raf = requestAnimationFrame(tick); } }
  function stop()  { running = false; if (raf) { cancelAnimationFrame(raf); raf = 0; } }

  /* ----------------------------- interface ---------------------------- */

  function noop() {}

  App.games.pop = {
    onDown: function (e) {
      App.unlockAudio();
      var hit = e.target && e.target.closest ? e.target.closest('.balloon') : null;
      if (hit && hit.__b) { burst(hit.__b); }
      e.preventDefault();
    },
    onMove: noop, onUp: noop, onCancel: noop,

    enter: function () { fill(); start(); },
    leave: stop,
    resize: function () {
      balloons.forEach(function (b) {
        var half = b.size / 2;
        b.x = clamp(b.x, half, Math.max(half, S.W - half));
        render(b);
      });
    },
    wake: function () { lastT = 0; },

    isEmpty: function () { return false; },   /* there is always a balloon */

    clear: function () {
      if (!balloons.length) { return false; }
      snap = balloons.map(function (b) {
        return { color: b.color, x: b.x, y: b.y, size: b.size, rise: b.rise };
      });
      balloons.slice().forEach(function (b, i) {
        setTimeout(function () { burst(b); }, i * 55);   /* a cascade */
      });
      return true;
    },

    restore: function () {
      var was = snap;
      snap = null;
      if (!was) { return; }
      balloons.slice().forEach(function (b) {
        drop(b);
        if (b.el.parentNode) { b.el.parentNode.removeChild(b.el); }
      });
      layer.querySelectorAll('.confetti').forEach(function (c) { c.remove(); });
      was.forEach(function (d) { make(d.color, d.x, d.y, d.size, d.rise); });
    },

    dropSnapshot: function () { snap = null; }
  };

}());
