// The phone controller: join a room, add a face, then render whatever layout
// the TV sends. Intents go back as small messages (btn, dir, move, action, aim,
// fire, pad, pick, stroke/undo/done for drawing; act is for TV menus).

import { joinRoom } from "./net.js";

const $ = (id) => document.getElementById(id);
let haptics = true; // the TV can switch buzzing off
const vib = (ms) => haptics && navigator.vibrate?.(ms);
const store = {
  get(k) { try { return sessionStorage.getItem(k) ?? localStorage.getItem(k); } catch { return null; } },
  set(k, v, local) { try { (local ? localStorage : sessionStorage).setItem(k, v); } catch {} },
};

// one seat per tab, so a seat survives a reload (auto-rejoin) and several
// tabs can play in one browser
let pid = store.get("jb-pid-tab");
if (!pid) { pid = Math.random().toString(36).slice(2) + Date.now().toString(36); store.set("jb-pid-tab", pid); }

let conn = null, code = "", name = "", joined = false, current = { kind: "wait", text: "Connecting…" }, faceDone = false;

const params = new URLSearchParams(location.search);
$("code").value = (params.get("room") || store.get("jb-code") || "").toUpperCase();
$("name").value = store.get("jb-name") || "";
if (location.pathname.includes("/ideas/")) $("home").hidden = false;
if ($("code").value.length === 4 && !$("name").value) $("name").focus();

function show(id) { for (const s of ["join", "face", "pad"]) $(s).hidden = s !== id; }

// one reconnect loop at a time (a failed attempt closes its socket too, which
// used to start a second loop), backing off; "final" closes stop it for good
let generation = 0, retrying = false, stopped = false;
async function connect() {
  const gen = ++generation;
  conn = await joinRoom(code, name, pid, {
    onMsg,
    onClose: (why, final) => {
      if (!joined || gen !== generation || stopped) return; // an old socket closing late
      if (final) { stopped = true; return render({ kind: "wait", text: "Disconnected", sub: why }); }
      render({ kind: "wait", text: "Reconnecting…", sub: why });
      retry();
    },
  });
  joined = true;
}

async function retry(wait = 1000) {
  if (retrying || stopped) return;
  retrying = true;
  for (;;) {
    await new Promise((r) => setTimeout(r, wait));
    try { await connect(); if (faceDone && lastFace) conn.send({ t: "face", data: lastFace }); break; }
    catch { wait = Math.min(8000, wait * 1.6); }
  }
  retrying = false;
}

$("join-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  code = $("code").value.trim().toUpperCase();
  name = $("name").value.trim().slice(0, 12);
  $("join-err").textContent = "";
  try {
    await connect();
  } catch (err) {
    $("join-err").textContent = err.message;
    return;
  }
  store.set("jb-code", code); store.set("jb-name", name, true); store.set("jb-name", name);
  try { await navigator.wakeLock?.request("screen"); } catch {}
  lastFace = store.get("jb-face-" + code);
  if (lastFace) { conn.send({ t: "face", data: lastFace }); faceDone = true; show("pad"); render(current); }
  else show("face");
});

/* ------------------------------------------------------------------ face */

const doodle = $("doodle"), dg = doodle.getContext("2d");
let lastFace = null, ink = "#16182b", drawing = false;
const INKS = ["#16182b", "#ffffff", "#ff5a5f", "#3fa7ff", "#ffd23f"], INK_NAMES = ["black", "white", "red", "blue", "yellow"];
for (const [i, c] of INKS.entries()) {
  const b = document.createElement("button");
  b.type = "button"; b.style.background = c; b.setAttribute("aria-label", `${INK_NAMES[i]} ink`);
  if (c === ink) b.classList.add("on");
  b.onclick = () => { ink = c; document.querySelectorAll(".swatches button").forEach((x) => x.classList.toggle("on", x === b)); };
  document.querySelector(".swatches").append(b);
}

$("selfie").addEventListener("change", async () => {
  const file = $("selfie").files[0];
  if (!file) return;
  const img = new Image();
  img.src = URL.createObjectURL(file);
  await img.decode().catch(() => {});
  const s = Math.min(img.naturalWidth, img.naturalHeight);
  dg.clearRect(0, 0, 256, 256);
  dg.drawImage(img, (img.naturalWidth - s) / 2, (img.naturalHeight - s) / 2, s, s, 0, 0, 256, 256);
  URL.revokeObjectURL(img.src);
  $("draw-tools").hidden = true;
  $("face-done").hidden = false;
  doodle.dataset.mode = "photo";
});

