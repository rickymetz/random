// Small canvas helpers shared by the TV screen and the minigames.
// Everything draws in a fixed 1920×1080 space; tv.js scales it to the screen.

export const W = 1920, H = 1080;
export const FONT = 'ui-rounded, "SF Pro Rounded", system-ui, -apple-system, "Segoe UI", sans-serif';

export function text(g, str, x, y, size, color = "#fff", align = "center", weight = 800) {
  g.font = `${weight} ${size}px ${FONT}`;
  g.textAlign = align;
  g.textBaseline = "middle";
  g.fillStyle = color;
  g.fillText(str, x, y);
}

// Grit kit (Hotline Miami 2 / Nidhogg 2 by way of WarioWare): neon on
// near-black, italic slab type with an RGB-split shadow, thick ink outlines,
// goo splats. tv.js adds the CRT pass (pixels, scanlines, grain, aberration).
export const INK = "#0b0710";
export const POP = ["#ff2a6d", "#f9f002", "#05d9e8", "#39ff14", "#b026ff", "#ff6b00"];
export const PAPER = "#efe6d2";

export function outlined(g, str, x, y, size, color = "#fff", align = "center", rot = 0) {
  g.save();
  g.translate(x, y);
  if (rot) g.rotate(rot);
  g.transform(1, 0, -0.16, 1, 0, 0); // italic slab
  g.font = `italic 900 ${size}px ${FONT}`;
  g.textAlign = align;
  g.textBaseline = "middle";
  g.lineJoin = "miter";
  g.miterLimit = 2;
  g.lineWidth = Math.max(4, size / 5);
  const d = Math.max(3, size / 16);
  g.fillStyle = "#05d9e8"; g.fillText(str, -d, d * 0.6);    // RGB split
  g.fillStyle = "#ff2a6d"; g.fillText(str, d * 1.4, d * 1.4);
  g.strokeStyle = INK; g.strokeText(str, 0, 0);
  g.fillStyle = color; g.fillText(str, 0, 0);
  g.restore();
}

/** Synthwave floor: a perspective grid scrolling toward the viewer. */
export function grid(g, t, color = "#ff2a6d", horizon = H * 0.58) {
  g.save();
  g.strokeStyle = color; g.lineWidth = 3; g.globalAlpha = 0.55;
  for (let i = -24; i <= 24; i++) { g.beginPath(); g.moveTo(W / 2 + i * 30, horizon); g.lineTo(W / 2 + i * 260, H); g.stroke(); }
  for (let i = 0; i < 14; i++) {
    const k = ((i + (t * 0.8) % 1) / 14), y = horizon + (H - horizon) * k * k;
    g.globalAlpha = 0.15 + 0.5 * k; g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke();
  }
  g.restore();
}

/** A goo splat decal (Nidhogg-style, but jelly). Build once, draw every frame. */
export function makeSplat(x, y, r, color) {
  const n = 14, pts = [];
  for (let i = 0; i < n; i++) pts.push(r * (0.55 + Math.random() * 0.6));
  const drops = Array.from({ length: 5 + Math.floor(Math.random() * 6) }, () => {
    const a = Math.random() * Math.PI * 2, d = r * (1.1 + Math.random() * 1.4);
    return [Math.cos(a) * d, Math.sin(a) * d * 0.7, r * (0.08 + Math.random() * 0.18)];
  });
  const drips = Array.from({ length: 2 + Math.floor(Math.random() * 3) }, () => [(Math.random() - 0.5) * r * 1.2, r * (0.4 + Math.random() * 1.2), r * (0.08 + Math.random() * 0.08)]);
  return { x, y, r, color, pts, drops, drips, rot: Math.random() * 6 };
}
export function drawSplat(g, s, dx = 0) {
  g.save();
  g.translate(s.x - dx, s.y);
  g.fillStyle = s.color;
  g.strokeStyle = INK; g.lineWidth = 4;
  g.beginPath();
  s.pts.forEach((rr, i) => { const a = s.rot + (i / s.pts.length) * Math.PI * 2; g[i ? "lineTo" : "moveTo"](Math.cos(a) * rr, Math.sin(a) * rr * 0.7); });
  g.closePath(); g.stroke(); g.fill();
  for (const [x, len, w] of s.drips) { g.fillRect(x - w / 2, 0, w, len); circle(g, x, len, w * 0.9, s.color); }
  for (const [x, y, rr] of s.drops) circle(g, x, y, rr, s.color);
  g.fillStyle = "rgba(255,255,255,.35)";
  g.beginPath(); g.ellipse(-s.r * 0.2, -s.r * 0.2, s.r * 0.18, s.r * 0.08, -0.5, 0, Math.PI * 2); g.fill();
  g.restore();
}

