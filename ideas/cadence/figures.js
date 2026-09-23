/* Cadence — the figure that shows you the movement.
 *
 * A small rig, not a stick figure: a two-part spine that can round or arch,
 * a neck and a head that shows which way you're facing, arms with hands, and
 * legs with real feet — heel and toe — because half of what makes a push-up
 * or a calf raise readable is what the feet are doing.
 *
 * Everything is authored in body units: a standing figure is about 100 tall,
 * the floor is y = 0 and y points UP. Angles are on a compass — 0 up, 90
 * right (the way the figure faces), 180 down, 270 left — and absolute, so
 * `shin: 180` is a vertical shin wherever the thigh went.
 *
 * A limb is either angles ([upper, lower]) or a target the rig reaches for:
 * `ik(x, y, bend)` puts the hand or ankle at a point and bends the elbow or
 * knee toward `bend` ('+x' forward, '-x' back, '+y' up, '-y' down). Targets
 * are solved every frame, so a planted foot stays planted through the whole
 * movement and a limb never shrinks halfway through a rep — the old figure
 * blended joint positions, which did both.
 *
 * A figure is a loop of keyframes. Two is a there-and-back; more can tell a
 * sequence (lunge, reach, rotate). `hold` pauses on a keyframe.
 *
 * A keyframe: `hip` [x, y]; `spine` — one angle, or [lower, upper] to round
 * or arch the back — or `shoulderAt` [x, y] to aim a straight spine at a
 * point (a bridge, where the shoulders stay on the floor); `head`, the nod
 * relative to the upper spine; `turn`, where the eye sits (1 facing the way
 * the body does, 0 toward you, -1 looking back); `shrug` and `roll` move the
 * shoulder joint up and forward; `arms` and `legs` [near, far]; `hands` and
 * `feet`, optional angles (a foot defaults to square with its shin).
 * `armLen` and `legLen` ([[upper, lower], [upper, lower]], default 1) draw a
 * bone shorter when it points toward you — a leg out to the side, seen from
 * the side, is mostly foreshortened.
 */