$("draw-btn").addEventListener("click", () => {
  dg.clearRect(0, 0, 256, 256);
  doodle.dataset.mode = "draw";
  $("draw-tools").hidden = false;
  $("face-done").hidden = false;
});
$("clear").addEventListener("click", () => dg.clearRect(0, 0, 256, 256));

const pt = (e) => { const r = doodle.getBoundingClientRect(); return [((e.clientX - r.left) / r.width) * 256, ((e.clientY - r.top) / r.height) * 256]; };
doodle.addEventListener("pointerdown", (e) => {
  if (doodle.dataset.mode !== "draw") return;
  drawing = true; doodle.setPointerCapture(e.pointerId);
  const [x, y] = pt(e);
  dg.beginPath(); dg.moveTo(x, y); dg.lineTo(x + 0.1, y);
  dg.lineWidth = 10; dg.lineCap = dg.lineJoin = "round"; dg.strokeStyle = ink; dg.stroke();
});
doodle.addEventListener("pointermove", (e) => { if (!drawing) return; const [x, y] = pt(e); dg.lineTo(x, y); dg.stroke(); });
doodle.addEventListener("pointerup", () => { drawing = false; });

$("face-done").addEventListener("click", () => {
  const out = document.createElement("canvas");
  out.width = out.height = 128;
  out.getContext("2d").drawImage(doodle, 0, 0, 128, 128);
  // photos as JPEG; doodles as PNG so the blob's colour shows through
  lastFace = doodle.dataset.mode === "photo" ? out.toDataURL("image/jpeg", 0.8) : out.toDataURL("image/png");
  store.set("jb-face-" + code, lastFace);
  conn.send({ t: "face", data: lastFace });
  faceDone = true;
  show("pad");
  render(current);
});

// no face? fine: a plain blob, and the TV stops waiting on you
$("pause").addEventListener("click", () => { conn.send({ t: "act", id: "pause" }); vib(20); });
$("face-skip").addEventListener("click", () => { conn.send({ t: "noface" }); faceDone = true; show("pad"); render(current); });

/* ---------------------------------------------------------------- layouts */

function onMsg(m) {
  if (m.t === "ping") return conn.send({ t: "pong", ts: m.ts });
  if (m.t === "buzz") return vib(m.ms || 100);
  if (m.t === "radar") return drawRadar(m);
  if (m.t === "layout") {
    current = m;
    // still on the face screen when a game needs you: skip it rather than miss the game
    if (!faceDone && (!["wait", "menu"].includes(m.kind) || m.actions?.some((a) => a.id === "ready"))) { faceDone = true; conn.send({ t: "noface" }); show("pad"); }
    if (faceDone) render(m);
  }
}

const view = $("view");
const add = (...kids) => view.append(...kids.filter(Boolean));
function el(tag, props = {}, ...kids) {
  const e = Object.assign(document.createElement(tag), props);
  e.append(...kids.filter(Boolean));
  return e;
}

function render(l) {
  if (l.you) {
    document.documentElement.style.setProperty("--me", l.you.color);
    $("me").querySelector("b").textContent = l.you.name;
    document.querySelector('meta[name="theme-color"]').content = l.you.color;
  }
  $("role").textContent = l.role || "";
  haptics = l.haptics !== false;
  $("pause").hidden = !l.vip;
  tiltOff?.(); tiltOff = null;
  view.replaceChildren();
  view.onpointerdown = view.onpointermove = view.onpointerup = null;
  if (l.command && l.kind !== "wait") add(el("p", { className: "cmd", textContent: l.command }));
  const kind = { wait, menu, choose, button, dpad, sling, pads, stick, scope, roll, tilt, draw, bomb, nav }[l.kind] || wait;
  kind(l);
}

