/* ==========================================================================
   cards — a picture-card board for naming things. Pick a group, get a 3x3 of
   pictures, tap one to turn it over to its name, tap again to turn it back.
   Press and hold the purple button to turn the whole board over at once.
   ========================================================================== */
'use strict';

(function () {

  var sfx = App.sfx;

  /* Nine per group, always the same nine, dealt in a fresh order each time —
     a consistent set is what a small child actually learns from. */
  var DECKS = {
    animals: [
      { s: 'dog', n: 'dog' }, { s: 'cat', n: 'cat' }, { s: 'fish', n: 'fish' },
      { s: 'bird', n: 'bird' }, { s: 'cow', n: 'cow' }, { s: 'pig', n: 'pig' },
      { s: 'duck', n: 'duck' }, { s: 'frog', n: 'frog' }, { s: 'bee', n: 'bee' }
    ],
    food: [
      { s: 'tomato', n: 'tomato' }, { s: 'banana', n: 'banana' },
      { s: 'carrot', n: 'carrot' }, { s: 'grapes', n: 'grapes' },
      { s: 'strawberry', n: 'strawberry' }, { s: 'bread', n: 'bread' },
      { s: 'pasta', n: 'pasta' }, { s: 'cheese', n: 'cheese' },
      { s: 'broccoli', n: 'broccoli' }
    ],
    vehicles: [
      { s: 'car', n: 'car', c: '#e63946' },
      { s: 'airplane', n: 'airplane', c: '#0a84ff' },
      { s: 'helicopter', n: 'helicopter', c: '#ffb703' },
      { s: 'balloon', n: 'balloon', c: '#ff2d95' },
      { s: 'rocket', n: 'rocket', c: '#af52de' },
      { s: 'boat', n: 'boat', c: '#00b8a9' },
      { s: 'train', n: 'train' }, { s: 'bus', n: 'bus' }, { s: 'bicycle', n: 'bicycle' }
    ],
    shapes: [
      { s: 'circle', n: 'circle' }, { s: 'square', n: 'square' },
      { s: 'triangle', n: 'triangle' }, { s: 'star', n: 'star' },
      { s: 'heart', n: 'heart' }, { s: 'diamond', n: 'diamond' },
      { s: 'oval', n: 'oval' }, { s: 'rectangle', n: 'rectangle' },
      { s: 'arrow', n: 'arrow' }
    ],
    colours: [
      { s: 'ball', n: 'red', c: '#e63946' }, { s: 'ball', n: 'orange', c: '#ff9500' },
      { s: 'ball', n: 'yellow', c: '#ffd60a' }, { s: 'ball', n: 'green', c: '#34c759' },
      { s: 'ball', n: 'blue', c: '#0a84ff' }, { s: 'ball', n: 'purple', c: '#af52de' },
      { s: 'ball', n: 'pink', c: '#ff2d95' }, { s: 'ball', n: 'brown', c: '#8a5a2b' },
      { s: 'ball', n: 'black', c: '#2e3440' }
    ]
  };

  /* every subject in one flat list, for the scratch-off game to draw from */
  App.SUBJECTS = [].concat(DECKS.animals, DECKS.food, DECKS.vehicles,
                           DECKS.shapes, DECKS.colours);

  var CATS = [
    { key: 'animals',  icon: 'dog',   label: 'animals' },
    { key: 'food',     icon: 'tomato', label: 'food' },
    { key: 'vehicles', icon: 'car',   label: 'vehicles', c: '#e63946' },
    { key: 'shapes',   icon: 'star',  label: 'shapes' },
    { key: 'colours',  icon: 'ball',  label: 'colours',  c: '#0a84ff' }
  ];

  var board   = document.getElementById('board');
  var catpick = document.getElementById('catpick');
  var row     = document.getElementById('cardTools');
  var flipBtn = document.getElementById('flipBtn');

  var cat   = null;
  var cards = [];      /* { el, item, flipped } */
  var snap  = null;

  function shuffled(arr) {
    var a = arr.slice(), i, j, t;
    for (i = a.length - 1; i > 0; i--) {
      j = (Math.random() * (i + 1)) | 0;
      t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }

  /* ------------------------------ the board --------------------------- */

  function makeCard(item, flipped) {
    var el = document.createElement('button');
    el.type = 'button';
    el.className = 'card' + (flipped ? ' flipped' : '');
    el.setAttribute('aria-label', item.n);
    if (item.c) { el.style.color = item.c; }
    el.innerHTML =
      '<div class="card-inner">' +
        '<div class="card-face card-front">' + App.spriteSvg(item.s) + '</div>' +
        '<div class="card-face card-back"><span class="card-word"></span></div>' +
      '</div>';
    /* the name goes in as text, never as markup */
    el.querySelector('.card-word').textContent = item.n;

    var card = { el: el, item: item, flipped: !!flipped };
    el.addEventListener('pointerdown', function () {
      App.unlockAudio();
      turn(card, !card.flipped);
      if (card.flipped) { sfx.hide(); } else { sfx.show(); }
    });
    board.appendChild(el);
    return card;
  }

  function turn(card, toBack) {
    card.flipped = !!toBack;
    card.el.classList.toggle('flipped', card.flipped);
  }

  function deal(key, layout) {
    cat = key;
    board.innerHTML = '';
    var items = layout ? layout.map(function (l) { return l.item; })
                       : shuffled(DECKS[key]);
    cards = items.map(function (item, i) {
      return makeCard(item, layout ? layout[i].flipped : false);
    });
    syncTools();
  }

  /* ------------------------------- chrome ----------------------------- */

  CATS.forEach(function (c) {
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'toolbtn';
    b.dataset.cat = c.key;
    b.setAttribute('aria-label', c.label);
    b.innerHTML = App.spriteSvg(c.icon);
    if (c.c) { b.style.color = c.c; }
    b.addEventListener('pointerdown', function () {
      App.unlockAudio();
      closePick();
      deal(c.key);
      sfx.show();
    });
    row.appendChild(b);

    var t = document.createElement('button');
    t.type = 'button';
    t.className = 'cattile';
    t.setAttribute('aria-label', c.label);
    t.innerHTML = App.spriteSvg(c.icon);
    if (c.c) { t.style.color = c.c; }
    t.addEventListener('pointerdown', function () {
      App.unlockAudio();
      closePick();
      deal(c.key);
      sfx.on();
    });
    catpick.appendChild(t);
  });

  function syncTools() {
    var bs = row.querySelectorAll('.toolbtn');
    for (var i = 0; i < bs.length; i++) {
      bs[i].setAttribute('aria-pressed', String(bs[i].dataset.cat === cat));
    }
  }

  function openPick()  { catpick.classList.add('open'); }
  function closePick() { catpick.classList.remove('open'); }

  /* tapping the space around the tiles keeps whatever is already dealt, so a
     stray tap can't trap anyone in the chooser */
  catpick.addEventListener('pointerdown', function (e) {
    if (e.target === catpick) { closePick(); sfx.drop(); }
  });

  /* Turn the whole board over. Rather than a strict toggle, it looks at what
     is showing and does the visible thing: if you can mostly see pictures it
     hides them, otherwise it reveals them. That stays predictable even after
     individual cards have been turned by hand. */
  App.attachHold(flipBtn, App.HOLD_MS, function () {
    if (!cards.length) { return; }
    var faceUp = cards.filter(function (c) { return !c.flipped; }).length;
    var toBack = faceUp * 2 >= cards.length;
    cards.forEach(function (c, i) {
      setTimeout(function () { turn(c, toBack); }, i * 45);   /* a ripple */
    });
    if (toBack) { sfx.hide(); } else { sfx.show(); }
  });

  /* ----------------------------- interface ---------------------------- */

  App.games.cards = {
    enter: function () {
      if (!cat) { deal('animals'); }     /* never show an empty board */
      syncTools();
      openPick();                        /* "when opened, pick a group" */
    },
    leave: closePick,

    /* the board is always full, so the clear button is always live and the
       tap-here hand is never wanted */
    isEmpty: function () { return false; },

    clear: function () {
      snap = { cat: cat, layout: cards.map(function (c) {
        return { item: c.item, flipped: c.flipped };
      }) };
      deal(cat);                         /* a fresh shuffle, all face up */
      return true;
    },

    restore: function () {
      var was = snap;
      snap = null;
      if (!was) { return; }
      deal(was.cat, was.layout);
    },

    dropSnapshot: function () { snap = null; }
  };

}());
