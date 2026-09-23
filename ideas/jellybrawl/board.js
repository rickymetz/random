// Board mode — the Mario Party half. Players take turns rolling on their
// phone and hopping round a loop: blue spaces pay coins, red ones take them,
// the shop sells items (kept secret on your phone), duel spaces start a 1v1
// microgame for coins, and passing the star with 20 coins buys a star (which
// then moves). After everyone has moved there's a minigame, whose points
// become coins. Most stars wins; coins break ties.
//
// tv.js owns the session; this module owns the board and talks back through
// `api`: { players, layout, send, sfx, shake, byPid, bg, minigame(), duel(a, b, done) }.

import { W, H, INK, text, outlined, shout, rrect, circle, blob, star, tag, fit } from "./gfx.js";

const STAR_COST = 20, BLUE = 3, RED = 3, DUEL_POT = 10, MAX_ITEMS = 3, STEP = 0.24;
const ITEMS = {
  double: { name: "Double dice", price: 5, blurb: "Roll two dice this turn." },
  warp: { name: "Warp", price: 8, blurb: "Swap places with a random rival." },
  steal: { name: "Pickpocket", price: 10, blurb: "Steal 5 coins from the richest rival." },
};
// 26 spaces round the loop: mostly blue, a few red, duel (D) and shop ($)
const LAYOUT = "BBB$BRBDBBBRB$BDBRBBDBBRBB";

function loopPoints(n) {
  // a stadium-shaped loop around the middle of the screen
  const x0 = 250, x1 = 1670, y0 = 230, y1 = 960, r = (y1 - y0) / 2;
  const straight = x1 - x0 - 2 * r, per = 2 * straight + 2 * Math.PI * r;
  return Array.from({ length: n }, (_, i) => {
    let d = (i / n) * per;
    if (d < straight) return [x0 + r + d, y0];
    d -= straight;
    if (d < Math.PI * r) { const a = -Math.PI / 2 + d / r; return [x1 - r + Math.cos(a) * r, y0 + r + Math.sin(a) * r]; }
    d -= Math.PI * r;
    if (d < straight) return [x1 - r - d, y1];
    d -= straight;
    const a = Math.PI / 2 + d / r;
    return [x0 + r + Math.cos(a) * r, y0 + r + Math.sin(a) * r];
  });
}