function wait(l) {
  const msg = el("p", { className: "msg" + (l.shout ? " shout" : ""), textContent: l.text || "", role: "status" });
  if (l.shout) msg.style.fontSize = `min(120px, ${Math.floor(128 / Math.max(4, (l.text || "").length))}vw)`;
  add(msg, l.sub && el("p", { className: "hint", textContent: l.sub }));
  if (l.heckle) { // knocked out? make trouble
    const h = el("button", { type: "button", className: "big heckle", textContent: "DROP GOO" });
    h.addEventListener("click", () => {
      conn.send({ t: "heckle" }); vib(30);
      h.disabled = true; let n = 4; h.textContent = `RELOADING ${n}`;
      const iv = setInterval(() => { if (--n <= 0) { clearInterval(iv); h.disabled = false; h.textContent = "DROP GOO"; } else h.textContent = `RELOADING ${n}`; }, 1000);
    });
    add(h, el("p", { className: "hint", textContent: "Drop a goo puddle into the game. Anyone who hits it goes spinning!" }));
  }
  if (l.react) add(el("div", { className: "reacts" }, ...["😂", "😱", "🔥", "👏", "💀", "🍿"].map((e) => {
    const b = el("button", { type: "button", textContent: e, ariaLabel: `react ${e}` });
    b.addEventListener("click", () => { conn.send({ t: "react", e }); vib(10); b.classList.add("pop"); setTimeout(() => b.classList.remove("pop"), 250); });
    return b;
  })));
}

function menu(l) {
  wait(l);
  if (l.actions?.length) add(el("div", { className: "actions" }, ...l.actions.map((a) =>
    el("button", { type: "button", className: a.big ? "big" : "", textContent: a.label, onclick: () => conn.send({ t: "act", id: a.id }) }))));
}

function choose(l) {
  add(el("p", { className: "msg", textContent: l.text }));
  const cards = el("div", { className: "cards" });
  for (const o of l.options) {
    const b = el("button", { type: "button" }, el("small", { textContent: o.kind }), el("b", { textContent: o.title }), el("span", { textContent: o.blurb }));
    b.onclick = () => { conn.send({ t: "pick", id: o.id }); render({ kind: "wait", text: `${o.title}!`, sub: "Good choice." }); };
    cards.append(b);
  }
  add(cards);
}

function button(l) {
  const b = el("button", { type: "button", className: "hit", textContent: l.label || "GO" });
  const down = (e) => { e.preventDefault(); b.classList.add("down"); conn.send({ t: "btn", down: true }); vib(15); };
  const up = () => { if (!b.classList.contains("down")) return; b.classList.remove("down"); conn.send({ t: "btn", down: false }); };
  b.addEventListener("pointerdown", down);
  b.addEventListener("pointerup", up);
  b.addEventListener("pointercancel", up);
  b.addEventListener("pointerleave", up);
  add(b, l.hint && el("p", { className: "hint", textContent: l.hint }));
}

function dpad(l) {
  const pad = el("div", { className: "dpad" });
  const send = (d) => { conn.send({ t: "dir", d }); vib(10); };
  for (const [cls, d, glyph] of [["u", "up", "▲"], ["l", "left", "◀"], ["r", "right", "▶"], ["d", "down", "▼"]]) {
    const b = el("button", { type: "button", className: cls, textContent: glyph, ariaLabel: d });
    b.addEventListener("pointerdown", (e) => { e.stopPropagation(); b.classList.add("down"); send(d); });
    b.addEventListener("pointerup", () => b.classList.remove("down"));
    b.addEventListener("pointerleave", () => b.classList.remove("down"));
    pad.append(b);
  }
  // swipe anywhere else on the screen
  let start = null;
  view.onpointerdown = (e) => { start = [e.clientX, e.clientY]; };
  view.onpointermove = (e) => {
    if (!start) return;
    const dx = e.clientX - start[0], dy = e.clientY - start[1];
    if (Math.hypot(dx, dy) < 28) return;
    send(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? "right" : "left") : dy > 0 ? "down" : "up");
    start = [e.clientX, e.clientY];
  };
  view.onpointerup = () => { start = null; };
  add(pad, el("p", { className: "hint", textContent: l.hint || "Swipe or tap the arrows" }));
}

