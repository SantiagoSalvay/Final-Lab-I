// Alarma sonora del panel con Web Audio: pitido intermitente (nivel 2) y sirena continua (nivel 3).

export class Sirena {
  constructor() {
    this.ctx = null;
    this.habilitada = false;
    this.modo = 'off';
    this.nodos = null;
    this.intervalo = null;
  }

  async habilitar(si) {
    this.habilitada = si;
    if (si && !this.ctx) this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    if (si && this.ctx.state === 'suspended') await this.ctx.resume();
    const m = this.modo;
    this.modo = 'off';
    this.detener();
    if (si) this.fijarModo(m);
    else this.modo = m;
  }

  fijarModo(modo) {
    if (modo === this.modo) return;
    this.modo = modo;
    this.detener();
    if (!this.habilitada || !this.ctx) return;
    if (modo === 'intermitente') {
      this.pitido();
      this.intervalo = setInterval(() => this.pitido(), 1000);
    } else if (modo === 'continua') {
      this.sirena();
    }
  }

  pitido() {
    const c = this.ctx;
    const t = c.currentTime;
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = 'square';
    o.frequency.value = 1760;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.05, t + 0.01);
    g.gain.setValueAtTime(0.05, t + 0.16);
    g.gain.linearRampToValueAtTime(0, t + 0.18);
    o.connect(g).connect(c.destination);
    o.start(t);
    o.stop(t + 0.2);
  }

  sirena() {
    const c = this.ctx;
    const o = c.createOscillator();
    const lfo = c.createOscillator();
    const prof = c.createGain();
    const g = c.createGain();
    o.type = 'sawtooth';
    o.frequency.value = 900;
    lfo.type = 'triangle';
    lfo.frequency.value = 1.6;
    prof.gain.value = 320;
    g.gain.value = 0.045;
    lfo.connect(prof).connect(o.frequency);
    o.connect(g).connect(c.destination);
    o.start();
    lfo.start();
    this.nodos = [o, lfo];
  }

  detener() {
    clearInterval(this.intervalo);
    this.intervalo = null;
    if (this.nodos) { this.nodos.forEach((n) => { try { n.stop(); } catch { /* ya detenido */ } }); this.nodos = null; }
  }
}
