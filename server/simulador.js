'use strict';
// Nodo virtual: genera lecturas con el mismo formato y la misma lógica que el ESP32 real.

const L = require('./logica');

const ESCENARIOS = {
  normal: { temp: 23.5, hum: 52, gasMv: 640, llamaMv: 3150, desc: 'Condiciones normales en el sendero' },
  precaucion: { temp: 29, hum: 38, gasMv: 1350, llamaMv: 3120, desc: 'Humo leve y temperatura en aumento' },
  alerta: { temp: 34, hum: 27, gasMv: 1950, llamaMv: 3080, desc: 'Humo denso, ambiente seco y caluroso' },
  incendio: { temp: 46, hum: 18, gasMv: 2420, llamaMv: 380, desc: 'Foco de fuego detectado junto al nodo' },
};

const ruido = (amp) => (Math.random() * 2 - 1) * amp;
const acercar = (v, obj, k) => v + (obj - v) * k;

class NodoVirtual {
  constructor(onLectura) {
    this.onLectura = onLectura;
    this.timer = null;
    this.escenario = 'normal';
    this.manual = null; // { temp, hum, gasMv, llama }
    this.reiniciar(false);
  }

  reiniciar(conPrecalentamiento) {
    const e = ESCENARIOS.normal;
    this.seq = 0;
    this.t0 = Date.now() - (conPrecalentamiento ? 0 : L.CFG.PRECALENTAMIENTO_S * 1000);
    this.v = { temp: e.temp, hum: e.hum, gasMv: e.gasMv, llamaMv: e.llamaMv };
    this.estado = { nivel: 0, nivelBase: 0, enclavado: false };
    this.rearmePendiente = false;
    this.bombaT0 = 0;
  }

  get activo() { return this.timer != null; }

  iniciar({ escenario, precalentamiento } = {}) {
    if (escenario) this.fijarEscenario(escenario);
    if (precalentamiento || !this.activo) this.reiniciar(!!precalentamiento);
    if (!this.timer) this.timer = setInterval(() => this.tick(), 1000);
    this.tick();
  }

  detener() {
    clearInterval(this.timer);
    this.timer = null;
  }

  fijarEscenario(nombre, manual) {
    if (nombre === 'manual' && manual) {
      this.escenario = 'manual';
      this.manual = {
        temp: L.clamp(Number(manual.temp) || 23, -10, 80),
        hum: L.clamp(Number(manual.hum) || 50, 0, 100),
        gasMv: L.clamp(Number(manual.gasMv) || 600, 100, 3300),
        llamaMv: manual.llama ? 400 : 3150,
      };
    } else if (ESCENARIOS[nombre]) {
      this.escenario = nombre;
      this.manual = null;
    }
  }

  rearmar() { this.rearmePendiente = true; }

  objetivo() {
    return this.escenario === 'manual' && this.manual ? this.manual : ESCENARIOS[this.escenario];
  }

  tick() {
    const obj = this.objetivo();
    const v = this.v;
    const ahora = Date.now();
    const bombaOn = this.estado.enclavado && L.estadoBomba(ahora - this.bombaT0).bomba;
    const enfriar = bombaOn ? 0.6 : 0;

    v.temp = acercar(v.temp, obj.temp - enfriar * 2, 0.12) + ruido(0.08);
    v.hum = L.clamp(acercar(v.hum, obj.hum + (bombaOn ? 6 : 0), 0.1) + ruido(0.3), 0, 100);
    v.gasMv = L.clamp(acercar(v.gasMv, obj.gasMv, 0.15) + ruido(12), 100, 3300);
    v.llamaMv = L.clamp(acercar(v.llamaMv, obj.llamaMv, 0.45) + ruido(25), 50, 3300);

    const calentando = ahora - this.t0 < L.CFG.PRECALENTAMIENTO_S * 1000;
    const temp = L.r1(v.temp);
    const pg = L.pGas(v.gasMv);
    const pt = L.pTemp(temp);
    const ir = L.indiceRiesgo(pg, pt);
    const llama = v.llamaMv < L.CFG.LLAMA_UMBRAL_MV;

    const estabaEnclavado = this.estado.enclavado;
    const res = L.evaluarNivel(this.estado, { ir, temp, pg, llama, calentando, pedirRearme: this.rearmePendiente });
    this.rearmePendiente = false;
    this.estado = { nivel: res.nivel, nivelBase: res.nivelBase, enclavado: res.enclavado };
    if (res.enclavado && (!estabaEnclavado || res.rearmado)) this.bombaT0 = ahora;

    const nivel3 = res.enclavado;
    const { bomba, rociador } = nivel3 ? L.estadoBomba(ahora - this.bombaT0) : { bomba: false, rociador: false };

    this.seq += 1;
    this.onLectura({
      seq: this.seq,
      temp,
      hum: Math.round(v.hum),
      gas_mv: Math.round(v.gasMv),
      p_gas: L.r1(pg),
      p_temp: L.r1(pt),
      ir: L.r1(ir),
      nivel: res.nivel,
      calentando,
      llama,
      vallas: nivel3,
      rociador,
      bomba,
      llama_mv: Math.round(v.llamaMv),
      enclavado: res.enclavado,
      uptime_s: Math.round((ahora - this.t0) / 1000),
      rssi: -55 + Math.round(ruido(6)),
    }, { rearmado: res.rearmado, rearmeRechazado: res.rearmeRechazado });
  }

  info() {
    return {
      activo: this.activo,
      escenario: this.escenario,
      descripcion: this.escenario === 'manual' ? 'Valores fijados manualmente' : ESCENARIOS[this.escenario].desc,
      manual: this.manual,
    };
  }
}

module.exports = { NodoVirtual, ESCENARIOS };