// Board mode: roll the die; your items (secret: only on your phone) sit underneath
function roll(l) {
  add(el("p", { className: "msg", textContent: l.text }), l.sub && el("p", { className: "hint", textContent: l.sub }));
  const b = el("button", { type: "button", className: "hit", textContent: l.dbl ? "ROLL ×2" : "ROLL" });
  b.addEventListener("pointerdown", (e) => { e.preventDefault(); conn.send({ t: "roll" }); vib(40); b.disabled = true; });
  add(b);
  if (l.items?.length) add(el("div", { className: "items" }, ...l.items.map((it) => {
    const x = el("button", { type: "button", textContent: `USE ${it.label}` });
    x.addEventListener("pointerdown", (e) => { e.stopPropagation(); conn.send({ t: "use", id: it.id }); x.disabled = true; vib(20); });
    return x;
  })));
}

// big coloured/numbered pads (microgames: MATCH!, COUNT!; votes; wires).
// One press locks the rest, unless multi (a keypad you press several of).
function padGrid(list, o = {}) {
  const grid = el("div", { className: "pads" + (o.small ? " small" : "") });
  if (o.cols) grid.style.gridTemplateColumns = `repeat(${o.cols}, 1fr)`;
  for (const p of list) {
    const b = el("button", { type: "button", textContent: p.label || "", disabled: !!p.off });
    b.style.background = p.color;
    if (p.fg) b.style.color = p.fg;
    b.addEventListener("pointerdown", (e) => {
      e.stopPropagation();
      if (b.disabled) return;
      conn.send({ t: "pad", id: p.id });
      vib(20);
      if (o.multi) { b.disabled = true; return; }
      grid.querySelectorAll("button").forEach((x) => { x.disabled = x !== b; });
      b.classList.add("down");
    });
    grid.append(b);
  }
  return grid;
}
function pads(l) { add(l.text && el("p", { className: "msg", textContent: l.text }), padGrid(l.pads, l), l.hint && el("p", { className: "hint", textContent: l.hint })); }

// Tilt: steer by tilting the phone (iOS asks permission on a tap). Level is
// wherever you hold it when you start. A thumbstick stands in when there's
// no motion sensor.
let tiltOff = null;
function tilt(l) {
  tiltOff?.();
  const msg = el("p", { className: "hint", textContent: l.hint || "Tilt to roll" });
  const dot = el("i"), bubble = el("div", { className: "level" }, dot);
  let base = null, last = 0, trail = null;
  const on = (e) => {
    if (e.beta == null) return;
    if (!base) base = [e.gamma, e.beta];
    const x = Math.max(-1, Math.min(1, (e.gamma - base[0]) / 25)), y = Math.max(-1, Math.min(1, (e.beta - base[1]) / 25));
    dot.style.transform = `translate(${x * 60}px, ${y * 60}px)`;
    const now = performance.now();
    clearTimeout(trail);
    if (now - last > 50) { last = now; conn.send({ t: "move", x: +x.toFixed(2), y: +y.toFixed(2) }); }
    else trail = setTimeout(() => { last = performance.now(); conn.send({ t: "move", x: +x.toFixed(2), y: +y.toFixed(2) }); }, 60);
  };
  const start = () => { addEventListener("deviceorientation", on); tiltOff = () => removeEventListener("deviceorientation", on); };
  const level = el("button", { type: "button", textContent: "LEVEL HERE" });
  level.addEventListener("click", () => { base = null; });
  if (typeof DeviceOrientationEvent !== "undefined" && typeof DeviceOrientationEvent.requestPermission === "function") {
    const ask = el("button", { type: "button", className: "big", textContent: "TAP TO ENABLE TILT" });
    ask.addEventListener("click", async () => { try { if (await DeviceOrientationEvent.requestPermission() === "granted") { start(); ask.remove(); } else msg.textContent = "No tilt? Use the stick."; } catch { msg.textContent = "No tilt? Use the stick."; } });
    add(ask);
  } else start();
  add(bubble, level, msg);
  // fallback stick, always there (desktop, or tilt refused)
  const pad = el("div", { className: "stick mini" }), knob = el("i");
  pad.append(knob);
  let o = null;
  const at = (e) => {
    let dx = e.clientX - o[0], dy = e.clientY - o[1]; const d = Math.hypot(dx, dy), R = 50;
    if (d > R) { dx *= R / d; dy *= R / d; }
    knob.style.transform = `translate(${dx}px, ${dy}px)`;
    conn.send({ t: "move", x: +(dx / R).toFixed(2), y: +(dy / R).toFixed(2) });
  };
  pad.addEventListener("pointerdown", (e) => { const r = pad.getBoundingClientRect(); o = [r.left + r.width / 2, r.top + r.height / 2]; pad.setPointerCapture(e.pointerId); at(e); });
  pad.addEventListener("pointermove", (e) => o && at(e));
  const stop = () => { o = null; knob.style.transform = ""; conn.send({ t: "move", x: 0, y: 0 }); };
  pad.addEventListener("pointerup", stop); pad.addEventListener("pointercancel", stop);
  add(el("p", { className: "hint", textContent: "No tilt? Use the stick" }), pad);
}