/** Largest font size ≤ size at which str fits in maxW. */
export function fit(g, str, size, maxW) {
  g.font = `italic 900 ${size}px ${FONT}`;
  const w = g.measureText(str).width * 1.08 + size / 5;
  return w > maxW ? Math.floor((size * maxW) / w) : size;
}

/** A slammed-in command word: overshoots, settles, then jitters. k = seconds since it appeared. */
export function shout(g, str, x, y, size, color, k) {
  const s = k < 0.18 ? 2.4 - (k / 0.18) * 1.55 : k < 0.3 ? 0.85 + ((k - 0.18) / 0.12) * 0.15 : 1;
  const j = k > 0.3 ? 3 : 14;
  g.save();
  g.translate(x + (Math.random() - 0.5) * j, y + (Math.random() - 0.5) * j);
  g.scale(s, s);
  outlined(g, str, 0, 0, size, color, "center", -0.06 + Math.sin(k * 9) * 0.02);
  g.restore();
}

/** Rotating rays in two colours, filling the whole screen. */
export function sunburst(g, cx, cy, c1, c2, t, rays = 18) {
  g.fillStyle = c1; g.fillRect(0, 0, W, H);
  g.fillStyle = c2;
  const R = 2400, a0 = t * 0.25;
  for (let i = 0; i < rays; i++) {
    const a = a0 + (i * Math.PI * 2) / rays, w = Math.PI / rays;
    g.beginPath(); g.moveTo(cx, cy);
    g.lineTo(cx + Math.cos(a - w / 2) * R, cy + Math.sin(a - w / 2) * R);
    g.lineTo(cx + Math.cos(a + w / 2) * R, cy + Math.sin(a + w / 2) * R);
    g.closePath(); g.fill();
  }
}

const tones = new Map();
/** Halftone dots growing toward the bottom of a full-screen layer (cached). */
export function halftone(g, color, alpha = 0.25, gap = 26) {
  const key = color + alpha + gap;
  if (!tones.has(key)) {
    const c = document.createElement("canvas");
    c.width = W; c.height = H;
    const cg = c.getContext("2d");
    cg.fillStyle = color; cg.globalAlpha = alpha;
    for (let y = 0, row = 0; y < H + gap; y += gap * 0.87, row++)
      for (let x = row % 2 ? gap / 2 : 0; x < W + gap; x += gap) {
        const r = (gap / 2) * Math.pow(y / H, 1.4);
        if (r > 0.6) { cg.beginPath(); cg.arc(x, y, r, 0, Math.PI * 2); cg.fill(); }
      }
    tones.set(key, c);
  }
  g.drawImage(tones.get(key), 0, 0);
}

/** A slab panel: flat fill (white reads as dirty paper), ink outline, neon hard shadow. */
export function panel(g, x, y, w, h, fill, r = 26, lw = 7) {
  r = Math.min(r, 8);
  rrect(g, x + 12, y + 12, w, h, r, "#ff2a6d");
  rrect(g, x, y, w, h, r, fill === "#fff" ? PAPER : fill, INK, lw);
}

