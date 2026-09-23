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
 * A reached-for limb can take `arc`: moving into or out of that keyframe,
 * the hand or foot travels on a curve that high instead of a straight line.
 * `spineLen` (default 1) shortens the torso the same way, for a fold seen
 * from the front.
 *
 * `d3` holds what only the 3D figure (figure3d.js) uses, blended like the
 * rest. Per side ([near, far]):
 *   sign    which way a foreshortened bone points out of the picture,
 *           { arms, legs: [[upper, lower], ...], spine }, +1 or -1
 *   abd     swing a limb out to its side, degrees — a number moves the
 *           whole limb, [upper, lower] swings the lower part separately
 *           (happy baby: thigh out, shin back to vertical)
 *   flare   turn the elbow or knee out about the line to the hand or foot,
 *           which stays planted (push-up elbows, squat knees)
 *   toeOut  turn the feet out, degrees; `handOut` the same for the hands
 *   wide    move the hand or foot out to its side by this much (a wider
 *           stance, hands wider than the shoulders); `reach` moves it by a
 *           vector [x, y, z]; `at` puts it at a point, and must then be in
 *           every keyframe. The elbow or knee is solved again in 3D.
 * and for the body:
 *   shift   move the weight sideways: the pelvis, or [pelvis, chest,
 *           hands] (the hands go with the chest unless planted: 0); the
 *           feet stay where they are
 *   twist   turn the upper body about the spine (`twistArms` [1, 1] says
 *           which arms go with it — a hand left behind stays put); `roll` turn the whole body about its
 *           long axis (lying on your side); `tilt` tip the head toward a
 *           shoulder; `faceZ` -1 turns a sideways-looking face the other way
 * A figure's `view` says which plane the 2D drawing is in: 'side' (default)
 * or 'front'. `keys3d` (with `view3d`, `still3d`) replace the keyframes for
 * 3D where the 2D drawing is a trick that can't be lifted; `props3d`
 * replaces the props.
 * `armLen` and `legLen` ([[upper, lower], [upper, lower]], default 1) draw a
 * bone shorter when it points toward you — a leg out to the side, seen from
 * the side, is mostly foreshortened.
 */
