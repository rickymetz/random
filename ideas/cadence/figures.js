/* Cadence — the little figure that shows you the movement.
 *
 * Each exercise is described as two poses, and a pose is joint *angles*, not
 * pixel positions: a thigh that "points down and forward at 150°" stays right
 * whatever size the panel is. Forward kinematics turns the angles into joints,
 * and the whole figure is auto-fitted to its box afterwards — so authoring a
 * pose only needs the limbs to be right relative to each other.
 *
 * Angles are degrees on a compass: 0 points up, 90 right, 180 down, 270 left.
 * Limb angles are absolute (not relative to the parent), which is what makes
 * them readable: `sh: 180` is a vertical shin, wherever the thigh went.
 *
 * Every limb takes [near, far] — the near side is drawn solid, the far side
 * faded, which is what makes a side view read as a body rather than a tangle.
 */
(function (global) {
  'use strict';

  var LEN = { torso: 24, head: 9, upperArm: 13, foreArm: 12, thigh: 15, shin: 15 };
  var HEAD_R = 6;
  var BOX = 100;
  var PAD = 7;

  function dir(a) {
    var r = a * Math.PI / 180;
    return [Math.sin(r), -Math.cos(r)];
  }

  function step(p, a, len) {
    var d = dir(a);
    return [p[0] + d[0] * len, p[1] + d[1] * len];
  }

  function pair(v) {
    return Array.isArray(v) ? v : [v, v];
  }

  /* angles → joints */
  function solve(pose) {
    var hip = pose.hip;
    var t = pose.t || 0;
    var neck = step(hip, t, LEN.torso);
    var head = step(neck, t + (pose.head || 0), LEN.head);
    var ua = pair(pose.ua), fa = pair(pose.fa), th = pair(pose.th), sh = pair(pose.sh);
    var out = { hip: hip, neck: neck, head: head, bow: pose.bow || 0, elbow: [], hand: [], knee: [], foot: [] };
    for (var i = 0; i < 2; i++) {
      out.elbow[i] = step(neck, ua[i], LEN.upperArm);
      out.hand[i] = step(out.elbow[i], fa[i], LEN.foreArm);
      out.knee[i] = step(hip, th[i], LEN.thigh);
      out.foot[i] = step(out.knee[i], sh[i], LEN.shin);
    }
    return out;
  }

  function points(sk) {
    return [sk.hip, sk.neck, sk.head].concat(sk.elbow, sk.hand, sk.knee, sk.foot);
  }

  function lerp(a, b, u) {
    return [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u];
  }

  function blend(a, b, u) {
    var out = { hip: lerp(a.hip, b.hip, u), neck: lerp(a.neck, b.neck, u), head: lerp(a.head, b.head, u),
      bow: a.bow + (b.bow - a.bow) * u, elbow: [], hand: [], knee: [], foot: [] };
    for (var i = 0; i < 2; i++) {
      out.elbow[i] = lerp(a.elbow[i], b.elbow[i], u);
      out.hand[i] = lerp(a.hand[i], b.hand[i], u);
      out.knee[i] = lerp(a.knee[i], b.knee[i], u);
      out.foot[i] = lerp(a.foot[i], b.foot[i], u);
    }
    return out;
  }

  /* The viewBox is the figure's own bounding box over BOTH poses: one box for
   * the pair, so the movement between them survives, and a wide pose (child's
   * pose, a plank) fills a wide panel instead of floating in a square. */
  function fitOf(skeletons) {
    var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    var floor = -Infinity;
    skeletons.forEach(function (sk) {
      points(sk).forEach(function (p) {
        minX = Math.min(minX, p[0] - HEAD_R);
        maxX = Math.max(maxX, p[0] + HEAD_R);
        minY = Math.min(minY, p[1] - HEAD_R);
        maxY = Math.max(maxY, p[1] + HEAD_R);
        floor = Math.max(floor, p[1]);
      });
    });
    var pad = Math.max(maxX - minX, maxY - minY) * 0.08;
    floor = Math.min(floor + 2.5, maxY + pad);
    return {
      x: minX - pad,
      y: minY - pad,
      w: (maxX - minX) + pad * 2,
      h: (maxY - minY) + pad * 2,
      ground: floor,
      right: maxX - HEAD_R
    };
  }

  var NS = 'http://www.w3.org/2000/svg';
  function svgEl(name, attrs) {
    var node = document.createElementNS(NS, name);
    Object.keys(attrs || {}).forEach(function (k) { node.setAttribute(k, attrs[k]); });
    return node;
  }

  function limbPath(a, b, c) {
    return 'M' + a[0] + ' ' + a[1] + 'L' + b[0] + ' ' + b[1] + 'L' + c[0] + ' ' + c[1];
  }

  /* A straight spine reads as a plank; cat-cow needs it to bend. */
  function spinePath(sk) {
    var a = sk.hip, b = sk.neck;
    if (!sk.bow) return 'M' + a[0] + ' ' + a[1] + 'L' + b[0] + ' ' + b[1];
    var dx = b[0] - a[0], dy = b[1] - a[1];
    var len = Math.sqrt(dx * dx + dy * dy) || 1;
    var px = -dy / len, py = dx / len;
    var cx = (a[0] + b[0]) / 2 + px * sk.bow * 2;
    var cy = (a[1] + b[1]) / 2 + py * sk.bow * 2;
    return 'M' + a[0] + ' ' + a[1] + 'Q' + cx + ' ' + cy + ' ' + b[0] + ' ' + b[1];
  }

  function easeInOutSine(u) {
    return 0.5 - Math.cos(u * Math.PI) / 2;
  }

  var reduceMotion = global.matchMedia && global.matchMedia('(prefers-reduced-motion: reduce)');

  /* Build an animated figure. Returns the <svg> plus a stop() to release it. */
  function create(id, opts) {
    var options = opts || {};
    var def = FIGURES[id] || FIGURES._default;
    var skeletons = def.poses.map(solve);
    var fit = fitOf(skeletons);

    var svg = svgEl('svg', {
      viewBox: fit.x + ' ' + fit.y + ' ' + fit.w + ' ' + fit.h,
      class: 'figure',
      preserveAspectRatio: 'xMidYMid meet',
      role: 'img',
      'aria-label': def.alt || def.cue || 'Exercise demonstration'
    });
    var g = svgEl('g', { 'stroke-linecap': 'round', 'stroke-linejoin': 'round', fill: 'none' });
    svg.appendChild(g);

    if (def.ground !== false) {
      g.appendChild(svgEl('line', {
        class: 'figure-ground',
        x1: fit.x, y1: fit.ground, x2: fit.x + fit.w, y2: fit.ground
      }));
    }
    if (def.prop === 'wall') {
      g.appendChild(svgEl('line', {
        class: 'figure-ground',
        x1: fit.right + 4, y1: Math.max(fit.y, fit.ground - 58), x2: fit.right + 4, y2: fit.ground
      }));
    }

    var farArm = svgEl('path', { class: 'figure-limb figure-far' });
    var farLeg = svgEl('path', { class: 'figure-limb figure-far' });
    var spine = svgEl('path', { class: 'figure-limb' });
    var neckLine = svgEl('line', { class: 'figure-limb' });
    var head = svgEl('circle', { class: 'figure-head', r: HEAD_R });
    var nearArm = svgEl('path', { class: 'figure-limb' });
    var nearLeg = svgEl('path', { class: 'figure-limb' });
    [farArm, farLeg, spine, neckLine, head, nearArm, nearLeg].forEach(function (n) { g.appendChild(n); });

    function paint(sk) {
      farArm.setAttribute('d', limbPath(sk.neck, sk.elbow[1], sk.hand[1]));
      farLeg.setAttribute('d', limbPath(sk.hip, sk.knee[1], sk.foot[1]));
      spine.setAttribute('d', spinePath(sk));
      neckLine.setAttribute('x1', sk.neck[0]);
      neckLine.setAttribute('y1', sk.neck[1]);
      neckLine.setAttribute('x2', sk.head[0]);
      neckLine.setAttribute('y2', sk.head[1]);
      head.setAttribute('cx', sk.head[0]);
      head.setAttribute('cy', sk.head[1]);
      nearArm.setAttribute('d', limbPath(sk.neck, sk.elbow[0], sk.hand[0]));
      nearLeg.setAttribute('d', limbPath(sk.hip, sk.knee[0], sk.foot[0]));
    }

    var raf = null;
    var started = 0;
    var still = options.still || (reduceMotion && reduceMotion.matches);

    function frame(now) {
      if (!started) started = now;
      var cycle = (def.cycle || 2.6) * 1000;
      var phase = ((now - started) % cycle) / cycle;
      var u = phase < 0.5 ? phase * 2 : (1 - phase) * 2;
      paint(blend(skeletons[0], skeletons[1] || skeletons[0], easeInOutSine(u)));
      raf = global.requestAnimationFrame(frame);
    }

    if (still) {
      // `phase` picks any point in the cycle; otherwise a still shows the
      // working end of the movement, which is the more descriptive pose.
      if (typeof options.phase === 'number') {
        paint(blend(skeletons[0], skeletons[1] || skeletons[0], easeInOutSine(options.phase)));
      } else {
        paint(skeletons[options.poseIndex === 0 ? 0 : 1] || skeletons[0]);
      }
    } else {
      raf = global.requestAnimationFrame(frame);
    }

    return {
      node: svg,
      stop: function () {
        if (raf) global.cancelAnimationFrame(raf);
        raf = null;
      }
    };
  }

  /* ------------------------------------------------------------------ *
   * The routine, drawn. Two poses each; the figure eases between them.  *
   * ------------------------------------------------------------------ */

  var FIGURES = {
    warmup: {
      cue: 'Easy march, swing the arms, get warm.',
      cycle: 1.7,
      poses: [
        { hip: [50, 50], t: 3, ua: [228, 138], fa: [248, 122], th: [108, 184], sh: [162, 184] },
        { hip: [50, 50], t: -3, ua: [138, 228], fa: [122, 248], th: [184, 108], sh: [184, 162] }
      ]
    },
    pushups: {
      cue: 'One straight line from head to heels, elbows close in.',
      cycle: 2.6,
      poses: [
        { hip: [46, 64], t: 74, head: 10, ua: 176, fa: 176, th: 233, sh: 233 },
        { hip: [44, 68], t: 74, head: 16, ua: 200, fa: 139, th: 242, sh: 242 }
      ]
    },
    squats: {
      cue: 'Chest up, knees tracking over the toes.',
      cycle: 2.8,
      poses: [
        { hip: [50, 50], t: 0, ua: [172, 188], fa: [172, 188], th: 180, sh: 180 },
        { hip: [46, 63], t: 22, ua: 100, fa: 96, th: 140, sh: 198 }
      ]
    },
    'reverse-lunges': {
      cue: 'Step back, drop the back knee, stay tall.',
      cycle: 3,
      poses: [
        { hip: [50, 50], t: 0, ua: [174, 186], fa: [174, 186], th: 180, sh: 180 },
        { hip: [50, 64], t: 7, ua: [170, 190], fa: [168, 192], th: [145, 218], sh: [186, 255] }
      ]
    },
    plank: {
      cue: 'Elbows under shoulders, ribs down, breathe.',
      cycle: 4.5,
      poses: [
        { hip: [47, 70], t: 76, head: 14, ua: 178, fa: 92, th: 256, sh: 256 },
        { hip: [47, 72], t: 74, head: 14, ua: 178, fa: 92, th: 254, sh: 254, bow: -1.5 }
      ]
    },
    cooldown: {
      cue: 'Let it go — fold, breathe, unwind.',
      cycle: 4,
      poses: [
        { hip: [50, 50], t: 0, ua: [174, 186], fa: [174, 186], th: 180, sh: 180 },
        { hip: [50, 50], t: 108, ua: 178, fa: 178, th: 182, sh: 178 }
      ]
    },
    'pike-pushups': {
      cue: 'Hips high, lower the crown of the head toward the floor.',
      cycle: 2.8,
      poses: [
        { hip: [46, 56], t: 125, head: 8, ua: 125, fa: 125, th: 201, sh: 201 },
        { hip: [46, 56], t: 125, head: 34, ua: 145, fa: 106, th: 201, sh: 201 }
      ]
    },
    'glute-bridges': {
      cue: 'Ribs down, squeeze the glutes, lift from the hips.',
      cycle: 2.6,
      poses: [
        { hip: [52, 76], t: 265, head: 2, ua: 100, fa: 100, th: 55, sh: 170 },
        { hip: [52, 66], t: 250, head: 12, ua: 100, fa: 96, th: 75, sh: 176 }
      ]
    },
    'split-squats': {
      cue: 'Weight through the front heel, back knee straight down.',
      cycle: 3,
      poses: [
        { hip: [50, 52], t: 8, ua: [174, 186], fa: [174, 186], th: [168, 205], sh: [182, 188] },
        { hip: [50, 64], t: 8, ua: [174, 186], fa: [174, 186], th: [158, 212], sh: [188, 240] }
      ]
    },
    'bird-dogs': {
      cue: 'Opposite arm and leg, hips level, no rocking.',
      cycle: 3.4,
      poses: [
        { hip: [56, 70], t: 288, head: -18, ua: [180, 265], fa: [180, 265], th: [180, 100], sh: [265, 95] },
        { hip: [56, 70], t: 288, head: -18, ua: [265, 180], fa: [265, 180], th: [100, 180], sh: [95, 265] }
      ]
    },
    'hip-switches': {
      cue: 'Sit tall, let both knees fall side to side.',
      cycle: 3,
      poses: [
        { hip: [50, 58], t: 0, ua: [140, 220], fa: [155, 205], th: [125, 155], sh: [95, 62] },
        { hip: [50, 58], t: 0, ua: [140, 220], fa: [155, 205], th: [235, 205], sh: [265, 298] }
      ]
    },
    'hip-flexor': {
      cue: 'Tuck the tailbone, then press the hips gently forward.',
      cycle: 4.5,
      poses: [
        { hip: [45, 73], t: -6, ua: [160, 200], fa: [170, 190], th: [90, 216], sh: [180, 250] },
        { hip: [50, 73], t: -12, ua: [160, 200], fa: [170, 190], th: [96, 224], sh: [178, 252] }
      ]
    },
    'adductor-rock-backs': {
      cue: 'One leg out to the side, rock the hips back slowly.',
      cycle: 3.6,
      poses: [
        { hip: [56, 70], t: 288, head: -18, ua: [180, 186], fa: [180, 186], th: [180, 120], sh: [265, 120] },
        { hip: [66, 74], t: 292, head: -18, ua: [166, 172], fa: [172, 178], th: [190, 128], sh: [256, 128] }
      ]
    },
    straddle: {
      cue: 'Soles together or legs wide — hinge from the hips, not the back.',
      cycle: 5,
      poses: [
        { hip: [46, 70], t: -4, ua: [168, 192], fa: [172, 188], th: [97, 106], sh: [94, 103] },
        { hip: [46, 70], t: 44, ua: [128, 140], fa: [116, 128], th: [97, 106], sh: [94, 103] }
      ]
    },
    'knee-to-wall-rocks': {
      cue: 'Heel stays down, drive the knee out over the toes.',
      cycle: 2.4,
      prop: 'wall',
      poses: [
        { hip: [44, 52], t: 4, ua: [150, 160], fa: [120, 130], th: [178, 200], sh: [182, 196] },
        { hip: [44, 55], t: 8, ua: [150, 160], fa: [114, 124], th: [166, 202], sh: [200, 198] }
      ]
    },
    'knee-to-wall-hold': {
      cue: 'Heel down, knee to the wall, and stay there.',
      cycle: 5,
      prop: 'wall',
      poses: [
        { hip: [44, 55], t: 8, ua: [150, 160], fa: [114, 124], th: [166, 202], sh: [200, 198] },
        { hip: [44, 56], t: 9, ua: [150, 160], fa: [113, 123], th: [164, 202], sh: [202, 198] }
      ]
    },
    'calf-stretch': {
      cue: 'Back leg straight, heel pressed into the floor.',
      cycle: 5,
      prop: 'wall',
      poses: [
        { hip: [44, 54], t: 12, ua: [120, 128], fa: [105, 113], th: [165, 205], sh: [185, 205] },
        { hip: [42, 56], t: 16, ua: [118, 126], fa: [103, 111], th: [162, 208], sh: [188, 208] }
      ]
    },
    'cat-cow': {
      cue: 'Round the back, then let it dip — move with the breath.',
      cycle: 4,
      poses: [
        { hip: [56, 70], t: 288, head: 4, ua: 180, fa: 180, th: 180, sh: 265, bow: -6 },
        { hip: [56, 70], t: 288, head: -46, ua: 180, fa: 180, th: 180, sh: 265, bow: 8 }
      ]
    },
    'open-book': {
      cue: 'Knees stay stacked, let the top arm open the chest.',
      cycle: 4,
      poses: [
        { hip: [58, 70], t: 272, head: -6, ua: [268, 268], fa: [268, 268], th: [200, 205], sh: [275, 280] },
        { hip: [58, 70], t: 280, head: -6, ua: [20, 268], fa: [40, 268], th: [200, 205], sh: [275, 280] }
      ]
    },
    'childs-pose': {
      cue: 'Hips toward the heels, arms long, breathe into the back.',
      cycle: 5,
      poses: [
        { hip: [62, 50], t: 235, head: 15, ua: [272, 278], fa: [278, 284], th: [200, 206], sh: [100, 95], bow: -3 },
        { hip: [63, 51], t: 237, head: 15, ua: [273, 279], fa: [279, 285], th: [200, 206], sh: [100, 95], bow: -6 }
      ]
    },
    'focus-stretch': {
      cue: 'Whatever felt tightest today — two quiet minutes on it.',
      cycle: 5,
      poses: [
        { hip: [50, 66], t: -2, ua: [152, 208], fa: [138, 222], th: [118, 242], sh: [244, 116] },
        { hip: [50, 67], t: 3, ua: [150, 210], fa: [136, 224], th: [118, 242], sh: [244, 116] }
      ]
    },
    recovery: {
      cue: 'Nothing scheduled. Walk, breathe, let it repair.',
      cycle: 4,
      poses: [
        { hip: [50, 50], t: 2, ua: [186, 174], fa: [190, 170], th: [176, 184], sh: [178, 186] },
        { hip: [50, 51], t: -2, ua: [174, 186], fa: [170, 190], th: [184, 176], sh: [186, 178] }
      ]
    },
    _default: {
      cue: '',
      cycle: 4,
      poses: [
        { hip: [50, 50], t: 2, ua: [184, 176], fa: [188, 172], th: [178, 182], sh: [179, 183] },
        { hip: [50, 51], t: -2, ua: [176, 184], fa: [172, 188], th: [182, 178], sh: [183, 179] }
      ]
    }
  };

  global.CadenceFigures = {
    create: create,
    has: function (id) { return Object.prototype.hasOwnProperty.call(FIGURES, id) && id !== '_default'; },
    cue: function (id) { return (FIGURES[id] || FIGURES._default).cue || ''; },
    ids: function () { return Object.keys(FIGURES).filter(function (k) { return k !== '_default'; }); }
  };
})(window);
