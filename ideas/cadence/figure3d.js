/* Cadence — the exercise figure in 3D, turned with a drag.
 *
 * There is no second set of poses. Every figure is authored once, in
 * figures.js, as a 2D rig; this lifts each frame of it into 3D:
 *
 * - The body gets width: hips and shoulders sit apart across the body, so
 *   near and far limbs hang from their own sides.
 * - A bone the 2D figure draws shorter than it is (foreshortened — a leg
 *   out to the side, seen from the side) is pointing out of the drawing's
 *   plane, and by exactly how much: a bone drawn at 40% of its length has
 *   √(1 − 0.4²) of it pointing toward or away from you. So those poses come
 *   back into 3D on their own; `d3.sign` says toward or away.
 * - What the drawing can't say at all comes from `d3` (see figures.js):
 *   limbs swung out to the side (`abd`), elbows and knees turned out
 *   (`flare`), feet turned out (`toeOut`), a hand or foot put somewhere
 *   the drawing can't show (`wide`, `reach`, `at` — the limb is solved again
 *   in 3D), the weight shifted sideways (`shift`), the upper body twisted about the spine (`twist`), the head
 *   tipped (`tilt`), the whole body rolled onto its side (`roll`).
 *
 * three.js (vendor/, a subset, MIT) is loaded only when a 3D figure is first
 * shown. Until it arrives, and anywhere WebGL isn't available, the 2D figure
 * stands in.
 */