export function makeBoard(api) {
  const pts = loopPoints(LAYOUT.length);
  const spaces = LAYOUT.split("").map((k, i) => ({ k, x: pts[i][0], y: pts[i][1] }));
  const B = { turn: 0, order: [], cur: 0, phase: "idle", t: 0, starAt: 0, toast: null, dice: null, steps: 0, hop: 0, duelWith: null };
  const P = () => api.players();
  const current = () => api.byPid(B.order[B.cur]);
  const auto = (p) => !p || p.bot || !p.connected;

  function relocateStar() {
    const blues = spaces.map((s, i) => i).filter((i) => i > 0 && spaces[i].k === "B" && i !== B.starAt && !P().some((p) => p.pos === i));
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
    B.t = 0;
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
    get state() { return { turn: B.turn, phase: B.phase, cur: B.order[B.cur], starAt: B.starAt }; }, // for tests

    newGame() {
      for (const p of P()) { p.pos = 0; p.stars = 0; p.items = []; p.dbl = false; p.score = 10; } // p.score is coins
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
        B.t = 0; B.hop = 1;
        p.pos = (p.pos + 1) % spaces.length;
        B.steps--;
        api.sfx.flap();
        if (p.pos === B.starAt) passStar(p);
        if (B.steps <= 0) { B.phase = "landing"; B.t = 0; }
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
      api.bg(265, W / 2, H / 2, false);
      // path
      g.lineWidth = 34; g.strokeStyle = "rgba(0,0,0,.5)"; g.lineJoin = "round";
      g.beginPath(); spaces.forEach((s, i) => g[i ? "lineTo" : "moveTo"](s.x, s.y)); g.closePath(); g.stroke();
      g.lineWidth = 10; g.strokeStyle = "#ff2a6d"; g.stroke();
      // spaces
      spaces.forEach((s, i) => {
        const col = { B: "#05d9e8", R: "#ff2a6d", D: "#b026ff", $: "#f9f002" }[s.k];
        circle(g, s.x + 4, s.y + 5, 34, INK);
        circle(g, s.x, s.y, 34, col, INK, 6);
        const mark = { R: "−", D: "VS", $: "$" }[s.k];
        if (mark) text(g, mark, s.x, s.y + 2, mark === "VS" ? 26 : 36, INK, "center", 900);
        if (i === 0) tag(g, "START", s.x, s.y + 58, "#fff", 18);
        if (i === B.starAt) star(g, s.x, s.y - 4 + Math.sin(t * 4) * 5, 30 + Math.sin(t * 6) * 3, "#f9f002", INK);
      });
      // players (stacked when sharing a space)
      const byPos = {};
      for (const p of P()) (byPos[p.pos] ||= []).push(p);
      const cp = current();
      for (const [pos, ps] of Object.entries(byPos)) {
        const s = spaces[pos];
        ps.forEach((p, k) => {
          const off = (k - (ps.length - 1) / 2) * 30, me = p === cp && B.phase !== "done";
          const hop = me && B.phase === "move" ? Math.sin(Math.min(1, B.t / STEP) * Math.PI) * 38 : 0;
          blob(g, p, s.x + off, s.y - 44 - hop - k * 6, me ? 30 : 24, { alpha: p.connected || p.bot ? 1 : 0.5 });
        });
      }
      // centre panel: turn, whose go, dice, standings
      rrect(g, 560, 330, 800, 520, 12, "rgba(13,2,33,.82)", "#05d9e8", 4);
      outlined(g, `TURN ${B.turn} / ${api.turns()}`, 960, 385, 52, "#fff");
      if (cp && B.phase !== "done") {
        blob(g, cp, 690, 485, 44);
        text(g, `${cp.name}'s go`, 760, 470, 40, cp.color, "left", 900);
        const what = { await: auto(cp) ? "thinking…" : "roll on your phone!", dice: "rolling…", move: `${B.steps} to go`, shop: "shopping…", duelpick: "picking a rival…", duel: "DUEL!" }[B.phase] || "";
        text(g, what, 760, 510, 28, "#fff", "left", 700);
      }
      if (B.dice && B.phase !== "await") {
        B.dice.vals.forEach((v, i) => {
          const spin = B.dice.t < 0.8, n = spin ? 1 + Math.floor(Math.random() * 6) : v, x = 1180 + (i - (B.dice.vals.length - 1) / 2) * 110, y = 490;
          g.save(); g.translate(x, y); g.rotate(spin ? Math.sin(B.dice.t * 30) * 0.4 : 0);
          rrect(g, -44, -44, 88, 88, 14, "#fff", INK, 6);
          text(g, String(n), 0, 3, 58, INK, "center", 900);
          g.restore();
        });
      }
      const list = [...P()].sort((a, b) => (b.stars - a.stars) || (b.score - a.score));
      list.forEach((p, i) => {
        const x = 610 + (i % 4) * 190, y = 620 + Math.floor(i / 4) * 110;
        blob(g, p, x + 20, y + 20, 26);
        text(g, `★ ${p.stars}`, x + 56, y + 6, 28, "#f9f002", "left", 900);
        text(g, `● ${p.score}`, x + 56, y + 38, 26, "#05d9e8", "left", 900);
      });
      if (B.toast && B.toast.t < B.toast.dur) shout(g, B.toast.msg, W / 2, 150, fit(g, B.toast.msg, 80, W - 200), B.toast.color, B.toast.t);
      text(g, "STAR COSTS 20 · PASS IT TO BUY", 960, 1045, 24, "rgba(255,255,255,.55)", "center", 900);
    },
  };
  return api2;
}
