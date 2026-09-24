// Jellybrawl signalling: the introductions for peer-to-peer play. Hosts that
// can't hold WebSockets open (Netlify) still let phones reach the TV: each
// phone and the TV swap one WebRTC offer and answer through these few HTTP
// calls, then talk directly (on the same Wi-Fi the game never leaves the
// room). The same handler runs in server.mjs (--p2p, rooms in memory) and in
// the Netlify Function (netlify/functions/jellybrawl.mjs, rooms in Blobs).
//
//   GET  config                          -> { iceServers }
//   POST room                            -> { code, token }          (the TV opens a room)
//   POST offer   { room, pid, name, sdp } -> 204 | 404               (a phone knocks)
//   GET  inbox?room=&token=[&touch=1]    -> [{ pid, name, sdp }]     (the TV collects knocks)
//   POST answer  { room, token, pid, sdp } -> 204                    (the TV answers one)
//   GET  answer?room=&pid=               -> { sdp } | 204            (the phone collects it)
//   POST close   { room, token }         -> 204                      (the TV leaves)
//
// store: { get(key) -> object | null, set(key, object), del(key), list(prefix) -> keys }

const LETTERS = "ABCDEFGHJKLMNPQRSTUVWXYZ";
const STALE = 2 * 60_000; // a TV that hasn't checked in for two minutes has gone
export const DEFAULT_ICE = [{ urls: ["stun:stun.l.google.com:19302", "stun:stun.cloudflare.com:3478"] }];

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
const empty = (status = 204) => new Response(null, { status, headers: { "cache-control": "no-store" } });
const clean = (s, max) => String(s ?? "").slice(0, max);
const codeOk = (c) => /^[A-Z]{4}$/.test(c);

export function signal(store, { iceServers = DEFAULT_ICE, now = () => Date.now() } = {}) {
  const room = async (code) => (codeOk(code) ? store.get(`room-${code}`) : null);
  const host = async (code, token) => { const r = await room(code); return r && token && r.token === token ? r : null; };

  async function handle(req) {
    const url = new URL(req.url), what = url.pathname.replace(/\/+$/, "").split("/").pop(), q = url.searchParams;
    const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
    const code = clean(body.room ?? q.get("room"), 4).toUpperCase();

    if (what === "config") return json({ iceServers });

    if (what === "room" && req.method === "POST") {
      let c;
      for (let k = 0; k < 20; k++) {
        c = Array.from({ length: 4 }, () => LETTERS[Math.floor(Math.random() * LETTERS.length)]).join("");
        const old = await store.get(`room-${c}`);
        if (!old || now() - old.seen > STALE) break;
      }
      const token = crypto.randomUUID();
      await store.set(`room-${c}`, { token, seen: now() });
      return json({ code: c, token });
    }

    if (what === "offer" && req.method === "POST") {
      const r = await room(code), pid = clean(body.pid, 40), sdp = clean(body.sdp, 20000);
      if (!r || now() - r.seen > STALE) return json({ error: "No room with that code." }, 404);
      if (!pid || !sdp) return json({ error: "Bad offer." }, 400);
      await store.del(`out-${code}-${pid}`); // an old answer is for an old offer
      await store.set(`in-${code}-${pid}`, { name: clean(body.name, 12) || "Player", sdp });
      return empty();
    }

    if (what === "inbox" && req.method === "GET") {
      const r = await host(code, q.get("token"));
      if (!r) return json({ error: "Not your room." }, 403);
      if (q.get("touch")) await store.set(`room-${code}`, { ...r, seen: now() });
      const out = [];
      for (const key of await store.list(`in-${code}-`)) {
        const o = await store.get(key);
        await store.del(key);
        if (o) out.push({ pid: key.slice(`in-${code}-`.length), name: o.name, sdp: o.sdp });
      }
      return json(out);
    }

    if (what === "answer" && req.method === "POST") {
      if (!(await host(code, body.token))) return json({ error: "Not your room." }, 403);
      const pid = clean(body.pid, 40);
      await store.set(`out-${code}-${pid}`, { sdp: clean(body.sdp, 20000) });
      return empty();
    }

    if (what === "answer" && req.method === "GET") {
      const key = `out-${code}-${clean(q.get("pid"), 40)}`, a = codeOk(code) ? await store.get(key) : null;
      if (!a) return empty();
      await store.del(key);
      return json(a);
    }

    if (what === "close" && req.method === "POST") {
      if (await host(code, body.token)) for (const key of [`room-${code}`, ...(await store.list(`in-${code}-`)), ...(await store.list(`out-${code}-`))]) await store.del(key);
      return empty();
    }

    return json({ error: "Not found." }, 404);
  }
  return { handle };
}

// rooms in memory (server.mjs --p2p, and tests)
export function memoryStore() {
  const m = new Map();
  return {
    get: async (k) => (m.has(k) ? structuredClone(m.get(k)) : null),
    set: async (k, v) => void m.set(k, structuredClone(v)),
    del: async (k) => void m.delete(k),
    list: async (p) => [...m.keys()].filter((k) => k.startsWith(p)),
  };
}
