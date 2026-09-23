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

export function outlined(g, str, x, y, size, color = "#fff", align = "center") {
  g.font = `900 ${size}px ${FONT}`;
  g.textAlign = align;
  g.textBaseline = "middle";
  g.lineJoin = "round";
  g.lineWidth = size / 6;
  g.strokeStyle = "rgba(10,12,30,.85)";
  g.strokeText(str, x, y);
  g.fillStyle = color;
  g.fillText(str, x, y);
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
  const n = Math.ceil(t), f = t - Math.floor(t);
  g.save();
  g.globalAlpha = Math.min(1, f * 3);
  outlined(g, String(n), W / 2, H / 2, 220 + (1 - f) * 60, "#ffd23f");
  g.restore();
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
  g.lineWidth = r * 0.07;
  g.strokeStyle = "rgba(0,0,0,.28)";
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
  g.beginPath(); g.arc(0, fy, fr, 0, Math.PI * 2); g.lineWidth = r * 0.06; g.strokeStyle = "rgba(255,255,255,.85)"; g.stroke();
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
    g.fillStyle = "#ffd23f"; g.fill(); g.lineWidth = r * 0.06; g.strokeStyle = "#a86b00"; g.stroke();
  }
  g.restore();
}

/** Lighten (amt > 0) or darken (amt < 0) a #rrggbb colour. */
export function shade(hex, amt) {
  const n = parseInt(hex.slice(1), 16);
  const f = (c) => Math.round(amt > 0 ? c + (255 - c) * amt : c * (1 + amt));
  return `rgb(${f(n >> 16)},${f((n >> 8) & 255)},${f(n & 255)})`;
}

/** Name label pill. */
export function tag(g, str, x, y, color = "#fff", size = 26) {
  g.font = `800 ${size}px ${FONT}`;
  const w = g.measureText(str).width + size;
  rrect(g, x - w / 2, y - size * 0.7, w, size * 1.4, size * 0.7, "rgba(10,12,30,.7)");
  text(g, str, x, y + 1, size, color);
}
