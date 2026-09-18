/* ==========================================================================
   draw — a scribbling canvas. Five implements plus stickers.

   Two canvases: #ink keeps everything permanently, #magic holds the
   disappearing ink and is faded out a little at a time with a destination-out
   fill, which eats alpha uniformly. Because older marks have been faded more
   times, they vanish first — the stroke evaporates from its tail forward, for
   one fillRect per bite.

   Smoothness rules for every implement in here:
     1. All the points from one pointer event become ONE path, curved through
        their midpoints. Stroking each sample as its own little line left a
        round cap at every join.
     2. Paint the body at alpha 1. Two translucent passes that overlap double
        their alpha, and a chain of those overlaps is exactly the row of dots
        we are trying to avoid. Softness comes from a lighter colour instead.
     3. Anything that must sit under the stroke is drawn with
        'destination-over' so it can never repaint what is already down.
   The crayon is the one exception: its grain really is made of dabs, so it
   walks the path at a fixed spacing rather than per event.
   ========================================================================== */
'use strict';

(function () {

  var rand = App.rand, clamp = App.clamp, sfx = App.sfx, S = App.Stage;
  var TAU = Math.PI * 2;

  var PENS = ['crayon', 'marker', 'pencil', 'glitter', 'magic'];
  var WIDTH = { crayon: 24, marker: 28, pencil: 7, glitter: 20, magic: 22 };

  var ink   = document.getElementById('ink');
  var magic = document.getElementById('magic');
  var stickerLayer = document.getElementById('stickers');
  var row   = document.getElementById('drawTools');
  var tray  = App.tray;

  var ictx = null, mctx = null, dpr = 1, scale = 1;
  var strokes  = new Map();     /* pointerId -> stroke state   */
  var sdrags   = new Map();     /* pointerId -> sticker drag   */
  var stickers = [];
  var hasInk   = false;         /* permanent ink only, not magic */
  var snap     = null;
  var mraf = 0, magicUntil = 0;
  var stickerIcon = null;

  /* ---------------------------- the canvases -------------------------- */

  function sizeCanvases() {
    var W = Math.max(1, Math.round(S.W));
    var H = Math.max(1, Math.round(S.H));
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    var pw = Math.round(W * dpr), ph = Math.round(H * dpr);
    scale = clamp(W / 900, 0.75, 1.5);
    if (ink.width === pw && ink.height === ph) { return; }

    /* resizing a canvas wipes it, so keep the artwork across an orientation
       change by copying it out and back */
    var keep = null;
    if (ink.width && ink.height && hasInk) {
      keep = document.createElement('canvas');
      keep.width = ink.width; keep.height = ink.height;
      keep.getContext('2d').drawImage(ink, 0, 0);
    }

    [ink, magic].forEach(function (c) {
      c.width = pw; c.height = ph;
      c.style.width = W + 'px';
      c.style.height = H + 'px';
    });
    ictx = ink.getContext('2d');
    mctx = magic.getContext('2d');
    [ictx, mctx].forEach(function (c) {
      c.setTransform(dpr, 0, 0, dpr, 0, 0);
      c.lineCap = 'round';
      c.lineJoin = 'round';
    });
    if (keep) { ictx.drawImage(keep, 0, 0, W, H); }
  }

  function wipe(ctx, canvas) {
    if (!ctx) { return; }
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.restore();
  }

  /* ------------------------------- geometry --------------------------- */

  var pathOf = App.smoothPath;   /* shared with the scratch-off canvas */

  function runLength(pts) {
    var d = 0;
    for (var i = 1; i < pts.length; i++) {
      d += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
    }
    return d;
  }

  /* Step along the samples at a fixed spacing, carrying the leftover across
     events so the dabs never bunch up or leave a gap at an event boundary. */
  function walk(s, pts, spacing, fn) {
    if (pts.length < 2) { fn(pts[0].x, pts[0].y, 0, 1); return; }
    var rem = s.walkRem || 0, guard = 0;
    for (var i = 1; i < pts.length; i++) {
      var x0 = pts[i - 1].x, y0 = pts[i - 1].y;
      var dx = pts[i].x - x0, dy = pts[i].y - y0;
      var len = Math.hypot(dx, dy);
      if (len < 0.0001) { continue; }
      var ux = dx / len, uy = dy / len;
      var d = rem;
      while (d < len && guard++ < 600) { fn(x0 + ux * d, y0 + uy * d, -uy, ux); d += spacing; }
      rem = d - len;
    }
    s.walkRem = rem;
  }

  function lighten(color, t) {
    var n = parseInt(color.slice(1), 16);
    var r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
    return 'rgb(' + Math.round(r + (255 - r) * t) + ',' +
                    Math.round(g + (255 - g) * t) + ',' +
                    Math.round(b + (255 - b) * t) + ')';
  }

  function strokeWith(ctx, path, w, paint, alpha) {
    ctx.globalAlpha = alpha === undefined ? 1 : alpha;
    ctx.strokeStyle = paint;
    ctx.lineWidth = w;
    ctx.stroke(path);
    ctx.globalAlpha = 1;
  }

  /* ------------------------------ implements -------------------------- */

  /* waxy and grainy: overlapping dabs at a fixed spacing along the path */
  function crayon(s, pts) {
    var w = s.w;
    ictx.globalAlpha = 0.085;
    ictx.fillStyle = s.color;
    walk(s, pts, w * 0.11, function (x, y, nx, ny) {
      for (var j = -1; j <= 1; j++) {
        var o = j * w * 0.26 + rand(-w * 0.07, w * 0.07);
        ictx.beginPath();
        ictx.arc(x + nx * o, y + ny * o, w * rand(0.24, 0.34), 0, TAU);
        ictx.fill();
      }
    });
    ictx.globalAlpha = 1;
  }

  /* fat, flat and solid. the bleed halo goes on with destination-over so it
     can only ever fill in behind, never repaint the core it just laid down */
  function marker(s, pts) {
    var p = pathOf(pts);
    strokeWith(ictx, p, s.w, s.color);
    ictx.globalCompositeOperation = 'destination-over';
    strokeWith(ictx, p, s.w * 1.32, s.bleed);
    ictx.globalCompositeOperation = 'source-over';
  }

  /* thin and pale. the paleness is in the colour, not the alpha, and the
     scratchiness is opaque grain scattered along the line */
  function pencil(s, pts) {
    var p = pathOf(pts);
    strokeWith(ictx, p, s.w, s.tint);
    ictx.fillStyle = s.grain;
    walk(s, pts, s.w * 1.5, function (x, y, nx, ny) {
      var o = rand(-s.w * 0.36, s.w * 0.36);
      ictx.beginPath();
      ictx.arc(x + nx * o, y + ny * o, rand(0.5, s.w * 0.16), 0, TAU);
      ictx.fill();
    });
  }

  /* the colour walks around the wheel with distance travelled, not with the
     number of events, so the rainbow looks the same however fast you go */
  function glitter(s, pts) {
    var p = pathOf(pts);
    var d = runLength(pts);
    var h0 = s.hue;
    s.hue += d * 0.5;
    var a = pts[0], b = pts[pts.length - 1];
    var paint;
    if (d < 1 || (a.x === b.x && a.y === b.y)) {
      paint = 'hsl(' + (h0 % 360).toFixed(0) + ', 95%, 58%)';
    } else {
      paint = ictx.createLinearGradient(a.x, a.y, b.x, b.y);
      paint.addColorStop(0, 'hsl(' + (h0 % 360).toFixed(0) + ', 95%, 58%)');
      paint.addColorStop(1, 'hsl(' + (s.hue % 360).toFixed(0) + ', 95%, 58%)');
    }
    strokeWith(ictx, p, s.w, paint);
    /* sparks, spaced by distance so they don't clump when you draw slowly */
    ictx.fillStyle = '#fff';
    walk(s, pts, s.w * 2.2, function (x, y, nx, ny) {
      if (Math.random() > 0.55) { return; }
      var o = rand(-s.w * 0.8, s.w * 0.8);
      ictx.globalAlpha = rand(0.55, 1);
      ictx.beginPath();
      ictx.arc(x + nx * o, y + ny * o, rand(1, 2.6), 0, TAU);
      ictx.fill();
    });
    ictx.globalAlpha = 1;
  }

  /* glowing ink on the fading canvas. the halo composites additively so it
     only ever brightens; the core is opaque so it never beads */
  function magicInk(s, pts) {
    var p = pathOf(pts);
    mctx.globalCompositeOperation = 'lighter';
    strokeWith(mctx, p, s.w * 2.1, s.color, 0.05);
    mctx.globalCompositeOperation = 'source-over';
    strokeWith(mctx, p, s.w * 0.85, s.color);
    magicUntil = performance.now() + MAGIC_LIFE;
    if (!mraf) { lastFadeT = 0; mraf = requestAnimationFrame(fade); }
  }

  var DRAW = { crayon: crayon, marker: marker, pencil: pencil,
               glitter: glitter, magic: magicInk };

  /* ---------------------------- disappearing ink ---------------------- */

  var BITE_HZ    = 15;       /* bites per second, whatever the refresh rate */
  var FADE_BITE  = 0.073;    /* alpha removed per bite                     */
  var MAGIC_LIFE = 3800;     /* ms of fading after the last mark            */
  var biteAcc = 0, lastFadeT = 0;

  function bite() {
    mctx.save();
    mctx.setTransform(1, 0, 0, 1, 0, 0);
    mctx.globalCompositeOperation = 'destination-out';
    mctx.globalAlpha = 1;
    mctx.fillStyle = 'rgba(0,0,0,' + FADE_BITE + ')';
    mctx.fillRect(0, 0, magic.width, magic.height);
    mctx.restore();
  }

  /* Paced by elapsed time, not by frame count: this iPad runs at 120Hz, and
     counting frames made the ink evaporate twice as fast as intended. */
  function fade(t) {
    var dt = lastFadeT ? Math.min((t - lastFadeT) / 1000, 0.1) : 1 / 60;
    lastFadeT = t;
    biteAcc += dt * BITE_HZ;
    var n = 0;
    while (biteAcc >= 1 && n++ < 8) { biteAcc -= 1; bite(); }
    if (t < magicUntil) {
      mraf = requestAnimationFrame(fade);
    } else {
      wipe(mctx, magic);     /* clears whatever the rounding floor left */
      mraf = 0;
      biteAcc = 0;
      App.refreshHint();
    }
  }

  /* ------------------------------- strokes ---------------------------- */

  function paint(s, pts) {
    DRAW[s.name](s, pts);
  }

  function beginStroke(id, x, y) {
    var name = App.tool;
    var color = App.pickColor();
    var s = {
      name: name,
      color: color,
      tint:  lighten(color, 0.46),
      grain: lighten(color, 0.14),
      bleed: lighten(color, 0.66),
      w: WIDTH[name] * scale,
      hue: Math.random() * 360,
      walkRem: 0,
      last: { x: x, y: y }
    };
    strokes.set(id, s);
    paint(s, [{ x: x, y: y }]);                /* a tap leaves a dot */
    if (name !== 'magic') { hasInk = true; }
    App.refreshHint();
  }

  function extend(s, pts) {
    if (!pts.length) { return; }
    pts.unshift(s.last);                        /* continue from where we were */
    /* drop samples on top of each other; they only make degenerate curves */
    var keep = [pts[0]];
    for (var i = 1; i < pts.length; i++) {
      var p = pts[i], q = keep[keep.length - 1];
      if (Math.hypot(p.x - q.x, p.y - q.y) >= 0.35) { keep.push(p); }
    }
    if (keep.length < 2) { return; }
    paint(s, keep);
    s.last = keep[keep.length - 1];
  }

  /* ------------------------------ stickers ---------------------------- */

  function placeSticker(type, color, x, y) {
    if (stickers.length >= App.MAX_OBJECTS) { dropOldest(); }
    var made = App.makeObj(type, color);
    var st = { type: type, color: color, x: x, y: y, size: S.obj,
               el: made.el, popEl: made.pop };
    made.el.__st = st;
    stickerLayer.appendChild(made.el);
    stickers.push(st);
    renderSticker(st);
    App.refreshHint();
    return st;
  }

  function renderSticker(st) {
    var half = st.size / 2;
    st.el.style.transform = 'translate3d(' + (st.x - half).toFixed(1) + 'px,' +
                                            (st.y - half).toFixed(1) + 'px,0)';
  }

  function removeSticker(st, delay) {
    var i = stickers.indexOf(st);
    if (i >= 0) { stickers.splice(i, 1); }
    setTimeout(function () {
      st.el.classList.add('leaving');
      setTimeout(function () {
        if (st.el.parentNode) { st.el.parentNode.removeChild(st.el); }
      }, 340);
    }, delay || 0);
  }

  function dropOldest() {
    for (var i = 0; i < stickers.length; i++) {
      if (!isHeld(stickers[i])) { removeSticker(stickers[i]); return; }
    }
  }

  function isHeld(st) {
    var held = false;
    sdrags.forEach(function (d) { if (d.st === st) { held = true; } });
    return held;
  }

  function clampStickers() {
    stickers.forEach(function (st) {
      st.size = S.obj;
      var half = st.size / 2;
      st.x = clamp(st.x, half, Math.max(half, S.W - half));
      st.y = clamp(st.y, half, Math.max(half, S.H - half));
      renderSticker(st);
    });
  }

  /* ------------------------------- chrome ----------------------------- */

  PENS.forEach(function (name) {
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'toolbtn';
    b.dataset.tool = name;
    b.setAttribute('aria-label', name);
    b.innerHTML = App.spriteSvg(name);
    b.addEventListener('pointerdown', function () {
      App.unlockAudio();
      setTool(name);
      sfx.grab();
    });
    row.appendChild(b);
  });

  var stickerBtn = document.createElement('button');
  stickerBtn.type = 'button';
  stickerBtn.className = 'toolbtn sticker-btn';
  stickerBtn.dataset.tool = 'sticker';
  stickerBtn.addEventListener('pointerdown', function () {
    App.unlockAudio();
    setTool('sticker');
    App.openPanel('tray');
    sfx.tick();
  });
  row.appendChild(stickerBtn);

  App.SHAPES.forEach(function (type) {
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'toolbtn';
    b.dataset.sticker = type;
    b.setAttribute('aria-label', type);
    b.innerHTML = App.spriteSvg(type);
    b.addEventListener('pointerdown', function () {
      App.unlockAudio();
      App.sticker = type;
      setTool('sticker');
      App.closePanels();
      sfx.pop();
    });
    tray.appendChild(b);
  });

  function setTool(name) {
    App.tool = name;
    document.body.dataset.tool = name;
    syncTools();
  }

  function syncTools() {
    var bs = row.querySelectorAll('.toolbtn');
    for (var i = 0; i < bs.length; i++) {
      bs[i].setAttribute('aria-pressed', String(bs[i].dataset.tool === App.tool));
    }
    var ts = tray.querySelectorAll('.toolbtn');
    for (var j = 0; j < ts.length; j++) {
      ts[j].setAttribute('aria-pressed', String(ts[j].dataset.sticker === App.sticker));
    }
    /* the sticker button wears whichever sticker is loaded */
    if (stickerIcon !== App.sticker) {
      stickerIcon = App.sticker;
      stickerBtn.innerHTML = App.spriteSvg(App.sticker);
      stickerBtn.setAttribute('aria-label', 'stickers, currently ' + App.sticker);
    }
  }

  /* ---------------------------- pointer work -------------------------- */

  function at(ev) {
    return { x: clamp(S.x(ev), 0, S.W), y: clamp(S.y(ev), 0, S.H) };
  }

  function onDown(e) {
    App.unlockAudio();
    var p = at(e);

    if (App.tool === 'sticker') {
      var hit = e.target && e.target.closest ? e.target.closest('.obj') : null;
      var st, ox = 0, oy = 0;
      if (hit && hit.__st) {
        st = hit.__st;
        ox = st.x - p.x; oy = st.y - p.y;      /* keep the grab offset */
        sfx.grab();
      } else {
        var half = S.obj / 2;
        st = placeSticker(App.sticker, App.pickColor(),
                          clamp(p.x, half, Math.max(half, S.W - half)),
                          clamp(p.y, half, Math.max(half, S.H - half)));
        sfx.pop();
      }
      st.el.style.zIndex = String(++App.zTop);
      st.popEl.classList.add('grabbed');
      sdrags.set(e.pointerId, { st: st, ox: ox, oy: oy });
    } else {
      beginStroke(e.pointerId, p.x, p.y);
      if (App.tool === 'glitter' || App.tool === 'magic') { sfx.sparkle(); }
      else { sfx.grab(); }
    }
    try { App.stage.setPointerCapture(e.pointerId); } catch (err) {}
    e.preventDefault();
  }

  function onMove(e) {
    var sd = sdrags.get(e.pointerId);
    if (sd) {
      var p = at(e);
      var half = sd.st.size / 2;
      sd.st.x = clamp(p.x + sd.ox, half, Math.max(half, S.W - half));
      sd.st.y = clamp(p.y + sd.oy, half, Math.max(half, S.H - half));
      renderSticker(sd.st);
      e.preventDefault();
      return;
    }

    var s = strokes.get(e.pointerId);
    if (!s) { return; }
    /* touch is sampled faster than frames arrive, so take every sample the
       browser saved up and draw them as one continuous run */
    var raw = e.getCoalescedEvents ? e.getCoalescedEvents() : null;
    var pts = [];
    if (raw && raw.length) {
      for (var i = 0; i < raw.length; i++) { pts.push(at(raw[i])); }
    } else {
      pts.push(at(e));
    }
    extend(s, pts);
    e.preventDefault();
  }

  function release(id) {
    var sd = sdrags.get(id);
    if (sd) {
      sdrags.delete(id);
      sd.st.popEl.classList.remove('grabbed');
      sfx.drop();
      return;
    }
    if (strokes.has(id)) { strokes.delete(id); }
  }

  /* ----------------------------- interface ---------------------------- */

  App.games.draw = {
    onDown: onDown,
    onMove: onMove,
    onUp:     function (e) { release(e.pointerId); },
    onCancel: function (e) { release(e.pointerId); },

    enter: function () { sizeCanvases(); syncTools(); clampStickers(); },
    leave: function () {
      strokes.clear();
      sdrags.clear();
      if (mraf) { cancelAnimationFrame(mraf); mraf = 0; }
      biteAcc = 0;
      wipe(mctx, magic);
    },
    resize: function () { sizeCanvases(); clampStickers(); },

    isEmpty: function () { return !hasInk && !stickers.length && !mraf; },

    clear: function () {
      if (!hasInk && !stickers.length && !mraf) { return false; }
      snap = {
        canvas: null,
        stickers: stickers.map(function (st) {
          return { type: st.type, color: st.color, x: st.x, y: st.y };
        })
      };
      if (hasInk && ink.width) {
        var keep = document.createElement('canvas');
        keep.width = ink.width; keep.height = ink.height;
        keep.getContext('2d').drawImage(ink, 0, 0);
        snap.canvas = keep;
      }
      wipe(ictx, ink);
      wipe(mctx, magic);
      if (mraf) { cancelAnimationFrame(mraf); mraf = 0; }
      biteAcc = 0;
      hasInk = false;
      strokes.clear();
      sdrags.clear();
      var list = stickers.slice();
      stickers.length = 0;
      list.forEach(function (st, i) { removeSticker(st, i * 12); });
      return true;
    },

    restore: function () {
      var s = snap;
      snap = null;
      if (!s) { return; }
      if (s.canvas) {
        /* blit in device pixels: the stage width is fractional while the
           canvas is rounded, so scaling by CSS size would resample */
        ictx.save();
        ictx.setTransform(1, 0, 0, 1, 0, 0);
        ictx.drawImage(s.canvas, 0, 0, ink.width, ink.height);
        ictx.restore();
        hasInk = true;
      }
      s.stickers.forEach(function (d) {
        placeSticker(d.type, d.color, d.x, d.y);
      });
    },

    dropSnapshot: function () { snap = null; }
  };

}());
