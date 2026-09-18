/* ==========================================================================
   scratch — a picture hidden under a coloured cover. Drag a finger and the
   cover wipes away with a destination-out stroke, revealing the picture and
   whatever backdrop is behind it. Hold the red button to shuffle: a new
   random picture and a fresh cover.
   ========================================================================== */
'use strict';

(function () {

  var rand = App.rand, clamp = App.clamp, pick = App.pick, sfx = App.sfx, S = App.Stage;

  var picLayer = document.getElementById('picLayer');
  var cover    = document.getElementById('cover');
  var cctx = null, dpr = 1;
  var strokes = new Map();
  var subject = null, paint = null, snap = null;

  /* pairs that stay bright enough to look inviting but dark enough that the
     revealed picture pops against them */
  var COVERS = [
    ['#ff9eb5', '#c9184a'], ['#8ecae6', '#023e8a'], ['#a8e6a1', '#1b7a3e'],
    ['#ffd6a5', '#dd6b00'], ['#cdb4f6', '#5a189a'], ['#9ae6e0', '#12657f'],
    ['#ffe066', '#e08e00'], ['#ffb3c6', '#7b2cbf']
  ];

  /* ------------------------------ the layers -------------------------- */

  function sizeCover() {
    var W = Math.max(1, Math.round(S.W)), H = Math.max(1, Math.round(S.H));
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    var pw = Math.round(W * dpr), ph = Math.round(H * dpr);
    if (cover.width === pw && cover.height === ph) { return; }

    /* keep whatever has been scratched so far across an orientation change */
    var keep = null;
    if (cover.width && cover.height && cctx) {
      keep = document.createElement('canvas');
      keep.width = cover.width; keep.height = cover.height;
      keep.getContext('2d').drawImage(cover, 0, 0);
    }
    cover.width = pw; cover.height = ph;
    cover.style.width = W + 'px';
    cover.style.height = H + 'px';
    cctx = cover.getContext('2d');
    cctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    cctx.lineCap = 'round';
    cctx.lineJoin = 'round';
    if (keep) {
      cctx.save();
      cctx.setTransform(1, 0, 0, 1, 0, 0);
      cctx.drawImage(keep, 0, 0, pw, ph);
      cctx.restore();
    } else {
      fillCover();
    }
  }

  function fillCover() {
    if (!cctx) { return; }
    cctx.save();
    cctx.setTransform(1, 0, 0, 1, 0, 0);
    cctx.globalCompositeOperation = 'source-over';
    cctx.clearRect(0, 0, cover.width, cover.height);
    var g = cctx.createLinearGradient(0, 0, cover.width, cover.height);
    g.addColorStop(0, paint[0]);
    g.addColorStop(1, paint[1]);
    cctx.fillStyle = g;
    cctx.fillRect(0, 0, cover.width, cover.height);
    cctx.restore();
  }

  function showPicture() {
    picLayer.innerHTML = '<div class="pic-card"><div class="pic">' +
                         App.spriteSvg(subject.s) + '</div></div>';
    if (subject.c) { picLayer.querySelector('.pic').style.color = subject.c; }
    picLayer.setAttribute('aria-label', subject.n);
  }

  /* a fresh round: new picture, new cover colour, cover put back */
  function shuffle() {
    var was = subject;
    do { subject = pick(App.SUBJECTS); }
    while (App.SUBJECTS.length > 1 && was && subject.n === was.n);
    paint = pick(COVERS);
    showPicture();
    sizeCover();
    fillCover();
  }

  /* ------------------------------ scratching -------------------------- */

  function brush() { return clamp(S.obj * 0.62, 46, 110); }

  function wipe(pts) {
    if (!cctx) { return; }
    cctx.save();
    cctx.globalCompositeOperation = 'destination-out';
    cctx.strokeStyle = '#000';
    cctx.lineWidth = brush();
    cctx.stroke(App.smoothPath(pts));
    cctx.restore();
  }

  function at(ev) {
    return { x: clamp(S.x(ev), 0, S.W), y: clamp(S.y(ev), 0, S.H) };
  }

  /* ----------------------------- interface ---------------------------- */

  App.games.scratch = {
    onDown: function (e) {
      App.unlockAudio();
      var p = at(e);
      strokes.set(e.pointerId, { last: p });
      wipe([p]);
      sfx.grab();
      try { App.stage.setPointerCapture(e.pointerId); } catch (err) {}
      e.preventDefault();
    },

    onMove: function (e) {
      var s = strokes.get(e.pointerId);
      if (!s) { return; }
      /* take every sample the browser saved up, as one smooth run */
      var raw = e.getCoalescedEvents ? e.getCoalescedEvents() : null;
      var pts = [s.last], i, p, q;
      if (raw && raw.length) {
        for (i = 0; i < raw.length; i++) { pts.push(at(raw[i])); }
      } else {
        pts.push(at(e));
      }
      var keep = [pts[0]];
      for (i = 1; i < pts.length; i++) {
        p = pts[i]; q = keep[keep.length - 1];
        if (Math.hypot(p.x - q.x, p.y - q.y) >= 0.5) { keep.push(p); }
      }
      if (keep.length < 2) { return; }
      wipe(keep);
      s.last = keep[keep.length - 1];
      e.preventDefault();
    },

    onUp:     function (e) { strokes.delete(e.pointerId); },
    onCancel: function (e) { strokes.delete(e.pointerId); },

    enter: function () {
      if (!subject) { shuffle(); } else { sizeCover(); }
    },
    leave: function () { strokes.clear(); },
    resize: function () { sizeCover(); },

    isEmpty: function () { return false; },   /* always something to shuffle */

    clear: function () {
      if (!cctx) { return false; }
      var keep = document.createElement('canvas');
      keep.width = cover.width; keep.height = cover.height;
      keep.getContext('2d').drawImage(cover, 0, 0);
      snap = { canvas: keep, subject: subject, paint: paint };
      strokes.clear();
      shuffle();
      return true;
    },

    restore: function () {
      var was = snap;
      snap = null;
      if (!was) { return; }
      subject = was.subject;
      paint = was.paint;
      showPicture();
      sizeCover();
      cctx.save();
      cctx.setTransform(1, 0, 0, 1, 0, 0);
      cctx.globalCompositeOperation = 'source-over';
      cctx.clearRect(0, 0, cover.width, cover.height);
      cctx.drawImage(was.canvas, 0, 0, cover.width, cover.height);
      cctx.restore();
    },

    dropSnapshot: function () { snap = null; }
  };

}());