// Draw: a square canvas; each finished stroke goes to the TV (normalised 0–1)
function draw(l) {
  add(l.prompt && el("p", { className: "prompt", textContent: l.prompt }));
  const c = el("canvas", { className: "sketch", width: 600, height: 600 }), g = c.getContext("2d");
  g.fillStyle = "#fff"; g.fillRect(0, 0, 600, 600); g.lineCap = g.lineJoin = "round";
  const colors = ["#0b0710", "#ff2a6d", "#05d9e8", "#39ff14", "#f9f002", "#ff6b00", "#8a5cff", "#ffffff"];
  let color = colors[0], width = 10, pts = null, strokes = [];
  const pos = (e) => { const r = c.getBoundingClientRect(); return [Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)), Math.max(0, Math.min(1, (e.clientY - r.top) / r.height))]; };
  const paint = (s) => { g.strokeStyle = s.c; g.lineWidth = s.w; g.beginPath(); s.pts.forEach(([x, y], i) => (i ? g.lineTo(x * 600, y * 600) : g.moveTo(x * 600, y * 600))); if (s.pts.length === 1) g.lineTo(s.pts[0][0] * 600 + 0.1, s.pts[0][1] * 600); g.stroke(); };
  const redraw = () => { g.fillStyle = "#fff"; g.fillRect(0, 0, 600, 600); strokes.forEach(paint); };
  c.addEventListener("pointerdown", (e) => { c.setPointerCapture(e.pointerId); pts = [pos(e)]; });
  c.addEventListener("pointermove", (e) => { if (!pts) return; const p = pos(e), q = pts[pts.length - 1]; if (Math.hypot(p[0] - q[0], p[1] - q[1]) < 0.006) return; pts.push(p); paint({ c: color, w: width, pts: pts.slice(-2) }); });
  const end = () => {
    if (!pts) return;
    const s = { c: color, w: width, pts: pts.slice(0, 200).map(([x, y]) => [+x.toFixed(3), +y.toFixed(3)]) };
    pts = null; strokes.push(s); paint(s);
    conn.send({ t: "stroke", ...s });
  };
  c.addEventListener("pointerup", end); c.addEventListener("pointercancel", end);
  const sw = el("div", { className: "swatches" }, ...colors.map((col) => {
    const b = el("button", { type: "button", className: col === color ? "on" : "", ariaLabel: `colour ${col}` });
    b.style.background = col;
    b.addEventListener("click", () => { color = col; sw.querySelectorAll("button").forEach((x) => x.classList.toggle("on", x === b)); });
    return b;
  }));
  const size = el("button", { type: "button", textContent: "THIN" });
  size.addEventListener("click", () => { width = width === 10 ? 4 : width === 4 ? 22 : 10; size.textContent = width === 10 ? "THIN" : width === 4 ? "THICK" : "MEDIUM"; });
  const undo = el("button", { type: "button", textContent: "UNDO" });
  undo.addEventListener("click", () => { if (strokes.pop()) { redraw(); conn.send({ t: "undo" }); } });
  const done = el("button", { type: "button", className: "big", textContent: "DONE" });
  done.addEventListener("click", () => { conn.send({ t: "done" }); render({ kind: "wait", text: "Nice!", sub: "Waiting for the other artists…" }); });
  add(c, sw, el("div", { className: "row" }, size, undo, done));
}

