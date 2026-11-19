// Escena animada del sendero: estado de la maqueta en SVG y partículas (humo, brasas, agua) en canvas.

const VB_W = 1000;
const MAX_PARTICULAS = 700;

function spriteHumo() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const r = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  r.addColorStop(0, 'rgba(255,255,255,0.9)');
  r.addColorStop(0.5, 'rgba(255,255,255,0.35)');
  r.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = r;
  g.fillRect(0, 0, 64, 64);
  return c;
}

function tintar(sprite, color) {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  g.drawImage(sprite, 0, 0);
  g.globalCompositeOperation = 'source-in';
  g.fillStyle = color;
  g.fillRect(0, 0, 64, 64);
  return c;
}

export class Escena {
  constructor(raiz) {
    this.raiz = raiz;
    this.canvas = raiz.querySelector('.escena__fx');
    this.ctx = this.canvas.getContext('2d');
    this.oled = raiz.querySelector('.oled');
    this.particulas = [];
    this.estado = { humo: 0, llama: false, bomba: false, nivel: 0 };
    this.mojadoHasta = 0;
    const base = spriteHumo();
    this.humoClaro = tintar(base, '#c9c6c2');
    this.humoOscuro = tintar(base, '#4a4440');
    this.viento = 0.25;
    this.ultimoFrame = performance.now();
    new ResizeObserver(() => this.redimensionar()).observe(raiz);
    this.redimensionar();
    requestAnimationFrame((t) => this.frame(t));
  }

  redimensionar() {
    const r = this.raiz.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    this.canvas.width = Math.round(r.width * dpr);
    this.canvas.height = Math.round(r.height * dpr);
    this.escala = this.canvas.width / VB_W;
  }

  actualizar(l) {
    const r = this.raiz;
    r.dataset.nivel = l.nivel;
    r.classList.toggle('con-llama', !!l.llama);
    r.classList.toggle('cerrado', !!l.vallas);
    r.classList.toggle('rociando', !!l.rociador);
    if (l.bomba || l.rociador) this.mojadoHasta = Date.now() + 25000;
    r.classList.toggle('mojado', Date.now() < this.mojadoHasta);
    r.dataset.sirena = l.nivel === 3 ? 'continua' : l.nivel === 2 ? 'intermitente' : '';
    this.oled.textContent = l.calentando ? `MQ2 ${Math.max(0, 60 - (l.uptime_s ?? 0))}s` : `N${l.nivel} IR ${Math.round(l.ir)}`;
    this.estado = { humo: Math.min(1, (l.p_gas || 0) / 100), llama: !!l.llama, bomba: !!l.bomba, nivel: l.nivel };
    // Pulso de radio en cada paquete recibido
    r.classList.remove('tx');
    void r.offsetWidth;
    r.classList.add('tx');
  }

  sinSenal(activo) {
    this.raiz.classList.toggle('sin-senal', activo);
    if (activo) this.estado = { ...this.estado, bomba: false };
  }

  emitir(p) {
    if (this.particulas.length < MAX_PARTICULAS) this.particulas.push(p);
  }

  generar(dt) {
    const e = this.estado;
    const f = dt / 16.7;
    const sinSenal = this.raiz.classList.contains('sin-senal');
    if (sinSenal) return;
    // Humo: proporcional al gas medido; más denso y oscuro con llama.
    const tasaHumo = (e.humo > 0.08 ? e.humo * 0.8 : 0) + (e.llama ? 0.9 : 0);
    let n = tasaHumo * f;
    while (n > 0) {
      if (Math.random() < n) {
        const enFuego = e.llama && Math.random() < 0.7;
        const foco = Math.random() < 0.75 ? [779, 245] : [683, 205];
        this.emitir({
          tipo: 'humo',
          x: enFuego ? foco[0] + (Math.random() - 0.5) * 50 : 560 + Math.random() * 380,
          y: enFuego ? foco[1] + Math.random() * 20 : 240 + Math.random() * 90,
          vx: (Math.random() - 0.3) * 0.25,
          vy: -(0.25 + Math.random() * 0.45) * (enFuego ? 1.6 : 1),
          r: enFuego ? 10 : 8,
          crece: enFuego ? 0.55 : 0.35,
          vida: 0,
          dur: 2600 + Math.random() * 2200,
          alfa: enFuego ? 0.32 : 0.14 + e.humo * 0.3,
          oscuro: enFuego || e.nivel >= 3,
        });
      }
      n -= 1;
    }
    // Brasas
    if (e.llama) {
      for (let k = 0; k < 2 * f; k++) {
        if (Math.random() > 0.6) continue;
        const foco = Math.random() < 0.7 ? [779, 250] : [683, 210];
        this.emitir({
          tipo: 'brasa', x: foco[0] + (Math.random() - 0.5) * 40, y: foco[1],
          vx: (Math.random() - 0.4) * 0.8, vy: -(1 + Math.random() * 1.6),
          r: 1 + Math.random() * 1.6, vida: 0, dur: 1200 + Math.random() * 1400,
        });
      }
    }
    // Agua del rociador (ráfagas de la bomba)
    if (e.bomba) {
      for (let k = 0; k < 7 * f; k++) {
        const ang = (-90 + (Math.random() - 0.5) * 120) * (Math.PI / 180);
        const v = 2.4 + Math.random() * 2.6;
        this.emitir({
          tipo: 'agua', x: 302, y: 342, vx: Math.cos(ang) * v, vy: Math.sin(ang) * v,
          r: 1.2 + Math.random() * 1.4, vida: 0, dur: 2000,
        });
      }
    }
  }

  frame(t) {
    const dt = Math.min(64, t - this.ultimoFrame);
    this.ultimoFrame = t;
    this.viento = 0.25 + Math.sin(t / 4000) * 0.15;
    if (!document.hidden) {
      this.generar(dt);
      this.dibujar(dt);
    }
    requestAnimationFrame((tt) => this.frame(tt));
  }

  dibujar(dt) {
    const { ctx, escala } = this;
    const f = dt / 16.7;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.setTransform(escala, 0, 0, escala, 0, 0);
    const vivas = [];
    for (const p of this.particulas) {
      p.vida += dt;
      const k = p.vida / p.dur;
      if (k >= 1) continue;
      if (p.tipo === 'humo') {
        p.x += (p.vx + this.viento) * f;
        p.y += p.vy * f;
        p.r += p.crece * f;
        ctx.globalAlpha = p.alfa * Math.sin(Math.PI * k);
        const d = p.r * 2;
        ctx.drawImage(p.oscuro ? this.humoOscuro : this.humoClaro, p.x - p.r, p.y - p.r, d, d);
      } else if (p.tipo === 'brasa') {
        p.x += (p.vx + this.viento * 1.5 + Math.sin((p.vida + p.y) / 120) * 0.4) * f;
        p.y += p.vy * f;
        ctx.globalAlpha = (1 - k) * (0.6 + Math.random() * 0.4);
        ctx.fillStyle = k < 0.4 ? '#ffd166' : '#ff6a00';
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fill();
      } else if (p.tipo === 'agua') {
        p.vy += 0.11 * f;
        p.x += p.vx * f;
        p.y += p.vy * f;
        if (p.y > 392) continue;
        ctx.globalAlpha = 0.75 * (1 - k * 0.5);
        ctx.strokeStyle = '#8fd0ff';
        ctx.lineWidth = p.r;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(p.x - p.vx * 1.6, p.y - p.vy * 1.6);
        ctx.stroke();
      }
      vivas.push(p);
    }
    ctx.globalAlpha = 1;
    this.particulas = vivas;
  }
}
