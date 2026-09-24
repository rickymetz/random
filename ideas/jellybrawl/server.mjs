#!/usr/bin/env node
// Jellybrawl relay: serves this folder over HTTP and relays messages between
// the TV (host) and phones (players) over WebSocket at /ws. Zero dependencies.
//
//   node ideas/jellybrawl/server.mjs [port] [--p2p]     (default 8787)
//
// --p2p serves the peer-to-peer signalling instead (signal.mjs, rooms in
// memory), the way the Netlify deploy works: phones talk to the TV directly
// over WebRTC and this server only introduces them.
//
// Open http://<this machine's LAN address>:8787/tv.html on the big screen
// (a laptop on HDMI, or AirPlay a browser to an Apple TV), and phones on the
// same Wi-Fi join at http://<LAN address>:8787/.
//
// Protocol (JSON text frames):
//   host   connects /ws?role=host                    <- {t:"room", code, urls}
//   player connects /ws?role=player&room=&pid=&name=  <- {t:"joined", pid} | {t:"error"}
//   player -> any object            host <- {t:"from", pid, m}
//   host   -> {t:"to", pid, m}      that player <- m
//   host   -> {t:"all", m}          every player <- m
//   player disconnect               host <- {t:"leave", pid}
//   player (re)connect              host <- {t:"join", pid, name}
//   host disconnect                 players <- {t:"closed"}

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { signal, memoryStore, DEFAULT_ICE } from "./signal.mjs";

const dir = path.dirname(fileURLToPath(import.meta.url));
const port = Number(process.argv.slice(2).find((a) => /^\d+$/.test(a)) || process.env.PORT || 8787);
const P2P = process.argv.includes("--p2p") || process.env.JB_P2P === "1";
let ice = DEFAULT_ICE;
try { const v = JSON.parse(process.env.JB_ICE_SERVERS || "null"); if (Array.isArray(v)) ice = v; } catch {}
const sig = P2P ? signal(memoryStore(), { iceServers: ice }) : null;
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".webm": "video/webm", ".woff2": "font/woff2" };

function lanUrls() {
  const out = [];
  for (const list of Object.values(os.networkInterfaces()))
    for (const a of list || []) if (a.family === "IPv4" && !a.internal) out.push(`http://${a.address}:${port}/`);
  return out.length ? out : [`http://localhost:${port}/`];
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, "http://x");
  if (!sig && url.pathname.startsWith("/api/jellybrawl/")) return void res.writeHead(204).end(); // no peer-to-peer here: the phones use the relay
  if (sig && url.pathname.startsWith("/api/jellybrawl/")) { // the signalling, as the Netlify Function serves it
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", async () => {
      const body = req.method === "POST" ? Buffer.concat(chunks).toString() : undefined;
      const out = await sig.handle(new Request(`http://${req.headers.host}${req.url}`, { method: req.method, body }));
      res.writeHead(out.status, Object.fromEntries(out.headers));
      res.end(out.status === 204 ? undefined : Buffer.from(await out.arrayBuffer()));
    });
    return;
  }
  let rel = decodeURIComponent(url.pathname).replace(/^\/+/, "") || "index.html";
  if (rel.endsWith("/")) rel += "index.html";
  const file = path.join(dir, rel);
  if (!file.startsWith(dir + path.sep)) return void res.writeHead(403).end();
  fs.readFile(file, (err, body) => {
    if (err) return void res.writeHead(404).end("Not found");
    const head = { "content-type": TYPES[path.extname(file)] || "application/octet-stream", "cache-control": "no-store", "accept-ranges": "bytes" };
    // byte ranges, so the preview page's video can seek
    const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || "");
    if (range && (range[1] || range[2])) {
      const start = range[1] ? +range[1] : Math.max(0, body.length - +range[2]), end = range[1] && range[2] ? Math.min(+range[2], body.length - 1) : body.length - 1;
      if (start > end || start >= body.length) return void res.writeHead(416, { "content-range": `bytes */${body.length}` }).end();
      res.writeHead(206, { ...head, "content-range": `bytes ${start}-${end}/${body.length}` });
      return void res.end(body.subarray(start, end + 1));
    }
    res.writeHead(200, head);
    res.end(body);
  });
});

/* ------------------------------------------------------ minimal WebSocket */