/** A cartoon bomb whose fuse burns down as frac goes 1 → 0. */
export function bomb(g, x, y, r, frac) {
  frac = Math.max(0, Math.min(1, frac));
  const len = 40 + 260 * frac;
  g.lineCap = "round";
  g.lineWidth = 12; g.strokeStyle = INK;
  g.beginPath(); g.moveTo(x + r * 0.6, y - r * 0.6);
  g.bezierCurveTo(x + r, y - r * 1.4, x + r * 0.4 + len * 0.5, y - r * 1.6, x + r * 0.4 + len, y - r * 1.1);
  g.stroke();
  g.lineWidth = 6; g.strokeStyle = "#e8d3a0"; g.stroke();
  circle(g, x, y, r, "#26263a", INK, 8);
  rrect(g, x + r * 0.4, y - r * 0.95, r * 0.5, r * 0.4, 6, "#44445c", INK, 5);
  g.beginPath(); g.ellipse(x - r * 0.35, y - r * 0.35, r * 0.25, r * 0.14, -0.7, 0, Math.PI * 2); g.fillStyle = "rgba(255,255,255,.5)"; g.fill();
  const sx = x + r * 0.4 + len, sy = y - r * 1.1;
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + performance.now() / 60, l = 16 + Math.random() * 16;
    g.lineWidth = 5; g.strokeStyle = i % 2 ? "#ffd400" : "#ff2e63";
    g.beginPath(); g.moveTo(sx, sy); g.lineTo(sx + Math.cos(a) * l, sy + Math.sin(a) * l); g.stroke();
  }
}

export function rrect(g, x, y, w, h, r, fill, stroke, lw = 4) {
  g.beginPath();
  g.roundRect(x, y, w, h, r);
  if (fill) { g.fillStyle = fill; g.fill(); }
  if (stroke) { g.lineWidth = lw; g.strokeStyle = stroke; g.stroke(); }
}

export function circle(g, x, y, r, fill, stroke, lw = 4) {
  g.beginPath();
  g.arc(x, y, r, 0, Math.PI * 2);
  if (fill) { g.fillStyle = fill; g.fill(); }
  if (stroke) { g.lineWidth = lw; g.strokeStyle = stroke; g.stroke(); }
}

export function star(g, x, y, r, fill = "#ffd23f", stroke = "#a86b00") {
  g.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5, rr = i % 2 ? r * 0.45 : r;
    g.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
  }
  g.closePath();
  g.fillStyle = fill; g.fill();
  g.lineWidth = r / 7; g.strokeStyle = stroke; g.stroke();
}


/** Big 3-2-1 overlay for a countdown value in seconds (> 0 while counting). */
export function countdown(g, t) {
  if (t <= 0) return;
  const n = Math.ceil(t), k = 1 - (t - Math.floor(t) || 1);
  shout(g, String(n), W / 2, H / 2, 300, POP[n % POP.length], k);
}

export const shuffle = (a) => {
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
};

/**
 * The cast: a jelly blob in the player's colour with their selfie (or doodle)
 * as the face. opts: sx/sy squash, rot, alpha, wings (flap phase), crown,
 * skirt, mouth (angle it faces, chomper), tint (override body colour).
 */
