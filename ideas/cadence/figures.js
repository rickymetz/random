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
      // The cue is rendered as text right beside this, so announcing the
      // drawing as well just said everything twice.
      'aria-hidden': 'true',
      focusable: 'false'
    });
    var g = svgEl('g', { 'stroke-linecap': 'round', 'stroke-linejoin': 'round', fill: 'none' });
    svg.appendChild(g);

    if (def.ground !== false) {
      g.appendChild(svgEl('line', {
        class: 'figure-ground',
        x1: fit.x, y1: fit.ground, x2: fit.x + fit.w, y2: fit.ground
      }));
    }
    if (def.prop === 'bar') {
      // The thing the hands are holding, drawn at hand height.
      var barY = Infinity, barL = Infinity, barR = -Infinity;
      skeletons.forEach(function (sk) {
        sk.hand.forEach(function (hand) {
          barY = Math.min(barY, hand[1]);
          barL = Math.min(barL, hand[0]);
          barR = Math.max(barR, hand[0]);
        });
      });
      g.appendChild(svgEl('line', {
        class: 'figure-ground',
        x1: barL - 10, y1: barY - 2, x2: barR + 10, y2: barY - 2
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

    /* ~20fps. These are two-to-five-second eases between two poses, so the
     * extra 40 frames a second buy nothing visible and cost more than double
     * the CPU — and it has to be a timer rather than a throttled rAF, because
     * the expense is asking for the frame, not the work done inside it. */
    var FRAME_MS = 50;
    var timer = null;
    var started = 0;
    var still = options.still || (reduceMotion && reduceMotion.matches);

    function frame() {
      var now = Date.now();
      if (!started) started = now;
      var cycle = (def.cycle || 2.6) * 1000;
      var phase = ((now - started) % cycle) / cycle;
      var u = phase < 0.5 ? phase * 2 : (1 - phase) * 2;
      paint(blend(skeletons[0], skeletons[1] || skeletons[0], easeInOutSine(u)));
      timer = global.setTimeout(frame, FRAME_MS);
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
      frame();
    }

    return {
      node: svg,
      stop: function () {
        if (timer) global.clearTimeout(timer);
        timer = null;
      }
    };
  }

  /* ------------------------------------------------------------------ *
   * The routine, drawn. Two poses each; the figure eases between them.  *
   * ------------------------------------------------------------------ */

  var FIGURES = {
    warmup: {
      cue: 'March and circle the arms, then rehearse today’s first two moves at half effort.',
      cycle: 1.7,
      poses: [
        { hip: [50, 50], t: 3, ua: [228, 138], fa: [248, 122], th: [108, 184], sh: [162, 184] },
        { hip: [50, 50], t: -3, ua: [138, 228], fa: [122, 248], th: [184, 108], sh: [184, 162] }
      ]
    },
    pushups: {
      cue: 'One straight line from head to heels, elbows close in.',
      cycle: 2.6,
      // Thigh = torso + 180 is what makes the body actually straight; the
      // torso angle is picked so hands and toes share one floor.
      poses: [
        { hip: [50, 58], t: 62, head: 15, ua: 180, fa: 180, th: 242, sh: 242 },
        { hip: [52.6, 64.2], t: 75, head: 15, ua: 250, fa: 140, th: 255, sh: 255 }
      ]
    },
    squats: {
      cue: 'Sit down between your heels — knees point the same way as your toes.',
      cycle: 2.8,
      poses: [
        { hip: [50, 50], t: 0, ua: [172, 188], fa: [172, 188], th: 180, sh: 180 },
        { hip: [45, 68], t: 30, ua: 100, fa: 95, th: 90, sh: 220 }
      ]
    },
    'reverse-lunges': {
      cue: 'Step back, drop the back knee, stay tall.',
      cycle: 3,
      poses: [
        { hip: [50, 50], t: 0, ua: [174, 186], fa: [174, 186], th: 180, sh: 180 },
        { hip: [48, 62], t: 5, ua: [170, 190], fa: [168, 192], th: [124, 217], sh: [225, 245] }
      ]
    },
    plank: {
      cue: 'Elbows under shoulders, ribs down, glutes tight — breathe.',
      cycle: 4.5,
      poses: [
        { hip: [47, 70], t: 76, head: 14, ua: 178, fa: 92, th: 256, sh: 256 },
        { hip: [47, 72], t: 74, head: 14, ua: 178, fa: 92, th: 254, sh: 254, bow: -1.5 }
      ]
    },
    cooldown: {
      cue: 'Walk it off, breathe slow, stretch whatever you just worked.',
      cycle: 4,
      poses: [
        { hip: [50, 50], t: 0, ua: [8, -8], fa: [5, -5], th: 180, sh: 180 },
        { hip: [50, 50], t: 12, ua: [16, -2], fa: [13, -6], th: 182, sh: 178 }
      ]
    },
    'pike-pushups': {
      cue: 'Hips stacked over your hands — lower until your head is just off the floor, weight in the hands.',
      cycle: 2.8,
      poses: [
        { hip: [46, 56], t: 125, head: 8, ua: 125, fa: 125, th: 201, sh: 201 },
        { hip: [46, 56], t: 125, head: 34, ua: 145, fa: 106, th: 201, sh: 201 }
      ]
    },
    'table-rows': {
      cue: 'Body straight from heels to head — pull your chest to the bar, shoulders away from your ears.',
      cycle: 2.8,
      prop: 'bar',
      poses: [
        { hip: [50, 62], t: 70, head: 10, ua: 0, fa: 0, th: 250, sh: 250 },
        { hip: [48.3, 58.2], t: 62, head: 10, ua: 50, fa: 325, th: 242, sh: 242 }
      ]
    },
    'prone-ytw': {
      cue: 'Thumbs up, arms light — lift from between the shoulder blades, not the neck.',
      cycle: 2.6,
      poses: [
        { hip: [50, 74], t: 92, head: -20, ua: [85, 88], fa: [85, 88], th: 272, sh: 272 },
        { hip: [50, 74], t: 88, head: -25, ua: [70, 74], fa: [65, 69], th: 272, sh: 272, bow: -3 }
      ]
    },
    'glute-bridges': {
      cue: 'Ribs down, squeeze the glutes, lift from the hips.',
      cycle: 2.6,
      poses: [
        { hip: [60, 76], t: 265, head: -2, ua: 95, fa: 95, th: 40, sh: 164 },
        { hip: [58, 66], t: 241, head: 22, ua: 95, fa: 95, th: 86, sh: 176 }
      ]
    },
    'split-squats': {
      cue: 'Weight through the front heel, back knee straight down.',
      cycle: 3,
      poses: [
        { hip: [46, 56], t: 6, ua: [174, 186], fa: [174, 186], th: [127, 214], sh: [187, 224] },
        { hip: [46, 68], t: 8, ua: [174, 186], fa: [174, 186], th: [82, 220], sh: [199, 268] }
      ]
    },
    'bird-dogs': {
      cue: 'Opposite arm and leg — reach long, not high; hips stay level.',
      cycle: 3.4,
      poses: [
        { hip: [56, 70], t: 288, head: -18, ua: [180, 265], fa: [180, 265], th: [180, 100], sh: [95, 95] },
        { hip: [56, 70], t: 288, head: -18, ua: [265, 180], fa: [265, 180], th: [100, 180], sh: [95, 95] }
      ]
    },
    'hip-switches': {
      cue: 'Sit tall on your sit bones and rotate the knees side to side — no leaning back.',
      cycle: 3,
      poses: [
        { hip: [50, 58], t: 0, ua: [140, 220], fa: [155, 205], th: [125, 155], sh: [95, 62] },
        { hip: [50, 58], t: 0, ua: [140, 220], fa: [155, 205], th: [235, 205], sh: [265, 298] }
      ]
    },
    'hip-flexor': {
      cue: 'Tuck the tailbone, ribs down, then press the hips forward — don’t lean back.',
      cycle: 4.5,
      poses: [
        { hip: [46, 65], t: 0, ua: [150, 200], fa: [160, 190], th: [90, 195], sh: [176, 265] },
        { hip: [51, 65], t: 3, ua: [150, 200], fa: [160, 190], th: [88, 211], sh: [195, 265] }
      ]
    },
    'adductor-rock-backs': {
      cue: 'One leg out to the side, rock the hips back slowly.',
      cycle: 3.6,
      poses: [
        { hip: [56, 70], t: 288, head: -18, ua: [180, 186], fa: [180, 186], th: [180, 120], sh: [95, 120] },
        { hip: [66, 74], t: 292, head: -18, ua: [166, 172], fa: [172, 178], th: [190, 128], sh: [95, 128] }
      ]
    },
    straddle: {
      cue: 'Soles together or legs wide — hinge from the hips, not the back.',
      cycle: 5,
      poses: [
        { hip: [46, 72], t: -2, ua: [165, 195], fa: [170, 190], th: [120, 128], sh: [265, 258] },
        { hip: [46, 72], t: 40, ua: [140, 160], fa: [130, 150], th: [120, 128], sh: [265, 258] }
      ]
    },
    'knee-to-wall-rocks': {
      cue: 'Heel stays down — drive the knee forward over the second toe.',
      cycle: 2.4,
      prop: 'wall',
      poses: [
        { hip: [44, 52], t: 4, ua: [150, 160], fa: [120, 130], th: [178, 202], sh: [182, 196] },
        { hip: [44, 58], t: 10, ua: [150, 160], fa: [112, 122], th: [150, 206], sh: [215, 196] }
      ]
    },
    'knee-to-wall-hold': {
      cue: 'Heel down, knee to the wall, and stay there.',
      cycle: 5,
      prop: 'wall',
      poses: [
        { hip: [44, 58], t: 10, ua: [150, 160], fa: [112, 122], th: [150, 206], sh: [215, 196] },
        { hip: [44, 59], t: 11, ua: [150, 160], fa: [111, 121], th: [148, 206], sh: [217, 196] }
      ]
    },
    'calf-stretch': {
      cue: 'Back leg straight, heel pressed into the floor.',
      cycle: 5,
      prop: 'wall',
      poses: [
        { hip: [44, 54], t: 20, ua: [118, 126], fa: [104, 112], th: [160, 213], sh: [193, 213] },
        { hip: [42, 56], t: 26, ua: [116, 124], fa: [102, 110], th: [155, 215], sh: [198, 215] }
      ]
    },
    'cat-cow': {
      cue: 'Exhale and round, inhale and let it dip — only as far as it’s comfortable.',
      cycle: 4,
      poses: [
        { hip: [56, 70], t: 288, head: 4, ua: 180, fa: 180, th: 180, sh: 95, bow: -4 },
        { hip: [56, 70], t: 288, head: -46, ua: 180, fa: 180, th: 180, sh: 95, bow: 6 }
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
        { hip: [62, 68], t: 258, head: 12, ua: [262, 266], fa: [268, 272], th: [227, 232], sh: [90, 86], bow: -3 },
        { hip: [62, 69], t: 260, head: 12, ua: [263, 267], fa: [269, 273], th: [227, 232], sh: [90, 86], bow: -5 }
      ]
    },
    'focus-stretch': {
      cue: 'Whatever felt tightest today — two quiet minutes, strong but never sharp.',
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

  /* Cues for exercises that don't have a drawing yet. Where a stretch can
   * hurt, the cue says how. */
  var CUES = {
    'neck-circles': 'Chin to chest, then roll ear to shoulder and back. Half-circles only — no rolling the head back.',
    'shoulder-rolls': 'Up to the ears, back, and down. Big and slow, then reverse halfway.',
    'reach-side-bend': 'Reach tall on the inhale, lean over on the exhale. Hips stay square, ribs open.',
    'hip-circles': 'Hands on hips, feet planted, draw the biggest circle the hips will make.',
    ragdoll: 'Soft knees, hold opposite elbows and let the head hang. Sway if it helps.',
    'worlds-greatest': 'Lunge, same-side elbow toward the instep, then rotate that arm to the ceiling.',
    frog: 'Knees wide, shins parallel, ankles in line with the knees. Rock the hips back slowly.',
    pigeon: 'Front shin as square as your hip allows, back leg long. Square hips beat a deep hold.',
    'happy-baby': 'Hold the outsides of the feet, knees toward the armpits, and let the low back sink.',
    malasana: 'Heels down if they’ll go, elbows pressing the knees apart, chest proud.',
    'seated-fold': 'Hinge at the hips, not the waist — a long spine over a straight-ish leg.',
    'butterfly-fold': 'Soles together, then walk the chest toward the feet. Don’t push on the knees.',
    'straddle-fold': 'Toes up, kneecaps up, fold only as far as the back stays long.',
    'half-splits': 'Front leg straight, hips over the back knee, fold toward the front shin.',
    'seated-twist': 'Grow tall on the inhale, twist on the exhale. The twist starts from the ribs, not the neck.',
    'half-lotus': 'Ankle on the opposite thigh. The turn comes from the hip — any twinge in the knee, stay at figure-4.',
    'thread-needle': 'From all fours, slide one arm under and rest that shoulder down.',
    cobra: 'Hips heavy, shoulders away from the ears. Straighten the arms only if the low back is happy.',
    camel: 'Hands on the low back first, hips pushed forward. Reach for the heels only when that feels easy.',
    plow: 'Weight on the shoulders, never the neck, and don’t turn your head. Legs up the wall instead if your neck complains.',
    'pelvic-floor': 'Lift and hold for three seconds, then let it go completely. Keep breathing; don’t clench the glutes.'
  };

  global.CadenceFigures = {
    create: create,
    has: function (id) { return Object.prototype.hasOwnProperty.call(FIGURES, id) && id !== '_default'; },
    cue: function (id) { return (FIGURES[id] && FIGURES[id].cue) || CUES[id] || ''; },
    ids: function () { return Object.keys(FIGURES).filter(function (k) { return k !== '_default'; }); }
  };
})(window);
