// Draws a player's avatar onto a 2D canvas from their chosen cosmetics.
import { ITEM_BY_ID, DEFAULT_AVATAR } from '/shared/cosmetics.js';

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function shade(hex, amt) {
  const n = parseInt(hex.slice(1), 16);
  const c = (v) => Math.max(0, Math.min(255, v + amt));
  return `rgb(${c(n >> 16)},${c((n >> 8) & 255)},${c(n & 255)})`;
}

/**
 * Draw an avatar centred at (cx, cy) about `size` pixels tall.
 * opts: { facing: 1|-1, ghost: bool, label: string, bob: number }
 */
export function drawAvatar(ctx, avatar, cx, cy, size, opts = {}) {
  const a = { ...DEFAULT_AVATAR, ...(avatar || {}) };
  const s = size / 100;
  const color = ITEM_BY_ID[a.color]?.value || '#4cc9f0';
  ctx.save();
  ctx.translate(cx, cy + (opts.bob || 0));
  ctx.scale(s * (opts.facing === -1 ? -1 : 1), s);
  if (opts.ghost) ctx.globalAlpha *= 0.45;

  // shadow
  ctx.fillStyle = 'rgba(0,0,0,0.18)';
  ctx.beginPath();
  ctx.ellipse(0, 48, 30, 7, 0, 0, Math.PI * 2);
  ctx.fill();

  // feet
  ctx.fillStyle = shade(color, -60);
  roundRect(ctx, -26, 36, 20, 12, 6);
  ctx.fill();
  roundRect(ctx, 6, 36, 20, 12, 6);
  ctx.fill();

  // body
  ctx.lineWidth = 4;
  ctx.strokeStyle = shade(color, -90);
  ctx.fillStyle = color;
  roundRect(ctx, -34, -42, 68, 84, 32);
  ctx.fill();
  ctx.stroke();

  // outfit (clipped to the body)
  const outfit = ITEM_BY_ID[a.outfit];
  if (outfit && outfit.value) {
    ctx.save();
    roundRect(ctx, -34, -42, 68, 84, 32);
    ctx.clip();
    ctx.fillStyle = outfit.value;
    ctx.fillRect(-40, 12, 80, 40);
    if (a.outfit === 'o_hoodie') {
      ctx.fillStyle = shade(outfit.value, -40);
      ctx.fillRect(-4, 12, 8, 30);
      ctx.beginPath();
      ctx.arc(0, 12, 14, 0, Math.PI);
      ctx.fill();
    } else if (a.outfit === 'o_space') {
      ctx.fillStyle = '#4361ee';
      ctx.fillRect(-12, 20, 24, 12);
      ctx.fillStyle = '#f72585';
      ctx.fillRect(-40, 12, 80, 4);
    } else if (a.outfit === 'o_racer') {
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(-40, 24, 80, 6);
      ctx.fillStyle = '#073b4c';
      ctx.font = 'bold 14px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('7', 18, 26);
    } else if (a.outfit === 'o_tux') {
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.moveTo(-10, 12);
      ctx.lineTo(10, 12);
      ctx.lineTo(0, 40);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = '#ef233c';
      ctx.fillRect(-7, 13, 14, 6);
    } else if (a.outfit === 'o_tee') {
      ctx.fillStyle = 'rgba(0,0,0,0.12)';
      ctx.fillRect(-40, 12, 80, 4);
    }
    ctx.restore();
    ctx.strokeStyle = shade(color, -90);
    roundRect(ctx, -34, -42, 68, 84, 32);
    ctx.stroke();
  }

  drawFace(ctx, a.face);
  drawHair(ctx, a.hair, color);
  drawAccessory(ctx, a.accessory);

  ctx.restore();

  if (opts.label) {
    ctx.save();
    ctx.font = `bold ${Math.max(11, Math.round(size * 0.2))}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.lineWidth = 4;
    ctx.strokeStyle = 'rgba(0,0,0,0.65)';
    ctx.fillStyle = opts.labelColor || '#fff';
    const ly = cy - size * 0.62 + (opts.bob || 0);
    ctx.strokeText(opts.label, cx, ly);
    ctx.fillText(opts.label, cx, ly);
    ctx.restore();
  }
}

function eye(ctx, x, y) {
  ctx.fillStyle = '#fff';
  ctx.beginPath();
  ctx.ellipse(x, y, 8, 10, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#1b1b2f';
  ctx.beginPath();
  ctx.arc(x + 2, y + 1, 4.5, 0, Math.PI * 2);
  ctx.fill();
}

function drawFace(ctx, face) {
  ctx.lineCap = 'round';
  ctx.strokeStyle = '#1b1b2f';
  ctx.lineWidth = 3.5;
  switch (face) {
    case 'f_happy':
      eye(ctx, -12, -14);
      eye(ctx, 12, -14);
      ctx.fillStyle = '#1b1b2f';
      ctx.beginPath();
      ctx.arc(0, 0, 13, 0, Math.PI);
      ctx.fill();
      ctx.fillStyle = '#ff5d8f';
      ctx.beginPath();
      ctx.arc(0, 7, 6, 0, Math.PI);
      ctx.fill();
      break;
    case 'f_cool':
      ctx.fillStyle = '#111';
      roundRect(ctx, -26, -22, 22, 14, 5);
      ctx.fill();
      roundRect(ctx, 4, -22, 22, 14, 5);
      ctx.fill();
      ctx.fillRect(-6, -19, 12, 3);
      ctx.beginPath();
      ctx.arc(2, 2, 10, 0.2, Math.PI - 0.6);
      ctx.stroke();
      break;
    case 'f_wink':
      eye(ctx, -12, -14);
      ctx.beginPath();
      ctx.moveTo(6, -14);
      ctx.lineTo(18, -14);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(0, -2, 11, 0.3, Math.PI - 0.3);
      ctx.stroke();
      break;
    case 'f_surprised':
      eye(ctx, -12, -16);
      eye(ctx, 12, -16);
      ctx.fillStyle = '#1b1b2f';
      ctx.beginPath();
      ctx.ellipse(0, 4, 6, 8, 0, 0, Math.PI * 2);
      ctx.fill();
      break;
    case 'f_sleepy':
      ctx.beginPath();
      ctx.arc(-12, -14, 7, 0, Math.PI);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(12, -14, 7, 0, Math.PI);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(-6, 4);
      ctx.lineTo(6, 4);
      ctx.stroke();
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 14px sans-serif';
      ctx.fillText('z', 22, -26);
      break;
    case 'f_star':
      star(ctx, -12, -14, 10, '#ffd60a');
      star(ctx, 12, -14, 10, '#ffd60a');
      ctx.beginPath();
      ctx.arc(0, -2, 11, 0.2, Math.PI - 0.2);
      ctx.stroke();
      break;
    default: // f_smile
      eye(ctx, -12, -14);
      eye(ctx, 12, -14);
      ctx.beginPath();
      ctx.arc(0, -2, 11, 0.3, Math.PI - 0.3);
      ctx.stroke();
  }
  // cheeks
  ctx.fillStyle = 'rgba(255,120,150,0.35)';
  ctx.beginPath();
  ctx.arc(-22, 0, 5, 0, Math.PI * 2);
  ctx.arc(22, 0, 5, 0, Math.PI * 2);
  ctx.fill();
}

function star(ctx, x, y, r, color) {
  ctx.save();
  ctx.fillStyle = color;
  ctx.strokeStyle = '#1b1b2f';
  ctx.lineWidth = 2;
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const rr = i % 2 ? r * 0.45 : r;
    const ang = -Math.PI / 2 + (i * Math.PI) / 5;
    ctx.lineTo(x + Math.cos(ang) * rr, y + Math.sin(ang) * rr);
  }
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

function drawHair(ctx, hair, body) {
  ctx.lineWidth = 3;
  ctx.strokeStyle = 'rgba(0,0,0,0.35)';
  switch (hair) {
    case 'h_spiky':
      ctx.fillStyle = '#3d2c1e';
      ctx.beginPath();
      ctx.moveTo(-28, -30);
      for (let i = 0; i <= 6; i++) {
        const x = -28 + i * 9.3;
        ctx.lineTo(x, i % 2 ? -36 : -56);
      }
      ctx.lineTo(28, -30);
      ctx.closePath();
      ctx.fill();
      break;
    case 'h_bob':
      ctx.fillStyle = '#6f1d1b';
      ctx.beginPath();
      ctx.moveTo(-38, 0);
      ctx.quadraticCurveTo(-42, -52, 0, -50);
      ctx.quadraticCurveTo(42, -52, 38, 0);
      ctx.lineTo(28, 0);
      ctx.quadraticCurveTo(28, -30, 0, -32);
      ctx.quadraticCurveTo(-28, -30, -28, 0);
      ctx.closePath();
      ctx.fill();
      break;
    case 'h_curly':
      ctx.fillStyle = '#2b2118';
      for (let i = 0; i < 7; i++) {
        ctx.beginPath();
        ctx.arc(-27 + i * 9, -40 - (i % 2) * 5, 10, 0, Math.PI * 2);
        ctx.fill();
      }
      break;
    case 'h_ponytail':
      ctx.fillStyle = '#e0a458';
      ctx.beginPath();
      ctx.ellipse(0, -40, 32, 12, 0, Math.PI, 0);
      ctx.fill();
      ctx.beginPath();
      ctx.ellipse(-36, -24, 9, 22, 0.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#ff006e';
      ctx.fillRect(-34, -44, 8, 8);
      break;
    case 'h_mohawk':
      ctx.fillStyle = '#f72585';
      ctx.beginPath();
      ctx.moveTo(-8, -38);
      ctx.lineTo(-12, -64);
      ctx.lineTo(-2, -54);
      ctx.lineTo(4, -70);
      ctx.lineTo(10, -54);
      ctx.lineTo(16, -62);
      ctx.lineTo(10, -38);
      ctx.closePath();
      ctx.fill();
      break;
    case 'h_rainbow': {
      const cols = ['#ff595e', '#ffca3a', '#8ac926', '#1982c4', '#6a4c93'];
      cols.forEach((c, i) => {
        ctx.fillStyle = c;
        ctx.beginPath();
        ctx.arc(-24 + i * 12, -44 - (i === 2 ? 8 : i % 2 ? 4 : 0), 13, 0, Math.PI * 2);
        ctx.fill();
      });
      break;
    }
    default:
      void body;
  }
}

function drawAccessory(ctx, acc) {
  switch (acc) {
    case 'a_cap':
      ctx.fillStyle = '#e63946';
      ctx.beginPath();
      ctx.ellipse(0, -38, 30, 16, 0, Math.PI, 0);
      ctx.fill();
      roundRect(ctx, 0, -40, 44, 8, 4);
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.beginPath();
      ctx.arc(0, -52, 3, 0, Math.PI * 2);
      ctx.fill();
      break;
    case 'a_bow':
      ctx.fillStyle = '#ff4d6d';
      ctx.beginPath();
      ctx.moveTo(18, -42);
      ctx.lineTo(4, -52);
      ctx.lineTo(4, -32);
      ctx.closePath();
      ctx.moveTo(18, -42);
      ctx.lineTo(32, -52);
      ctx.lineTo(32, -32);
      ctx.closePath();
      ctx.fill();
      ctx.beginPath();
      ctx.arc(18, -42, 5, 0, Math.PI * 2);
      ctx.fill();
      break;
    case 'a_headphones':
      ctx.strokeStyle = '#222';
      ctx.lineWidth = 6;
      ctx.beginPath();
      ctx.arc(0, -20, 36, Math.PI * 1.05, Math.PI * 1.95);
      ctx.stroke();
      ctx.fillStyle = '#4361ee';
      roundRect(ctx, -42, -26, 14, 24, 6);
      ctx.fill();
      roundRect(ctx, 28, -26, 14, 24, 6);
      ctx.fill();
      break;
    case 'a_crown':
      ctx.fillStyle = '#ffd60a';
      ctx.strokeStyle = '#b08900';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(-20, -40);
      ctx.lineTo(-22, -62);
      ctx.lineTo(-10, -50);
      ctx.lineTo(0, -66);
      ctx.lineTo(10, -50);
      ctx.lineTo(22, -62);
      ctx.lineTo(20, -40);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#e63946';
      ctx.beginPath();
      ctx.arc(0, -48, 3.5, 0, Math.PI * 2);
      ctx.fill();
      break;
    case 'a_antenna':
      ctx.strokeStyle = '#333';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(0, -42);
      ctx.lineTo(6, -66);
      ctx.stroke();
      ctx.fillStyle = '#ff006e';
      ctx.beginPath();
      ctx.arc(6, -68, 6, 0, Math.PI * 2);
      ctx.fill();
      break;
    case 'a_flower':
      for (let i = 0; i < 5; i++) {
        const ang = (i / 5) * Math.PI * 2;
        ctx.fillStyle = '#ff99c8';
        ctx.beginPath();
        ctx.arc(-22 + Math.cos(ang) * 7, -36 + Math.sin(ang) * 7, 6, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.fillStyle = '#ffd60a';
      ctx.beginPath();
      ctx.arc(-22, -36, 5, 0, Math.PI * 2);
      ctx.fill();
      break;
  }
}

/** Convenience: a canvas element showing an avatar. */
export function avatarCanvas(avatar, size = 64, opts = {}) {
  const c = document.createElement('canvas');
  const dpr = window.devicePixelRatio || 1;
  c.width = size * dpr;
  c.height = size * dpr;
  c.style.width = `${size}px`;
  c.style.height = `${size}px`;
  c.className = 'avatar-canvas';
  const ctx = c.getContext('2d');
  ctx.scale(dpr, dpr);
  drawAvatar(ctx, avatar, size / 2, size * 0.56, size * 0.72, opts);
  return c;
}