function frame(text) {
  const data = Buffer.from(text);
  const n = data.length;
  const head = n < 126 ? Buffer.from([0x81, n]) : n < 65536 ? Buffer.from([0x81, 126, n >> 8, n & 255]) : Buffer.concat([Buffer.from([0x81, 127, 0, 0, 0, 0]), Buffer.from([(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255])]);
  return Buffer.concat([head, data]);
}

function accept(req, socket, onText, onClose) {
  const key = req.headers["sec-websocket-key"];
  const hash = crypto.createHash("sha1").update(key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11").digest("base64");
  socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${hash}\r\n\r\n`);
  socket.setNoDelay(true);
  let buf = Buffer.alloc(0);
  let closed = false;
  const conn = {
    send(obj) { if (!closed) socket.write(frame(JSON.stringify(obj))); },
    close() { if (!closed) { socket.end(Buffer.from([0x88, 0])); } },
  };
  socket.on("data", (chunk) => {
    buf = buf.length ? Buffer.concat([buf, chunk]) : chunk;
    if (buf.length > MAX_FRAME + 14) return void socket.destroy(); // nobody needs more than a selfie
    for (;;) {
      if (buf.length < 2) return;
      const op = buf[0] & 15;
      let len = buf[1] & 127, off = 2;
      if (len === 126) { if (buf.length < 4) return; len = buf.readUInt16BE(2); off = 4; }
      else if (len === 127) { if (buf.length < 10) return; len = Number(buf.readBigUInt64BE(2)); off = 10; }
      if (len > MAX_FRAME) return void socket.destroy();
      const masked = buf[1] & 128;
      const mask = masked ? buf.subarray(off, off + 4) : null;
      if (masked) off += 4;
      if (buf.length < off + len) return;
      const data = Buffer.from(buf.subarray(off, off + len));
      buf = buf.subarray(off + len);
      if (mask) for (let i = 0; i < data.length; i++) data[i] ^= mask[i & 3];
      if (op === 8) return void conn.close();
      if (op === 9) { socket.write(Buffer.concat([Buffer.from([0x8a, data.length]), data])); continue; }
      if (op === 1) { try { onText(JSON.parse(data.toString())); } catch {} }
    }
  });
  const done = () => { if (!closed) { closed = true; onClose(); } };
  socket.on("close", done);
  socket.on("error", done);
  return conn;
}

/* ------------------------------------------------------------------ rooms */

const rooms = new Map(); // code -> { host, token, players: Map(pid -> conn), gone }
const MAX_FRAME = 512 * 1024, MAX_ROOMS = 500, HOST_GRACE = 60_000;
// per-IP budgets, refilled every minute: opening rooms is rare, joining less so
const budget = new Map();
setInterval(() => budget.clear(), 60_000).unref();
function allow(ip, kind, max) { const k = ip + kind, n = (budget.get(k) || 0) + 1; budget.set(k, n); return n <= max; }
const LETTERS = "ABCDEFGHJKLMNPQRSTUVWXYZ";
function newCode() {
  let c;
  do c = Array.from({ length: 4 }, () => LETTERS[crypto.randomInt(LETTERS.length)]).join("");
  while (rooms.has(c));
  return c;
}

server.on("upgrade", (req, socket) => {
  const url = new URL(req.url, "http://x");
  if (!url.pathname.endsWith("/ws")) return void socket.destroy();
  const role = url.searchParams.get("role");

  const ip = req.socket.remoteAddress || "?";

  if (role === "host") {
    // a TV that blipped comes back with its code and secret and keeps the room
    const back = rooms.get((url.searchParams.get("code") || "").toUpperCase());
    const resuming = back && back.token === url.searchParams.get("token") && back.gone;
    if (!resuming && (!allow(ip, "host", 20) || rooms.size >= MAX_ROOMS)) return void socket.destroy();
    const code = resuming ? url.searchParams.get("code").toUpperCase() : newCode();
    const room = resuming ? back : { host: null, token: crypto.randomUUID(), players: new Map(), gone: null };
    if (resuming) { clearTimeout(room.gone); room.gone = null; }
    rooms.set(code, room);
    const host = accept(req, socket, (msg) => {
      if (msg.t === "to") room.players.get(msg.pid)?.send(msg.m);
      else if (msg.t === "all") for (const p of room.players.values()) p.send(msg.m);
    }, () => {
      if (room.host !== host) return;
      room.gone = setTimeout(() => { // no TV for a minute: close the room
        rooms.delete(code);
        for (const p of room.players.values()) { p.send({ t: "closed" }); p.close(); }
      }, HOST_GRACE);
    });
    room.host = host;
    host.send({ t: "room", code, token: room.token, urls: lanUrls(), resumed: !!resuming });
    if (resuming) for (const pid of room.players.keys()) host.send({ t: "join", pid, name: room.names?.get(pid) || "" });
    console.log(`room ${code} ${resuming ? "resumed" : "opened"}`);
    return;
  }

  if (!allow(ip, "join", 120)) return void socket.destroy();

  const room = rooms.get((url.searchParams.get("room") || "").toUpperCase());
  const pid = (url.searchParams.get("pid") || crypto.randomUUID()).slice(0, 40);
  const name = (url.searchParams.get("name") || "Player").slice(0, 12);
  let conn;
  conn = accept(req, socket, (m) => room?.host.send({ t: "from", pid, m }), () => {
    if (room && room.players.get(pid) === conn) { room.players.delete(pid); room.host.send({ t: "leave", pid }); }
  });
  if (!room) { conn.send({ t: "error", msg: "No room with that code." }); return void conn.close(); }
  const old = room.players.get(pid);
  if (old) { old.send({ t: "replaced" }); old.close(); } // the same seat opened again replaces the old socket
  room.players.set(pid, conn);
  (room.names ??= new Map()).set(pid, name);
  conn.send({ t: "joined", pid });
  room.host.send({ t: "join", pid, name });
});

server.listen(port, () => {
  console.log(`Jellybrawl ${P2P ? "peer-to-peer signalling" : "relay"} running.`);
  for (const u of lanUrls()) console.log(`  TV:     ${u}tv.html\n  Phones: ${u}`);
});
