// Transport between the TV (host) and the phones (players). Three backends
// with the same shape, picked automatically:
//   p2p   — WebRTC data channels straight between each phone and the TV; the
//           site only introduces them (signal.mjs: the Netlify Function, or
//           server.mjs --p2p). Real phones on a host with no WebSockets.
//   relay — WebSocket to server.mjs (or ?relay=wss://…): real phones.
//   local — BroadcastChannel: the TV and controller tabs in one browser, so
//           the prototype still plays on static hosting (GitHub Pages).

const CHANNEL = "jellybrawl";

function relayUrl() {
  const q = new URLSearchParams(location.search).get("relay");
  if (q) return q;
  if (location.protocol === "file:" || location.hostname.endsWith("github.io")) return null;
  return (location.protocol === "https:" ? "wss://" : "ws://") + location.host + location.pathname.replace(/[^/]*$/, "") + "ws";
}

function openSocket(url, ms = 1500) {
  return new Promise((resolve) => {
    if (!url) return resolve(null);
    let ws;
    try { ws = new WebSocket(url); } catch { return resolve(null); }
    const timer = setTimeout(() => { ws.close(); resolve(null); }, ms);
    ws.onopen = () => { clearTimeout(timer); resolve(ws); };
    ws.onerror = () => { clearTimeout(timer); resolve(null); };
  });
}

/* ------------------------------------------------------------ p2p (WebRTC) */

const API = "/api/jellybrawl/"; // at the site's root (a Netlify Function's path)

// the signalling, if this site has it: resolves its ICE servers, or null
async function p2pConfig() {
  if (new URLSearchParams(location.search).get("relay") || location.protocol === "file:" || location.hostname.endsWith("github.io") || !window.RTCPeerConnection) return null;
  try {
    const r = await fetch(API + "config", { signal: AbortSignal.timeout(2500) });
    const j = r.ok && (await r.json());
    return j && Array.isArray(j.iceServers) ? j : null;
  } catch { return null; }
}
async function api(path, body) {
  const r = await fetch(API + path, body ? { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) } : { cache: "no-store" });
  if (!r.ok) throw Object.assign(new Error((await r.json().catch(() => ({}))).error || `Signalling failed (${r.status}).`), { status: r.status });
  return r.status === 204 ? null : r.json();
}
// One round trip, no trickle: wait for the candidates, but not for a slow
// or unreachable STUN server: once they've gone quiet for a moment, go.
function gathered(pc, ms = 2500, quiet = 300) {
  return new Promise((resolve) => {
    if (pc.iceGatheringState === "complete") return resolve();
    let lull = null;
    const done = () => { clearTimeout(cap); clearTimeout(lull); pc.removeEventListener("icegatheringstatechange", check); pc.removeEventListener("icecandidate", seen); resolve(); };
    const check = () => pc.iceGatheringState === "complete" && done();
    const seen = () => { clearTimeout(lull); lull = setTimeout(done, quiet); };
    const cap = setTimeout(done, ms);
    pc.addEventListener("icegatheringstatechange", check);
    pc.addEventListener("icecandidate", seen);
  });
}
// A data channel message is safe up to about 64 KB everywhere (a selfie is
// bigger): long messages go in pieces and are put back together.
const PIECE = 16000;
let nextId = 0;
function sendOn(ch, m) {
  if (ch?.readyState !== "open") return;
  const s = JSON.stringify(m);
  if (s.length <= PIECE) return ch.send(s);
  const id = ++nextId, n = Math.ceil(s.length / PIECE);
  for (let i = 0; i < n; i++) ch.send(JSON.stringify({ t: "__part", id, i, n, d: s.slice(i * PIECE, (i + 1) * PIECE) }));
}
function receiver(fn) {
  const parts = new Map();
  return (e) => {
    let m; try { m = JSON.parse(e.data); } catch { return; }
    if (m.t !== "__part") return fn(m);
    const p = parts.get(m.id) || { got: 0, d: [] };
    p.d[m.i] = m.d; p.got++; parts.set(m.id, p);
    if (p.got === m.n) { parts.delete(m.id); try { fn(JSON.parse(p.d.join(""))); } catch {} }
  };
}