// Bomb Squad: your slice of the manual (scrolls), and, if you're the one
// holding the bomb, the wires / keypad / button
function bomb(l) {
  if (l.manual?.length) add(el("div", { className: "manual" }, ...l.manual.map((sec) => el("section", {}, el("h3", { textContent: sec.title }), ...sec.lines.map((t) => el("p", { textContent: t }))))));
  if (l.wires) add(el("p", { className: "hint", textContent: "CUT A WIRE" }), padGrid(l.wires, { cols: l.wires.length, small: true }));
  if (l.keys) add(el("p", { className: "hint", textContent: "PRESS THE SYMBOLS IN ORDER" }), padGrid(l.keys, { cols: 4, multi: true }));
  if (l.hold) {
    const b = el("button", { type: "button", className: "hit bombbtn", textContent: l.hold.label });
    b.style.background = l.hold.color;
    const down = (e) => { e.preventDefault(); b.classList.add("down"); conn.send({ t: "btn", down: true }); vib(15); };
    const up = () => { if (!b.classList.contains("down")) return; b.classList.remove("down"); conn.send({ t: "btn", down: false }); };
    b.addEventListener("pointerdown", down); b.addEventListener("pointerup", up); b.addEventListener("pointercancel", up); b.addEventListener("pointerleave", up);
    add(b);
  }
  if (l.hint) add(el("p", { className: "hint", textContent: l.hint }));
}

// Runner (sniper games): private radar / mini-map, thumbstick, optional action
let radar = null, radarMap = null;
function drawRadar(m) {
  if (!radar || !radar.isConnected) return;
  const g = radar.getContext("2d"), w = radar.width, h = radar.height;
  g.clearRect(0, 0, w, h);
  g.strokeStyle = "rgba(5,217,232,.35)"; g.lineWidth = 2; g.strokeRect(1, 1, w - 2, h - 2);
  if (m.map) radarMap = m.map; // a crate broke
  if (radarMap) redrawCover(g, w, h);
  for (const [x, y, age] of m.shots || []) { // recent shots, fading
    g.save(); g.globalAlpha = 1 - age; g.strokeStyle = "#ff2a6d"; g.lineWidth = 4;
    g.beginPath(); g.moveTo(x * w - 7, y * h - 7); g.lineTo(x * w + 7, y * h + 7); g.moveTo(x * w + 7, y * h - 7); g.lineTo(x * w - 7, y * h + 7); g.stroke();
    g.restore();
  }
  if (m.scope) { // where the sniper is looking
    const [x, y, r] = m.scope;
    g.fillStyle = "rgba(255,42,109,.18)"; g.strokeStyle = "#ff2a6d"; g.lineWidth = 3;
    g.beginPath(); g.arc(x * w, y * h, r * w, 0, Math.PI * 2); g.fill(); g.stroke();
    g.beginPath(); g.moveTo(x * w - 8, y * h); g.lineTo(x * w + 8, y * h); g.moveTo(x * w, y * h - 8); g.lineTo(x * w, y * h + 8); g.stroke();
  }
  g.fillStyle = "#f9f002";
  for (const [x, y] of m.coins || []) { g.beginPath(); g.arc(x * w, y * h, 6, 0, Math.PI * 2); g.fill(); }
  if (m.ring) { const [x, y, r] = m.ring; g.strokeStyle = "#39ff14"; g.lineWidth = 4; g.setLineDash([6, 6]); g.beginPath(); g.arc(x * w, y * h, r * w, 0, Math.PI * 2); g.stroke(); g.setLineDash([]); }
  for (const [x, y, c, r = 8] of m.dots || []) { g.fillStyle = c; g.strokeStyle = "#000"; g.lineWidth = 2; g.beginPath(); g.arc(x * w, y * h, r, 0, Math.PI * 2); g.fill(); g.stroke(); }
  if (m.x == null) return;
  g.fillStyle = getComputedStyle(document.documentElement).getPropertyValue("--me");
  g.strokeStyle = "#fff"; g.lineWidth = 3;
  g.beginPath(); g.arc(m.x * w, m.y * h, 10, 0, Math.PI * 2); g.fill(); g.stroke();
}