(function (global) {
  'use strict';

  /* ---------- the rig ---------- */

  var LEN = {
    spineLow: 15, spineHigh: 15, neck: 5, headR: 6.5,
    upperArm: 18.5, foreArm: 15.5, hand: 8,
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

  /* The sole from the ankle: heel, the ball of the foot, and the toes. `a`
   * is the direction heel→ball (90: flat, pointing forward); `t` is the
   * toes', which bend at the ball — up on your toes, they stay flat on the
   * floor while the heel rises. */
  var FOOT = { heel: 2.5, ball: 7.5, toes: 3.5 };
  function footPoints(ankle, a, t) {
    var f = dir(a), down = dir(a + 90);
    var k = ANKLE - WIDTH.foot / 2;
    var base = [ankle[0] + down[0] * k, ankle[1] + down[1] * k];
    var ball = [base[0] + f[0] * FOOT.ball, base[1] + f[1] * FOOT.ball];
    return {
      heel: [base[0] - f[0] * FOOT.heel, base[1] - f[1] * FOOT.heel],
      ball: ball,
      toe: step(ball, t == null ? a : t, FOOT.toes)
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
    var sl = p.spineLen == null ? 1 : p.spineLen;
    var waist = step(hip, sp[0], LEN.spineLow * sl);
    var shoulder = step(waist, sp[1], LEN.spineHigh * sl);
    var neckA = sp[1] + (p.head || 0);
    var neckTop = step(shoulder, neckA, LEN.neck);
    var head = step(neckTop, neckA, LEN.headR);
    var face = dir(neckA + 90);                 // front of the face
    var turn = p.turn == null ? 1 : p.turn;
    var root = armRoot(shoulder, sp[1], p);
    // Two eyes: together at the front of the face in profile, drawing apart
    // as the face turns toward you, level across it when it faces you.
    var spread = 2.3 * Math.sqrt(Math.max(0, 1 - turn * turn));
    var eyeAt = function (k) {
      var along = Math.max(-5.2, Math.min(5.2, 3.2 * turn + k * spread));
      return [head[0] + face[0] * along + dir(neckA)[0] * 1.2, head[1] + face[1] * along + dir(neckA)[1] * 1.2];
    };
    var out = { hip: hip, waist: waist, shoulder: shoulder, root: root, neckTop: neckTop, head: head, turn: turn, d3: p.d3 || null,
      eyes: [eyeAt(1), eyeAt(-1)], arms: [], legs: [] };
    out.eye = out.eyes[0];
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
      var fp = footPoints(ankle, footA, p.toes && p.toes[i] != null ? p.toes[i] : null);
      out.legs[i] = { knee: knee, ankle: ankle, heel: fp.heel, ball: fp.ball, toe: fp.toe };
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
    var sl = k.spineLen == null ? 1 : k.spineLen;
    var shoulder = step(step(hip, sp[0], LEN.spineLow * sl), sp[1], LEN.spineHigh * sl);
    var root = armRoot(shoulder, sp[1], k);
    var out = { hip: hip, spine: sp, spineLen: k.spineLen, head: k.head || 0, turn: k.turn, shrug: k.shrug, roll: k.roll,
      armLen: k.armLen, legLen: k.legLen, d3: k.d3, arms: [], legs: [], hands: k.hands, feet: [null, null], toes: [null, null] };
    for (var i = 0; i < 2; i++) {
      var a = k.arms[i], l = k.legs[i];
      // A foot placed with flat() or toes() carries its own angles; the
      // keyframe's `feet` wins over them.
      out.feet[i] = k.feet && k.feet[i] != null ? k.feet[i] : l.foot != null ? l.foot : null;
      out.toes[i] = l.toe != null ? l.toe : null;
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

  /* The 3D extras, blended leaf by leaf, whatever their shape; a value
   * missing on one side blends from its neutral (1 for `sign`, `faceZ` and
   * `twistArms`; 0 otherwise). figure3d.js reads them with defaults. */
  var D3_ONE = { sign: 1, faceZ: 1, twistArms: 1 };
  function blendD3(a, b, u) {
    if (!a && !b) return null;
    function walk(x, y, neutral) {
      if (Array.isArray(x) || Array.isArray(y)) {
        var n = Math.max(x ? x.length : 0, y ? y.length : 0), out = [];
        for (var i = 0; i < n; i++) out[i] = walk(x ? x[i] : undefined, y ? y[i] : undefined, neutral);
        return out;
      }
      if ((x && typeof x === 'object') || (y && typeof y === 'object')) {
        var o = {};
        Object.keys(x || {}).concat(Object.keys(y || {})).forEach(function (k) {
          if (!(k in o)) o[k] = walk(x ? x[k] : undefined, y ? y[k] : undefined, neutral);
        });
        return o;
      }
      var p = x == null ? neutral : x, q = y == null ? neutral : y;
      return p + (q - p) * u;
    }
    var out = {};
    Object.keys(a || {}).concat(Object.keys(b || {})).forEach(function (k) {
      if (!(k in out)) out[k] = walk(a ? a[k] : undefined, b ? b[k] : undefined, D3_ONE[k] != null ? D3_ONE[k] : 0);
    });
    return out;
  }

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
      spineLen: lerp(ka.spineLen == null ? 1 : ka.spineLen, kb.spineLen == null ? 1 : kb.spineLen, u),
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
          // `arc` lifts a moving hand or foot along a curve instead of a
          // straight line — a stepping foot clears the floor.
          var p = lerpPt(a.ik, b.ik, u);
          p[1] += Math.max(a.arc || 0, b.arc || 0) * Math.sin(Math.PI * u);
          k[part][i] = { ik: p, bend: a.bend };
        } else {
          k[part][i] = [lerpAngle(ra[part][i][0], rb[part][i][0], u), lerpAngle(ra[part][i][1], rb[part][i][1], u)];
        }
      }
    });
    var r = resolve(k);
    r.d3 = blendD3(ka.d3, kb.d3, u);
    r.hands = optAngles(ka.hands, kb.hands, function (i) { return ra.arms[i][1]; }, function (i) { return rb.arms[i][1]; }, u);
    var fa = [], fb = [];
    r.feet = []; r.toes = [];
    for (var i = 0; i < 2; i++) {
      fa[i] = ra.feet[i] != null ? ra.feet[i] : ra.legs[i][1] - 90;
      fb[i] = rb.feet[i] != null ? rb.feet[i] : rb.legs[i][1] - 90;
      r.feet[i] = lerpAngle(fa[i], fb[i], u);
      r.toes[i] = lerpAngle(ra.toes[i] != null ? ra.toes[i] : fa[i], rb.toes[i] != null ? rb.toes[i] : fb[i], u);
    }
    return r;
  }

  /* The figure as the 3D view sees it: the same, unless it has its own
   * `keys3d` (with `view3d`, `still3d`) because its 2D drawing is a trick
   * that can't be lifted — open book is drawn from above. */
  function def3(id) {
    var def = FIGURES[id] || FIGURES._default;
    if (!def.keys3d) return def.props3d ? merge3(def, { props: def.props3d }) : def;
    return { keys: def.keys3d, cycle: def.cycle, view: def.view3d || 'side', props: def.props3d || def.props,
      floor: true, still: def.still3d, yaw: def.yaw };
  }

  function merge3(a, b) {
    var o = {};
    Object.keys(a).forEach(function (k) { o[k] = a[k]; });
    Object.keys(b).forEach(function (k) { o[k] = b[k]; });
    return o;
  }

  /* The loop phase at which keyframe `i` is reached (after its hold). */
  function keyPhase(def, i) {
    var keys = def.keys, n = keys.length;
    var holds = keys.map(function (k) { return k.hold || 0; });
    var moveEach = Math.max(0.05, 1 - holds.reduce(function (a, b) { return a + b; }, 0)) / n;
    var t = 0;
    for (var j = 0; j < i; j++) t += holds[j] + moveEach;
    return t + holds[i] / 2;
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
    sk.legs.forEach(function (l) { pts.push(l.knee, l.ankle, l.heel, l.ball, l.toe); });
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
      if (pr.rod) { add(pr.rod, 3); }
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
      if (pr.rod) {
        // A pull-up bar runs across the body, so from the side you see its end.
        g.appendChild(svgEl('circle', { class: 'fig-rod', cx: pr.rod[0], cy: -pr.rod[1], r: 2.2 }));
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
    var eyes = [svgEl('circle', { class: 'fig-eye', r: 1.1 }), svgEl('circle', { class: 'fig-eye', r: 1.1 })];
    // Far limbs behind the body, near limbs in front of it.
    g.appendChild(far.g);
    g.appendChild(torso);
    g.appendChild(neck);
    g.appendChild(head);
    eyes.forEach(function (e) { g.appendChild(e); });
    g.appendChild(near.g);

    function paintLimbs(set, sk, i) {
      var a = sk.arms[i], l = sk.legs[i];
      set.parts.thigh.setAttribute('d', seg(sk.hip, l.knee));
      set.parts.shin.setAttribute('d', seg(l.knee, l.ankle));
      set.parts.foot.setAttribute('d', 'M' + P(l.ankle) + 'L' + P(l.heel) + 'L' + P(l.ball) + 'L' + P(l.toe));
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
      sk.eyes.forEach(function (p, i) {
        eyes[i].setAttribute('cx', p[0].toFixed(2));
        eyes[i].setAttribute('cy', (-p[1]).toFixed(2));
      });
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

  /* A foot flat on the floor (or on top of a box at `y`), ankle at x. */
  function flat(x, y, bend) {
    var l = ik(x, (y || 0) + ANKLE, bend || '+x');
    l.foot = 90; l.toe = 90;
    return l;
  }

  /* Where the ankle is when the ball of the foot is at (x, y) and the foot
   * points at `footAngle` — up on the toes, or toes tucked under in a plank. */
  function ankleOnToes(x, y, footAngle) {
    var f = dir(footAngle), down = dir(footAngle + 90);
    var k = ANKLE - WIDTH.foot / 2;
    return [x - f[0] * FOOT.ball - down[0] * k, (y || 0) + WIDTH.foot / 2 - f[1] * FOOT.ball - down[1] * k];
  }

  /* A foot up on its toes: the ball at (x, y), toes flat on the floor. */
  function toes(x, y, footAngle, bend) {
    var fa = footAngle == null ? 135 : footAngle;
    var a = ankleOnToes(x, y, fa);
    var l = ik(a[0], a[1], bend || '+x');
    l.foot = fa; l.toe = 90;
    return l;
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
    warmup: "March on the spot, swinging the arms, then rehearse today’s first two moves at half effort.",
    pushups: "One straight line from head to heels, elbows close in.",
    "table-rows": "Body straight from heels to head — pull your chest to the bar, shoulders away from your ears.",
    squats: "Sit down between your heels — knees point the same way as your toes.",
    "reverse-lunges": "Step back, drop the back knee, stay tall.",
    plank: "Elbows under shoulders, ribs down, glutes tight — breathe.",
    cooldown: "Walk it off, breathe slow, stretch whatever you just worked.",
    "pike-pushups": "Hips high, feet walked in — lower until your head is just off the floor, weight in the hands.",
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
  function arced(leg, h) { leg.arc = h; return leg; }
  function merge(base, extra) {
    var k = {};
    Object.keys(base).forEach(function (key) { k[key] = base[key]; });
    Object.keys(extra || {}).forEach(function (key) { k[key] = extra[key]; });
    return k;
  }
  var PALMS = [90, 90];          // hands flat on the floor, fingers forward
  var WRIST = 2.6;               // wrist height with the palm flat
  var KNEE = 3.8;                // knee joint height, kneeling on it
  var LYING = 6.2;               // hip and shoulder height lying down

  /* A leg reaching for an ankle point with the foot on its toes: ball on
   * the floor, toes flat, heel up. */
  function onToes(ankle, bend, footAngle) {
    var l = ik(ankle[0], ankle[1], bend);
    l.foot = footAngle; l.toe = 90;
    return l;
  }

  /* High plank / push-up: balls of the feet at x = -50, toes tucked under,
   * the body one line from heel to head. */
  var PU_FOOT = 162;
  var PU_ANKLE = ankleOnToes(-50, 0, PU_FOOT);
  /* The body angle at which straight arms just reach the floor. */
  function lineForShoulderAt(ankle, y) {
    return Math.acos((y - ankle[1]) / (LEN.thigh + LEN.shin + LEN.spineLow + LEN.spineHigh)) * 180 / Math.PI;
  }
  var PU_ANGLE = lineForShoulderAt(PU_ANKLE, WRIST + LEN.upperArm + LEN.foreArm - 0.2);
  var puTop = line(PU_ANKLE, PU_ANGLE);
  var puLow = line(PU_ANKLE, 87);
  var PU_HAND = puTop.shoulder[0];
  var PU_LEGS = [onToes(PU_ANKLE, '+y', PU_FOOT), onToes([PU_ANKLE[0] - 1, PU_ANKLE[1]], '+y', PU_FOOT)];
  var PU_ARMS = [ik(PU_HAND, WRIST, '+y'), ik(PU_HAND + 1, WRIST, '+y')];
  // In 3D: hands a little wider than the shoulders; at the bottom the
  // elbows point back at about 35° from the body, not out to the sides.
  var PU_3D = { wide: { arms: [2.5, 2.5] } };
  var PU_3D_LOW = { wide: { arms: [2.5, 2.5] }, flare: { arms: [35, 35] } };
  function pushTop(extra) {
    return merge({ hip: puTop.hip, spine: PU_ANGLE, head: 12, arms: PU_ARMS, hands: PALMS, legs: PU_LEGS, d3: PU_3D }, extra);
  }
  function pushLow(extra) {
    return merge({ hip: puLow.hip, spine: 88, head: 8, arms: PU_ARMS, hands: PALMS, legs: PU_LEGS, d3: PU_3D_LOW }, extra);
  }

  // The 3D figure's shoulder joints sit this far either side of the spine.
  var SHOULDER_3D = 9.5;

  /* All fours: knees under hips, hands under shoulders. */
  var Q_HIP = [0, KNEE + LEN.thigh];
  // Arms are longer than thighs, so the back slopes up to the shoulders.
  var Q_SPINE = 90 - Math.asin((WRIST + LEN.upperArm + LEN.foreArm - 0.3 - Q_HIP[1]) / (LEN.spineLow + LEN.spineHigh)) * 180 / Math.PI;
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
      hip: [0, LYING], spine: 270, head: 4,
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

  /* The edge of a table to row from. */
  var TABLE = 45;

  /* Hanging from a bar at BAR_Y. */
  var BAR_Y = 140;
  var BAR_ARMS = [ik(1, BAR_Y - 1, '+x'), ik(-1, BAR_Y - 1, '+x')];
  var HANG_HIP = [0, BAR_Y - 1 - LEN.upperArm - LEN.foreArm - LEN.spineLow - LEN.spineHigh - 0.1];
  /* Chin over the bar: leaning back a little, so the head is behind the bar
   * and the chin clears it in front. */
  var OVER_BAR = { hip: [3, HANG_HIP[1] + 31], spine: -12, head: -14, legs: [[176, 184], [174, 182]], feet: [140, 140] };
  function hanging(extra) {
    return merge({ hip: HANG_HIP, spine: 0, head: -4, arms: BAR_ARMS, hands: [0, 0],
      legs: [[182, 180], [178, 180]], feet: [120, 120] }, extra);
  }

  /* In 3D: heels a little wider than the hips, toes turned out. */
  var SQUAT_3D = { wide: { legs: [5, 5] }, toeOut: [22, 22] };

  var MALASANA_3D = { wide: { legs: [7, 7] }, toeOut: [38, 38], flare: { legs: [38, 38], arms: [30, 30] },
    reach: { arms: [[0, 0, -SHOULDER_3D + 1], [0, 0, SHOULDER_3D - 1]] } };

  // Focus stretch, in 3D: the bent leg's foot against the long leg's inner
  // thigh, its knee dropped out to the side.
  var FOCUS_3D = { at: { legs: [0, [15, 5.2, 1]] }, flare: { legs: [0, 57] } };

  // World's greatest, in 3D: the front foot out wide, so both hands are
  // inside it.
  var WG_3D = { wide: { legs: [12, 0] } };

  /* Seen from the front: the eye sits in the middle of the face. */
  var FRONT = { turn: 0 };

  var FIGURES = {

    /* ---------- warm-up and cool-down ---------- */

    warmup: {
      // Marching on the spot, arms swinging. One knee at a time: blending
      // straight from one lifted knee to the other left both legs half-up
      // at the midpoint, standing on nothing.
      cycle: 2,
      keys: [
        standing({ spine: 2, arms: [[205, 160], [150, 120]], legs: [ik(12, 32, '+x'), flat(-1)], d3: { shift: -2.5 } }),
        standing({ spine: 1, arms: [[182, 176], [178, 184]], legs: [flat(0), flat(-1)] }),
        standing({ spine: 2, arms: [[150, 120], [205, 160]], legs: [flat(0), ik(11, 32, '+x')], d3: { shift: 2.5 } }),
        standing({ spine: 1, arms: [[182, 176], [178, 184]], legs: [flat(0), flat(-1)] })
      ]
    },
    cooldown: {
      // Tall reach, then let it go.
      cycle: 5,
      keys: [
        standing({ hold: 0.15 }),
        standing({ spine: [2, 6], head: -12, arms: [[8, 4], [4, 2]], hold: 0.25 })
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
      // Under a sturdy table, heels down, body one line. Hanging below the
      // edge the arms are straight and square to the body; pull until the
      // chest meets the edge, elbows back at about 45°.
      cycle: 2.8,
      props: [{ bar: [-40, TABLE] }],
      keys: (function () {
        var L = LEN.thigh + LEN.shin + LEN.spineLow + LEN.spineHigh;
        var sLow = [-41, TABLE - 0.5 - LEN.upperArm - LEN.foreArm + 0.3];
        var ank = [sLow[0] + Math.sqrt(L * L - Math.pow(sLow[1] - 4.5, 2)), 4.5];
        var yHigh = TABLE - 7.5;
        var sHigh = [ank[0] - Math.sqrt(L * L - Math.pow(yHigh - 4.5, 2)), yHigh];
        var aLow = angleOf(sLow[0] - ank[0], sLow[1] - ank[1]), aHigh = angleOf(sHigh[0] - ank[0], sHigh[1] - ank[1]);
        var low = line(ank, aLow), high = line(ank, aHigh);
        var legs = [ik(ank[0], ank[1], '+y'), ik(ank[0] + 1, ank[1], '+y')];
        var arms = [ik(-40, TABLE - 0.5, '-y'), ik(-40, TABLE - 0.5, '-y')];
        return [
          { hip: low.hip, spine: aLow, head: 10, arms: arms, hands: [270, 270], legs: legs, feet: [0, 0] },
          { hip: high.hip, spine: aHigh, head: 16, arms: arms, hands: [270, 270], legs: legs, feet: [0, 0], d3: { flare: { arms: [45, 45] } }, hold: 0.1 }
        ];
      })()
    },
    squats: {
      cycle: 3,
      keys: [
        standing({ arms: [[176, 176], [184, 184]], legs: [flat(0), flat(-1)], d3: SQUAT_3D }),
        { hip: [-13, 29], spine: [34, 40], head: -32, arms: [[82, 88], [86, 92]], legs: [flat(0), flat(-1)],
          d3: merge(SQUAT_3D, { flare: { legs: [22, 22] } }) }
      ]
    },
    'reverse-lunges': {
      cycle: 3.2,
      keys: [
        standing(),
        { hip: [-6, 34], spine: 4, arms: HANG, legs: [flat(9), arced(toes(-34, 0, 145, '+x'), 12)] }
      ]
    },
    plank: {
      // On the forearms, elbows under the shoulders, one line from heels to head.
      cycle: 4.5,
      keys: (function () {
        var ang = lineForShoulderAt(PU_ANKLE, WRIST + LEN.upperArm + 0.3);
        var a = line(PU_ANKLE, ang), b = line(PU_ANKLE, ang - 1);
        var fore = [ik(a.shoulder[0] + LEN.foreArm, WRIST, '-y'), ik(a.shoulder[0] + LEN.foreArm + 1, WRIST, '-y')];
        return [
          { hip: a.hip, spine: ang, head: 12, arms: fore, hands: PALMS, legs: PU_LEGS },
          { hip: b.hip, spine: ang - 1, head: 12, arms: fore, hands: PALMS, legs: PU_LEGS }
        ];
      })()
    },

    /* ---------- Calisthenics B ---------- */

    'pike-pushups': {
      // Feet walked in, hips high; bend the elbows and lower the head until
      // it's just off the floor in front of the hands — a tripod.
      cycle: 3.2,
      keys: (function () {
        var legs = [toes(-8, 0, 150, '+x'), toes(-9, 0, 150, '+x')];
        var arms = [ik(33, WRIST, '-x'), ik(34, WRIST, '-x')];
        return [
          { hip: [6, 57], spine: 162, head: -4, arms: arms, hands: PALMS, legs: legs },
          { hip: [18, 48], spine: 155, head: -24, arms: arms, hands: PALMS, legs: legs, hold: 0.1 }
        ];
      })()
    },
    'prone-ytw': {
      // Face down, forehead low: lift the arms in a Y, then a T (out to the
      // sides, toward you), then a W (elbows pulled to the ribs).
      cycle: 7.5,
      keys: [
        prone({ arms: [[82, 84], [84, 86]], hands: [84, 86], d3: { abd: { arms: [35, 35] } } }),
        prone({ spine: [91, 82], head: -8, arms: [[62, 56], [64, 58]], hands: [56, 58], d3: { abd: { arms: [35, 35] } }, hold: 0.08 }),
        prone({ arms: [[100, 100], [104, 104]], armLen: [[0.28, 0.28], [0.25, 0.25]], hands: [100, 104] }),
        prone({ spine: [91, 82], head: -8, arms: [[62, 62], [66, 66]], armLen: [[0.28, 0.28], [0.25, 0.25]], hands: [62, 66], hold: 0.08 }),
        prone({ spine: [91, 82], head: -8, arms: [[284, 58], [288, 62]], armLen: [[0.8, 0.5], [0.75, 0.45]], hands: [58, 62], hold: 0.08 })
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
        { hip: [-0.5, 42], spine: 4, head: -4, arms: [ik(-10, 44, '-x'), ik(-11, 44, '-x')], hands: [118, 118], legs: [flat(32), flat(30)] },
        { hip: [0.5, 26], spine: 10, head: -8, arms: [ik(-10, 44, '-x'), ik(-11, 44, '-x')], hands: [118, 118], legs: [flat(32), flat(30)], d3: { flare: { arms: [-12, -12] } } }
      ]
    },
    'shoulder-taps': {
      // High plank, feet wide; one hand taps the other shoulder, then the
      // other, hips staying level.
      cycle: 3,
      keys: (function () {
        var TAP_3D = { wide: { arms: [2.5, 2.5], legs: [11, 11] } };
        var tap = ik(puTop.shoulder[0] + 3, puTop.shoulder[1] - 5, '-y');
        return [
          pushTop({ d3: TAP_3D }),
          pushTop({ arms: [tap, PU_ARMS[1]], hands: [300, 90], d3: merge(TAP_3D, { reach: { arms: [[0, 0, -2 * SHOULDER_3D - 1], [0, 0, 0]] } }) }),
          pushTop({ d3: TAP_3D }),
          pushTop({ arms: [PU_ARMS[0], tap], hands: [90, 300], d3: merge(TAP_3D, { reach: { arms: [[0, 0, 0], [0, 0, 2 * SHOULDER_3D + 1]] } }) })
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
      // One foot planted and driving; the other knee held in toward the chest.
      cycle: 2.8,
      keys: [
        onBack({ legs: [flat(22, 0, '+y'), [340, 80]], feet: [null, 350] }),
        onBack({ hip: [0, 26], shoulderAt: B_SHOULDER, head: 20, legs: [flat(22, 0, '+y'), [325, 60]], feet: [null, 330], hold: 0.1 })
      ]
    },
    'towel-leg-curls': {
      // Hips up, heels on a towel; pull them in and slide them out.
      cycle: 3.4,
      keys: [
        onBack({ hip: [0, 16], shoulderAt: B_SHOULDER, head: 12, legs: [ik(47, 4, '+y'), ik(48, 4, '+y')], feet: [0, 0] }),
        onBack({ hip: [0, 24], shoulderAt: B_SHOULDER, head: 18, legs: [ik(24, 4, '+y'), ik(25, 4, '+y')], feet: [6, 6] })
      ]
    },
    'step-ups': {
      cycle: 3.2,
      props: [{ box: [16, 46, 22] }],
      keys: [
        standing({ hip: [-2, STAND], spine: 6, arms: [[160, 150], [200, 190]], legs: [flat(26, 22, '+y'), flat(-2)], d3: { shift: -3 } }),
        standing({ hip: [26, STAND + 22], spine: 0, arms: [[200, 190], [160, 150]], legs: [flat(27, 22), arced(ik(40, 44, '+x'), 18)], d3: { shift: 4 } })
      ]
    },
    'wall-sit': {
      // Back flat on the wall, thighs level.
      cycle: 6,
      props: [{ wall: -12 }],
      keys: [
        { hip: [-5.5, 30], spine: 0, head: -2, arms: [ik(8, 36.5, '-x'), ik(7, 36.5, '-x')], hands: [95, 95], legs: [flat(20, 0, '+y'), flat(19, 0, '+y')] },
        { hip: [-5.5, 29], spine: 0, head: -2, arms: [ik(8, 35.5, '-x'), ik(7, 35.5, '-x')], hands: [95, 95], legs: [flat(20, 0, '+y'), flat(19, 0, '+y')] }
      ]
    },
    'calf-raises': {
      // One foot on a step edge, the other hooked behind: the heel drops
      // below the step, then rises high onto the ball of the foot.
      cycle: 3,
      props: [{ box: [7, 34, 12] }],
      keys: (function () {
        var bx = 8;
        var at = function (fa, extra) {
          var a = ankleOnToes(bx, 12, fa);
          return standing(merge({ hip: [a[0] - 0.5, a[1] + LEN.thigh + LEN.shin - 0.05], legs: [toes(bx, 12, fa), [192, 240]], feet: [null, 150], d3: { shift: 4 } }, extra));
        };
        return [at(64, { hold: 0.08 }), at(142, { hold: 0.12 })];
      })()
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
          legs: [[68, 68], [69, 69]], feet: [72, 72] },
        { hip: [0, LYING], spine: [277, 295], head: 10, arms: [[300, 296], [302, 298]], hands: [296, 298],
          legs: [[65, 65], [66, 66]], feet: [69, 69] }
      ]
    },
    'side-plank': {
      // Facing you on one forearm, top arm to the ceiling: hold one straight
      // line from heels to head, breathing.
      view: 'front',
      cycle: 5,
      keys: (function () {
        var ank = [-47, 4.5];
        var top = line(ank, 76), low = line(ank, 77);
        var legs = [ik(ank[0], ank[1], '+y'), ik(ank[0] + 2, ank[1] + 3, '+y')];
        var elbowArm = ik(top.shoulder[0] + LEN.foreArm - 2, WRIST, '-y');
        return [
          { hip: top.hip, spine: 76, head: 12, turn: 0, arms: [elbowArm, [0, 0]], hands: [90, 0], legs: legs, feet: [84, 84], hold: 0.3 },
          { hip: low.hip, spine: 77, head: 12, turn: 0, arms: [elbowArm, [0, 0]], hands: [90, 0], legs: legs, feet: [84, 84], hold: 0.3 }
        ];
      })(),
      // In 3D the hips and shoulders stack, so the drawing's midline sits
      // half a body-width up: the lower foot and elbow on the floor, the
      // upper arm straight down from the shoulder, forearm pointing forward.
      view3d: 'front',
      keys3d: (function () {
        var ank = [-47, 9.8], L = LEN.thigh + LEN.shin + LEN.spineLow + LEN.spineHigh;
        var at = function (rootY) {
          var ang = Math.acos((rootY + SHOULDER_3D * 0.97 - ank[1]) / L) * 180 / Math.PI;
          return { hip: line(ank, ang).hip, spine: ang, head: 12, turn: 0,
            arms: [[180, 90], [0, 0]], armLen: [[(rootY - 2.6) / LEN.upperArm, 0.05], [1, 1]], hands: [90, 0],
            legs: [ik(ank[0], ank[1], '+y'), ik(ank[0] + 1, ank[1], '+y')], feet: [84, 84] };
        };
        return [merge(at(LEN.upperArm + 2.6), { hold: 0.3 }), merge(at(LEN.upperArm + 2.2), { hold: 0.3 })];
      })()
    },
    'reverse-crunch': {
      // Knees bent at 90° over the hips; curl them toward the chest and peel
      // the pelvis off the floor — no swinging.
      cycle: 3,
      keys: [
        onBack({ legs: [[8, 98], [9, 99]], feet: [8, 9] }),
        onBack({ hip: [-5, 17], spine: [246, 262], head: 6, legs: [[318, 48], [319, 49]], feet: [318, 319], hold: 0.1 })
      ]
    },

    /* ---------- Calisthenics C ---------- */

    'archer-pushups': {
      // Hands wide. Lower toward one hand while the other arm stays straight
      // out to the side — foreshortened here, as it points toward you.
      cycle: 4.4,
      keys: (function () {
        // Out to the side, a straight arm shows only its drop to the floor.
        var reach = LEN.upperArm + LEN.foreArm;
        var sTop = (puTop.shoulder[1] - WRIST) / reach, sLow = (puLow.shoulder[1] - WRIST) / reach * 0.98;
        var wide = ik(PU_HAND - 1, WRIST, '+y');
        var low = { hip: puLow.hip, spine: 87, head: 8, legs: PU_LEGS };
        return [
          pushTop({ arms: [PU_ARMS[0], wide], armLen: [[1, 1], [sTop, sTop]], hands: [90, 90] }),
          merge(low, { arms: [PU_ARMS[0], wide], armLen: [[1, 1], [sLow, sLow]], hands: [90, 90], hold: 0.08 }),
          pushTop({ arms: [wide, PU_ARMS[1]], armLen: [[sTop, sTop], [1, 1]], hands: [90, 90] }),
          merge(low, { arms: [wide, PU_ARMS[1]], armLen: [[sLow, sLow], [1, 1]], hands: [90, 90], hold: 0.08 })
        ];
      })(),
      // In 3D both hands are planted wide, and the chest travels over the
      // hand that bends while the other arm stays long.
      keys3d: (function () {
        var wide = { wide: { arms: [14.5, 14.5] } };
        var ang = lineForShoulderAt(PU_ANKLE, WRIST + 30.5);
        var top = { hip: line(PU_ANKLE, ang).hip, spine: ang, head: 12, arms: PU_ARMS, hands: PALMS, legs: PU_LEGS, d3: wide };
        return [
          top,
          pushLow({ d3: merge(wide, { shift: [5, 16, 0] }), hold: 0.08 }),
          top,
          pushLow({ d3: merge(wide, { shift: [-5, -16, 0] }), hold: 0.08 })
        ];
      })()
    },
    'box-pistols': {
      // Sit back to the chair on one leg, the other held out in front.
      cycle: 3.6,
      props: [{ box: [-38, -10, 25] }],
      keys: [
        standing({ arms: [[92, 92], [94, 94]], legs: [flat(1), [98, 98]], feet: [null, 30], d3: { shift: 4 } }),
        { hip: [-17, 32], spine: [34, 38], head: -26, arms: [[80, 82], [82, 84]], legs: [flat(4, 0, '+x'), [84, 86]], feet: [null, 20], d3: { shift: 3.5 } }
      ]
    },
    'planche-lean': {
      // Arms locked straight; the whole body slides forward so the shoulders
      // pass in front of the hands and the arms slant back. The balls of the
      // feet stay put; the ankles roll over them.
      cycle: 4.5,
      keys: (function () {
        var reach = LEN.upperArm + LEN.foreArm - 0.1;
        var sh = step([PU_HAND, WRIST], 22, reach);             // shoulder ahead of the hand
        var ang = 74;
        var hip = step(sh, ang + 180, LEN.spineLow + LEN.spineHigh);
        var ank = step(hip, ang + 180, LEN.thigh + LEN.shin);
        var arms = [ik(PU_HAND, WRIST, '+y'), ik(PU_HAND + 1, WRIST, '+y')];
        return [
          pushTop({ hands: [70, 70], d3: { handOut: [60, 60] } }),
          { hip: hip, spine: ang, head: 10, arms: arms, hands: [70, 70], legs: [onToes(ank, '+y', 190), onToes([ank[0] - 1, ank[1]], '+y', 190)], d3: { handOut: [60, 60] }, hold: 0.3 }
        ];
      })()
    },
    'nordic-negatives': {
      // Kneeling, heels anchored; lower forward as slowly as you can.
      cycle: 5,
      props: [{ bar: [-26, 11] }],
      keys: (function () {
        var knee = [0, KNEE];
        // The body pivots at the knee: keyframes every ~20° so the hips
        // travel on that arc and the knee stays on the floor.
        var at = function (deg, extra) {
          return merge({ hip: step(knee, deg, LEN.thigh), spine: deg, head: -deg * 0.2,
            arms: [[160 - deg, 40 + deg * 1.5], [165 - deg, 40 + deg * 1.5]], legs: [[deg + 180, 270], [deg + 180, 270]], feet: [270, 270] }, extra);
        };
        return [at(0, { hold: 0.1 }), at(20), at(40), at(58, { hold: 0.05 }), at(30)];
      })()
    },
    'tuck-l-sit': {
      // Hands pressing down on two chairs either side of the hips (seen here
      // just behind them), arms locked, shoulders pushed down; the feet leave
      // the floor and the knees come up — the hips hover, not sit.
      cycle: 4,
      props: [{ box: [-16, -8, 30], pair: true }],
      keys: (function () {
        var hand = [-10, 30.5];
        var sh = step(hand, 12, LEN.upperArm + LEN.foreArm - 0.1);
        var hip = [sh[0] + 1, sh[1] - LEN.spineLow - LEN.spineHigh];
        var arms = [ik(hand[0], hand[1], '-x'), ik(hand[0] - 1, hand[1], '-x')];
        return [
          { hip: hip, spine: -2, head: -4, shrug: 2, arms: arms, hands: [270, 270], legs: [flat(20, 0, '+y'), flat(19, 0, '+y')] },
          { hip: [hip[0], hip[1] + 2], spine: -4, head: -4, shrug: -1, arms: arms, hands: [270, 270], legs: [[56, 176], [58, 178]], feet: [130, 130], hold: 0.35 }
        ];
      })(),
      // In 3D there's room for the truth: a chair either side of the hips,
      // hands beside them, arms straight down.
      props3d: [{ box: [-6, 6, 30], pair: 14.5 }],
      keys3d: (function () {
        var hand = [0, 30.5], out = { abd: { arms: [8, 8] } };
        var hip = [0, hand[1] + LEN.upperArm + LEN.foreArm - 0.3 - LEN.spineLow - LEN.spineHigh];
        var arms = [ik(0, hand[1], '-x'), ik(0, hand[1], '-x')];
        return [
          { hip: hip, spine: 0, head: -4, shrug: 2, arms: arms, hands: [90, 90], legs: [flat(20, 0, '+y'), flat(19, 0, '+y')], d3: out },
          { hip: [hip[0], hip[1] + 2], spine: -2, head: -4, shrug: -1, arms: arms, hands: [90, 90], legs: [[40, 176], [42, 178]], feet: [130, 130], d3: out, hold: 0.35 }
        ];
      })()
    },

    /* ---------- Pull-up bar ---------- */

    'dead-hang': {
      cycle: 5,
      props: [{ rod: [0, BAR_Y] }],
      keys: [hanging(), hanging({ hip: [1.5, HANG_HIP[1]], spine: -1 })]
    },
    'scapular-pulls': {
      // Arms stay straight. Shoulders shrugged to the ears, then pulled down
      // — the body rises a few centimetres without the elbows bending.
      cycle: 2.8,
      props: [{ rod: [0, BAR_Y] }],
      keys: [
        hanging({ hip: [0, HANG_HIP[1] - 4], shrug: 4 }),
        hanging({ hip: [0, HANG_HIP[1] + 3.5], shrug: -3.5, head: -8, hold: 0.1 })
      ]
    },
    'pullup-negatives': {
      // Chin over the bar, lower as slowly as you can to a full hang, then
      // step up from a box in front of the bar back to the top.
      cycle: 6,
      still: 0,
      props: [{ rod: [0, BAR_Y] }, { box: [8, 32, 26] }],
      keys: [
        hanging(merge(OVER_BAR, { hold: 0.12 })),
        hanging({ legs: [[178, 190], [176, 188]], feet: [140, 140] }),
        hanging({ legs: [flat(18, 26, '+x'), flat(16, 26, '+x')], hip: [1, HANG_HIP[1] + 9], spine: -4, head: -10 })
      ]
    },
    'chin-ups': {
      cycle: 3,
      props: [{ rod: [0, BAR_Y] }],
      keys: [
        hanging({ legs: [[176, 178], [174, 178]] }),
        hanging(merge(OVER_BAR, { hold: 0.1 }))
      ]
    },
    'hanging-knee-raises': {
      // Knees up past hip height with a small curl of the pelvis; no swing.
      cycle: 3,
      props: [{ rod: [0, BAR_Y] }],
      keys: [
        hanging(),
        hanging({ hip: [-2, HANG_HIP[1] + 3], spine: [-14, -6], legs: [[68, 172], [70, 174]], feet: [100, 100], hold: 0.1 })
      ]
    },

    /* ---------- Express 15 ---------- */

    'mountain-climbers': {
      // High plank; each knee drives up toward the chest, foot off the floor,
      // the other leg long on its toes. The hips lift a little as the knee
      // comes through, as they do for real.
      cycle: 1.4,
      keys: [
        pushTop({ hip: [puTop.hip[0] + 1, puTop.hip[1] + 6], spine: PU_ANGLE + 4, legs: [arced(ik(puTop.hip[0] + 11, 17, '+x'), 10), onToes([PU_ANKLE[0] - 1, PU_ANKLE[1]], '+x', PU_FOOT)], feet: [150, null] }),
        pushTop({ hip: [puTop.hip[0] + 1, puTop.hip[1] + 6], spine: PU_ANGLE + 4, legs: [onToes(PU_ANKLE, '+x', PU_FOOT), arced(ik(puTop.hip[0] + 10, 17, '+x'), 10)], feet: [null, 150] })
      ]
    },

    /* ---------- Flexibility ---------- */

    'hip-switches': {
      // 90/90, seen from the front, sitting tall: the knees sweep from one
      // side to the other like windscreen wipers. Each side, one shin lies
      // across the front (its thigh toward you) and the other leg is out to
      // the side (its shin pointing back, away from you). In-between keys
      // route each shin up over its knee, as a real leg goes, rather than
      // through the floor.
      view: 'front',
      cycle: 5,
      keys: (function () {
        var base = merge(FRONT, { hip: [0, 9], spine: 0, head: 0, arms: [ik(7, 21, '-y'), ik(-7, 21, '-y')], hands: [300, 60] });
        var backNear = { sign: { legs: [[1, -1], [1, 1]] } }, backFar = { sign: { legs: [[1, 1], [1, -1]] } };
        var A = merge(base, { legs: [[94, 22], [232, 92]], legLen: [[1, 0.3], [0.3, 1]], feet: [22, 92], d3: backNear, hold: 0.1 });
        var B = merge(base, { legs: [[128, 268], [266, 338]], legLen: [[0.3, 1], [1, 0.3]], feet: [268, 338], d3: backFar, hold: 0.1 });
        var up = merge(base, { legs: [[32, 158], [328, 202]], feet: [110, 250] });
        var t1 = merge(base, { legs: [[62, 95], [290, 20]], legLen: [[1, 0.7], [0.7, 1]], feet: [60, 20], d3: backNear });
        var t2 = merge(base, { legs: [[80, 20], [300, 270]], legLen: [[0.7, 1], [1, 0.7]], feet: [20, 270], d3: backFar });
        return [A, t1, up, t2, B, t2, up, t1];
      })(),
      // In 3D: feet planted wide in front, and both knees swing over
      // together about the line from hip to foot, like windscreen wipers.
      view3d: 'front',
      keys3d: (function () {
        var base = merge(FRONT, { hip: [0, 9], spine: 0, head: 0,
          arms: [[172, 180], [188, 180]], armLen: [[0.88, 0.88], [0.88, 0.88]], hands: [180, 180],
          legs: [[32.7, 156], [327.3, 204]], legLen: [[0.664, 0.82], [0.664, 0.82]], feet: [90, 270] });
        var arms = { sign: { arms: [[-1, -1], [-1, -1]] }, toeOut: [70, 70] };
        return [
          merge(base, { d3: merge(arms, { flare: { legs: [78, -78] }, twist: -12 }), hold: 0.2 }),
          merge(base, { d3: merge(arms, { flare: { legs: [-78, 78] }, twist: 12 }), hold: 0.2 })
        ];
      })()
    },
    'hip-flexor': {
      // Half-kneeling; tuck the tail and press the hips forward, torso tall.
      cycle: 4.5,
      keys: [
        { hip: [-4, 29.5], spine: 0, head: -2, arms: [[182, 176], [178, 184]], legs: [flat(21, 0, '+y'), ik(-30, KNEE + 0.5, '-y')], feet: [null, 270] },
        { hip: [3, 28.5], spine: 0, head: -2, arms: [[182, 176], [178, 184]], legs: [flat(21, 0, '+y'), ik(-30, KNEE + 0.5, '-y')], feet: [null, 270], hold: 0.25 }
      ]
    },
    'adductor-rock-backs': {
      // All fours with one leg straight out to the side (toward you, so it
      // looks short), foot flat; rock the hips back toward the heel.
      cycle: 4,
      keys: (function () {
        // How short the straight leg is drawn so its foot is on the floor.
        var sideLeg = function (hip, a) { return (hip[1] - ANKLE - 1.2) / (-Math.cos(a * Math.PI / 180) * (LEN.thigh + LEN.shin)); };
        var back = step([0, KNEE], 318, LEN.thigh);
        return [
        fours({ legs: [[160, 160], Q_LEGS[1]], legLen: [[sideLeg(Q_HIP, 160), sideLeg(Q_HIP, 160)], [1, 1]], feet: [66, 270] }),
        fours({ hip: back, spine: 58, head: 18, legs: [[130, 130], [142, 270]], legLen: [[sideLeg(back, 130), sideLeg(back, 130)], [1, 1]], feet: [78, 270], hold: 0.15 })
        ];
      })()
    },
    straddle: {
      // Seen from the front: legs wide in a V, then hinge forward from the
      // hips with a long back — the torso comes toward you.
      view: 'front',
      cycle: 5,
      keys: (function () {
        // The legs are a ~110° V: out to the sides and forward, toward you,
        // so drawn a little short.
        var base = merge(FRONT, { hip: [0, 7.5], legs: [[93, 93], [267, 267]], legLen: [[0.82, 0.82], [0.82, 0.82]], feet: [4, 356],
          arms: [ik(14, WRIST, '+y'), ik(-14, WRIST, '+y')], hands: [90, 270] });
        return [
          merge(base, { spine: 0 }),
          merge(base, { spine: 0, spineLen: 0.62, head: 0, arms: [ik(22, WRIST, '+y'), ik(-22, WRIST, '+y')], hold: 0.25 })
        ];
      })()
    },
    'knee-to-wall-rocks': {
      // Half-kneeling at a wall; the front knee drives forward over the toes.
      cycle: 2.6,
      props: [{ wall: 42 }],
      keys: [
        { hip: [2, 29.5], spine: 8, arms: [ik(39.5, 50, '-y'), ik(39.5, 48, '-y')], hands: [0, 0], legs: [flat(24, 0, '+y'), ik(-22, KNEE + 0.5, '-y')], feet: [null, 270] },
        { hip: [11, 29], spine: 12, arms: [ik(39.5, 50, '-y'), ik(39.5, 48, '-y')], hands: [0, 0], legs: [flat(24, 0, '+x'), ik(-14, KNEE + 0.5, '-y')], feet: [null, 270] }
      ]
    },
    'knee-to-wall-hold': {
      cycle: 6,
      props: [{ wall: 42 }],
      keys: [
        { hip: [11, 29], spine: 12, arms: [ik(39.5, 50, '-y'), ik(39.5, 48, '-y')], hands: [0, 0], legs: [flat(24, 0, '+x'), ik(-14, KNEE + 0.5, '-y')], feet: [null, 270] },
        { hip: [12, 28.7], spine: 13, arms: [ik(39.5, 50, '-y'), ik(39.5, 48, '-y')], hands: [0, 0], legs: [flat(24, 0, '+x'), ik(-13, KNEE + 0.5, '-y')], feet: [null, 270] }
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
      // Hands and knees stay put: round the whole back up and tuck the chin,
      // then let the belly sink and look forward.
      cycle: 5,
      keys: [
        fours({ spine: [Q_SPINE - 24, Q_SPINE + 30], head: 44, hold: 0.12 }),
        fours({ spine: [Q_SPINE + 24, Q_SPINE - 18], head: -34, hold: 0.12 })
      ]
    },
    'open-book': {
      // Lying on your side, knees stacked; the top arm opens across to the
      // other side, following the eyes. Drawn from above in 2D; in 3D it is
      // the real thing: a figure on its back, knees and arms up, rolled onto
      // its side, the top arm swinging over.
      cycle: 5,
      floor: false,
      keys: [
        { hip: [0, 0], spine: 270, head: 0, turn: 0.6, arms: [[2, 0], [358, 0]], hands: [0, 0], legs: [[0, 90], [2, 92]], feet: [0, 2] },
        { hip: [0, 0], spine: 270, head: 0, turn: -0.4, arms: [[268, 270], [358, 0]], hands: [270, 0], legs: [[0, 90], [2, 92]], feet: [0, 2] },
        { hip: [0, 0], spine: 270, head: 0, turn: -1, arms: [[186, 182], [358, 0]], hands: [182, 0], legs: [[0, 90], [2, 92]], feet: [0, 2], hold: 0.15 }
      ],
      keys3d: (function () {
        var base = onBack({ legs: [[0, 90], [0, 90]], feet: [0, 0], arms: [[0, 0], [0, 0]], hands: [0, 0], head: 0 });
        return [
          merge(base, { turn: 1, d3: { roll: 90, twistArms: [0, 1] } }),
          merge(base, { turn: 0.4, d3: { roll: 90, abd: { arms: [0, 50] }, twist: 45, twistArms: [0, 1] } }),
          merge(base, { turn: -0.3, d3: { roll: 90, abd: { arms: [0, 95] }, twist: 88, twistArms: [0, 1] }, hold: 0.15 })
        ];
      })()
    },
    'childs-pose': {
      // Knees folded fully, hips sitting back on the heels — the highest point
      // — torso sloping down over the thighs, forehead to the floor, arms long.
      cycle: 5,
      keys: (function () {
        var knee = [0, KNEE];
        var hip = step(knee, 293, LEN.thigh);
        var legs = [[113, 270], [113, 270]];
        return [
          { hip: hip, spine: [98, 104], head: -10, arms: [ik(46, WRIST, '+y'), ik(45, WRIST, '+y')], hands: PALMS, legs: legs, feet: [270, 270] },
          { hip: [hip[0] - 0.4, hip[1] - 0.5], spine: [99, 105], head: -10, arms: [ik(46, WRIST, '+y'), ik(45, WRIST, '+y')], hands: PALMS, legs: legs, feet: [270, 270] }
        ];
      })()
    },
    'focus-stretch': {
      // One leg long, the other foot to the inner thigh; hinge from the hips
      // over the long leg, back long, hands to the shin.
      cycle: 5,
      keys: [
        seated({ legs: [[90, 90], [68, 248]], feet: [5, 96], arms: [ik(22, 12, '-y'), ik(10, WRIST, '-x')], hands: [90, 90], d3: FOCUS_3D }),
        seated({ spine: [46, 52], head: 6, legs: [[90, 90], [68, 248]], feet: [5, 96], arms: [ik(34, 10, '+y'), ik(33, 10, '+y')], hands: [95, 95], d3: FOCUS_3D, hold: 0.25 })
      ]
    },

    /* ---------- Morning stretch ---------- */

    'neck-circles': {
      // Chin to chest, then roll ear toward one shoulder and the other —
      // half-circles only, never tipping the head back.
      cycle: 6,
      still: 0,
      keys: [
        standing({ head: 44, turn: 1, hold: 0.1 }),
        standing({ head: 16, turn: 0.35 }),
        standing({ head: 0, turn: 0 }),
        standing({ head: 16, turn: -0.35 })
      ],
      // The drawing turns the head to show the roll; in 3D it really rolls:
      // chin to chest, ear toward one shoulder, back through the chin, the
      // other ear — face forward throughout.
      keys3d: [
        standing({ head: 40, hold: 0.1 }),
        standing({ head: 10, d3: { tilt: 36 } }),
        standing({ head: 40 }),
        standing({ head: 10, d3: { tilt: -36 } })
      ],
      still3d: 1
    },
    'shoulder-rolls': {
      // Up to the ears, back, and down.
      cycle: 2.6,
      keys: [
        standing({ roll: 5.5, arms: [[174, 170], [180, 176]] }),
        standing({ shrug: 8, roll: 1 }),
        standing({ roll: -5.5, arms: [[190, 186], [196, 192]] }),
        standing({ shrug: -2.5 })
      ]
    },
    'reach-side-bend': {
      // Seen from the front: reach tall, then bend over to one side and the
      // other, hips level — a side bend, not a backbend.
      view: 'front',
      cycle: 7,
      keys: (function () {
        var base = standing(merge(FRONT, { legs: [[172, 180], [188, 180]], feet: [92, 268] }));
        var up = merge(base, { arms: [[10, 4], [350, 356]], hands: [4, 356] });
        return [
          merge(base, { arms: [[172, 176], [188, 184]] }),
          up,
          merge(up, { spine: [352, 332], head: -8, arms: [[322, 312], [322, 312]], hands: [312, 312], hold: 0.12 }),
          up,
          merge(up, { spine: [8, 28], head: 8, arms: [[38, 48], [38, 48]], hands: [48, 48], hold: 0.12 })
        ];
      })()
    },
    'hip-circles': {
      // Hands on hips; the hips trace a slow circle.
      cycle: 3.4,
      keys: (function () {
        var arms = function (hx) { return [ik(hx + 4, 57, '-x'), ik(hx + 3, 57, '-x')]; };
        return [
          { hip: [5, 53], spine: -5, arms: arms(5), legs: [flat(1), flat(-1)] },
          { hip: [0, 51.5], spine: 0, arms: arms(0), legs: [flat(1), flat(-1)], d3: { shift: [6, 1.5] } },
          { hip: [-5, 53], spine: 6, arms: arms(-5), legs: [flat(1), flat(-1)] },
          { hip: [0, 54], spine: 0, arms: arms(0), legs: [flat(1), flat(-1)], d3: { shift: [-6, -1.5] } }
        ];
      })()
    },
    ragdoll: {
      // A hairpin: legs long with soft knees, the low back rounding forward
      // over the hips and the upper back hanging, so the trunk falls in front
      // of the thighs; head toward the shins, holding the elbows; sway.
      cycle: 5,
      keys: [
        { hip: [-6, 52], spine: [115, 172], head: 5, arms: [[178, 92], [182, 268]], armLen: [[1, 0.35], [1, 0.35]], hands: [92, 268], legs: [flat(-1), flat(-3)], d3: { sign: { arms: [[1, -1], [1, -1]] }, shift: [0.5, 4] } },
        { hip: [-5, 51.5], spine: [118, 180], head: 6, arms: [[186, 92], [190, 268]], armLen: [[1, 0.35], [1, 0.35]], hands: [92, 268], legs: [flat(-1), flat(-3)], d3: { sign: { arms: [[1, -1], [1, -1]] }, shift: [-0.5, -4] } }
      ]
    },
    'worlds-greatest': {
      // Long lunge, back knee straight and off the floor, both hands down
      // inside the front foot; drop the inside elbow to the instep; then
      // rotate and reach that same arm to the ceiling.
      cycle: 6.5,
      still: 2,
      keys: (function () {
        var legs = [flat(26, 0, '+y'), toes(-46, 0, 150, '+y')];
        var far = ik(24, WRIST, '+x');
        return [
          { hip: [0, 26], spine: 72, head: 10, arms: [ik(20, WRIST, '+x'), far], hands: PALMS, legs: legs, d3: WG_3D },
          { hip: [0, 24], spine: [78, 98], head: 28, arms: [ik(24, 12, '-y'), far], hands: [150, 90], legs: legs, d3: WG_3D, hold: 0.1 },
          { hip: [0, 26], spine: 64, head: -40, turn: 0.1, arms: [[4, 0], far], hands: [0, 90], legs: legs, d3: merge(WG_3D, { twist: -85, twistArms: [0, 0] }), hold: 0.15 }
        ];
      })()
    },

    /* ---------- Kama Stretcha ---------- */

    frog: {
      // On the forearms, knees wide, shins parallel behind; rock the hips back.
      // The thighs point out to the sides — toward you here, so drawn short —
      // which lets the hips sit low; the 3D figure swings them out.
      cycle: 5,
      keys: (function () {
        var knee = [0, KNEE];
        var at = function (hip, extra) {
          var dx = knee[0] - hip[0], dy = knee[1] - hip[1];
          var thigh = Math.sqrt(dx * dx + dy * dy) / LEN.thigh;
          var th = angleOf(dx, dy);
          // The spine slopes so the elbows stay on the floor however far back the hips go.
          var sa = Math.acos((WRIST + LEN.upperArm + 0.4 - hip[1]) / (LEN.spineLow + LEN.spineHigh)) * 180 / Math.PI;
          var sh = step(hip, sa, LEN.spineLow + LEN.spineHigh);
          var fore = [ik(sh[0] + LEN.foreArm, WRIST, '-y'), ik(sh[0] + LEN.foreArm + 1, WRIST, '-y')];
          return merge({ hip: hip, spine: sa, head: 16, arms: fore, hands: PALMS,
            legs: [[th, 270], [th, 270]], legLen: [[thigh, 1], [thigh, 1]], feet: [270, 270] }, extra);
        };
        return [at([1, KNEE + 10.5]), at([-11, KNEE + 7.5], { hold: 0.2 })];
      })()
    },
    'pigeon': {
      // Front shin across the mat (pointing toward you, so it looks short),
      // back leg long behind; sit tall, then fold forward over the front leg.
      cycle: 5.5,
      keys: [
        { hip: [0, 12], spine: 0, head: -2, arms: [ik(12, WRIST, '-x'), ik(-6, WRIST, '-x')], hands: PALMS,
          legs: [[104, 250], [263, 270]], legLen: [[1, 0.42], [1, 1]], feet: [310, 270], d3: { sign: { legs: [[1, -1], [1, 1]] } } },
        { hip: [0, 11], spine: [58, 80], head: 24, arms: [ik(46, WRIST, '+y'), ik(45, WRIST, '+y')], hands: PALMS,
          legs: [[104, 250], [263, 270]], legLen: [[1, 0.42], [1, 1]], feet: [310, 270], d3: { sign: { legs: [[1, -1], [1, 1]] } }, hold: 0.2 }
      ]
    },
    'happy-baby': {
      // Flat on your back, head down; knees wide toward the armpits, shins
      // straight up, soles to the ceiling, hands holding the feet; rock.
      cycle: 4.5,
      keys: (function () {
        var hip = [0, LYING];
        var pose = function (th, extra) {
          var ankle = step(step(hip, th, LEN.thigh), 0, LEN.shin);
          return merge({ hip: hip, spine: 270, head: 4,
            arms: [ik(ankle[0] - 1, ankle[1] - 3, '+y'), ik(ankle[0], ankle[1] - 3, '+y')], hands: [5, 5],
            legs: [[th, 0], [th + 1, 1]], feet: [270, 271], d3: { abd: { legs: [[42, 0], [42, 0]], arms: [21, 21] } } }, extra);
        };
        return [pose(292), pose(288, { hip: [0.6, LYING] })];
      })()
    },
    malasana: {
      // Deep squat, heels down, elbows pressing the knees apart.
      cycle: 5,
      // (In 3D: feet wider and turned out, knees over the toes, palms
      // together in the middle with the elbows inside the knees.)
      keys: [
        { hip: [-7, 17], spine: [14, 6], head: -6, arms: [[150, 20], [152, 22]], hands: [10, 12], legs: [flat(4, 0, '+x'), flat(3, 0, '+x')], d3: MALASANA_3D },
        { hip: [-7, 15], spine: [16, 8], head: -6, arms: [[152, 20], [154, 22]], hands: [10, 12], legs: [flat(4, 0, '+x'), flat(3, 0, '+x')], d3: MALASANA_3D }
      ]
    },
    'seated-fold': {
      // Sit tall, then hinge from the hips over straight legs with a long
      // back, hands sliding to the shins.
      cycle: 5,
      keys: [
        seated({ arms: [[10, 6], [6, 2]], hands: [4, 0], head: -4 }),
        seated({ spine: [48, 54], head: 6, arms: [ik(36, 10, '+y'), ik(35, 10, '+y')], hands: [95, 95], hold: 0.25 })
      ]
    },
    'butterfly-fold': {
      // Seen from the front: soles together, knees falling out to the sides —
      // a diamond — then the chest walks forward toward the feet.
      view: 'front',
      cycle: 5,
      keys: (function () {
        var base = merge(FRONT, { hip: [0, 9], legs: [[99, 268], [261, 92]], feet: [22, 338],
          arms: [ik(5, 11, '+y'), ik(-5, 11, '+y')], hands: [180, 180] });
        return [
          merge(base, { spine: 0 }),
          merge(base, { spine: 0, spineLen: 0.65, head: 0, hold: 0.25 })
        ];
      })(),
      // In 3D: knees wide and a little forward, feet together in front of
      // the hips; the hands hold the feet, elbows inside the knees, and the
      // chest walks forward toward them.
      keys3d: (function () {
        var feet = [[4.5, 5.5, 18.5], [-4.5, 5.5, 18.5]];
        var base = merge(FRONT, { hip: [0, 9], legs: [[95.2, 265], [264.8, 95]], legLen: [[0.876, 0.962], [0.876, 0.962]], feet: [270, 90],
          arms: [ik(-4.5, 12, '-x'), ik(4.5, 12, '+x')], hands: [180, 180] });
        var hold = { toeOut: [90, 90], at: { arms: [[6.5, 10, 21], [-6.5, 10, 21]] } };
        return [
          merge(base, { spine: 0, spineLen: 0.97, d3: hold }),
          merge(base, { spine: 0, spineLen: 0.68, head: 0, d3: hold, hold: 0.25 })
        ];
      })(),
      view3d: 'front'
    },
    'half-splits': {
      // Back knee down, front leg long, heel down; hips back, then fold.
      cycle: 5,
      keys: [
        { hip: [-4, 29.5], spine: 10, head: -2, arms: [ik(12, WRIST, '+x'), ik(13, WRIST, '+x')], hands: PALMS,
          legs: [ik(39, 5, '+y'), ik(-28, KNEE + 0.5, '-y')], feet: [0, 270] },
        { hip: [-6, 29], spine: [58, 74], head: 14, arms: [ik(28, WRIST, '+y'), ik(29, WRIST, '+y')], hands: PALMS,
          legs: [ik(37, 5, '+y'), ik(-30, KNEE + 0.5, '-y')], feet: [0, 270], hold: 0.2 }
      ]
    },
    'seated-twist': {
      // One knee up, the other leg tucked; twist toward the knee, eyes last.
      cycle: 5.5,
      keys: [
        seated({ head: -2, arms: [ik(-10, WRIST, '-x'), ik(20, 26, '-y')], hands: [270, 60], legs: [flat(20, 0, '+y'), [92, 262]], feet: [null, 270], d3: { twist: -10 } }),
        seated({ head: -6, turn: -0.9, d3: { twist: -50 }, spine: [0, 356], arms: [ik(-14, WRIST, '-x'), ik(24, 30, '-y')], hands: [270, 60], legs: [flat(20, 0, '+y'), [92, 262]], feet: [null, 270], hold: 0.25 })
      ]
    },
    'half-lotus': {
      // Seen from the front: one foot resting on top of the opposite thigh,
      // the other tucked under; knees dropping, hands on the knees, sit tall
      // then fold a little. The turn comes from the hip, not the knee.
      view: 'front',
      cycle: 5,
      keys: (function () {
        var base = merge(FRONT, { hip: [0, 9], legs: [[99, 276], [262, 90]], legLen: [[1, 0.9], [1, 0.85]], feet: [300, 60],
          arms: [ik(20, 9, '-y'), ik(-20, 9, '-y')], hands: [100, 260] });
        return [
          merge(base, { spine: 0 }),
          merge(base, { spine: 0, spineLen: 0.85, head: 0, hold: 0.25 })
        ];
      })(),
      // In 3D: the top foot really rests in the lap on the other thigh,
      // the lower foot tucked in under the top shin, hands on the knees.
      view3d: 'front',
      keys3d: (function () {
        var base = merge(FRONT, { hip: [0, 9], legs: [[109.4, 270], [254.9, 90]], legLen: [[0.36, 1], [0.613, 1]], feet: [270, 90],
          arms: [ik(4, 16, '-y'), ik(-4, 16, '-y')], hands: [180, 180] });
        var d3 = { at: { legs: [[-6, 13.5, 8], [5, 4.5, 20]], arms: [[13, 10, 20], [-18, 9, 17]] }, toeOut: [0, 60] };
        return [
          merge(base, { spine: 0, spineLen: 0.96, d3: d3 }),
          merge(base, { spine: 0, spineLen: 0.85, head: 0, d3: d3, hold: 0.25 })
        ];
      })()
    },
    'thread-needle': {
      // From all fours, one arm slides under the chest to the other side and
      // that shoulder and temple rest down; the other hand stays planted.
      cycle: 5,
      keys: [
        fours(),
        fours({ spine: [Q_SPINE + 8, 124], head: 34, turn: 0, arms: [arced(ik(Q_HAND - 8, WRIST + 1.5, '+x'), 6), ik(Q_HAND + 1, WRIST, '+x')],
          armLen: [[0.55, 0.55], [1, 1]], hands: [255, 90], d3: { sign: { arms: [[-1, -1], [1, 1]] }, twist: 35, faceZ: -1 }, hold: 0.25 })
      ]
    },
    'cobra': {
      // Face down, hands by the lower ribs, elbows hugging back; lift the
      // chest with the hips down (cobra), then press to straight arms with
      // the wrists under the shoulders (upward dog).
      cycle: 6,
      keys: [
        prone({ arms: [ik(20, WRIST, '-x'), ik(21, WRIST, '-x')], hands: PALMS }),
        prone({ spine: [82, 44], head: -16, arms: [ik(20, WRIST, '-x'), ik(21, WRIST, '-x')], hands: PALMS, hold: 0.1 }),
        prone({ hip: [-2, 12], spine: [62, 22], head: -20, arms: [ik(20, WRIST, '-x'), ik(21, WRIST, '-x')], hands: PALMS, legs: [[272, 272], [271, 271]], hold: 0.15 })
      ]
    },
    'camel': {
      // Kneeling tall, toes tucked (heels higher, easier to reach), hands on
      // the low back; hips press forward over the knees, the chest lifts up
      // and back, then the hands reach for the heels. The head follows, but
      // stays about level with the shoulders.
      cycle: 6,
      keys: (function () {
        var ank = ankleOnToes(-27, 0, 170);
        var legs = [onToes(ank, '-y', 170), onToes([ank[0] - 1, ank[1]], '-y', 170)];
        var heel = [ank[0] + 2, ank[1] + 3];
        return [
          { hip: [0, KNEE + LEN.thigh], spine: 0, head: -4, arms: [ik(-7, 34, '-y'), ik(-6, 33, '-y')], hands: [0, 0], legs: legs, hold: 0.1 },
          { hip: [5, KNEE + LEN.thigh - 0.6], spine: [334, 292], head: -6, arms: [ik(heel[0] + 1, heel[1] + 2, '-x'), ik(heel[0] + 2, heel[1] + 2, '-x')], hands: [180, 180], legs: legs, hold: 0.25 }
        ];
      })()
    },
    'plow': {
      // Shoulders on the floor, hips stacked over them. The legs go up once,
      // then over into plow and hold — not rolling back and forth.
      cycle: 9,
      keys: (function () {
        var sh = [-22, LYING], hip = [-21, LYING + LEN.spineLow + LEN.spineHigh - 0.5];
        var arms = [ik(10, WRIST, '+y'), ik(11, WRIST, '+y')];
        return [
          { hip: hip, shoulderAt: sh, head: 90, arms: arms, hands: PALMS, legs: [[4, 4], [6, 6]], feet: [14, 16] },
          { hip: hip, shoulderAt: sh, head: 90, arms: arms, hands: PALMS, legs: [ik(-66, 10, '+y'), ik(-67, 11, '+y')], feet: [215, 215], hold: 0.55 }
        ];
      })()
    },
    'pelvic-floor': {
      // On your back, knees bent, pelvis staying down: a slow lift and hold
      // from inside, then let go completely. Only the breath shows.
      cycle: 6,
      keys: [
        onBack({ hold: 0.2 }),
        onBack({ spine: [270, 268], head: 2, hold: 0.35 })
      ]
    },

    _default: {
      cycle: 4,
      keys: [standing(), standing({ spine: [1, 3], arms: [[186, 180], [174, 180]] })]
    }
  };

  /* The same moves, timed, in Express 15 — and the straddle fold. */
  /* Seated twist: the drawing shows the look over the shoulder by turning
   * the eye; in 3D the chest and head really turn toward the raised knee,
   * the head a little further, and the other elbow hooks the outside of
   * the knee, forearm upright. */
  (function (d) {
    var hand = [[21, 26, -6], [13, 43.5, 9.5]];
    d.keys3d = d.keys.map(function (k, i) {
      return merge(k, { turn: i ? 0.93 : 1, d3: { twist: i ? -55 : -10, twistArms: [1, 0], at: { arms: [0, hand[i]] } } });
    });
  })(FIGURES['seated-twist']);

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
    _at: function (id, phase) { return build(at(FIGURES[id], phase)); },
    /* What the 3D figure needs: a frame's joints (in the drawing's plane),
     * its 3D extras, the plane it was drawn in, props, and the rig. */
    frame: function (id, phase) {
      var def = def3(id);
      var r = at(def, phase);
      var sk = build(r);
      sk.d3 = blendD3(sk.d3 || {}, sk.d3 || {}, 0);     // fills in the neutral values
      return sk;
    },
    info: function (id) {
      var def = def3(id);
      return { view: def.view || 'side', props: def.props || [], floor: def.floor !== false, cycle: def.cycle || 3,
        still: def.still != null ? def.still : Math.min(1, def.keys.length - 1), keys: def.keys.length,
        yaw: def.yaw, grounded: !!def.grounded };
    },
    stillPhase: function (id) {
      var def = def3(id);
      return keyPhase(def, def.still != null ? def.still : Math.min(1, def.keys.length - 1));
    },
    rig: { LEN: LEN, WIDTH: WIDTH }
  };
})(window);
