// Gráficos de línea en canvas, sin dependencias: desplazamiento continuo, bandas de nivel y tooltip.

const css = (nombre) => getComputedStyle(document.documentElement).getPropertyValue(nombre).trim();

export function leerTema() {
  return {
    texto: css('--text'), texto2: css('--text-2'), muted: css('--muted'), grid: css('--grid'), eje: css('--axis'),
    superficie: css('--surface'), serie: css('--serie'),
    n: [css('--n0'), css('--n1'), css('--n2'), css('--n3')],
  };
}

const fmt = (v, d) => v.toLocaleString('es-AR', { minimumFractionDigits: d, maximumFractionDigits: d });
const hora = (t) => new Date(t).toLocaleTimeString('es-AR', { hour12: false });

export class GraficoLinea {
  constructor(canvas, opciones) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.o = { min: null, max: null, minRango: 5, decimales: 1, unidad: '', bandas: null, campo: 'v', ...opciones };
    this.puntos = [];
    this.ventana = 300000;
    this.hover = null;
    this.tema = leerTema();
    const cont = canvas.parentElement;
    this.tip = document.createElement('div');
    this.tip.className = 'tooltip';
    this.tip.hidden = true;
    cont.appendChild(this.tip);
    new ResizeObserver(() => this.redimensionar()).observe(cont);
    canvas.addEventListener('pointermove', (e) => { const r = canvas.getBoundingClientRect(); this.hover = e.clientX - r.left; });
    canvas.addEventListener('pointerleave', () => { this.hover = null; this.tip.hidden = true; });
    this.redimensionar();
  }

  redimensionar() {
    const r = this.canvas.parentElement.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    this.w = Math.max(50, r.width);
    this.h = Math.max(50, r.height);
    this.canvas.width = Math.round(this.w * dpr);
    this.canvas.height = Math.round(this.h * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  setDatos(puntos, ventana) {
    this.puntos = puntos;
    this.ventana = ventana;
  }

  dominioY(visibles) {
    let { min, max } = this.o;
    if (min != null && max != null) return [min, max];
    let lo = Infinity, hi = -Infinity;
    for (const p of visibles) { if (p.v < lo) lo = p.v; if (p.v > hi) hi = p.v; }
    if (!Number.isFinite(lo)) { lo = 0; hi = 1; }
    const centro = (lo + hi) / 2;
    const rango = Math.max(this.o.minRango, (hi - lo) * 1.3);
    let a = centro - rango / 2, b = centro + rango / 2;
    if (min != null) a = Math.max(min, a);
    if (max != null) b = Math.min(max, b);
    const paso = this.pasoLindo((b - a) / 4);
    return [Math.floor(a / paso) * paso, Math.ceil(b / paso) * paso];
  }

  pasoLindo(x) {
    const e = Math.pow(10, Math.floor(Math.log10(x || 1)));
    const f = x / e;
    return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * e;
  }

  dibujar(ahora) {
    const { ctx, w, h, o, tema } = this;
    const m = { l: 40, r: 14, t: 10, b: 24 };
    const pw = w - m.l - m.r, ph = h - m.t - m.b;
    const t0 = ahora - this.ventana;
    ctx.clearRect(0, 0, w, h);

    // Puntos visibles (+1 a cada lado para continuidad) y punta interpolada en "ahora".
    const pts = this.puntos;
    let i0 = 0;
    while (i0 < pts.length && pts[i0].t < t0) i0++;
    const vis = pts.slice(Math.max(0, i0 - 1));
    const enRango = vis.filter((p) => p.t >= t0 && p.v != null);
    const [y0, y1] = this.dominioY(enRango.length ? enRango : vis.filter((p) => p.v != null));
    const X = (t) => m.l + ((t - t0) / this.ventana) * pw;
    const Y = (v) => m.t + ph - ((v - y0) / (y1 - y0)) * ph;

    // Bandas de nivel
    if (o.bandas) {
      o.bandas.forEach(([a, b], k) => {
        const ya = Y(Math.min(b, y1)), yb = Y(Math.max(a, y0));
        if (yb <= ya) return;
        ctx.fillStyle = tema.n[k];
        ctx.globalAlpha = 0.09;
        ctx.fillRect(m.l, ya, pw, yb - ya);
        ctx.globalAlpha = 1;
        if (a > y0) {
          ctx.strokeStyle = tema.n[k];
          ctx.globalAlpha = 0.55;
          ctx.setLineDash([4, 4]);
          ctx.lineWidth = 1;
          ctx.beginPath(); ctx.moveTo(m.l, Y(a) + 0.5); ctx.lineTo(m.l + pw, Y(a) + 0.5); ctx.stroke();
          ctx.setLineDash([]);
          ctx.globalAlpha = 1;
        }
      });
    }

    // Grilla y eje Y
    ctx.font = '11px system-ui, -apple-system, "Segoe UI", sans-serif';
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'right';
    const paso = (y1 - y0) / 4;
    for (let k = 0; k <= 4; k++) {
      const v = y0 + paso * k;
      const y = Math.round(Y(v)) + 0.5;
      ctx.strokeStyle = k === 0 ? tema.eje : tema.grid;
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(m.l, y); ctx.lineTo(m.l + pw, y); ctx.stroke();
      ctx.fillStyle = tema.muted;
      ctx.fillText(fmt(v, paso < 1 ? 1 : 0), m.l - 8, y);
    }

    // Eje X relativo
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    const minutos = this.ventana >= 120000;
    const marcas = 5;
    for (let k = 0; k <= marcas; k++) {
      const dt = (this.ventana / marcas) * (marcas - k);
      const x = m.l + (pw / marcas) * k;
      const txt = dt === 0 ? 'ahora' : minutos ? `−${fmt(dt / 60000, dt % 60000 ? 1 : 0)} min` : `−${Math.round(dt / 1000)} s`;
      ctx.fillStyle = tema.muted;
      ctx.textAlign = k === marcas ? 'right' : k === 0 ? 'left' : 'center';
      ctx.fillText(txt, k === marcas ? x : k === 0 ? x : x, h - m.b + 7);
    }

    // Serie
    ctx.save();
    ctx.beginPath();
    ctx.rect(m.l, m.t - 6, pw + 1, ph + 12);
    ctx.clip();
    const tramos = [];
    let actual = [];
    let punta = null;
    for (let k = 0; k < vis.length; k++) {
      const p = vis[k];
      if (p.v == null) { if (actual.length) tramos.push(actual); actual = []; continue; }
      const prev = actual[actual.length - 1];
      if (prev && p.t - prev.t > 5000) { tramos.push(actual); actual = []; }
      if (p.t > ahora) {
        if (prev && p.t - prev.t <= 5000) {
          const f = (ahora - prev.t) / (p.t - prev.t);
          punta = { ...p, t: ahora, v: prev.v + (p.v - prev.v) * Math.max(0, Math.min(1, f)) };
          actual.push(punta);
        }
        break;
      }
      actual.push(p);
      punta = p;
    }
    if (actual.length) tramos.push(actual);

    const color = o.colorSerie ? o.colorSerie(punta) : tema.serie;
    for (const tr of tramos) {
      if (tr.length < 2) continue;
      const grad = ctx.createLinearGradient(0, m.t, 0, m.t + ph);
      grad.addColorStop(0, hexA(tema.serie, 0.22));
      grad.addColorStop(1, hexA(tema.serie, 0));
      ctx.beginPath();
      ctx.moveTo(X(tr[0].t), Y(tr[0].v));
      for (const p of tr) ctx.lineTo(X(p.t), Y(p.v));
      ctx.lineTo(X(tr[tr.length - 1].t), m.t + ph);
      ctx.lineTo(X(tr[0].t), m.t + ph);
      ctx.closePath();
      ctx.fillStyle = grad;
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(X(tr[0].t), Y(tr[0].v));
      for (const p of tr) ctx.lineTo(X(p.t), Y(p.v));
      ctx.strokeStyle = tema.serie;
      ctx.lineWidth = 2;
      ctx.lineJoin = 'round';
      ctx.stroke();
    }
    ctx.restore();

    // Punta viva
    if (punta && punta.t >= t0) {
      const x = X(punta.t), y = Y(punta.v);
      const fase = (performance.now() % 1600) / 1600;
      ctx.beginPath();
      ctx.arc(x, y, 4 + fase * 10, 0, Math.PI * 2);
      ctx.fillStyle = hexA(color, 0.35 * (1 - fase));
      ctx.fill();
      ctx.beginPath();
      ctx.arc(x, y, 4.5, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = tema.superficie;
      ctx.stroke();
    }

    // Hover: cruz + tooltip
    if (this.hover != null && this.hover >= m.l && this.hover <= m.l + pw && enRango.length) {
      const tH = t0 + ((this.hover - m.l) / pw) * this.ventana;
      let mejor = enRango[0];
      for (const p of enRango) if (Math.abs(p.t - tH) < Math.abs(mejor.t - tH)) mejor = p;
      const x = X(mejor.t), y = Y(mejor.v);
      ctx.strokeStyle = tema.texto2;
      ctx.globalAlpha = 0.5;
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(Math.round(x) + 0.5, m.t); ctx.lineTo(Math.round(x) + 0.5, m.t + ph); ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.beginPath();
      ctx.arc(x, y, 5, 0, Math.PI * 2);
      ctx.fillStyle = o.colorSerie ? o.colorSerie(mejor) : tema.serie;
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = tema.superficie;
      ctx.stroke();
      const extra = o.extraTooltip ? o.extraTooltip(mejor) : '';
      this.tip.innerHTML = `<b>${fmt(mejor.v, o.decimales)} ${o.unidad}</b>${extra}<br><span>${hora(mejor.t)} · #${mejor.seq ?? ''}</span>`;
      this.tip.style.left = `${Math.min(Math.max(x, 70), w - 70)}px`;
      this.tip.style.top = `${y}px`;
      this.tip.hidden = false;
    } else if (!this.tip.hidden) {
      this.tip.hidden = true;
    }
  }
}

// Mini gráfico de tendencia de cada indicador.
export function sparkline(canvas, valores, color, rango) {
  const r = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  const w = r.width, h = r.height;
  if (!w || !h) return;
  if (canvas.width !== Math.round(w * dpr)) { canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr); }
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  const vs = valores.filter((v) => v != null);
  if (vs.length < 2) return;
  let lo = Math.min(...vs), hi = Math.max(...vs);
  const minR = rango || 1;
  if (hi - lo < minR) { const c = (hi + lo) / 2; lo = c - minR / 2; hi = c + minR / 2; }
  const X = (i) => (i / (valores.length - 1)) * w;
  const Y = (v) => 6 + (1 - (v - lo) / (hi - lo)) * (h - 10);
  const grad = ctx.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, hexA(color, 0.28));
  grad.addColorStop(1, hexA(color, 0));
  ctx.beginPath();
  let primero = true;
  valores.forEach((v, i) => { if (v == null) return; primero ? ctx.moveTo(X(i), Y(v)) : ctx.lineTo(X(i), Y(v)); primero = false; });
  ctx.lineTo(w, h); ctx.lineTo(0, h); ctx.closePath();
  ctx.fillStyle = grad;
  ctx.fill();
  ctx.beginPath();
  primero = true;
  valores.forEach((v, i) => { if (v == null) return; primero ? ctx.moveTo(X(i), Y(v)) : ctx.lineTo(X(i), Y(v)); primero = false; });
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.lineJoin = 'round';
  ctx.stroke();
}

export function hexA(hex, a) {
  if (!hex || hex[0] !== '#') return hex;
  let h = hex.slice(1);
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  const n = parseInt(h, 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}