async function hostP2P(cfg, { onJoin, onLeave, onInput }, base) {
  const { code, token } = await api("room", {});
  const peers = new Map(); // pid -> { pc, ch }
  const drop = (pid, pc) => { if (peers.get(pid)?.pc !== pc) return; peers.delete(pid); pc.close(); onLeave(pid); };
  async function accept({ pid, name, sdp }) {
    const old = peers.get(pid);
    if (old) { sendOn(old.ch, { t: "replaced" }); peers.delete(pid); old.pc.close(); } // the same seat opened again replaces the old one
    const pc = new RTCPeerConnection({ iceServers: cfg.iceServers });
    const peer = { pc, ch: null };
    peers.set(pid, peer);
    pc.ondatachannel = ({ channel: ch }) => {
      ch.onopen = () => { if (peers.get(pid) !== peer) return; peer.ch = ch; sendOn(ch, { t: "joined", pid }); onJoin(pid, name); };
      ch.onmessage = receiver((m) => (m.t === "__bye" ? drop(pid, pc) : peers.get(pid) === peer && onInput(pid, m)));
      ch.onclose = () => drop(pid, pc);
    };
    pc.onconnectionstatechange = () => (pc.connectionState === "failed" || pc.connectionState === "closed") && drop(pid, pc);
    await pc.setRemoteDescription({ type: "offer", sdp });
    await pc.setLocalDescription(await pc.createAnswer());
    await gathered(pc);
    await api("answer", { room: code, token, pid, sdp: pc.localDescription.sdp });
  }
  // collect knocks: every second while people are arriving, every few seconds once it's quiet
  let busyUntil = Date.now() + 120_000, touched = 0;
  (async function poll() {
    try {
      const touch = Date.now() - touched > 30_000;
      const list = await api(`inbox?room=${code}&token=${token}${touch ? "&touch=1" : ""}`);
      if (touch) touched = Date.now();
      if (list.length) busyUntil = Date.now() + 60_000;
      for (const o of list) accept(o).catch(() => {});
    } catch {}
    setTimeout(poll, Date.now() < busyUntil ? 1000 : 3000);
  })();
  addEventListener("pagehide", () => {
    for (const { ch } of peers.values()) sendOn(ch, { t: "closed" });
    navigator.sendBeacon?.(API + "close", new Blob([JSON.stringify({ room: code, token })], { type: "application/json" }));
  });
  return {
    mode: "p2p", code, joinUrl: base,
    send: (pid, m) => sendOn(peers.get(pid)?.ch, m),
    broadcast: (m) => { for (const { ch } of peers.values()) sendOn(ch, m); },
  };
}

async function joinP2P(cfg, code, name, pid, { onMsg, onClose }) {
  const pc = new RTCPeerConnection({ iceServers: cfg.iceServers });
  const ch = pc.createDataChannel("jellybrawl", { ordered: true });
  let joined = false, over = false;
  const end = (why, final) => { if (over) return; over = true; pc.close(); if (joined) onClose(why, final); };
  await new Promise((resolve, reject) => {
    const fail = (msg) => { over = true; pc.close(); reject(new Error(msg)); };
    const timer = setTimeout(() => fail("Couldn't reach the TV. Is this phone on the same Wi-Fi as the TV?"), 20000);
    ch.onmessage = receiver((m) => {
      if (m.t === "joined") { joined = true; clearTimeout(timer); resolve(); }
      else if (m.t === "closed") end("The TV left the game.", true);
      else if (m.t === "replaced") end("You opened this seat somewhere else.", true);
      else onMsg(m);
    });
    ch.onclose = () => (joined ? end("Disconnected.") : null);
    pc.onconnectionstatechange = () => pc.connectionState === "failed" && (joined ? end("Disconnected.") : fail("Couldn't reach the TV. Is this phone on the same Wi-Fi as the TV?"));
    (async () => {
      await pc.setLocalDescription(await pc.createOffer());
      await gathered(pc);
      await api("offer", { room: code, pid, name, sdp: pc.localDescription.sdp });
      for (let k = 0; k < 60 && !over; k++) { // the TV answers within a second or so
        const a = await api(`answer?room=${code}&pid=${encodeURIComponent(pid)}`);
        if (a?.sdp) return pc.setRemoteDescription({ type: "answer", sdp: a.sdp });
        await new Promise((r) => setTimeout(r, 400));
      }
      fail("The TV didn't answer. Is it still showing the room code?");
    })().catch((e) => { clearTimeout(timer); fail(e.status === 404 ? "No room with that code." : e.message); });
  });
  addEventListener("pagehide", () => sendOn(ch, { t: "__bye" }));
  return { mode: "p2p", send: (m) => sendOn(ch, m) };
}

function code4() {
  const L = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  return Array.from({ length: 4 }, () => L[Math.floor(Math.random() * L.length)]).join("");
}

