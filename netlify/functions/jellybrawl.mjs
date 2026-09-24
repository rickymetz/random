// Jellybrawl on Netlify: the signalling that lets phones reach the TV
// peer-to-peer (Netlify can't hold the WebSocket relay open). The logic is
// ideas/jellybrawl/signal.mjs; rooms live in Netlify Blobs, read and written
// with strong consistency so an answer is there the moment it's written.
//
// Optional env var JB_ICE_SERVERS: a JSON array of RTCIceServer entries (add a
// TURN server for phones on a different network from the TV).
import { getStore } from "../vendor/netlify-blobs.mjs";
import { signal, DEFAULT_ICE } from "../../ideas/jellybrawl/signal.mjs";

function iceServers() {
  try { const v = JSON.parse(process.env.JB_ICE_SERVERS || "null"); if (Array.isArray(v)) return v; } catch {}
  return DEFAULT_ICE;
}

export default async (req) => {
  const blobs = getStore({ name: "jellybrawl", consistency: "strong" });
  const store = {
    get: (k) => blobs.get(k, { type: "json" }),
    set: (k, v) => blobs.setJSON(k, v),
    del: (k) => blobs.delete(k).catch(() => {}), // (gone already is fine)
    list: async (prefix) => (await blobs.list({ prefix })).blobs.map((b) => b.key),
  };
  return signal(store, { iceServers: iceServers() }).handle(req);
};

export const config = { path: "/api/jellybrawl/*" };