// the fixed part of the map: Blackout's cover, or walls (rects) and lines
function redrawCover(g, w, h) {
  g.fillStyle = "#1f7a3a";
  for (const [x, y, r] of radarMap.bushes || []) { g.beginPath(); g.arc(x * w, y * h, r * w, 0, Math.PI * 2); g.fill(); }
  g.fillStyle = "#8a5a2b";
  for (const [x, y, cw, ch] of radarMap.crates || []) g.fillRect(x * w, y * h, cw * w, ch * h);
  g.fillStyle = "#7d8ca3";
  for (const [x, y, cw, ch] of radarMap.walls || []) g.fillRect(x * w, y * h, cw * w, ch * h);
  g.strokeStyle = "#7d8ca3"; g.lineWidth = radarMap.lw ? radarMap.lw * w : 3; g.lineCap = "round"; // lw: a road's width, as a share of the map
  for (const [x1, y1, x2, y2] of radarMap.lines || []) { g.beginPath(); g.moveTo(x1 * w, y1 * h); g.lineTo(x2 * w, y2 * h); g.stroke(); }
}

// Navigator: a big private map and nothing to steer with (Blind Pilot)
function nav(l) {
  radar = el("canvas", { className: "radar big", width: 480, height: 280 });
  radarMap = l.map || null;
  const g = radar.getContext("2d");
  if (radarMap) redrawCover(g, radar.width, radar.height);
  let act = null;
  if (l.action) {
    act = el("button", { type: "button", className: "hit fire", textContent: l.action });
    act.addEventListener("pointerdown", (e) => { e.stopPropagation(); conn.send({ t: "action" }); vib(20); });
  }
  add(radar, l.hint && el("p", { className: "hint", textContent: l.hint }), act);
}

function stick(l) {
  radar = el("canvas", { className: "radar", width: 320, height: 186 });
  radarMap = l.map || null;
  const pad = el("div", { className: "stick" }), knob = el("i");
  pad.append(knob);
  let o = null, last = 0, sent = [0, 0];
  const R = 70;
  let trail = null;
  const send = (x, y, force) => {
    const now = performance.now();
    clearTimeout(trail);
    if (!force && now - last < 50 && Math.hypot(x - sent[0], y - sent[1]) < 0.25) { trail = setTimeout(() => send(x, y, true), 60); return; } // never leave a stale value on the TV
    last = now; sent = [x, y];
    conn.send({ t: "move", x: +x.toFixed(2), y: +y.toFixed(2) });
  };
  const at = (e) => {
    let dx = e.clientX - o[0], dy = e.clientY - o[1];
    const d = Math.hypot(dx, dy);
    if (d > R) { dx *= R / d; dy *= R / d; }
    knob.style.transform = `translate(${dx}px, ${dy}px)`;
    send(dx / R, dy / R);
  };
  pad.addEventListener("pointerdown", (e) => { const r = pad.getBoundingClientRect(); o = [r.left + r.width / 2, r.top + r.height / 2]; pad.setPointerCapture(e.pointerId); at(e); });
  pad.addEventListener("pointermove", (e) => o && at(e));
  const stop = () => { o = null; knob.style.transform = ""; send(0, 0, true); };
  pad.addEventListener("pointerup", stop);
  pad.addEventListener("pointercancel", stop);
  let act = null;
  if (l.action) {
    act = el("button", { type: "button", className: "act", textContent: l.action });
    // "action", not "act": the TV reads "act" as a menu command
    act.addEventListener("pointerdown", (e) => { e.stopPropagation(); conn.send({ t: "action" }); vib(20); });
  }
  if (l.radar === false) radar = null; // games where everything is on the TV
  add(radar, el("div", { className: "stickrow" + (act ? "" : " solo") }, pad, act), l.hint && el("p", { className: "hint", textContent: l.hint }));
}

