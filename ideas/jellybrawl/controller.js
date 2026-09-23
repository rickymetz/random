// The phone controller: join a room, add a face, then render whatever layout
// the TV sends. Intents go back as small messages (btn, dir, aim, fire, pick, act).

import { joinRoom } from "./net.js";

const $ = (id) => document.getElementById(id);
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

async function connect() {
  conn = await joinRoom(code, name, pid, {
    onMsg,
    onClose: (why) => {
      if (!joined) return;
      render({ kind: "wait", text: "Reconnecting…", sub: why });
      setTimeout(retry, 1500);
    },
  });
  joined = true;
}

async function retry() {
  try { await connect(); if (faceDone && lastFace) conn.send({ t: "face", data: lastFace }); } catch { setTimeout(retry, 2500); }
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
const INKS = ["#16182b", "#ffffff", "#ff5a5f", "#3fa7ff", "#ffd23f"];
for (const c of INKS) {
  const b = document.createElement("button");
  b.type = "button"; b.style.background = c; b.setAttribute("aria-label", "ink " + c);
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

/* ---------------------------------------------------------------- layouts */

function onMsg(m) {
  if (m.t === "ping") return conn.send({ t: "pong", ts: m.ts });
  if (m.t === "buzz") return navigator.vibrate?.(m.ms || 100);
  if (m.t === "layout") { current = m; if (faceDone) render(m); }
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
  view.replaceChildren();
  view.onpointerdown = view.onpointermove = view.onpointerup = null;
  const kind = { wait, menu, choose, button, dpad, sling }[l.kind] || wait;
  kind(l);
}

function wait(l) {
  const msg = el("p", { className: "msg" + (l.shout ? " shout" : ""), textContent: l.text || "" });
  if (l.shout) msg.style.fontSize = `min(120px, ${Math.floor(128 / Math.max(4, (l.text || "").length))}vw)`;
  add(msg, l.sub && el("p", { className: "hint", textContent: l.sub }));
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
  const down = (e) => { e.preventDefault(); b.classList.add("down"); conn.send({ t: "btn", down: true }); navigator.vibrate?.(15); };
  const up = () => { if (!b.classList.contains("down")) return; b.classList.remove("down"); conn.send({ t: "btn", down: false }); };
  b.addEventListener("pointerdown", down);
  b.addEventListener("pointerup", up);
  b.addEventListener("pointercancel", up);
  b.addEventListener("pointerleave", up);
  add(b, l.hint && el("p", { className: "hint", textContent: l.hint }));
}

function dpad(l) {
  const pad = el("div", { className: "dpad" });
  const send = (d) => { conn.send({ t: "dir", d }); navigator.vibrate?.(10); };
  for (const [cls, d, glyph] of [["u", "up", "▲"], ["l", "left", "◀"], ["r", "right", "▶"], ["d", "down", "▼"]]) {
    const b = el("button", { type: "button", className: cls, textContent: glyph });
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
    svg.innerHTML = `<line x1="${o[0] - r.left}" y1="${o[1] - r.top}" x2="${e.clientX - r.left}" y2="${e.clientY - r.top}" stroke="#111" stroke-width="8" stroke-linecap="round" stroke-dasharray="2 14"/>
      <circle cx="${e.clientX - r.left}" cy="${e.clientY - r.top}" r="${24 + p * 16}" fill="${getComputedStyle(document.documentElement).getPropertyValue("--me")}" stroke="#111" stroke-width="6"/>
      <line x1="${o[0] - r.left}" y1="${o[1] - r.top}" x2="${o[0] - r.left - dx}" y2="${o[1] - r.top - dy}" stroke="#ff2e63" stroke-width="10" stroke-linecap="round"/>`;
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
    if (v.p > 0.08) { conn.send({ t: "fire", ...v }); navigator.vibrate?.(40); }
    else hint.textContent = "Drag further!";
  });
}

// Came back to a tab that already joined this room? Rejoin straight away.
if ($("code").value && store.get("jb-joined-" + $("code").value) && $("name").value) $("join-form").requestSubmit();
addEventListener("pagehide", () => { if (joined) store.set("jb-joined-" + code, "1"); });
