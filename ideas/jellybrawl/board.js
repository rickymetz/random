// Board mode — the Mario Party half. Players take turns rolling on their
// phone and hopping along a themed map (boards.js) with forks, where they
// pick a path on their phone: blue spaces pay coins, red ones take them, the
// shop sells items (kept secret on your phone), duel spaces start a 1v1
// microgame for coins, ? spaces are random events, and passing the star with
// 20 coins buys a star (which then moves). Maps add their own spaces: tolls,
// warp pipes, an erupting volcano. After everyone has moved there's a
// minigame, whose points become coins. Most stars wins; coins break ties.
//
// tv.js owns the session; this module owns the board and talks back through
// `api`: { players, layout, send, sfx, shake, byPid, bg, map, minigame(), duel(a, b, done) }.

import { W, H, INK, text, outlined, shout, rrect, circle, blob, star, tag, fit } from "./gfx.js";
import { MAPS } from "./boards.js";

const STAR_COST = 20, BLUE = 3, RED = 3, DUEL_POT = 10, MAX_ITEMS = 3, STEP = 0.24, TOLL = 6, ERUPT = 3;
const ITEMS = {
  double: { name: "Double dice", price: 5, blurb: "Roll two dice this turn." },
  warp: { name: "Warp", price: 8, blurb: "Swap places with a random rival." },
  steal: { name: "Pickpocket", price: 10, blurb: "Steal 5 coins from the richest rival." },
};
export function makeBoard(api) {
  const ids = Object.keys(MAPS), pickId = api.map && MAPS[api.map] ? api.map : ids[Math.floor(Math.random() * ids.length)];
  const map = MAPS[pickId]();
  const spaces = map.nodes;
  const B = { turn: 0, order: [], cur: 0, phase: "idle", t: 0, starAt: 0, toast: null, dice: null, steps: 0, hop: 0, from: null, fork: null };
  // spaces from a to b along the arrows (for bots, and the phone's fork hints)
  function dist(a, b) {
    const seen = new Map([[a, 0]]), q = [a];
    while (q.length) { const x = q.shift(); if (x === b) return seen.get(x); for (const y of spaces[x].next) if (!seen.has(y)) { seen.set(y, seen.get(x) + 1); q.push(y); } }
    return 99;
  }
  const P = () => api.players();
  const current = () => api.byPid(B.order[B.cur]);
  const auto = (p) => !p || p.bot || !p.connected;

  function relocateStar() {
    const blues = spaces.map((s, i) => i).filter((i) => i !== map.start && spaces[i].k === "B" && spaces[i].next.length === 1 && i !== B.starAt && !P().some((p) => p.pos === i));
    B.starAt = blues[Math.floor(Math.random() * blues.length)];
  }
  function say(msg, color = "#fff", dur = 1.4) { B.toast = { msg, color, t: 0, dur }; }
  const busy = () => B.toast && B.toast.t < B.toast.dur;

  function rollLayout(p) {
    return { kind: "roll", text: "Your turn!", sub: `${p.score} coins · ★ ${p.stars}`, items: p.items.map((id, i) => ({ id: `${id}:${i}`, label: ITEMS[id].name })), dbl: !!p.dbl };
  }
  function waitAll(except, text, sub) { for (const q of P()) if (q.pid !== except) api.layout(q.pid, { kind: "wait", text, sub }); }

  function beginTurn() {
    const p = current();
    B.phase = "await"; B.t = 0; B.dice = null;
    api.layout(p.pid, rollLayout(p));
    waitAll(p.pid, `${p.name}'s turn`, "Watch the board");
    api.send(p.pid, { t: "buzz", ms: 120 });
  }

  function useItem(p, id) {
    const i = p.items.indexOf(id);
    if (i < 0 || B.phase !== "await") return;
    p.items.splice(i, 1);
    const rivals = P().filter((q) => q !== p);
    if (id === "double") { p.dbl = true; say(`${p.name} rolls double!`, "#f9f002"); }
    else if (id === "warp" && rivals.length) {
      const q = rivals[Math.floor(Math.random() * rivals.length)];
      [p.pos, q.pos] = [q.pos, p.pos];
      say(`WARP! ${p.name} ⇄ ${q.name}`, "#b026ff"); api.sfx.power(); api.shake(10);
    } else if (id === "steal" && rivals.length) {
      const q = [...rivals].sort((a, b) => b.score - a.score)[0], n = Math.min(5, q.score);
      q.score -= n; p.score += n;
      say(`${p.name} pickpockets ${n} from ${q.name}!`, "#ff2a6d"); api.sfx.pop();
    }
    if (!auto(p)) api.layout(p.pid, rollLayout(p));
  }

  function roll(p) {
    if (B.phase !== "await") return;
    const d = [1 + Math.floor(Math.random() * 6)];
    if (p.dbl) d.push(1 + Math.floor(Math.random() * 6));
    p.dbl = false;
    B.dice = { vals: d, t: 0 }; B.steps = d.reduce((a, b) => a + b, 0);
    B.phase = "dice"; B.t = 0;
    api.sfx.tick();
    api.layout(p.pid, { kind: "wait", text: `You rolled ${B.steps}!`, sub: "Hop hop hop…" });
  }

  function passStar(p) {
    if (p.score >= STAR_COST) {
      p.score -= STAR_COST; p.stars++; p.stats.stars = (p.stats.stars || 0) + 1;
      say(`★ ${p.name} buys a STAR! ★`, "#f9f002", 1.8); api.sfx.win(); api.shake(14);
      relocateStar();
    } else say(`${p.name} can't afford the star (${STAR_COST} coins)`, "#888", 1.2);
  }

  function land(p) {
    const s = spaces[p.pos];
    if (s.k === "B") { p.score += BLUE; say(`+${BLUE} coins`, "#05d9e8", 0.9); api.sfx.dot(); B.phase = "next"; }
    else if (s.k === "R") { p.score = Math.max(0, p.score - RED); say(`−${RED} coins`, "#ff2a6d", 0.9); api.sfx.lose(); B.phase = "next"; }
    else if (s.k === "$") openShop(p);
    else if (s.k === "D") openDuel(p);
    else if (s.k === "?") { event(p); B.phase = B.phase === "move" ? "move" : "next"; }
    else if (s.k === "P") {
      p.pos = s.pair; api.sfx.power(); api.shake(8);
      say(`${p.name} slides down the pipe!`, "#39ff14", 1.3); B.phase = "next";
    } else if (s.k === "V") {
      let got = 0;
      for (const q of P()) if (q !== p) { const n = Math.min(ERUPT, q.score); q.score -= n; got += n; }
      p.score += got; api.sfx.hit(); api.shake(28);
      say(`ERUPTION! ${p.name} collects ${got} coins`, "#ff6b00", 1.8); B.phase = "next";
    } else B.phase = "next"; // toll spaces were paid on the way in
    B.t = 0;
  }

  // ? spaces: something random happens
  function event(p) {
    const r = Math.random();
    if (r < 0.3) { p.score += 6; say(`Lucky find! ${p.name} +6 coins`, "#39ff14"); api.sfx.win(); }
    else if (r < 0.55) { p.score = Math.max(0, p.score - 5); say(`Ouch! ${p.name} drops 5 coins`, "#ff2a6d"); api.sfx.lose(); }
    else if (r < 0.8) { B.steps = 3; say(`Tailwind! ${p.name} hops 3 more`, "#05d9e8"); api.sfx.power(); B.phase = "move"; return; }
    else if (p.items.length < MAX_ITEMS) {
      const id = Object.keys(ITEMS)[Math.floor(Math.random() * 3)];
      p.items.push(id); say(`${p.name} found a mystery item!`, "#f9f002"); api.sfx.dot();
    } else { p.score += 3; say(`${p.name} +3 coins`, "#39ff14"); }
    B.phase = "next";
  }

  function forkLayout(p, node) {
    return { kind: "choose", text: "Which way?", options: node.next.map((id) => ({ id: String(id), title: spaces[id].label || "This way", kind: `★ ${dist(id, B.starAt) + 1} spaces away`, blurb: spaces[id].k === "T" ? `Costs ${TOLL} coins` : "" })) };
  }
  function takeFork(p, id) {
    if (B.phase !== "fork" || !spaces[p.pos].next.includes(+id)) return;
    B.fork = +id; B.phase = "move"; B.t = STEP; // step straight on
    if (!auto(p)) api.layout(p.pid, { kind: "wait", text: "Off you go!", sub: `${B.steps} to go` });
  }

  function shopLayout(p) {
    const opts = Object.entries(ITEMS).filter(([, it]) => it.price <= p.score && p.items.length < MAX_ITEMS)
      .map(([id, it]) => ({ id, title: it.name, kind: `${it.price} coins`, blurb: it.blurb }));
    return { kind: "choose", text: `Shop · ${p.score} coins`, options: [...opts, { id: "done", title: "I'm done", kind: `${p.items.length}/${MAX_ITEMS} items`, blurb: "Leave the shop" }] };
  }
  function openShop(p) {
    B.phase = "shop"; B.t = 0;
    say(`${p.name} goes shopping`, "#f9f002", 1);
    if (!auto(p)) api.layout(p.pid, shopLayout(p));
  }
  function buy(p, id) {
    if (B.phase !== "shop") return;
    const it = ITEMS[id];
    if (id === "done" || !it) { B.phase = "next"; B.t = 0; return; }
    if (it.price > p.score || p.items.length >= MAX_ITEMS) return;
    p.score -= it.price; p.items.push(id); api.sfx.dot();
    say(`${p.name} bought something…`, "#f9f002", 0.8); // what, stays secret
    if (!auto(p)) api.layout(p.pid, shopLayout(p));
  }

  function openDuel(p) {
    B.phase = "duelpick"; B.t = 0;
    say(`DUEL! ${p.name} picks a rival`, "#b026ff", 1.2); api.sfx.slam();
    if (!auto(p)) api.layout(p.pid, { kind: "choose", text: "Pick your rival", options: P().filter((q) => q !== p).map((q) => ({ id: q.pid, title: q.name, kind: `${q.score} coins`, blurb: `Winner takes up to ${DUEL_POT} coins` })) });
  }
  function startDuel(p, rivalPid) {
    const q = api.byPid(rivalPid);
    if (B.phase !== "duelpick" || !q || q === p) return;
    B.phase = "duel";
    api.duel(p, q, (r) => {
      const [first] = r.ranking;
      if (first.length === 1) {
        const w = api.byPid(first[0]), l = w === p ? q : p, n = Math.min(DUEL_POT, l.score);
        l.score -= n; w.score += n; w.stats.duels = (w.stats.duels || 0) + 1;
        say(`${w.name} wins the duel · +${n} coins`, "#b026ff", 1.8);
      } else say("Duel draw · nobody pays", "#888", 1.4);
      B.phase = "next"; B.t = 0;
    });
  }

  const api2 = {
    spaces,
    get state() { return { turn: B.turn, phase: B.phase, cur: B.order[B.cur], starAt: B.starAt, steps: B.steps }; }, // for tests
    dist,

    map: pickId,
    newGame() {
      for (const p of P()) { p.pos = map.start; p.stars = 0; p.items = []; p.dbl = false; p.score = 10; } // p.score is coins
      B.turn = 0;
      relocateStar();
    },
    startTurn() {
      B.order = P().map((p) => p.pid);
      B.cur = 0; B.turn++;
      say(`TURN ${B.turn}`, "#fff", 1.1);
      B.phase = "intro"; B.t = 0;
    },
    input(p, m) {
      if (!p || p.pid !== B.order[B.cur]) return;
      if (m.t === "roll") roll(p);
      else if (m.t === "use") useItem(p, String(m.id).split(":")[0]);
      else if (m.t === "pick" && B.phase === "shop") buy(p, m.id);
      else if (m.t === "pick" && B.phase === "duelpick") startDuel(p, m.id);
      else if (m.t === "pick" && B.phase === "fork") takeFork(p, m.id);
    },
    tick(dt) {
      B.t += dt;
      if (B.toast) B.toast.t += dt;
      if (B.dice) B.dice.t += dt;
      const p = current();
      if (B.phase === "intro") { if (!busy()) beginTurn(); return; }
      if (B.phase === "await") {
        // bots (and dropped phones) think for a beat, sometimes use an item, then roll
        if (auto(p) && B.t > 0.9) {
          if (p.items.length && Math.random() < 0.5) useItem(p, p.items[0]);
          if (!busy()) roll(p);
        } else if (B.t > 15) roll(p);
        return;
      }
      if (B.phase === "dice") { if (B.t > 1.1) { B.phase = "move"; B.t = 0; } return; }
      if (B.phase === "move") {
        if (busy() || B.t < STEP) return;
        const here = spaces[p.pos];
        // a fork: stop and ask (bots head for the star, mostly, and dodge tolls they can't afford)
        if (here.next.length > 1 && B.fork == null) {
          B.phase = "fork"; B.t = 0;
          say(`${p.name}: which way?`, "#fff", 0.8);
          if (!auto(p)) api.layout(p.pid, forkLayout(p, here));
          return;
        }
        const to = B.fork != null ? B.fork : here.next[0];
        B.fork = null; B.from = p.pos;
        B.t = 0; B.hop = 1;
        p.pos = to;
        B.steps--;
        api.sfx.flap();
        if (spaces[to].k === "T") { const n = Math.min(TOLL, p.score); p.score -= n; say(`TOLL · ${p.name} pays ${n}`, "#ff6b00", 0.9); api.sfx.crunch(); }
        if (p.pos === B.starAt) passStar(p);
        if (B.steps <= 0) { B.phase = "landing"; B.t = 0; }
        return;
      }
      if (B.phase === "fork") {
        if ((auto(p) && B.t > 0.9) || B.t > 12) {
          const opts = spaces[p.pos].next.filter((id) => spaces[id].k !== "T" || p.score >= TOLL + 8);
          const pool = opts.length ? opts : spaces[p.pos].next;
          const best = [...pool].sort((a, b) => dist(a, B.starAt) - dist(b, B.starAt))[0];
          takeFork(p, Math.random() < 0.75 ? best : pool[Math.floor(Math.random() * pool.length)]);
        }
        return;
      }
      if (B.phase === "landing") { if (!busy() && B.t > 0.25) land(p); return; }
      if (B.phase === "shop") {
        if (auto(p) && B.t > 0.8) {
          const can = Object.entries(ITEMS).filter(([, it]) => it.price <= p.score - 8 && p.items.length < MAX_ITEMS);
          buy(p, can.length && Math.random() < 0.7 ? can[Math.floor(Math.random() * can.length)][0] : "done");
          if (B.phase === "shop") B.t = 0;
        } else if (B.t > 12) buy(p, "done");
        return;
      }
      if (B.phase === "duelpick") {
        if ((auto(p) && B.t > 1.2) || B.t > 12) {
          const rivals = P().filter((q) => q !== p).sort((a, b) => b.score - a.score);
          startDuel(p, rivals[0].pid); // bots go after the richest
        }
        return;
      }
      if (B.phase === "next") {
        if (busy() || B.t < 0.35) return;
        B.cur++;
        if (B.cur < B.order.length) beginTurn();
        else { B.phase = "done"; api.minigame(); }
      }
    },

    draw(g, t) {
      map.backdrop(g, t, api);
      const th = map.theme, cp = current();
      // paths: every arrow between spaces
      g.lineCap = "round";
      for (const [pass, w, col] of [[0, 30, "rgba(0,0,0,.55)"], [1, 9, th.path]]) {
        g.lineWidth = w; g.strokeStyle = col;
        for (const s of spaces) for (const n of s.next) { const o = spaces[n]; g.beginPath(); g.moveTo(s.x, s.y); g.lineTo(o.x, o.y); g.stroke(); }
      }
      // forks: arrows showing the ways you can go (pulsing while someone's choosing)
      spaces.forEach((s, i) => {
        if (s.next.length < 2) return;
        const choosing = B.phase === "fork" && cp && cp.pos === i;
        for (const n of s.next) {
          const o = spaces[n], a = Math.atan2(o.y - s.y, o.x - s.x), mx = s.x + Math.cos(a) * 58, my = s.y + Math.sin(a) * 58, sz = choosing ? 20 + Math.sin(t * 10) * 5 : 15;
          g.save(); g.translate(mx, my); g.rotate(a);
          g.beginPath(); g.moveTo(sz, 0); g.lineTo(-sz * 0.7, -sz * 0.8); g.lineTo(-sz * 0.7, sz * 0.8); g.closePath();
          g.fillStyle = choosing ? "#fff" : th.glow; g.fill(); g.lineWidth = 3; g.strokeStyle = INK; g.stroke(); g.restore();
          if (choosing && o.label) tag(g, o.label, o.x, o.y + 62, "#fff", 20);
        }
      });
      // spaces
      const COL = { B: "#05d9e8", R: "#ff2a6d", D: "#b026ff", $: "#f9f002", "?": "#efe6d2", T: "#ff6b00", P: "#39ff14", V: "#ff3b00" };
      const MARK = { R: "−", D: "VS", $: "$", "?": "?", T: "TOLL", P: "◎", V: "▲" };
      spaces.forEach((s, i) => {
        const r = s.k === "V" ? 40 : 30;
        circle(g, s.x + 4, s.y + 5, r, INK);
        if (s.k === "V") { g.save(); g.shadowColor = "#ff6b00"; g.shadowBlur = 25 + Math.sin(t * 5) * 10; circle(g, s.x, s.y, r, COL.V, INK, 6); g.restore(); }
        else circle(g, s.x, s.y, r, COL[s.k], INK, 6);
        const mark = MARK[s.k];
        if (mark) text(g, mark, s.x, s.y + 2, mark.length > 2 ? 17 : mark === "VS" ? 22 : 32, INK, "center", 900);
        if (i === map.start) tag(g, "START", s.x, s.y + 52, "#fff", 16);
        if (i === B.starAt) star(g, s.x, s.y - 4 + Math.sin(t * 4) * 5, 28 + Math.sin(t * 6) * 3, "#f9f002", INK);
      });
      // players (stacked when sharing a space); the mover hops between spaces
      const byPos = {};
      for (const p of P()) (byPos[p.pos] ||= []).push(p);
      for (const [pos, ps] of Object.entries(byPos)) {
        const s = spaces[pos];
        ps.forEach((p, k) => {
          const off = (k - (ps.length - 1) / 2) * 28, me = p === cp && B.phase !== "done";
          let x = s.x + off, y = s.y - 42 - k * 6;
          if (me && B.phase === "move" && B.from != null && B.t < STEP) {
            const f = spaces[B.from], u = B.t / STEP;
            x = f.x + (s.x - f.x) * u; y = f.y + (s.y - f.y) * u - 42 - Math.sin(u * Math.PI) * 38;
          }
          blob(g, p, x, y, me ? 30 : 24, { alpha: p.connected || p.bot ? 1 : 0.5 });
        });
      }
      // top bar: turn + map, whose go + dice, standings
      rrect(g, 0, 0, W, 150, 0, "rgba(13,2,33,.88)");
      g.fillStyle = th.path; g.fillRect(0, 148, W, 4);
      outlined(g, `TURN ${B.turn}/${api.turns()}`, 150, 52, 42, "#fff");
      text(g, map.name.toUpperCase(), 150, 108, 28, th.glow, "center", 900);
      if (cp && B.phase !== "done") {
        blob(g, cp, 380, 75, 42);
        text(g, `${cp.name}'s go`, 440, 55, 36, cp.color, "left", 900);
        const what = { await: auto(cp) ? "thinking…" : "roll on your phone!", dice: "rolling…", move: `${B.steps} to go`, fork: auto(cp) ? "picking a path…" : "pick a path on your phone!", shop: "shopping…", duelpick: "picking a rival…", duel: "DUEL!" }[B.phase] || "";
        text(g, what, 440, 100, 24, "#fff", "left", 700);
      }
      if (B.dice && B.phase !== "await") {
        B.dice.vals.forEach((v, i) => {
          const spin = B.dice.t < 0.8, n = spin ? 1 + Math.floor(Math.random() * 6) : v, x = 905 + i * 84, y = 75;
          g.save(); g.translate(x, y); g.rotate(spin ? Math.sin(B.dice.t * 30) * 0.4 : 0);
          rrect(g, -36, -36, 72, 72, 12, "#fff", INK, 5);
          text(g, String(n), 0, 3, 46, INK, "center", 900);
          g.restore();
        });
      }
      const list = [...P()].sort((a, b) => (b.stars - a.stars) || (b.score - a.score));
      list.forEach((p, i) => {
        const x = 1090 + (i % 4) * 205, y = 42 + Math.floor(i / 4) * 64;
        blob(g, p, x + 22, y, 22);
        text(g, `★${p.stars}`, x + 52, y, 26, "#f9f002", "left", 900);
        text(g, `●${p.score}`, x + 110, y, 24, "#05d9e8", "left", 900);
      });
      if (B.toast && B.toast.t < B.toast.dur) shout(g, B.toast.msg, W / 2, 205, fit(g, B.toast.msg, 64, W - 200), B.toast.color, B.toast.t);
    },
  };
  return api2;
}
