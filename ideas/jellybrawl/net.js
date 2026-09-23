// Transport between the TV (host) and the phones (players). Two backends with
// the same shape, picked automatically:
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

function code4() {
  const L = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  return Array.from({ length: 4 }, () => L[Math.floor(Math.random() * L.length)]).join("");
}

/** Opens a room. handlers: onJoin(pid, name), onLeave(pid), onInput(pid, msg). */
export async function hostRoom({ onJoin, onLeave, onInput }) {
  const base = location.href.replace(/[^/]*([?#].*)?$/, "");
  const ws = await openSocket(relayUrl() && relayUrl() + "?role=host");
  if (ws) {
    const room = await new Promise((resolve) => {
      ws.onmessage = (e) => {
        const msg = JSON.parse(e.data);
        if (msg.t === "room") resolve(msg);
        else if (msg.t === "join") onJoin(msg.pid, msg.name);
        else if (msg.t === "leave") onLeave(msg.pid);
        else if (msg.t === "from") onInput(msg.pid, msg.m);
      };
    });
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
  const url = relayUrl();
  const ws = await openSocket(url && `${url}?role=player&room=${code}&pid=${encodeURIComponent(pid)}&name=${encodeURIComponent(name)}`);
  if (ws) {
    await new Promise((resolve, reject) => {
      ws.onmessage = (e) => {
        const msg = JSON.parse(e.data);
        if (msg.t === "joined") resolve();
        else if (msg.t === "error") reject(new Error(msg.msg));
        else if (msg.t === "closed") onClose("The TV left the game.");
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