/** Opens a room. handlers: onJoin(pid, name), onLeave(pid), onInput(pid, msg). */
export async function hostRoom({ onJoin, onLeave, onInput }) {
  const base = location.href.replace(/[^/]*([?#].*)?$/, "");
  const cfg = await p2pConfig();
  if (cfg) { try { return await hostP2P(cfg, { onJoin, onLeave, onInput }, base); } catch {} }
  let ws = await openSocket(relayUrl() && relayUrl() + "?role=host");
  if (ws) {
    const listen = (sock, resolve) => {
      sock.onmessage = (e) => {
        const msg = JSON.parse(e.data);
        if (msg.t === "room") resolve?.(msg);
        else if (msg.t === "join") onJoin(msg.pid, msg.name);
        else if (msg.t === "leave") onLeave(msg.pid);
        else if (msg.t === "from") onInput(msg.pid, msg.m);
      };
    };
    const room = await new Promise((resolve) => listen(ws, resolve));
    // the relay keeps the room for a minute if the TV drops; come back with the code and secret
    let wait = 500;
    const reconnect = async () => {
      const next = await openSocket(`${relayUrl()}?role=host&code=${room.code}&token=${room.token}`);
      if (!next) { wait = Math.min(8000, wait * 2); return void setTimeout(reconnect, wait); }
      wait = 500; ws = next; listen(ws); ws.onclose = reconnect;
    };
    ws.onclose = reconnect;
    const joinUrl = new URLSearchParams(location.search).get("relay") ? base : (room.urls[0] || base);
    return {
      mode: "relay", code: room.code, joinUrl,
      send: (pid, m) => ws.readyState === 1 && ws.send(JSON.stringify({ t: "to", pid, m })),
      broadcast: (m) => ws.readyState === 1 && ws.send(JSON.stringify({ t: "all", m })),
    };
  }

  const code = code4();
  const bc = new BroadcastChannel(CHANNEL);
  const down = (pid, m) => bc.postMessage({ room: code, dir: "down", pid, m });
  bc.onmessage = (e) => {
    const d = e.data;
    if (!d || d.room !== code || d.dir !== "up") return;
    if (d.t === "join") { down(d.pid, { t: "joined", pid: d.pid }); onJoin(d.pid, d.name); }
    else if (d.t === "leave") onLeave(d.pid);
    else if (d.t === "from") onInput(d.pid, d.m);
  };
  addEventListener("pagehide", () => bc.postMessage({ room: code, dir: "down", pid: "*", m: { t: "closed" } }));
  return { mode: "local", code, joinUrl: base, send: down, broadcast: (m) => down("*", m) };
}

/** Joins a room. Resolves { send } or rejects with a readable message. */
export async function joinRoom(code, name, pid, { onMsg, onClose }) {
  code = code.toUpperCase();
  const cfg = await p2pConfig();
  if (cfg) return joinP2P(cfg, code, name, pid, { onMsg, onClose });
  const url = relayUrl();
  const ws = await openSocket(url && `${url}?role=player&room=${code}&pid=${encodeURIComponent(pid)}&name=${encodeURIComponent(name)}`);
  if (ws) {
    await new Promise((resolve, reject) => {
      ws.onmessage = (e) => {
        const msg = JSON.parse(e.data);
        if (msg.t === "joined") resolve();
        else if (msg.t === "error") reject(new Error(msg.msg));
        else if (msg.t === "closed") onClose("The TV left the game.", true);
        else if (msg.t === "replaced") onClose("You opened this seat somewhere else.", true);
        else onMsg(msg);
      };
      ws.onclose = () => { reject(new Error("Couldn't join.")); onClose("Disconnected."); };
    });
    return { mode: "relay", send: (m) => ws.readyState === 1 && ws.send(JSON.stringify(m)) };
  }

  const bc = new BroadcastChannel(CHANNEL);
  const up = (o) => bc.postMessage({ room: code, dir: "up", pid, ...o });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("No game with that code. (Without the relay server, controllers must be tabs in the same browser as the TV.)")), 1200);
    bc.onmessage = (e) => {
      const d = e.data;
      if (!d || d.room !== code || d.dir !== "down" || (d.pid !== pid && d.pid !== "*")) return;
      if (d.m.t === "joined") { clearTimeout(timer); resolve(); }
      else if (d.m.t === "closed") onClose("The TV left the game.");
      else onMsg(d.m);
    };
    up({ t: "join", name });
  });
  addEventListener("pagehide", () => up({ t: "leave" }));
  return { mode: "local", send: (m) => up({ t: "from", m }) };
}

export const _pieces = { sendOn, receiver }; // (for tests)