// Sniper: a trackpad (relative drag) and a FIRE button with the reload shown
function scope(l) {
  const area = el("div", { className: "trackpad" }, el("span", { textContent: "DRAG TO AIM" }));
  let lp = null, acc = [0, 0], timer = null;
  const SENS = 2.4;
  const flush = () => { timer = null; if (acc[0] || acc[1]) { conn.send({ t: "aim", dx: Math.round(acc[0]), dy: Math.round(acc[1]) }); acc = [0, 0]; } };
  area.addEventListener("pointerdown", (e) => { lp = [e.clientX, e.clientY]; area.setPointerCapture(e.pointerId); });
  area.addEventListener("pointermove", (e) => {
    if (!lp) return;
    acc[0] += (e.clientX - lp[0]) * SENS; acc[1] += (e.clientY - lp[1]) * SENS;
    lp = [e.clientX, e.clientY];
    if (!timer) timer = setTimeout(flush, 30);
  });
  area.addEventListener("pointerup", () => { lp = null; flush(); });
  const fire = el("button", { type: "button", className: "hit fire", textContent: "FIRE" });
  const until = performance.now() + (l.cool || 0) * 1000;
  const tick = () => {
    if (!fire.isConnected) return;
    const left = (until - performance.now()) / 1000;
    fire.disabled = left > 0;
    fire.textContent = left > 0 ? left.toFixed(1) : "FIRE";
    if (left > 0) requestAnimationFrame(tick);
  };
  fire.addEventListener("pointerdown", (e) => { e.stopPropagation(); if (fire.disabled) return; conn.send({ t: "fire" }); vib(60); });
  let flare = null;
  if (l.flares != null) { // Blackout: light up the whole plaza for a second
    flare = el("button", { type: "button", className: "flare", textContent: `FLARE ${"✦".repeat(l.flares) || "—"}`, disabled: !l.flares });
    flare.addEventListener("pointerdown", (e) => { e.stopPropagation(); if (flare.disabled) return; conn.send({ t: "flare" }); flare.disabled = true; vib(40); });
  }
  add(area, flare ? el("div", { className: "firerow" }, fire, flare) : fire, l.hint && el("p", { className: "hint", textContent: l.hint }));
  tick(); // after add(): tick stops once the button leaves the page
}

function sling(l) {
  const area = el("div", { className: "sling" + (l.active ? " active" : "") });
  const hint = el("p", { className: "msg", textContent: l.active ? "Drag back & let go" : l.hint });
  area.append(hint);
  add(area, l.active && el("p", { className: "hint", textContent: l.hint }));
  if (!l.active) return;
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  area.append(svg);
  let o = null, lastSend = 0, v = null;
  const vec = (e) => {
    const r = area.getBoundingClientRect();
    const dx = e.clientX - o[0], dy = e.clientY - o[1], len = Math.hypot(dx, dy);
    const p = Math.min(1, len / (Math.min(r.width, r.height) * 0.42));
    svg.innerHTML = `<line x1="${o[0] - r.left}" y1="${o[1] - r.top}" x2="${e.clientX - r.left}" y2="${e.clientY - r.top}" stroke="#05d9e8" stroke-width="6" stroke-linecap="round" stroke-dasharray="2 14"/>
      <circle cx="${e.clientX - r.left}" cy="${e.clientY - r.top}" r="${24 + p * 16}" fill="${getComputedStyle(document.documentElement).getPropertyValue("--me")}" stroke="#fff" stroke-width="5"/>
      <line x1="${o[0] - r.left}" y1="${o[1] - r.top}" x2="${o[0] - r.left - dx}" y2="${o[1] - r.top - dy}" stroke="#f9f002" stroke-width="10" stroke-linecap="round"/>`;
    hint.textContent = `Power ${Math.round(p * 100)}%`;
    return len ? { x: -dx / len, y: -dy / len, p } : { x: 0, y: 0, p: 0 };
  };
  area.addEventListener("pointerdown", (e) => { o = [e.clientX, e.clientY]; area.setPointerCapture(e.pointerId); });
  area.addEventListener("pointermove", (e) => {
    if (!o) return;
    v = vec(e);
    const now = performance.now();
    if (now - lastSend > 45) { lastSend = now; conn.send({ t: "aim", ...v }); }
  });
  area.addEventListener("pointerup", (e) => {
    if (!o) return;
    v = vec(e); o = null; svg.innerHTML = "";
    if (v.p > 0.08) { conn.send({ t: "fire", ...v }); vib(40); }
    else hint.textContent = "Drag further!";
  });
}

// Came back to a tab that already joined this room? Rejoin straight away.
if ($("code").value && store.get("jb-joined-" + $("code").value) && $("name").value) $("join-form").requestSubmit();
addEventListener("pagehide", () => { if (joined) store.set("jb-joined-" + code, "1"); });