(function (global) {
  'use strict';

  var F = global.CadenceFigures;
  var SRC = 'vendor/three.cadence.min.js';

  /* ---------- loading ---------- */

  var loading = null;
  function load() {
    if (global.CadenceThree) return Promise.resolve(global.CadenceThree);
    if (!loading) {
      loading = new Promise(function (resolve, reject) {
        var s = document.createElement('script');
        s.src = SRC;
        s.async = true;
        s.onload = function () { global.CadenceThree ? resolve(global.CadenceThree) : reject(new Error('three.js missing')); };
        s.onerror = function () { loading = null; reject(new Error('three.js failed to load')); };
        document.head.appendChild(s);
      });
    }
    return loading;
  }

  var webgl = null;
  function supported() {
    if (webgl != null) return webgl;
    try {
      var c = document.createElement('canvas');
      webgl = !!(global.WebGLRenderingContext && (c.getContext('webgl2') || c.getContext('webgl')));
    } catch (e) {
      webgl = false;
    }
    return webgl;
  }

  /* ---------- vectors ---------- */

  function add(a, b) { return [a[0] + b[0], a[1] + b[1], a[2] + b[2]]; }
  function sub(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
  function mul(a, k) { return [a[0] * k, a[1] * k, a[2] * k]; }
  function dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
  function cross(a, b) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }
  function len(a) { return Math.sqrt(dot(a, a)); }
  function norm(a) { var l = len(a); return l > 1e-9 ? mul(a, 1 / l) : [0, 0, 0]; }

  /* Rodrigues: `p` turned `deg` about the line through `pivot` along `axis`. */
  function turnAbout(p, pivot, axis, deg) {
    if (!deg) return p;
    var k = norm(axis);
    if (!len(k)) return p;
    var r = deg * Math.PI / 180, c = Math.cos(r), s = Math.sin(r);
    var v = sub(p, pivot);
    var out = add(add(mul(v, c), mul(cross(k, v), s)), mul(k, dot(k, v) * (1 - c)));
    return add(out, pivot);
  }

  /* ---------- lifting a frame into 3D ---------- */

  var HIP_W = 5.2;         // hip joint, either side of the midline
  var SHOULDER_W = 9.5;    // shoulder joint, either side
  var R = {
    torsoLow: 5.4, torsoHigh: 6.2, pelvis: 5.4, girdle: 4.4, neck: 2.5, head: 6.5,
    thigh: 3.9, shin: 2.9, foot: 2.1, toe: 1.8,
    upperArm: 2.7, foreArm: 2.2, hand: 1.9
  };

  /* A `d3` value that may be missing, a number, or per side / per bone. */
  function pick(v, i, dflt) {
    if (v == null) return dflt;
    if (typeof v === 'number') return v;
    return v[i] == null ? dflt : v[i];
  }
  function across(a2, b2) {
    var dx = b2[0] - a2[0], dy = b2[1] - a2[1], l = Math.sqrt(dx * dx + dy * dy);
    return l > 3 ? [dy / l, -dx / l, 0] : [1, 0, 0];
  }

  /* Two-bone reach in 3D: from `o` toward `target`, the middle joint on the
   * side of `pole`. Out of reach, the limb points straight at the target. */
  function solve(o, target, l1, l2, pole, fallback) {
    var d = sub(target, o), dn = norm(d);
    var dist = Math.max(Math.abs(l1 - l2) + 0.01, Math.min(l1 + l2 - 0.001, len(d)));
    var a = (l1 * l1 - l2 * l2 + dist * dist) / (2 * dist);
    var h = Math.sqrt(Math.max(0, l1 * l1 - a * a));
    var pv = sub(sub(pole, o), mul(dn, dot(sub(pole, o), dn)));
    if (len(pv) < 1e-3) pv = cross(dn, fallback);
    return { mid: add(add(o, mul(dn, a)), mul(norm(pv), h)), end: add(o, mul(dn, dist)) };
  }

  function lift(sk, view, LEN) {
    var d3 = sk.d3 || {};
    // Across the body. From the side, that's straight out of the picture;
    // from the front, it's square to the spine in the picture, so a body
    // lying on its side (side plank) has its hips and shoulders stacked.
    var front = view === 'front';
    var hipAcross = front ? across(sk.hip, sk.waist) : [0, 0, 1];
    var shoulderAcross = front ? across(sk.waist, sk.shoulder) : [0, 0, 1];
    var SIDES = [1, -1];                        // near, far
    function P(p) { return [p[0], p[1], 0]; }

    /* The next joint: the drawn step in the plane, plus whatever length the
     * drawing lost, out of the plane. */
    function bone(from3, a2, b2, length, sign) {
      var dx = b2[0] - a2[0], dy = b2[1] - a2[1];
      var p = Math.sqrt(dx * dx + dy * dy);
      var dz = Math.sqrt(Math.max(0, length * length - p * p)) * sign;
      return [from3[0] + dx, from3[1] + dy, from3[2] + dz];
    }
    // Out of the plane defaults to "outward" for a limb seen from the side,
    // and "forward" (toward you) for one drawn from the front.
    function outSign(i) { return front ? 1 : SIDES[i]; }
    function sign(part, i, j) { return pick(pick(d3.sign && d3.sign[part], i, 1), j, 1); }

    var spineSign = pick(d3.sign && d3.sign.spine, 0, 1);
    var hip = P(sk.hip);
    var waist = bone(hip, sk.hip, sk.waist, LEN.spineLow, spineSign);
    var shoulder = bone(waist, sk.waist, sk.shoulder, LEN.spineHigh, spineSign);
    var neckTop = bone(shoulder, sk.shoulder, sk.neckTop, LEN.neck, 1);
    var head = bone(neckTop, sk.neckTop, sk.head, LEN.headR, 1);

    // Where the face points: in the drawing's plane, square to the neck,
    // turned toward you as `turn` goes from 1 to 0 (away with faceZ -1).
    var n2 = norm([sk.head[0] - sk.neckTop[0], sk.head[1] - sk.neckTop[1], 0]);
    var turn = sk.turn == null ? 1 : sk.turn;
    var faceZ = pick(d3.faceZ, 0, 1);
    var face = norm(add(mul([n2[1], -n2[0], 0], turn), mul([0, 0, faceZ], Math.sqrt(Math.max(0, 1 - turn * turn)))));
    var up = norm(sub(head, neckTop));

    // The head tipped toward a shoulder, about the line of the face.
    var tilt = pick(d3.tilt, 0, 0);
    if (tilt) {
      var tl = function (p) { return turnAbout(p, shoulder, face, tilt); };
      neckTop = tl(neckTop); head = tl(head);
      up = norm(sub(head, neckTop));
    }

    // Weight shifted sideways: `shift` moves the pelvis, or [pelvis, chest,
    // hands] — the hands go with the chest unless they're planted; the feet
    // always stay where they are.
    var sp = pick(d3.shift, 0, 0), sc = pick(d3.shift, 1, sp), sh = pick(d3.shift, 2, sc);
    function mv(p, d, across3) { return d ? add(p, mul(across3 || hipAcross, d)) : p; }
    var hip0 = hip;
    hip = mv(hip, sp);
    waist = mv(waist, (sp + sc) / 2);
    shoulder = mv(shoulder, sc, shoulderAcross); neckTop = mv(neckTop, sc, shoulderAcross); head = mv(head, sc, shoulderAcross);

    var rootOff = [sk.root[0] - sk.shoulder[0], sk.root[1] - sk.shoulder[1], 0];
    var arms = [], legs = [];
    for (var i = 0; i < 2; i++) {
      var a2 = sk.arms[i], l2 = sk.legs[i];
      var outA = mul(shoulderAcross, SIDES[i]), outL = mul(hipAcross, SIDES[i]);

      var root = add(add(shoulder, rootOff), mul(shoulderAcross, SHOULDER_W * SIDES[i]));
      var elbow = bone(root, sk.root, a2.elbow, LEN.upperArm, sign('arms', i, 0) * outSign(i));
      var wrist = bone(elbow, a2.elbow, a2.wrist, LEN.foreArm, sign('arms', i, 1) * outSign(i));
      var fingers = bone(wrist, a2.wrist, a2.fingers, LEN.hand, sign('arms', i, 1) * outSign(i));
      var arm = { root: root, elbow: elbow, wrist: wrist, fingers: fingers };
      retarget(arm, 'root', 'elbow', 'wrist', ['fingers'], LEN.upperArm, LEN.foreArm, outA, 'arms', i, mv(wrist, sh - sc, shoulderAcross), elbow);

      var hj0 = add(hip0, mul(hipAcross, HIP_W * SIDES[i]));
      var knee = bone(hj0, sk.hip, l2.knee, LEN.thigh, sign('legs', i, 0) * outSign(i));
      var ankle = bone(knee, l2.knee, l2.ankle, LEN.shin, sign('legs', i, 1) * outSign(i));
      var drop = sub(ankle, P(l2.ankle));
      var leg = { hip: mv(hj0, sp), knee: knee, ankle: ankle,
        heel: add(P(l2.heel), drop), ball: add(P(l2.ball), drop), toe: add(P(l2.toe), drop) };
      retarget(leg, 'hip', 'knee', 'ankle', ['heel', 'ball', 'toe'], LEN.thigh, LEN.shin, outL, 'legs', i, ankle, mv(knee, sp / 2));

      limb3(arm, 'root', 'elbow', 'wrist', ['fingers'], outA, 'arms', i);
      limb3(leg, 'hip', 'knee', 'ankle', ['heel', 'ball', 'toe'], outL, 'legs', i);

      // Feet and hands turned out, about the upright through the ankle or wrist.
      turnOut(leg, 'ankle', ['heel', 'ball', 'toe'], 'heel', 'ball', pick(d3.toeOut, i, 0), outL, i);
      turnOut(arm, 'wrist', ['fingers'], 'wrist', 'fingers', pick(d3.handOut, i, 0), outA, i);
      arms.push(arm);
      legs.push(leg);
    }

    /* Where the hand or foot ends up, if not where the drawing put it: moved
     * out to its side (`wide`), moved by a vector (`reach`), or put at a
     * point (`at`, in the figure's own frame). The elbow or knee is solved
     * again in 3D, on the side it was on. */
    function retarget(limb, rootK, midK, endK, tail, l1, l2, out, part, i, end, pole) {
      var at = d3.at && d3.at[part] && d3.at[part][i];
      var w = pick(d3.wide && d3.wide[part], i, 0);
      var r = d3.reach && d3.reach[part] && d3.reach[part][i];
      var target = at && at.length === 3 ? at.slice() : add(add(end, mul(out, w)), r && r.length === 3 ? r : [0, 0, 0]);
      var moved = len(sub(target, limb[endK])) > 1e-3;
      var rootMoved = len(sub(pole, limb[midK])) > 1e-3;
      if (!moved && !rootMoved) return;
      var m = solve(limb[rootK], target, l1, l2, pole, out);
      var dEnd = sub(m.end, limb[endK]);
      tail.forEach(function (k) { limb[k] = add(limb[k], dEnd); });
      limb[midK] = m.mid;
      limb[endK] = m.end;
    }

    function turnOut(limb, pivotK, keys, fromK, toK, deg, out, i) {
      if (!deg) return;
      var fwd = sub(limb[toK], limb[fromK]);
      var t = dot(cross([0, 1, 0], norm(fwd)), out);
      var k = Math.abs(t) > 0.2 ? (t > 0 ? 1 : -1) : front ? SIDES[i] : -SIDES[i];
      keys.forEach(function (key) { limb[key] = turnAbout(limb[key], limb[pivotK], [0, 1, 0], deg * k); });
    }

    /* A limb swung out to its side (`abd`: the whole limb, or [upper,
     * lower] with the lower part swung on its own about the elbow or knee),
     * then its middle joint turned out about the line to its end (`flare`),
     * which stays where it is. */
    function limb3(limb, rootK, midK, endK, tail, out, part, i) {
      var ab = d3.abd && d3.abd[part] ? pick(d3.abd[part], i, 0) : 0;
      var up = pick(ab, 0, 0), lo = pick(ab, 1, up);
      var below = [midK, endK].concat(tail), lower = [endK].concat(tail);
      var axis = cross(norm(sub(limb[midK], limb[rootK])), out);
      if (len(axis) > 1e-3) {
        if (up) below.forEach(function (k) { limb[k] = turnAbout(limb[k], limb[rootK], axis, up); });
        if (lo - up) lower.forEach(function (k) { limb[k] = turnAbout(limb[k], limb[midK], axis, lo - up); });
      }
      var fl = pick(d3.flare && d3.flare[part], i, 0);
      if (fl) {
        var ax = sub(limb[endK], limb[rootK]);
        var v = sub(limb[midK], limb[rootK]);
        var perp = sub(v, mul(norm(ax), dot(v, norm(ax))));
        if (len(perp) > 0.5 && len(ax) > 1e-3) {
          var s = dot(cross(norm(ax), perp), out) >= 0 ? 1 : -1;
          limb[midK] = turnAbout(limb[midK], limb[rootK], ax, fl * s);
        }
      }
    }

    var body = { hip: hip, waist: waist, shoulder: shoulder, neckTop: neckTop, head: head, face: face, up: up, arms: arms, legs: legs };

    // The whole body rolled onto its side, about its long axis (x), then set
    // back down on the floor.
    var rollDeg = pick(d3.roll, 0, 0);
    if (rollDeg) {
      var X = [1, 0, 0], pivot = body.hip;
      var roll = function (p) { return turnAbout(p, pivot, X, rollDeg); };
      eachPoint(body, roll);
      body.face = sub(roll(add(pivot, body.face)), pivot);
      body.up = sub(roll(add(pivot, body.up)), pivot);
      var low = Infinity;
      segments(body).forEach(function (s) { low = Math.min(low, s[0][1] - s[2], s[1][1] - s[2]); });
      if (isFinite(low)) eachPoint(body, function (p) { return [p[0], p[1] - low, p[2]]; });
    }

    // The upper body twisted about the spine, after the body is set down,
    // so a twist never lifts it off the floor. `twistArms` says how much
    // each arm goes with it.
    var twist = pick(d3.twist, 0, 0);
    if (twist) {
      var h0 = body.hip, axis = sub(body.shoulder, body.hip);
      var tw = function (p, deg) { return turnAbout(p, h0, axis, deg == null ? twist : deg); };
      var f0 = body.face, u0 = body.up;
      body.neckTop = tw(body.neckTop);
      body.head = tw(body.head);
      body.face = sub(tw(add(h0, f0)), h0);
      body.up = sub(tw(add(h0, u0)), h0);
      // An arm that stays behind (a planted hand) still has its shoulder
      // carried round; its elbow is solved again to reach the hand.
      arms.forEach(function (a, j) {
        var w = pick(d3.twistArms, j, 1);
        a.root = tw(a.root);
        ['elbow', 'wrist', 'fingers'].forEach(function (k) { a[k] = tw(a[k], twist * w); });
        if (w !== 1) {
          // (the elbow lifted a little, so it bends up off the floor)
          var m = solve(a.root, a.wrist, LEN.upperArm, LEN.foreArm, add(a.elbow, [0, 6, 0]), [0, 1, 0]);
          var d = sub(m.end, a.wrist);
          a.elbow = m.mid; a.wrist = m.end; a.fingers = add(a.fingers, d);
        }
      });
    }
    return body;
  }

  function eachPoint(body, fn) {
    ['hip', 'waist', 'shoulder', 'neckTop', 'head'].forEach(function (k) { body[k] = fn(body[k]); });
    body.arms.forEach(function (a) { ['root', 'elbow', 'wrist', 'fingers'].forEach(function (k) { a[k] = fn(a[k]); }); });
    body.legs.forEach(function (l) { ['hip', 'knee', 'ankle', 'heel', 'ball', 'toe'].forEach(function (k) { l[k] = fn(l[k]); }); });
  }

  /* The body as capsules: [from, to, radius]. */
  function segments(b) {
    var s = [
      [b.hip, b.waist, R.torsoLow], [b.waist, b.shoulder, R.torsoHigh],
      [b.legs[0].hip, b.legs[1].hip, R.pelvis], [b.arms[0].root, b.arms[1].root, R.girdle],
      [b.shoulder, b.neckTop, R.neck]
    ];
    b.legs.forEach(function (l) {
      s.push([l.hip, l.knee, R.thigh], [l.knee, l.ankle, R.shin], [l.ankle, l.heel, R.foot], [l.heel, l.ball, R.foot], [l.ball, l.toe, R.toe]);
    });
    b.arms.forEach(function (a) {
      s.push([a.root, a.elbow, R.upperArm], [a.elbow, a.wrist, R.foreArm], [a.wrist, a.fingers, R.hand]);
    });
    return s;
  }

  /* ---------- drawing ---------- */

  function cssColor(name, fallback) {
    var v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return v || fallback;
  }

  function scene3(T, id, opts, host) {
    var info = F.info(id);
    var LEN = F.rig.LEN;
    var view = info.view;

    var renderer = new T.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'low-power' });
    renderer.setPixelRatio(Math.min(2, global.devicePixelRatio || 1));
    renderer.outputColorSpace = T.SRGBColorSpace;
    var canvas = renderer.domElement;
    canvas.className = 'fig3d-canvas';
    canvas.setAttribute('aria-hidden', 'true');

    var scene = new T.Scene();
    var camera = new T.PerspectiveCamera(26, 1, 1, 4000);
    scene.add(camera);
    scene.add(new T.HemisphereLight(0xffffff, 0x8a8178, 1.5));
    var key = new T.DirectionalLight(0xffffff, 1.7);
    key.position.set(-0.6, 1, 0.8);
    camera.add(key);                               // the light turns with you

    var bodyMat = new T.MeshStandardMaterial({ color: new T.Color(cssColor('--accent', '#b3542e')), roughness: 0.55, metalness: 0 });
    var eyeMat = new T.MeshBasicMaterial({ color: new T.Color(cssColor('--card-2', '#f4f2ee')) });
    var propMat = new T.MeshStandardMaterial({ color: new T.Color(cssColor('--line-strong', '#d6d2ca')), roughness: 0.9 });
    var wallMat = new T.MeshStandardMaterial({ color: new T.Color(cssColor('--line-strong', '#d6d2ca')), roughness: 0.9, transparent: true, opacity: 0.45, depthWrite: false });
    // Unlit, so the floor stays the page's own quiet line colour at any angle.
    var floorMat = new T.MeshBasicMaterial({ color: new T.Color(cssColor('--line', '#e5e2dc')) });

    var cylGeo = new T.CylinderGeometry(1, 1, 1, 18, 1, true);
    var sphGeo = new T.SphereGeometry(1, 18, 12);
    var boxGeo = new T.BoxGeometry(1, 1, 1);
    var geos = [cylGeo, sphGeo, boxGeo];

    var figure = new T.Group();
    scene.add(figure);

    // Enough meshes for one frame, reused every frame.
    var sample = segments(lift(F.frame(id, 0), view, LEN));
    var parts = sample.map(function () {
      var cyl = new T.Mesh(cylGeo, bodyMat), a = new T.Mesh(sphGeo, bodyMat), b = new T.Mesh(sphGeo, bodyMat);
      figure.add(cyl); figure.add(a); figure.add(b);
      return { cyl: cyl, a: a, b: b };
    });
    var headMesh = new T.Mesh(sphGeo, bodyMat);
    var noseMesh = new T.Mesh(sphGeo, bodyMat);
    var eyes = [new T.Mesh(sphGeo, eyeMat), new T.Mesh(sphGeo, eyeMat)];
    figure.add(headMesh); figure.add(noseMesh); eyes.forEach(function (e) { figure.add(e); });

    var Y = new T.Vector3(0, 1, 0), tmp = new T.Vector3();
    function place(frame) {
      var body = lift(frame, view, LEN);
      segments(body).forEach(function (s, i) {
        var p = parts[i], a = s[0], b = s[1], r = s[2];
        var d = sub(b, a), l = len(d);
        p.cyl.position.set((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2);
        p.cyl.scale.set(r, Math.max(l, 0.001), r);
        if (l > 1e-6) p.cyl.quaternion.setFromUnitVectors(Y, tmp.set(d[0] / l, d[1] / l, d[2] / l));
        p.a.position.set(a[0], a[1], a[2]); p.a.scale.setScalar(r);
        p.b.position.set(b[0], b[1], b[2]); p.b.scale.setScalar(r);
      });
      var hd = body.head, f = body.face, u = body.up;
      var side = norm(cross(u, f));
      headMesh.position.set(hd[0], hd[1], hd[2]); headMesh.scale.setScalar(R.head);
      var nose = add(hd, mul(f, R.head * 0.95));
      noseMesh.position.set(nose[0], nose[1], nose[2]); noseMesh.scale.setScalar(1.5);
      [-1, 1].forEach(function (k, j) {
        var e = add(add(add(hd, mul(f, R.head * 0.8)), mul(side, 2.3 * k)), mul(u, 1.6));
        eyes[j].position.set(e[0], e[1], e[2]); eyes[j].scale.setScalar(1.05);
      });
      return body;
    }

    /* Framing: one box around every frame of the loop, so turning or
     * playing never walks the figure out of view. */
    var lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    function grow(p, r) { for (var k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], p[k] - r); hi[k] = Math.max(hi[k], p[k] + r); } }
    for (var s = 0; s < 24; s++) {
      var b = lift(F.frame(id, s / 24), view, LEN);
      segments(b).forEach(function (seg) { grow(seg[0], seg[2]); grow(seg[1], seg[2]); });
      grow(b.head, R.head);
    }

    // Props, in the 3D sense of the 2D ones.
    info.props.forEach(function (pr) {
      var m;
      if (pr.box) {
        // `pair`: one either side of the body (at ±pair, or the shoulders).
        var depth = pr.pair ? 6 : 26, pz = typeof pr.pair === 'number' ? pr.pair : SHOULDER_W;
        (pr.pair ? [-pz, pz] : [0]).forEach(function (z) {
          m = new T.Mesh(boxGeo, propMat);
          m.scale.set(pr.box[1] - pr.box[0], pr.box[2], depth);
          m.position.set((pr.box[0] + pr.box[1]) / 2, pr.box[2] / 2, z);
          scene.add(m);
          grow([pr.box[0], pr.box[2], z - depth / 2], 0); grow([pr.box[1], 0, z + depth / 2], 0);
        });
      }
      if (pr.rod) {
        m = new T.Mesh(cylGeo, propMat);
        m.scale.set(1.3, 40, 1.3);
        m.rotation.x = Math.PI / 2;
        m.position.set(pr.rod[0], pr.rod[1], 0);
        scene.add(m);
        grow([pr.rod[0], pr.rod[1], -20], 2); grow([pr.rod[0], pr.rod[1], 20], 2);
      }
      if (pr.bar) {
        // A table: its top edge where the 2D figure draws a line.
        m = new T.Mesh(boxGeo, propMat);
        m.scale.set(30, 2.4, 40);
        m.position.set(pr.bar[0] - 12, pr.bar[1], 0);
        scene.add(m);
        grow([pr.bar[0] - 27, pr.bar[1], -20], 0); grow([pr.bar[0] + 3, pr.bar[1], 20], 0);
      }
      if (pr.wall != null) {
        // See-through, so turning to look from behind the wall still works.
        m = new T.Mesh(boxGeo, wallMat);
        m.scale.set(1.5, 130, 60);
        m.position.set(pr.wall + (pr.wall > 0 ? 0.75 : -0.75), 65, 0);
        scene.add(m);
      }
    });

    var center = [(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, (lo[2] + hi[2]) / 2];
    var radius = 0.5 * Math.sqrt(Math.pow(hi[0] - lo[0], 2) + Math.pow(hi[1] - lo[1], 2) + Math.pow(hi[2] - lo[2], 2));

    if (info.floor) {
      var floor = new T.Mesh(new T.CircleGeometry(1, 48), floorMat);
      geos.push(floor.geometry);
      floor.rotation.x = -Math.PI / 2;
      floor.scale.setScalar(radius * 1.05);
      floor.position.set(center[0], -0.05, center[2]);
      scene.add(floor);
    }

    /* The view: side-view figures start from three-quarters in front of
     * the near side, so depth shows from the first frame; you turn it
     * from there. */
    var orbit = {
      yaw: opts.yaw != null ? opts.yaw : info.yaw != null ? info.yaw : view === 'front' ? 22 : 32,
      pitch: opts.pitch != null ? opts.pitch : 14
    };
    function aim(w, h) {
      var fov = camera.fov * Math.PI / 180;
      var fit = Math.max(radius / Math.sin(fov / 2), radius / Math.sin(Math.atan(Math.tan(fov / 2) * (w / h || 1))));
      var d = fit * 1.1;
      var y = orbit.yaw * Math.PI / 180, p = orbit.pitch * Math.PI / 180;
      camera.position.set(center[0] + d * Math.sin(y) * Math.cos(p), center[1] + d * Math.sin(p), center[2] + d * Math.cos(y) * Math.cos(p));
      camera.lookAt(center[0], center[1], center[2]);
    }

    var size = { w: 0, h: 0 };
    function resize() {
      var w = host.clientWidth || 300, h = host.clientHeight || 150;
      if (w === size.w && h === size.h) return;
      size = { w: w, h: h };
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    }

    var still = opts.still || typeof opts.phase === 'number' || (global.matchMedia && global.matchMedia('(prefers-reduced-motion: reduce)').matches);
    // A still shows the working end of the movement, unless a phase is asked for.
    var stillPhase = typeof opts.phase === 'number' ? opts.phase : F.stillPhase(id);
    var cycle = info.cycle * 1000;
    var started = 0, raf = 0, dirty = true;

    function draw(now) {
      resize();
      var phase = still ? stillPhase : ((now - started) % cycle) / cycle;
      place(F.frame(id, phase));
      aim(size.w, size.h);
      renderer.render(scene, camera);
      dirty = false;
    }
    function loop(now) {
      raf = global.requestAnimationFrame(loop);
      if (!started) started = now;
      if (document.hidden) return;
      if (still && !dirty) return;
      draw(now);
    }

    /* Drag to turn. On a touch screen only sideways drags turn it — an
     * up-and-down swipe still scrolls the page (touch-action: pan-y). */
    var drag = null;
    function down(e) {
      drag = { x: e.clientX, y: e.clientY, touch: e.pointerType === 'touch' };
      try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* old browsers */ }
      host.classList.add('is-turned');
    }
    function move(e) {
      if (!drag) return;
      orbit.yaw -= (e.clientX - drag.x) * 0.45;
      if (!drag.touch) orbit.pitch = Math.max(-8, Math.min(75, orbit.pitch + (e.clientY - drag.y) * 0.35));
      drag.x = e.clientX; drag.y = e.clientY;
      dirty = true;
    }
    function up() { drag = null; }
    canvas.addEventListener('pointerdown', down);
    canvas.addEventListener('pointermove', move);
    canvas.addEventListener('pointerup', up);
    canvas.addEventListener('pointercancel', up);

    raf = global.requestAnimationFrame(loop);

    return {
      canvas: canvas,
      stop: function () {
        global.cancelAnimationFrame(raf);
        canvas.removeEventListener('pointerdown', down);
        canvas.removeEventListener('pointermove', move);
        canvas.removeEventListener('pointerup', up);
        canvas.removeEventListener('pointercancel', up);
        geos.forEach(function (g) { g.dispose(); });
        [bodyMat, eyeMat, propMat, wallMat, floorMat].forEach(function (m) { m.dispose(); });
        // A page only gets a handful of WebGL contexts; give this one back.
        renderer.dispose();
        if (renderer.forceContextLoss) renderer.forceContextLoss();
      }
    };
  }

  /* A figure for the demonstration panel: the 2D one at once, swapped for
   * the 3D one when three.js has loaded. Same shape as CadenceFigures.create. */
  function create(id, opts) {
    opts = opts || {};
    var host = document.createElement('div');
    host.className = 'fig3d';
    var flat = F.create(id, opts);
    host.appendChild(flat.node);
    var live = null, stopped = false;

    if (supported()) {
      load().then(function (T) {
        if (stopped) return;
        try {
          live = scene3(T, id, opts, host);
        } catch (e) {
          live = null;                      // keep the 2D figure
          return;
        }
        flat.stop();
        host.replaceChild(live.canvas, flat.node);
        var hint = document.createElement('span');
        hint.className = 'fig3d-hint';
        hint.setAttribute('aria-hidden', 'true');
        hint.textContent = 'Drag to turn';
        host.appendChild(hint);
      }).catch(function () { /* offline without the library: stay 2D */ });
    }

    return {
      node: host,
      stop: function () {
        stopped = true;
        flat.stop();
        if (live) live.stop();
      }
    };
  }

  global.CadenceFigure3D = {
    supported: supported,
    create: create,
    // For development: a frame lifted into 3D.
    _lift: function (id, phase) { return lift(F.frame(id, phase), F.info(id).view, F.rig.LEN); }
  };
})(window);