(function (global) {
  'use strict';

  /* ---------- the rig ---------- */

  var LEN = {
    spineLow: 15, spineHigh: 15, neck: 5, headR: 6.5,
    upperArm: 17, foreArm: 14, hand: 6,
    thigh: 25, shin: 24
  };
  var ANKLE = 5;     // ankle height above the sole when the foot is flat
  var WIDTH = { torso: 10, neck: 4.6, upperArm: 5, foreArm: 4.2, hand: 3.8, thigh: 7.4, shin: 5.6, foot: 4 };

  function dir(a) {
    var r = a * Math.PI / 180;
    return [Math.sin(r), Math.cos(r)];          // y up
  }

  function step(p, a, len) {
    var d = dir(a);
    return [p[0] + d[0] * len, p[1] + d[1] * len];
  }

  function angleOf(dx, dy) {
    var a = Math.atan2(dx, dy) * 180 / Math.PI;
    return (a + 360) % 360;
  }

  /* Two-bone reach: from `o` toward target `t`. Returns [upper, lower]
   * angles. Out of reach, the limb points straight at the target. */
  function reach(o, t, l1, l2, bend) {
    var dx = t[0] - o[0], dy = t[1] - o[1];
    var d = Math.sqrt(dx * dx + dy * dy);
    d = Math.max(Math.abs(l1 - l2) + 0.01, Math.min(l1 + l2 - 0.001, d));
    var a0 = angleOf(dx, dy);
    var c = (l1 * l1 + d * d - l2 * l2) / (2 * l1 * d);
    var alpha = Math.acos(Math.max(-1, Math.min(1, c))) * 180 / Math.PI;
    var best = null;
    [1, -1].forEach(function (s) {
      var a1 = a0 + s * alpha;
      var j = step(o, a1, l1);
      var ex = t[0] - j[0], ey = t[1] - j[1];
      var a2 = Math.abs(ex) + Math.abs(ey) > 0.01 ? angleOf(ex, ey) : a1;
      var score = bend === '+x' ? j[0] : bend === '-x' ? -j[0] : bend === '+y' ? j[1] : -j[1];
      if (!best || score > best.score) best = { score: score, a: [a1, a2] };
    });
    return best.a;
  }

  /* The sole's heel and toe from the ankle and the foot's angle. `foot` is
   * the direction heel→toe; 90 is flat, pointing forward. */
  function footPoints(ankle, a) {
    var f = dir(a), down = dir(a + 90);
    var base = [ankle[0] + down[0] * (ANKLE - WIDTH.foot / 2), ankle[1] + down[1] * (ANKLE - WIDTH.foot / 2)];
    return {
      heel: [base[0] - f[0] * 2, base[1] - f[1] * 2],
      toe: [base[0] + f[0] * 10, base[1] + f[1] * 10]
    };
  }

  function scaleOf(v, i) { return v && v[i] ? v[i] : [1, 1]; }

  /* Where the arms hang from: the top of the spine, moved by a shrug or a
   * roll of the shoulders. */
  function armRoot(shoulder, upper, p) {
    var up = dir(upper), fwd = dir(upper + 90);
    var s = p.shrug || 0, r = p.roll || 0;
    return [shoulder[0] + up[0] * s + fwd[0] * r, shoulder[1] + up[1] * s + fwd[1] * r];
  }

  /* A resolved pose: every joint, ready to draw. */
  function build(p) {
    var hip = p.hip;
    var sp = p.spine;
    var waist = step(hip, sp[0], LEN.spineLow);
    var shoulder = step(waist, sp[1], LEN.spineHigh);
    var neckA = sp[1] + (p.head || 0);
    var neckTop = step(shoulder, neckA, LEN.neck);
    var head = step(neckTop, neckA, LEN.headR);
    var face = dir(neckA + 90);                 // front of the face
    var turn = p.turn == null ? 1 : p.turn;
    var root = armRoot(shoulder, sp[1], p);
    var out = { hip: hip, waist: waist, shoulder: shoulder, root: root, neckTop: neckTop, head: head,
      eye: [head[0] + face[0] * 3.2 * turn + dir(neckA)[0] * 1.2, head[1] + face[1] * 3.2 * turn + dir(neckA)[1] * 1.2],
      arms: [], legs: [] };
    for (var i = 0; i < 2; i++) {
      var al = scaleOf(p.armLen, i), ll = scaleOf(p.legLen, i);
      var ua = p.arms[i][0], fa = p.arms[i][1];
      var elbow = step(root, ua, LEN.upperArm * al[0]);
      var wrist = step(elbow, fa, LEN.foreArm * al[1]);
      var handA = p.hands && p.hands[i] != null ? p.hands[i] : fa;
      out.arms[i] = { elbow: elbow, wrist: wrist, fingers: step(wrist, handA, LEN.hand) };
      var th = p.legs[i][0], sh = p.legs[i][1];
      var knee = step(hip, th, LEN.thigh * ll[0]);
      var ankle = step(knee, sh, LEN.shin * ll[1]);
      var footA = p.feet && p.feet[i] != null ? p.feet[i] : sh - 90;
      var fp = footPoints(ankle, footA);
      out.legs[i] = { knee: knee, ankle: ankle, heel: fp.heel, toe: fp.toe };
    }
    return out;
  }

  function spineOf(k) {
    if (k.shoulderAt) {
      var a = angleOf(k.shoulderAt[0] - k.hip[0], k.shoulderAt[1] - k.hip[1]);
      return [a, a];
    }
    return typeof k.spine === 'number' ? [k.spine, k.spine] : k.spine;
  }

  /* Turn a keyframe's limb targets into angles. */
  function resolve(k) {
    var sp = spineOf(k);
    var hip = k.hip;
    var shoulder = step(step(hip, sp[0], LEN.spineLow), sp[1], LEN.spineHigh);
    var root = armRoot(shoulder, sp[1], k);
    var out = { hip: hip, spine: sp, head: k.head || 0, turn: k.turn, shrug: k.shrug, roll: k.roll,
      armLen: k.armLen, legLen: k.legLen, arms: [], legs: [], hands: k.hands, feet: k.feet };
    for (var i = 0; i < 2; i++) {
      var a = k.arms[i], l = k.legs[i];
      var al = scaleOf(k.armLen, i), ll = scaleOf(k.legLen, i);
      out.arms[i] = a.ik ? reach(root, a.ik, LEN.upperArm * al[0], LEN.foreArm * al[1], a.bend) : a;
      out.legs[i] = l.ik ? reach(hip, l.ik, LEN.thigh * ll[0], LEN.shin * ll[1], l.bend) : l;
    }
    return out;
  }

  /* ---------- blending ---------- */

  function lerp(a, b, u) { return a + (b - a) * u; }
  function lerpAngle(a, b, u) {
    var d = ((b - a) % 360 + 540) % 360 - 180;
    return a + d * u;
  }
  function lerpPt(a, b, u) { return [lerp(a[0], b[0], u), lerp(a[1], b[1], u)]; }

  function lerpLens(a, b, u) {
    if (!a && !b) return null;
    var out = [];
    for (var i = 0; i < 2; i++) {
      var x = scaleOf(a, i), y = scaleOf(b, i);
      out[i] = [lerp(x[0], y[0], u), lerp(x[1], y[1], u)];
    }
    return out;
  }

  function optAngles(x, y, fallbackX, fallbackY, u) {
    if (!x && !y) return null;
    var out = [];
    for (var i = 0; i < 2; i++) {
      var ax = x && x[i] != null ? x[i] : fallbackX(i);
      var ay = y && y[i] != null ? y[i] : fallbackY(i);
      out[i] = lerpAngle(ax, ay, u);
    }
    return out;
  }

  /* Between two keyframes. A limb that reaches for a target in both is
   * blended as a target and solved, so a planted foot stays put; otherwise
   * its angles are blended. */
  function blend(ka, kb, u) {
    var sa = spineOf(ka), sb = spineOf(kb);
    var k = {
      hip: lerpPt(ka.hip, kb.hip, u),
      spine: [lerpAngle(sa[0], sb[0], u), lerpAngle(sa[1], sb[1], u)],
      head: lerp(ka.head || 0, kb.head || 0, u),
      turn: lerp(ka.turn == null ? 1 : ka.turn, kb.turn == null ? 1 : kb.turn, u),
      shrug: lerp(ka.shrug || 0, kb.shrug || 0, u),
      roll: lerp(ka.roll || 0, kb.roll || 0, u),
      armLen: lerpLens(ka.armLen, kb.armLen, u),
      legLen: lerpLens(ka.legLen, kb.legLen, u),
      arms: [], legs: []
    };
    var ra = resolve(ka), rb = resolve(kb);
    ['arms', 'legs'].forEach(function (part) {
      for (var i = 0; i < 2; i++) {
        var a = ka[part][i], b = kb[part][i];
        if (a.ik && b.ik && a.bend === b.bend) {
          k[part][i] = { ik: lerpPt(a.ik, b.ik, u), bend: a.bend };
        } else {
          k[part][i] = [lerpAngle(ra[part][i][0], rb[part][i][0], u), lerpAngle(ra[part][i][1], rb[part][i][1], u)];
        }
      }
    });
    var r = resolve(k);
    r.hands = optAngles(ka.hands, kb.hands, function (i) { return ra.arms[i][1]; }, function (i) { return rb.arms[i][1]; }, u);
    r.feet = optAngles(ka.feet, kb.feet, function (i) { return ra.legs[i][1] - 90; }, function (i) { return rb.legs[i][1] - 90; }, u);
    return r;
  }

  function ease(u) { return 0.5 - Math.cos(u * Math.PI) / 2; }

  /* Where in the loop `phase` (0..1) falls: which keyframes, and how far. */
  function at(def, phase) {
    var keys = def.keys;
    var n = keys.length;
    if (n === 1) return resolve(keys[0]);
    var holds = keys.map(function (k) { return k.hold || 0; });
    var holdTotal = holds.reduce(function (a, b) { return a + b; }, 0);
    var moveEach = Math.max(0.05, 1 - holdTotal) / n;
    var t = phase;
    for (var i = 0; i < n; i++) {
      if (t < holds[i]) return resolve(keys[i]);
      t -= holds[i];
      if (t < moveEach) return blend(keys[i], keys[(i + 1) % n], ease(t / moveEach));
      t -= moveEach;
    }
    return resolve(keys[0]);
  }

  /* ---------- drawing ---------- */

  var NS = 'http://www.w3.org/2000/svg';
  function svgEl(name, attrs) {
    var node = document.createElementNS(NS, name);
    Object.keys(attrs || {}).forEach(function (k) { node.setAttribute(k, attrs[k]); });
    return node;
  }

  /* SVG's y points down; the rig's points up. */
  function P(p) { return p[0].toFixed(2) + ' ' + (-p[1]).toFixed(2); }
  function seg(a, b) { return 'M' + P(a) + 'L' + P(b); }

  function points(sk) {
    var pts = [sk.hip, sk.waist, sk.shoulder, sk.neckTop];
    var r = LEN.headR;
    pts.push([sk.head[0] - r, sk.head[1] - r], [sk.head[0] + r, sk.head[1] + r]);
    sk.arms.forEach(function (a) { pts.push(a.elbow, a.wrist, a.fingers); });
    sk.legs.forEach(function (l) { pts.push(l.knee, l.ankle, l.heel, l.toe); });
    return pts;
  }

  /* One box for every frame of the loop, so the movement shows inside a
   * still frame, and a wide pose fills a wide panel. */
  function fitOf(def) {
    var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    function add(p, pad) {
      minX = Math.min(minX, p[0] - pad); maxX = Math.max(maxX, p[0] + pad);
      minY = Math.min(minY, p[1] - pad); maxY = Math.max(maxY, p[1] + pad);
    }
    for (var s = 0; s < 24; s++) {
      points(build(at(def, s / 24))).forEach(function (p) { add(p, 4); });
    }
    (def.props || []).forEach(function (pr) {
      if (pr.box) { add([pr.box[0], pr.box[2]], 1); add([pr.box[1], 0], 1); }
      if (pr.bar) { add([pr.bar[0] - 6, pr.bar[1]], 2); add([pr.bar[0] + 6, pr.bar[1]], 2); }
      if (pr.wall != null) { add([pr.wall, 0], 1.5); }
    });
    if (def.floor !== false) minY = Math.min(minY, -2);
    var w = maxX - minX, h = maxY - minY;
    var pad = Math.max(w, h) * 0.06;
    return { x: minX - pad, y: -(maxY + pad), w: w + pad * 2, h: h + pad * 2, top: maxY, left: minX, right: maxX };
  }

  var reduceMotion = global.matchMedia && global.matchMedia('(prefers-reduced-motion: reduce)');

  function create(id, opts) {
    var options = opts || {};
    var def = FIGURES[id] || FIGURES._default;
    var fit = fitOf(def);

    var svg = svgEl('svg', {
      viewBox: fit.x.toFixed(2) + ' ' + fit.y.toFixed(2) + ' ' + fit.w.toFixed(2) + ' ' + fit.h.toFixed(2),
      class: 'figure',
      preserveAspectRatio: 'xMidYMid meet',
      // The cue is rendered as text right beside this, so announcing the
      // drawing as well just said everything twice.
      'aria-hidden': 'true',
      focusable: 'false'
    });
    var g = svgEl('g', { 'stroke-linecap': 'round', 'stroke-linejoin': 'round', fill: 'none' });
    svg.appendChild(g);

    (def.props || []).forEach(function (pr) {
      if (pr.box) {
        g.appendChild(svgEl('rect', {
          class: 'fig-box', x: pr.box[0], y: -pr.box[2], width: pr.box[1] - pr.box[0], height: pr.box[2], rx: 1.5
        }));
      }
      if (pr.bar) {
        g.appendChild(svgEl('path', { class: 'fig-prop', d: 'M' + (pr.bar[0] - 12) + ' ' + (-pr.bar[1]) + 'H' + (pr.bar[0] + 12) }));
      }
      if (pr.wall != null) {
        g.appendChild(svgEl('path', { class: 'fig-prop', d: 'M' + pr.wall + ' 0V' + (-Math.min(fit.top + 4, 110)) }));
      }
    });
    if (def.floor !== false) {
      g.appendChild(svgEl('path', { class: 'fig-prop', d: 'M' + fit.x + ' 0H' + (fit.x + fit.w) }));
    }

    function limbSet(cls) {
      var grp = svgEl('g', { class: cls });
      var parts = {};
      ['thigh', 'shin', 'foot', 'upperArm', 'foreArm', 'hand'].forEach(function (name) {
        parts[name] = svgEl('path', { class: 'fig-limb', 'stroke-width': WIDTH[name] });
        grp.appendChild(parts[name]);
      });
      return { g: grp, parts: parts };
    }
    var far = limbSet('fig-far');
    var near = limbSet('fig-near');
    var torso = svgEl('path', { class: 'fig-limb', 'stroke-width': WIDTH.torso });
    var neck = svgEl('path', { class: 'fig-limb', 'stroke-width': WIDTH.neck });
    var head = svgEl('circle', { class: 'fig-head', r: LEN.headR });
    var eye = svgEl('circle', { class: 'fig-eye', r: 1.1 });
    // Far limbs behind the body, near limbs in front of it.
    g.appendChild(far.g);
    g.appendChild(torso);
    g.appendChild(neck);
    g.appendChild(head);
    g.appendChild(eye);
    g.appendChild(near.g);

    function paintLimbs(set, sk, i) {
      var a = sk.arms[i], l = sk.legs[i];
      set.parts.thigh.setAttribute('d', seg(sk.hip, l.knee));
      set.parts.shin.setAttribute('d', seg(l.knee, l.ankle));
      set.parts.foot.setAttribute('d', 'M' + P(l.ankle) + 'L' + P(l.heel) + 'L' + P(l.toe));
      set.parts.upperArm.setAttribute('d', seg(sk.root, a.elbow));
      set.parts.foreArm.setAttribute('d', seg(a.elbow, a.wrist));
      set.parts.hand.setAttribute('d', seg(a.wrist, a.fingers));
    }

    function paint(pose) {
      var sk = build(pose);
      paintLimbs(far, sk, 1);
      paintLimbs(near, sk, 0);
      torso.setAttribute('d', 'M' + P(sk.hip) + 'Q' + P(sk.waist) + ' ' + P(sk.shoulder));
      neck.setAttribute('d', seg(sk.shoulder, sk.neckTop));
      head.setAttribute('cx', sk.head[0].toFixed(2));
      head.setAttribute('cy', (-sk.head[1]).toFixed(2));
      eye.setAttribute('cx', sk.eye[0].toFixed(2));
      eye.setAttribute('cy', (-sk.eye[1]).toFixed(2));
    }

    /* ~20fps. These are eases of a few seconds, so the extra 40 frames a
     * second buy nothing visible and cost more than double the CPU. */
    var FRAME_MS = 50;
    var timer = null;
    var started = 0;
    var still = options.still || (reduceMotion && reduceMotion.matches);

    function frame() {
      var now = Date.now();
      if (!started) started = now;
      var cycle = (def.cycle || 3) * 1000;
      paint(at(def, ((now - started) % cycle) / cycle));
      timer = global.setTimeout(frame, FRAME_MS);
    }

    if (still) {
      // A still shows the working end of the movement — the more
      // descriptive pose — unless a phase or keyframe is asked for.
      if (typeof options.phase === 'number') paint(at(def, options.phase));
      else paint(resolve(def.keys[options.poseIndex != null ? options.poseIndex : def.still != null ? def.still : Math.min(1, def.keys.length - 1)]));
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

  /* ---------- authoring helpers ---------- */

  function ik(x, y, bend) { return { ik: [x, y], bend: bend }; }

  /* An ankle for a foot flat on the floor (or on top of a box at `y`). */
  function flat(x, y, bend) { return ik(x, (y || 0) + ANKLE, bend || '+x'); }

  /* An ankle for a foot up on its toes, the ball of the foot at (x, y). */
  function toes(x, y, footAngle, bend) {
    var fa = footAngle == null ? 45 : footAngle;
    var f = dir(fa), down = dir(fa + 90);
    var k = ANKLE - WIDTH.foot / 2;
    return ik(x - f[0] * 10 - down[0] * k, (y || 0) + WIDTH.foot / 2 - f[1] * 10 - down[1] * k, bend || '+x');
  }

  var STAND = 54;                 // hip height, standing tall
  var HANG = [[182, 176], [178, 184]];
  var LEGS_STRAIGHT = [[180, 180], [180, 180]];

  function standing(extra) {
    var k = { hip: [0, STAND], spine: 0, arms: HANG, legs: [flat(1), flat(-1)] };
    Object.keys(extra || {}).forEach(function (key) { k[key] = extra[key]; });
    return k;
  }

  var CUES = {
    warmup: "March and circle the arms, then rehearse today’s first two moves at half effort.",
    pushups: "One straight line from head to heels, elbows close in.",
    "table-rows": "Body straight from heels to head — pull your chest to the bar, shoulders away from your ears.",
    squats: "Sit down between your heels — knees point the same way as your toes.",
    "reverse-lunges": "Step back, drop the back knee, stay tall.",
    plank: "Elbows under shoulders, ribs down, glutes tight — breathe.",
    cooldown: "Walk it off, breathe slow, stretch whatever you just worked.",
    "pike-pushups": "Hips stacked over your hands — lower until your head is just off the floor, weight in the hands.",
    "prone-ytw": "Thumbs up, arms light — lift from between the shoulder blades, not the neck.",
    "glute-bridges": "Ribs down, squeeze the glutes, lift from the hips.",
    "split-squats": "Weight through the front heel, back knee straight down.",
    "bird-dogs": "Opposite arm and leg — reach long, not high; hips stay level.",
    "chair-dips": "Hands on a sturdy chair behind you, elbows straight back. Stop where the shoulders start to roll forward.",
    "shoulder-taps": "High plank, feet wide. Tap the opposite shoulder without letting the hips sway.",
    "bulgarian-split-squats": "Back foot on a chair, most of the weight in the front heel. Sink straight down.",
    "single-leg-bridges": "One foot planted, other knee to chest. Drive through the heel and squeeze at the top.",
    "towel-leg-curls": "On your back, heels on a towel on a smooth floor. Lift the hips, then pull the heels in and slide them out slowly.",
    "step-ups": "A sturdy step or chair. Push through the top foot — don’t spring off the bottom one.",
    "wall-sit": "Back flat on the wall, knees over the ankles, thighs as close to level as you can hold.",
    "calf-raises": "On a step edge if you have one. All the way up, pause, and all the way down.",
    "dead-bugs": "Low back pressed into the floor the whole time. Opposite arm and leg reach, slow.",
    "hollow-hold": "Low back glued down, arms and legs long. Bend the knees to make it easier.",
    "side-plank": "Elbow under the shoulder, a straight line from head to heels. Knees down to make it easier.",
    "reverse-crunch": "Curl the hips off the floor with the lower abs — no swinging the legs.",
    "archer-pushups": "Hands wide. Lower toward one hand while the other arm stays nearly straight.",
    "box-pistols": "Sit back to a chair on one leg, touch, and stand without rocking. Lower the chair as it gets easier.",
    "planche-lean": "Push-up position, hands turned out, lean the shoulders forward past the hands with straight arms.",
    "nordic-negatives": "Heels anchored under something heavy, hips straight. Lower as slowly as you can and catch yourself with your hands — the way down is the exercise.",
    "tuck-l-sit": "Hands on two sturdy chairs, push down hard and lift the knees to the chest.",
    "dead-hang": "Full grip, shoulders active — not shrugged to the ears.",
    "scapular-pulls": "From a hang, pull the shoulder blades down and back without bending the elbows.",
    "pullup-negatives": "Jump or step to the top, then lower for three to five seconds. Stop if the elbows ache.",
    "chin-ups": "Palms facing you. Chest toward the bar, full hang at the bottom.",
    "hanging-knee-raises": "No swinging — knees up with a slight curl of the pelvis, then lower under control.",
    "express-squats": "Steady pace, full depth. Forty seconds, then breathe.",
    "express-pushups": "Any version that keeps a straight line — knees down is fine by the second round.",
    "express-lunges": "Alternate legs, back knee toward the floor.",
    "mountain-climbers": "Hands under the shoulders, hips level, knees driving in turn.",
    "express-plank": "Elbows under the shoulders, squeeze the glutes, breathe.",
    "hip-switches": "Sit tall on your sit bones and rotate the knees side to side — no leaning back.",
    "hip-flexor": "Tuck the tailbone, ribs down, then press the hips forward — don’t lean back.",
    "adductor-rock-backs": "One leg out to the side, rock the hips back slowly.",
    straddle: "Soles together or legs wide — hinge from the hips, not the back.",
    "knee-to-wall-rocks": "Heel stays down — drive the knee forward over the second toe.",
    "knee-to-wall-hold": "Heel down, knee to the wall, and stay there.",
    "calf-stretch": "Back leg straight, heel pressed into the floor.",
    "cat-cow": "Exhale and round, inhale and let it dip — only as far as it’s comfortable.",
    "open-book": "Knees stay stacked, let the top arm open the chest.",
    "childs-pose": "Hips toward the heels, arms long, breathe into the back.",
    "focus-stretch": "Whatever felt tightest today — two quiet minutes, strong but never sharp.",
    "neck-circles": "Chin to chest, then roll ear to shoulder and back. Half-circles only — no rolling the head back.",
    "shoulder-rolls": "Up to the ears, back, and down. Big and slow, then reverse halfway.",
    "reach-side-bend": "Reach tall on the inhale, lean over on the exhale. Hips stay square, ribs open.",
    "hip-circles": "Hands on hips, feet planted, draw the biggest circle the hips will make.",
    ragdoll: "Soft knees, hold opposite elbows and let the head hang. Sway if it helps.",
    "worlds-greatest": "Lunge, same-side elbow toward the instep, then rotate that arm to the ceiling.",
    frog: "Knees wide, shins parallel, ankles in line with the knees. Rock the hips back slowly.",
    pigeon: "Front shin as square as your hip allows, back leg long. Square hips beat a deep hold.",
    "happy-baby": "Hold the outsides of the feet, knees toward the armpits, and let the low back sink.",
    malasana: "Heels down if they’ll go, elbows pressing the knees apart, chest proud.",
    "seated-fold": "Hinge at the hips, not the waist — a long spine over a straight-ish leg.",
    "butterfly-fold": "Soles together, then walk the chest toward the feet. Don’t push on the knees.",
    "straddle-fold": "Toes up, kneecaps up, fold only as far as the back stays long.",
    "half-splits": "Front leg straight, hips over the back knee, fold toward the front shin.",
    "seated-twist": "Grow tall on the inhale, twist on the exhale. The twist starts from the ribs, not the neck.",
    "half-lotus": "Ankle on the opposite thigh. The turn comes from the hip — any twinge in the knee, stay at figure-4.",
    "thread-needle": "From all fours, slide one arm under and rest that shoulder down.",
    cobra: "Hips heavy, shoulders away from the ears. Straighten the arms only if the low back is happy.",
    camel: "Hands on the low back first, hips pushed forward. Reach for the heels only when that feels easy.",
    plow: "Weight on the shoulders, never the neck, and don’t turn your head. Legs up the wall instead if your neck complains.",
    "pelvic-floor": "Lift and hold for three seconds, then let it go completely. Keep breathing; don’t clench the glutes.",
    recovery: "Nothing scheduled. Walk, breathe, let it repair."
  };

  /* ---------- shared positions ---------- */

  /* A straight body from the ankle: where the hip and shoulder fall when
   * everything from heel to head is one line at `angle` (plank, push-up). */
  function line(ankle, angle) {
    return {
      hip: step(ankle, angle, LEN.thigh + LEN.shin),
      shoulder: step(ankle, angle, LEN.thigh + LEN.shin + LEN.spineLow + LEN.spineHigh)
    };
  }
  function merge(base, extra) {
    var k = {};
    Object.keys(base).forEach(function (key) { k[key] = base[key]; });
    Object.keys(extra || {}).forEach(function (key) { k[key] = extra[key]; });
    return k;
  }
  var PALMS = [90, 90];          // hands flat on the floor, fingers forward
  var WRIST = 2.6;               // wrist height with the palm flat
  var KNEE = 3;                  // knee joint height, kneeling
  var LYING = 5.5;               // hip and shoulder height lying down

  /* High plank / push-up: toes at PU_ANKLE, the body one line. */
  var PU_ANKLE = [-46, 12];
  var puTop = line(PU_ANKLE, 74);
  var puLow = line(PU_ANKLE, 88);
  var PU_HAND = puTop.shoulder[0];
  var PU_LEGS = [ik(PU_ANKLE[0], PU_ANKLE[1], '+y'), ik(PU_ANKLE[0] - 1, PU_ANKLE[1], '+y')];
  var PU_ARMS = [ik(PU_HAND, WRIST, '+y'), ik(PU_HAND + 1, WRIST, '+y')];
  function pushTop(extra) {
    return merge({ hip: puTop.hip, spine: 74, head: 12, arms: PU_ARMS, hands: PALMS, legs: PU_LEGS }, extra);
  }
  function pushLow(extra) {
    return merge({ hip: puLow.hip, spine: 88, head: 8, arms: PU_ARMS, hands: PALMS, legs: PU_LEGS }, extra);
  }

  /* All fours: knees under hips, hands under shoulders. */
  var Q_HIP = [0, KNEE + LEN.thigh];
  var Q_SPINE = 79;
  var Q_HAND = step(Q_HIP, Q_SPINE, LEN.spineLow + LEN.spineHigh)[0];
  var Q_LEGS = [ik(-LEN.shin, KNEE + 0.5, '-y'), ik(-LEN.shin - 1, KNEE + 0.5, '-y')];
  var Q_ARMS = [ik(Q_HAND, WRIST, '+x'), ik(Q_HAND + 1, WRIST, '+x')];
  function fours(extra) {
    return merge({ hip: Q_HIP, spine: Q_SPINE, head: 12, arms: Q_ARMS, hands: PALMS, legs: Q_LEGS, feet: [270, 270] }, extra);
  }

  /* On your back, head to the left: knees bent and feet flat. */
  var B_SHOULDER = [-LEN.spineLow - LEN.spineHigh, LYING];
  function onBack(extra) {
    return merge({
      hip: [0, LYING], spine: 270, head: -4,
      arms: [ik(-3, WRIST + 0.5, '+y'), ik(-2, WRIST + 0.5, '+y')], hands: [90, 90],
      legs: [flat(22, 0, '+y'), flat(21, 0, '+y')]
    }, extra);
  }

  /* Face down, head to the right, legs long behind. */
  function prone(extra) {
    return merge({
      hip: [0, LYING], spine: 90, head: -6,
      arms: [[95, 90], [95, 90]], hands: [90, 90],
      legs: [[270, 270], [270, 270]], feet: [262, 262]
    }, extra);
  }

  /* Sitting on the floor, legs long in front. */
  var SIT = [0, 7];
  function seated(extra) {
    return merge({
      hip: SIT, spine: 0,
      arms: [ik(8, WRIST, '-x'), ik(-6, WRIST, '-x')], hands: [90, 270],
      legs: [[90, 90], [90, 90]], feet: [5, 5]
    }, extra);
  }

  /* Kneeling up tall, shins flat behind. */
  var KNEELING_LEGS = [ik(-LEN.shin, KNEE + 0.5, '-y'), ik(-LEN.shin - 1, KNEE + 0.5, '-y')];

  /* Hanging from a bar at BAR_Y. */
  var BAR_Y = 128;
  var BAR_ARMS = [ik(1, BAR_Y - 1, '+x'), ik(-1, BAR_Y - 1, '+x')];
  var HANG_HIP = [0, BAR_Y - 1 - LEN.upperArm - LEN.foreArm - LEN.spineLow - LEN.spineHigh + 0.5];
  function hanging(extra) {
    return merge({ hip: HANG_HIP, spine: 0, head: -4, arms: BAR_ARMS, hands: [0, 0],
      legs: [[182, 180], [178, 180]], feet: [120, 120] }, extra);
  }

  var FIGURES = {

    /* ---------- warm-up and cool-down ---------- */

    warmup: {
      // Marching on the spot, arms swinging. One knee at a time: blending
      // straight from one lifted knee to the other left both legs half-up
      // at the midpoint, standing on nothing.
      cycle: 2,
      keys: [
        standing({ spine: 2, arms: [[205, 160], [150, 120]], legs: [ik(12, 32, '+x'), flat(-1)] }),
        standing({ spine: 1, arms: [[182, 176], [178, 184]], legs: [flat(0), flat(-1)] }),
        standing({ spine: 2, arms: [[150, 120], [205, 160]], legs: [flat(0), ik(11, 32, '+x')] }),
        standing({ spine: 1, arms: [[182, 176], [178, 184]], legs: [flat(0), flat(-1)] })
      ]
    },
    cooldown: {
      // Tall reach, then let it go.
      cycle: 5,
      keys: [
        standing({ hold: 0.15 }),
        standing({ spine: [2, 6], head: -12, arms: [[8, 4], [352, 356]], hold: 0.25 })
      ]
    },
    recovery: {
      cycle: 4.5,
      keys: [standing(), standing({ spine: [1, 3], head: -4, arms: [[184, 178], [176, 182]], hip: [0, STAND + 0.6] })]
    },

    /* ---------- Calisthenics A ---------- */

    pushups: {
      cycle: 2.8,
      keys: [pushTop(), pushLow()]
    },
    'table-rows': {
      // Under a table, heels down, body one line; pull the chest to the edge.
      cycle: 2.8,
      props: [{ bar: [-37, 57] }],
      keys: (function () {
        var ank = [40, 4.5];
        var low = line(ank, 285), high = line(ank, 299);
        var legs = [ik(ank[0], ank[1], '+y'), ik(ank[0] + 1, ank[1], '+y')];
        var arms = [ik(-37, 56, '-y'), ik(-36, 56, '-y')];
        return [
          { hip: low.hip, spine: 285, head: 18, arms: arms, hands: [0, 0], legs: legs, feet: [0, 0] },
          { hip: high.hip, spine: 299, head: 20, arms: arms, hands: [0, 0], legs: legs, feet: [0, 0] }
        ];
      })()
    },
    squats: {
      cycle: 3,
      keys: [
        standing({ arms: [[176, 176], [184, 184]], legs: [flat(0), flat(-1)] }),
        { hip: [-13, 29], spine: [34, 40], head: -32, arms: [[82, 88], [86, 92]], legs: [flat(0), flat(-1)] }
      ]
    },
    'reverse-lunges': {
      cycle: 3.2,
      keys: [
        standing(),
        { hip: [-6, 34], spine: 4, arms: HANG, legs: [flat(9), toes(-34, 0, 145, '-y')] }
      ]
    },
    plank: {
      // On the forearms, one line from heels to head.
      cycle: 4.5,
      keys: (function () {
        var a = line([-46, 12], 78), b = line([-46, 12], 77);
        var fore = function (s) { return [ik(s[0] + 14, WRIST, '-y'), ik(s[0] + 15, WRIST, '-y')]; };
        return [
          { hip: a.hip, spine: 78, head: 12, arms: fore(a.shoulder), hands: PALMS, legs: PU_LEGS },
          { hip: b.hip, spine: 77, head: 12, arms: fore(a.shoulder), hands: PALMS, legs: PU_LEGS }
        ];
      })()
    },

    /* ---------- Calisthenics B ---------- */

    'pike-pushups': {
      // Hips high, head lowers toward the floor just in front of the hands.
      cycle: 3,
      keys: [
        { hip: [-6, 60], spine: 148, head: 6, arms: [ik(20, WRIST, '+y'), ik(21, WRIST, '+y')], hands: PALMS,
          legs: [toes(-34, 0, 165, '+x'), toes(-35, 0, 165, '+x')] },
        { hip: [-3, 55], spine: 162, head: -10, arms: [ik(20, WRIST, '+y'), ik(21, WRIST, '+y')], hands: PALMS,
          legs: [toes(-34, 0, 165, '+x'), toes(-35, 0, 165, '+x')] }
      ]
    },
    'prone-ytw': {
      // Face down, arms overhead in a Y, lifted from the upper back.
      cycle: 3,
      keys: [
        prone({ arms: [[85, 88], [88, 90]], hands: [90, 90] }),
        prone({ spine: [92, 74], head: -16, arms: [[58, 52], [60, 54]], hands: [52, 54], hold: 0.15 })
      ]
    },
    'glute-bridges': {
      cycle: 2.8,
      keys: [
        onBack(),
        onBack({ hip: [0, 26], shoulderAt: B_SHOULDER, head: 20 })
      ]
    },
    'split-squats': {
      // Feet stay put: straight down and up.
      cycle: 3,
      keys: [
        { hip: [-7, 50], spine: 3, arms: HANG, legs: [flat(13), toes(-30, 0, 145, '-y')] },
        { hip: [-7, 32], spine: 5, arms: HANG, legs: [flat(13), toes(-30, 0, 145, '-y')] }
      ]
    },
    'bird-dogs': {
      // Opposite arm and leg reach long, one side then the other.
      cycle: 5,
      keys: [
        fours(),
        fours({ arms: [[88, 88], Q_ARMS[1]], legs: [Q_LEGS[0], [270, 270]], feet: [270, 262], hold: 0.12 }),
        fours(),
        fours({ arms: [Q_ARMS[0], [88, 88]], legs: [[270, 270], Q_LEGS[1]], feet: [262, 270], hold: 0.12 })
      ]
    },

    /* ---------- Upper body ---------- */

    'chair-dips': {
      cycle: 2.8,
      props: [{ box: [-32, -6, 42] }],
      keys: [
        { hip: [2, 42], spine: 4, head: -4, arms: [ik(-9, 44, '-x'), ik(-10, 44, '-x')], hands: [270, 270], legs: [flat(32), flat(30)] },
        { hip: [4, 26], spine: 10, head: -8, arms: [ik(-9, 44, '-x'), ik(-10, 44, '-x')], hands: [270, 270], legs: [flat(32), flat(30)] }
      ]
    },
    'shoulder-taps': {
      // High plank; one hand taps the other shoulder, then the other.
      cycle: 3,
      keys: (function () {
        var tap = ik(puTop.shoulder[0] + 3, puTop.shoulder[1] - 5, '-y');
        return [
          pushTop(),
          pushTop({ arms: [tap, PU_ARMS[1]], hands: [300, 90] }),
          pushTop(),
          pushTop({ arms: [PU_ARMS[0], tap], hands: [90, 300] })
        ];
      })()
    },

    /* ---------- Lower body ---------- */

    'bulgarian-split-squats': {
      // Back foot laces-down on a chair; sink straight down.
      cycle: 3.2,
      props: [{ box: [-52, -28, 24] }],
      keys: [
        { hip: [-6, 51], spine: 4, arms: HANG, legs: [flat(15), ik(-40, 27.5, '-y')], feet: [null, 262] },
        { hip: [-8, 31], spine: 12, head: -8, arms: HANG, legs: [flat(15), ik(-40, 27.5, '-y')], feet: [null, 262] }
      ]
    },
    'single-leg-bridges': {
      // One foot planted, the other leg long; the hips rise in one line.
      cycle: 2.8,
      keys: (function () {
        var up = angleOf(-B_SHOULDER[0], 26 - B_SHOULDER[1]);   // hip→away from the shoulder
        return [
          onBack({ legs: [flat(22, 0, '+y'), [60, 60]], feet: [null, 40] }),
          onBack({ hip: [0, 26], shoulderAt: B_SHOULDER, head: 20, legs: [flat(22, 0, '+y'), [up, up]], feet: [null, up - 30] })
        ];
      })()
    },
    'towel-leg-curls': {
      // Hips up, heels on a towel; pull them in and slide them out.
      cycle: 3.4,
      keys: [
        onBack({ hip: [0, 16], shoulderAt: B_SHOULDER, head: 12, legs: [ik(47, 4, '+y'), ik(48, 4, '+y')], feet: [0, 0] }),
        onBack({ hip: [0, 24], shoulderAt: B_SHOULDER, head: 18, legs: [ik(24, 4, '+y'), ik(25, 4, '+y')], feet: [20, 20] })
      ]
    },
    'step-ups': {
      cycle: 3.2,
      props: [{ box: [16, 46, 22] }],
      keys: [
        standing({ hip: [-2, STAND], spine: 6, arms: [[160, 150], [200, 190]], legs: [flat(26, 22, '+y'), flat(-2)] }),
        standing({ hip: [26, STAND + 22], spine: 0, arms: [[200, 190], [160, 150]], legs: [flat(27, 22), ik(40, 44, '+x')] })
      ]
    },
    'wall-sit': {
      // Back flat on the wall, thighs level.
      cycle: 6,
      props: [{ wall: -12 }],
      keys: [
        { hip: [-5.5, 30], spine: 0, head: -2, arms: [[182, 180], [178, 180]], legs: [flat(20, 0, '+y'), flat(19, 0, '+y')] },
        { hip: [-5.5, 29], spine: 0, head: -2, arms: [[182, 180], [178, 180]], legs: [flat(20, 0, '+y'), flat(19, 0, '+y')] }
      ]
    },
    'calf-raises': {
      cycle: 2.4,
      keys: [
        standing(),
        standing({ hip: [5, 65], legs: [toes(11, 0, 142), toes(10, 0, 142)], hold: 0.1 })
      ]
    },

    /* ---------- Core ---------- */

    'dead-bugs': {
      // Arms up, knees over hips; opposite arm and leg lower toward the floor.
      cycle: 5,
      keys: (function () {
        var base = onBack({ arms: [[0, 0], [0, 0]], hands: [0, 0], legs: [[0, 90], [0, 90]], feet: [0, 0] });
        return [
          base,
          merge(base, { arms: [[274, 272], [0, 0]], hands: [272, 0], legs: [[0, 90], [84, 86]], feet: [0, 86], hold: 0.1 }),
          base,
          merge(base, { arms: [[0, 0], [274, 272]], hands: [0, 272], legs: [[84, 86], [0, 90]], feet: [86, 0], hold: 0.1 })
        ];
      })()
    },
    'hollow-hold': {
      // Low back glued down; shoulders and legs hover, arms long overhead.
      cycle: 5,
      keys: [
        { hip: [0, LYING], spine: [276, 292], head: 10, arms: [[296, 292], [298, 294]], hands: [292, 294],
          legs: [[80, 80], [81, 81]], feet: [84, 84] },
        { hip: [0, LYING], spine: [277, 295], head: 10, arms: [[300, 296], [302, 298]], hands: [296, 298],
          legs: [[77, 77], [78, 78]], feet: [81, 81] }
      ]
    },
    'side-plank': {
      // On one forearm, top arm to the ceiling; lift the hips into one line.
      cycle: 4,
      keys: (function () {
        var ank = [-47, 4.5];
        var top = line(ank, 78);
        var legs = [ik(ank[0], ank[1], '+y'), ik(ank[0] + 2, ank[1] + 3, '+y')];
        var elbowArm = ik(top.shoulder[0] + 12, WRIST, '-y');
        return [
          { hip: [ank[0] + 46, 7.5], shoulderAt: top.shoulder, head: 10, arms: [elbowArm, [0, 0]], hands: [90, 0], legs: legs, feet: [95, 95] },
          { hip: top.hip, spine: 78, head: 10, arms: [elbowArm, [0, 0]], hands: [90, 0], legs: legs, feet: [95, 95], hold: 0.2 }
        ];
      })()
    },
    'reverse-crunch': {
      // Knees over hips; curl the hips off the floor.
      cycle: 2.8,
      keys: [
        onBack({ legs: [[5, 95], [6, 96]], feet: [5, 6] }),
        onBack({ hip: [-4, 13], spine: [248, 266], head: 6, legs: [[322, 40], [323, 41]], feet: [320, 321] })
      ]
    },

    /* ---------- Calisthenics C ---------- */

    'archer-pushups': {
      // Lower toward one hand while the other arm stays long, then the other.
      cycle: 4.4,
      keys: (function () {
        var far = ik(PU_HAND + 26, WRIST, '+y');
        var low = { hip: [puLow.hip[0] + 2, puLow.hip[1]], spine: 88, head: 8, hands: PALMS, legs: PU_LEGS };
        return [
          pushTop({ arms: [PU_ARMS[0], far] }),
          merge(low, { arms: [PU_ARMS[0], far] }),
          pushTop({ arms: [far, PU_ARMS[1]] }),
          merge(low, { arms: [far, PU_ARMS[1]] })
        ];
      })()
    },
    'box-pistols': {
      // Sit back to the chair on one leg, the other held out in front.
      cycle: 3.6,
      props: [{ box: [-38, -10, 25] }],
      keys: [
        standing({ arms: [[92, 92], [94, 94]], legs: [flat(1), [98, 98]], feet: [null, 30] }),
        { hip: [-17, 32], spine: [34, 38], head: -26, arms: [[80, 82], [82, 84]], legs: [flat(4, 0, '+y'), [84, 86]], feet: [null, 20] }
      ]
    },
    'planche-lean': {
      // Arms locked, shoulders slide forward past the hands.
      cycle: 4.5,
      keys: (function () {
        var ank2 = [-35, 15];
        var lean = line(ank2, 77);
        var arms = [ik(PU_HAND, WRIST, '+y'), ik(PU_HAND + 1, WRIST, '+y')];
        return [
          pushTop({ hands: [70, 70] }),
          { hip: lean.hip, spine: 77, head: 10, arms: arms, hands: [70, 70], legs: [ik(ank2[0], ank2[1], '+y'), ik(ank2[0] - 1, ank2[1], '+y')], feet: [200, 200], hold: 0.25 }
        ];
      })()
    },
    'nordic-negatives': {
      // Kneeling, heels anchored; lower forward as slowly as you can.
      cycle: 5,
      props: [{ bar: [-26, 11] }],
      keys: (function () {
        var knee = [0, KNEE];
        var leanHip = step(knee, 55, LEN.thigh);
        return [
          { hip: [0, KNEE + LEN.thigh], spine: 0, arms: [[160, 40], [165, 40]], legs: [[180, 270], [180, 270]], feet: [270, 270], hold: 0.1 },
          { hip: leanHip, spine: 55, head: -12, arms: [[120, 125], [125, 130]], legs: [[235, 270], [235, 270]], feet: [270, 270], hold: 0.05 }
        ];
      })()
    },
    'tuck-l-sit': {
      // Hands pressing down on two chairs, knees pulled up.
      cycle: 4,
      props: [{ box: [-9, 9, 30] }],
      keys: [
        { hip: [0, 31], spine: 0, head: -4, arms: [ik(1, 32.5, '-x'), ik(2, 32.5, '-x')], hands: [90, 90], legs: [flat(16, 0, '+y'), flat(15, 0, '+y')] },
        { hip: [0, 34], spine: -3, head: -4, arms: [ik(1, 32.5, '-x'), ik(2, 32.5, '-x')], hands: [90, 90], legs: [[62, 178], [64, 180]], feet: [120, 120], hold: 0.3 }
      ]
    },

    /* ---------- Pull-up bar ---------- */

    'dead-hang': {
      cycle: 5,
      props: [{ bar: [0, BAR_Y] }],
      keys: [hanging(), hanging({ hip: [1.5, HANG_HIP[1]], spine: -1 })]
    },
    'scapular-pulls': {
      // Arms straight; pull the shoulder blades down and the body rises.
      cycle: 2.8,
      props: [{ bar: [0, BAR_Y] }],
      keys: [hanging({ shrug: 3 }), hanging({ hip: [0, HANG_HIP[1] + 3], shrug: -1, head: -8 })]
    },
    'pullup-negatives': {
      // Start at the top, lower slowly, step back up.
      cycle: 5.5,
      still: 0,
      props: [{ bar: [0, BAR_Y] }],
      keys: [
        hanging({ hip: [3, HANG_HIP[1] + 22], spine: 4, head: -10, legs: [[176, 215], [174, 213]], feet: [140, 140], hold: 0.15 }),
        hanging({ legs: [[178, 212], [176, 210]], feet: [140, 140], hold: 0.05 })
      ]
    },
    'chin-ups': {
      cycle: 3,
      props: [{ bar: [0, BAR_Y] }],
      keys: [
        hanging({ legs: [[176, 178], [174, 178]] }),
        hanging({ hip: [3, HANG_HIP[1] + 23], spine: 6, head: -12, legs: [[170, 176], [168, 176]], hold: 0.1 })
      ]
    },
    'hanging-knee-raises': {
      cycle: 3,
      props: [{ bar: [0, BAR_Y] }],
      keys: [
        hanging(),
        hanging({ hip: [-1, HANG_HIP[1] + 2], spine: -6, legs: [[82, 175], [84, 177]], feet: [95, 95], hold: 0.1 })
      ]
    },

    /* ---------- Express 15 ---------- */

    'mountain-climbers': {
      // High plank, knees driving in turn.
      cycle: 1.2,
      keys: [
        // Both targets bend the knee down, so the foot travels along the
        // floor instead of the leg swinging up through the air between them.
        pushTop({ legs: [ik(puTop.hip[0] + 14, 14, '-y'), ik(PU_ANKLE[0] - 1, PU_ANKLE[1], '-y')], feet: [150, null] }),
        pushTop({ legs: [ik(PU_ANKLE[0], PU_ANKLE[1], '-y'), ik(puTop.hip[0] + 13, 14, '-y')], feet: [null, 150] })
      ]
    },

    /* ---------- Flexibility ---------- */

    'hip-switches': {
      // Seen from the front, sitting tall on the hands: the knees swing from
      // one side to the other — each time one shin ends up across the front
      // (thigh toward you, foreshortened) and the other out to the side.
      cycle: 4,
      keys: (function () {
        var base = { hip: [0, 7], spine: 0, head: 0, turn: 0,
          arms: [ik(15, WRIST, '+x'), ik(-15, WRIST, '-x')], hands: [150, 210] };
        return [
          merge(base, { legs: [[98, 188], [118, 94]], legLen: [[1, 0.35], [0.45, 1]], feet: [170, 94] }),
          merge(base, { legs: [ik(18, 5, '+y'), ik(-18, 5, '+y')], feet: [120, 240] }),
          merge(base, { legs: [[242, 266], [262, 172]], legLen: [[0.45, 1], [1, 0.35]], feet: [266, 190] }),
          merge(base, { legs: [ik(18, 5, '+y'), ik(-18, 5, '+y')], feet: [120, 240] })
        ];
      })()
    },
    'hip-flexor': {
      // Half-kneeling; tuck the tail and press the hips forward.
      cycle: 4.5,
      keys: [
        { hip: [-4, 28], spine: 0, head: -2, arms: [[182, 176], [178, 184]], legs: [flat(21, 0, '+y'), ik(-30, KNEE + 0.5, '-y')], feet: [null, 270] },
        { hip: [3, 26], spine: 358, head: -2, arms: [[182, 176], [178, 184]], legs: [flat(21, 0, '+y'), ik(-30, KNEE + 0.5, '-y')], feet: [null, 270], hold: 0.25 }
      ]
    },
    'adductor-rock-backs': {
      // All fours with one leg out to the side; rock the hips back.
      cycle: 3.8,
      keys: [
        fours({ legs: [[160, 160], Q_LEGS[1]], legLen: [[0.55, 0.55], [1, 1]], feet: [95, 270] }),
        fours({ hip: [-9, 21], spine: 70, legs: [[172, 172], Q_LEGS[1]], legLen: [[0.45, 0.45], [1, 1]], feet: [95, 270], hold: 0.15 })
      ]
    },
    straddle: {
      // Legs long, hinge from the hips, hands walking forward.
      cycle: 5,
      keys: [
        seated({ arms: [ik(20, WRIST, '+y'), ik(19, WRIST, '+y')], hands: PALMS }),
        seated({ spine: [58, 76], head: 18, arms: [ik(44, WRIST, '+y'), ik(43, WRIST, '+y')], hands: PALMS, hold: 0.25 })
      ]
    },
    'knee-to-wall-rocks': {
      // Half-kneeling at a wall; the front knee drives forward over the toes.
      cycle: 2.6,
      props: [{ wall: 42 }],
      keys: [
        { hip: [2, 28], spine: 8, arms: [ik(41, 50, '-y'), ik(41, 48, '-y')], hands: [0, 0], legs: [flat(24, 0, '+y'), ik(-22, KNEE + 0.5, '-y')], feet: [null, 270] },
        { hip: [11, 27], spine: 12, arms: [ik(41, 50, '-y'), ik(41, 48, '-y')], hands: [0, 0], legs: [flat(24, 0, '+x'), ik(-14, KNEE + 0.5, '-y')], feet: [null, 270] }
      ]
    },
    'knee-to-wall-hold': {
      cycle: 6,
      props: [{ wall: 42 }],
      keys: [
        { hip: [11, 27], spine: 12, arms: [ik(41, 50, '-y'), ik(41, 48, '-y')], hands: [0, 0], legs: [flat(24, 0, '+x'), ik(-14, KNEE + 0.5, '-y')], feet: [null, 270] },
        { hip: [12, 26.5], spine: 13, arms: [ik(41, 50, '-y'), ik(41, 48, '-y')], hands: [0, 0], legs: [flat(24, 0, '+x'), ik(-13, KNEE + 0.5, '-y')], feet: [null, 270] }
      ]
    },
    'calf-stretch': {
      // Hands on the wall, back leg long, back heel down.
      cycle: 5,
      props: [{ wall: 44 }],
      keys: [
        { hip: [2, 49], spine: 22, head: -10, arms: [ik(43, 72, '-y'), ik(43, 70, '-y')], hands: [0, 0], legs: [flat(20, 0, '+x'), flat(-22, 0, '+y')] },
        { hip: [5, 47], spine: 28, head: -14, arms: [ik(43, 72, '-y'), ik(43, 70, '-y')], hands: [0, 0], legs: [flat(20, 0, '+x'), flat(-22, 0, '+y')], hold: 0.2 }
      ]
    },
    'cat-cow': {
      // Round the back up, then let it sag and look up.
      cycle: 4.5,
      keys: [
        fours({ spine: [60, 104], head: 42, hold: 0.1 }),
        fours({ spine: [100, 64], head: -34, hold: 0.1 })
      ]
    },
    'open-book': {
      // Lying on your side, seen from above: the top arm opens across to the
      // other side, following the eyes.
      cycle: 5,
      floor: false,
      keys: [
        { hip: [0, 0], spine: 270, head: 0, turn: 0.6, arms: [[2, 0], [358, 0]], hands: [0, 0], legs: [[0, 90], [2, 92]], feet: [0, 2] },
        { hip: [0, 0], spine: 270, head: 0, turn: -0.4, arms: [[268, 270], [358, 0]], hands: [270, 0], legs: [[0, 90], [2, 92]], feet: [0, 2] },
        { hip: [0, 0], spine: 270, head: 0, turn: -1, arms: [[186, 182], [358, 0]], hands: [182, 0], legs: [[0, 90], [2, 92]], feet: [0, 2], hold: 0.15 }
      ]
    },
    'childs-pose': {
      // Sitting back on the heels, chest to the thighs, arms long.
      cycle: 5,
      keys: (function () {
        var hip = step([0, KNEE], 285, LEN.thigh);
        var legs = [[105, 270], [105, 270]];
        return [
          { hip: hip, spine: [78, 100], head: 8, arms: [ik(38, WRIST, '+y'), ik(37, WRIST, '+y')], hands: PALMS, legs: legs, feet: [270, 270] },
          { hip: [hip[0] - 0.5, hip[1] - 0.6], spine: [80, 103], head: 6, arms: [ik(40, WRIST, '+y'), ik(39, WRIST, '+y')], hands: PALMS, legs: legs, feet: [270, 270] }
        ];
      })()
    },
    'focus-stretch': {
      // One leg long, the other tucked; fold over the long one.
      cycle: 5,
      keys: [
        seated({ legs: [[90, 90], [60, 230]], feet: [5, 95], arms: [ik(20, 12, '-y'), ik(10, WRIST, '-x')], hands: [90, 90] }),
        seated({ spine: [60, 78], head: 16, legs: [[90, 90], [60, 230]], feet: [5, 95], arms: [ik(44, 9, '+y'), ik(40, 9, '+y')], hands: [90, 90], hold: 0.25 })
      ]
    },

    /* ---------- Morning stretch ---------- */

    'neck-circles': {
      // Chin to chest, then ear toward shoulder and back up.
      cycle: 5,
      still: 0,
      keys: [
        standing({ head: 48, turn: 1, hold: 0.08 }),
        standing({ head: 12, turn: 0 }),
        standing({ head: -14, turn: 1, hold: 0.08 }),
        standing({ head: 12, turn: 0 })
      ]
    },
    'shoulder-rolls': {
      // Up to the ears, back, and down.
      cycle: 2.6,
      keys: [
        standing({ roll: 4, arms: [[176, 172], [182, 178]] }),
        standing({ shrug: 6, roll: 1 }),
        standing({ roll: -4, arms: [[188, 184], [194, 190]] }),
        standing({ shrug: -1.5 })
      ]
    },
    'reach-side-bend': {
      // Reach tall, then lean over.
      cycle: 5,
      keys: [
        standing(),
        standing({ arms: [[2, 0], [358, 0]], hands: [0, 0], head: -6 }),
        standing({ spine: [352, 338], head: -8, arms: [[340, 334], [336, 330]], hands: [334, 330], hold: 0.15 })
      ]
    },
    'hip-circles': {
      // Hands on hips; the hips trace a slow circle.
      cycle: 3.4,
      keys: (function () {
        var arms = function (hx) { return [ik(hx + 4, 57, '-x'), ik(hx + 3, 57, '-x')]; };
        return [
          { hip: [5, 53], spine: -5, arms: arms(5), legs: [flat(1), flat(-1)] },
          { hip: [0, 51.5], spine: 0, arms: arms(0), legs: [flat(1), flat(-1)] },
          { hip: [-5, 53], spine: 6, arms: arms(-5), legs: [flat(1), flat(-1)] },
          { hip: [0, 54], spine: 0, arms: arms(0), legs: [flat(1), flat(-1)] }
        ];
      })()
    },
    ragdoll: {
      // Folded forward, knees soft, holding the elbows; sway a little.
      cycle: 5,
      keys: [
        { hip: [-13, 51], spine: [124, 158], head: 16, arms: [[176, 272], [180, 88]], hands: [272, 88], legs: [flat(0), flat(-2)] },
        { hip: [-12, 50], spine: [130, 166], head: 18, arms: [[184, 272], [188, 88]], hands: [272, 88], legs: [flat(0), flat(-2)] }
      ]
    },
    'worlds-greatest': {
      // Lunge, hands down; elbow to the instep; rotate and reach up.
      cycle: 6,
      still: 2,
      keys: (function () {
        var legs = [flat(24, 0, '+y'), toes(-42, 0, 150, '-y')];
        return [
          { hip: [0, 23], spine: 74, head: 10, arms: [ik(18, WRIST, '+x'), ik(19, WRIST, '+x')], hands: PALMS, legs: legs },
          { hip: [0, 21], spine: [80, 100], head: 30, arms: [ik(22, 10, '-y'), ik(19, WRIST, '+x')], hands: [150, 90], legs: legs, hold: 0.1 },
          { hip: [0, 23], spine: 70, head: -40, turn: -0.2, arms: [ik(19, WRIST, '+x'), [2, 0]], hands: [90, 0], legs: legs, hold: 0.15 }
        ];
      })()
    },

    /* ---------- Kama Stretcha ---------- */

    frog: {
      // On the forearms, knees wide; rock the hips back toward the heels.
      cycle: 5,
      keys: (function () {
        var arms = [ik(34, WRIST, '-y'), ik(35, WRIST, '-y')];
        return [
          fours({ spine: 104, head: 20, arms: arms, legs: [ik(-LEN.shin + 2, KNEE + 0.5, '-y'), ik(-LEN.shin + 1, KNEE + 0.5, '-y')] }),
          fours({ hip: [-9, 24], spine: 99, head: 22, arms: arms, legs: [ik(-LEN.shin + 2, KNEE + 0.5, '-y'), ik(-LEN.shin + 1, KNEE + 0.5, '-y')], hold: 0.2 })
        ];
      })()
    },
    pigeon: {
      // Front shin across the mat, back leg long; sit tall, then fold.
      cycle: 5.5,
      keys: [
        { hip: [0, 13], spine: 0, head: -2, arms: [ik(12, WRIST, '-x'), ik(-6, WRIST, '-x')], hands: PALMS,
          legs: [[102, 262], [262, 270]], feet: [5, 270] },
        { hip: [0, 12], spine: [62, 84], head: 30, arms: [ik(42, WRIST, '+y'), ik(41, WRIST, '+y')], hands: PALMS,
          legs: [[102, 262], [262, 270]], feet: [5, 270], hold: 0.2 }
      ]
    },
    'happy-baby': {
      // On your back, knees toward the armpits, shins stacked over the knees,
      // holding the feet; rock gently.
      cycle: 4.5,
      keys: (function () {
        var hip = [0, LYING];
        var pose = function (th, sh, spine) {
          var ankle = step(step(hip, th, LEN.thigh), sh, LEN.shin);
          return { hip: hip, spine: spine, head: -22,
            arms: [ik(ankle[0] + 2, ankle[1] + 2, '+y'), ik(ankle[0] + 3, ankle[1] + 2, '+y')], hands: [0, 0],
            legs: [[th, sh], [th + 1, sh + 1]], feet: [270, 271] };
        };
        return [pose(315, 352, [270, 306]), pose(310, 346, [270, 310])];
      })()
    },
    malasana: {
      // Deep squat, heels down, elbows pressing the knees apart.
      cycle: 5,
      keys: [
        { hip: [-7, 17], spine: [14, 6], head: -6, arms: [[150, 20], [152, 22]], hands: [10, 12], legs: [flat(4, 0, '+x'), flat(3, 0, '+x')] },
        { hip: [-7, 15], spine: [16, 8], head: -6, arms: [[152, 20], [154, 22]], hands: [10, 12], legs: [flat(4, 0, '+x'), flat(3, 0, '+x')] }
      ]
    },
    'seated-fold': {
      // Hinge from the hips over straight legs.
      cycle: 5,
      keys: [
        seated({ arms: [[10, 6], [6, 2]], hands: [4, 0], head: -4 }),
        seated({ spine: [62, 80], head: 20, arms: [ik(50, 9, '+y'), ik(49, 9, '+y')], hands: [95, 95], hold: 0.25 })
      ]
    },
    'butterfly-fold': {
      // Soles together, knees wide; fold toward the feet.
      cycle: 5,
      keys: (function () {
        var legs = [[58, 228], [56, 230]];
        return [
          seated({ spine: 0, head: -4, arms: [ik(8, 8, '+y'), ik(9, 8, '+y')], hands: [120, 120], legs: legs, feet: [100, 100] }),
          seated({ spine: [52, 70], head: 24, arms: [ik(12, 5, '+y'), ik(13, 5, '+y')], hands: [120, 120], legs: legs, feet: [100, 100], hold: 0.25 })
        ];
      })()
    },
    'half-splits': {
      // Back knee down, front leg long, heel down; hips back, then fold.
      cycle: 5,
      keys: [
        { hip: [-4, 28], spine: 10, head: -2, arms: [ik(12, WRIST, '+x'), ik(13, WRIST, '+x')], hands: PALMS,
          legs: [ik(39, 5, '+y'), ik(-28, KNEE + 0.5, '-y')], feet: [0, 270] },
        { hip: [-6, 27], spine: [58, 74], head: 14, arms: [ik(28, WRIST, '+y'), ik(29, WRIST, '+y')], hands: PALMS,
          legs: [ik(37, 5, '+y'), ik(-30, KNEE + 0.5, '-y')], feet: [0, 270], hold: 0.2 }
      ]
    },
    'seated-twist': {
      // One knee up, the other leg tucked; twist toward the knee, eyes last.
      cycle: 5.5,
      keys: [
        seated({ head: -2, arms: [ik(-10, WRIST, '-x'), ik(20, 26, '-y')], hands: [270, 60], legs: [flat(20, 0, '+y'), [92, 262]], feet: [null, 270] }),
        seated({ head: -6, turn: -0.9, spine: [0, 356], arms: [ik(-14, WRIST, '-x'), ik(24, 30, '-y')], hands: [270, 60], legs: [flat(20, 0, '+y'), [92, 262]], feet: [null, 270], hold: 0.25 })
      ]
    },
    'half-lotus': {
      // One ankle on the other thigh; sit tall, then lean in.
      cycle: 5,
      keys: [
        seated({ head: -2, arms: [ik(24, 13, '-y'), ik(22, 9, '-y')], hands: [100, 100], legs: [[93, 280], [92, 262]], feet: [30, 270] }),
        seated({ spine: [22, 26], head: 8, arms: [ik(28, 11, '-y'), ik(26, 7, '-y')], hands: [100, 100], legs: [[93, 280], [92, 262]], feet: [30, 270], hold: 0.25 })
      ]
    },
    'thread-needle': {
      // From all fours, one arm slides under and that shoulder rests down.
      cycle: 5,
      keys: [
        fours(),
        fours({ spine: [84, 118], head: 30, turn: 0, arms: [ik(-6, 4, '-y'), ik(Q_HAND + 1, WRIST, '+x')], hands: [270, 90], hold: 0.25 })
      ]
    },
    cobra: {
      // Face down, hands by the ribs; lift the chest, then the hips a little.
      cycle: 5.5,
      keys: [
        prone({ arms: [ik(26, WRIST, '+y'), ik(27, WRIST, '+y')], hands: PALMS }),
        prone({ spine: [82, 42], head: -18, arms: [ik(26, WRIST, '+y'), ik(27, WRIST, '+y')], hands: PALMS, hold: 0.1 }),
        prone({ hip: [0, 11], spine: [68, 30], head: -24, arms: [ik(26, WRIST, '+y'), ik(27, WRIST, '+y')], hands: PALMS, legs: [[272, 272], [271, 271]], hold: 0.15 })
      ]
    },
    camel: {
      // Kneeling tall, hands on the low back; hips forward, open the chest,
      // reach for the heels.
      cycle: 6,
      keys: [
        { hip: [0, 28], spine: 0, head: -4, arms: [ik(-7, 31, '-y'), ik(-6, 30, '-y')], hands: [0, 0], legs: KNEELING_LEGS, feet: [180, 180], hold: 0.1 },
        { hip: [4, 27], spine: [322, 250], head: -50, arms: [ik(-23, 11, '-x'), ik(-22, 11, '-x')], hands: [180, 180], legs: KNEELING_LEGS, feet: [180, 180], hold: 0.2 }
      ]
    },
    plow: {
      // Shoulders down, hips over them; legs up, then over and down behind.
      cycle: 6,
      keys: (function () {
        var sh = [-22, LYING], hip = [-14, 34];
        var arms = [ik(12, WRIST, '+y'), ik(13, WRIST, '+y')];
        return [
          { hip: hip, shoulderAt: sh, head: 78, arms: arms, hands: PALMS, legs: [[2, 2], [4, 4]], feet: [10, 12] },
          { hip: hip, shoulderAt: sh, head: 78, arms: arms, hands: PALMS, legs: [ik(-62, 9, '+y'), ik(-63, 10, '+y')], feet: [215, 215], hold: 0.25 }
        ];
      })()
    },
    'pelvic-floor': {
      // On your back, knees bent: lift and hold, then let go completely.
      cycle: 6,
      keys: [
        onBack({ hold: 0.15 }),
        onBack({ hip: [0, LYING + 1.2], spine: [268, 270], hold: 0.35 })
      ]
    },

    _default: {
      cycle: 4,
      keys: [standing(), standing({ spine: [1, 3], arms: [[186, 180], [174, 180]] })]
    }
  };

  /* The same moves, timed, in Express 15 — and the straddle fold. */
  FIGURES['express-squats'] = FIGURES.squats;
  FIGURES['express-pushups'] = FIGURES.pushups;
  FIGURES['express-lunges'] = FIGURES['reverse-lunges'];
  FIGURES['express-plank'] = FIGURES.plank;
  FIGURES['straddle-fold'] = FIGURES.straddle;


  global.CadenceFigures = {
    create: create,
    has: function (id) { return Object.prototype.hasOwnProperty.call(FIGURES, id) && id !== '_default'; },
    cue: function (id) { return CUES[id] || ''; },
    ids: function () { return Object.keys(FIGURES).filter(function (k) { return k !== '_default'; }); },
    // For the contact sheet in development: a resolved frame of any figure.
    _at: function (id, phase) { return build(at(FIGURES[id], phase)); }
  };
})(window);