export function blob(g, p, x, y, r, o = {}) {
  const sx = o.sx ?? 1, sy = o.sy ?? 1;
  g.save();
  g.translate(x, y);
  if (o.rot) g.rotate(o.rot);
  if (o.alpha != null) g.globalAlpha = o.alpha;
  g.scale(sx, sy);
  const body = o.tint || p.color;
  if (o.wings != null) {
    const a = Math.sin(o.wings) * 0.7;
    for (const s of [-1, 1]) {
      g.save();
      g.translate(s * r * 0.8, -r * 0.1);
      g.rotate(s * (-0.4 + a));
      g.beginPath(); g.ellipse(s * r * 0.35, 0, r * 0.5, r * 0.22, 0, 0, Math.PI * 2);
      g.fillStyle = "#fff"; g.fill(); g.lineWidth = 3; g.strokeStyle = "rgba(0,0,0,.3)"; g.stroke();
      g.restore();
    }
  }
  // body: a soft dome with a flat-ish bottom
  g.beginPath();
  if (o.skirt) {
    g.arc(0, -r * 0.05, r, Math.PI, 0);
    const n = 4, w = (2 * r) / n, t = o.skirt;
    g.lineTo(r, r * 0.8);
    for (let i = 0; i < n; i++) {
      const x0 = r - i * w;
      g.quadraticCurveTo(x0 - w / 2, r * (0.55 + 0.25 * Math.sin(t * 10 + i)), x0 - w, r * 0.8);
    }
    g.closePath();
  } else {
    g.ellipse(0, 0, r, r * 0.94, 0, 0, Math.PI * 2);
  }
  const grad = g.createLinearGradient(0, -r, 0, r);
  grad.addColorStop(0, body);
  grad.addColorStop(1, shade(body, -0.28));
  g.fillStyle = grad;
  g.fill();
  g.lineWidth = Math.max(3, r * 0.1);
  g.strokeStyle = INK;
  g.stroke();
  // face
  const fr = r * 0.6, fy = -r * 0.08;
  g.save();
  g.beginPath(); g.arc(0, fy, fr, 0, Math.PI * 2); g.closePath();
  g.fillStyle = shade(body, 0.35); g.fill();
  g.clip();
  if (p.face && p.face.complete && p.face.naturalWidth) g.drawImage(p.face, -fr, fy - fr, fr * 2, fr * 2);
  else {
    for (const s of [-1, 1]) {
      g.beginPath(); g.ellipse(s * fr * 0.36, fy - fr * 0.12, fr * 0.2, fr * 0.27, 0, 0, Math.PI * 2); g.fillStyle = "#fff"; g.fill();
      g.beginPath(); g.arc(s * fr * 0.36 + fr * 0.05, fy - fr * 0.06, fr * 0.1, 0, Math.PI * 2); g.fillStyle = "#1b1b2b"; g.fill();
    }
    g.beginPath(); g.arc(0, fy + fr * 0.2, fr * 0.35, 0.15 * Math.PI, 0.85 * Math.PI); g.lineWidth = fr * 0.1; g.strokeStyle = "#1b1b2b"; g.stroke();
  }
  g.restore();
  g.beginPath(); g.arc(0, fy, fr, 0, Math.PI * 2); g.lineWidth = Math.max(2, r * 0.06); g.strokeStyle = INK; g.stroke();
  // glossy highlight
  g.beginPath(); g.ellipse(-r * 0.55, -r * 0.55, r * 0.2, r * 0.11, -0.7, 0, Math.PI * 2);
  g.fillStyle = "rgba(255,255,255,.55)"; g.fill();
  if (o.mouth != null) {
    g.save(); g.rotate(o.mouth);
    const open = 0.2 + 0.25 * Math.abs(Math.sin(performance.now() / 70));
    g.beginPath(); g.moveTo(r * 0.2, 0); g.arc(0, 0, r * 1.05, -open, open); g.closePath();
    g.fillStyle = "#1b1b2b"; g.fill();
    g.restore();
  }
  if (o.crown) {
    g.beginPath();
    const cy = -r * 0.92, cw = r * 0.55;
    g.moveTo(-cw, cy); g.lineTo(-cw, cy - r * 0.35); g.lineTo(-cw / 2, cy - r * 0.15); g.lineTo(0, cy - r * 0.45);
    g.lineTo(cw / 2, cy - r * 0.15); g.lineTo(cw, cy - r * 0.35); g.lineTo(cw, cy); g.closePath();
    g.fillStyle = "#ffd400"; g.fill(); g.lineWidth = Math.max(2, r * 0.08); g.strokeStyle = INK; g.stroke();
  }
  g.restore();
}

/** Lighten (amt > 0) or darken (amt < 0) a #rrggbb colour. */
export function shade(hex, amt) {
  const n = parseInt(hex.slice(1), 16);
  const f = (c) => Math.round(amt > 0 ? c + (255 - c) * amt : c * (1 + amt));
  return `rgb(${f(n >> 16)},${f((n >> 8) & 255)},${f(n & 255)})`;
}

/** Name label: a tilted sticker. */
export function tag(g, str, x, y, color = "#fff", size = 26) {
  g.font = `900 ${size}px ${FONT}`;
  const w = g.measureText(str).width + size;
  g.save(); g.translate(x, y); g.rotate(-0.04);
  rrect(g, -w / 2 + 4, -size * 0.7 + 4, w, size * 1.4, 8, INK);
  rrect(g, -w / 2, -size * 0.7, w, size * 1.4, 8, color, INK, 4);
  text(g, str, 0, 1, size, INK, "center", 900);
  g.restore();
}
