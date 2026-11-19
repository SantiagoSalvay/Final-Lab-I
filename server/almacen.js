'use strict';
// Historial en memoria (buffer circular), detección de eventos y persistencia opcional en disco.

const fs = require('fs');
const path = require('path');
const { NIVELES } = require('./logica');

const num = (v, def = null) => {
  if (v === null || v === undefined || v === '') return def;
  const n = Number(v);
  return Number.isFinite(n) ? n : def;
};
const dec = (v) => Number(v).toFixed(1).replace('.', ',');
const bool = (v) => v === true || v === 1 || v === '1' || v === 'true';

// Acepta el JSON del nodo (o la línea DATA convertida) y lo deja en un formato único.
function normalizar(d) {
  return {
    seq: num(d.seq, 0),
    temp: num(d.temp ?? d.tempC),
    hum: num(d.hum),
    gas_mv: num(d.gas_mv ?? d.gasMv, 0),
    p_gas: num(d.p_gas ?? d.pGas, 0),
    p_temp: num(d.p_temp ?? d.pTemp, 0),
    ir: num(d.ir, 0),
    nivel: Math.max(0, Math.min(3, Math.round(num(d.nivel, 0)))),
    calentando: bool(d.calentando ?? d.precalent),
    llama: bool(d.llama),
    vallas: bool(d.vallas),
    rociador: bool(d.rociador),
    bomba: bool(d.bomba),
    llama_mv: num(d.llama_mv ?? d.llamaMv),
    enclavado: bool(d.enclavado),
    uptime_s: num(d.uptime_s),
    rssi: num(d.rssi),
  };
}

class Almacen {
  constructor({ maxLecturas = 3600, maxEventos = 300, dir = null } = {}) {
    this.maxLecturas = maxLecturas;
    this.maxEventos = maxEventos;
    this.lecturas = [];
    this.eventos = [];
    this.ultimo = null;
    this.idEvento = 0;
    this.archivo = dir ? path.join(dir, 'historial.json') : null;
    this.sucio = false;
    if (this.archivo) this.cargar();
  }

  cargar() {
    try {
      const j = JSON.parse(fs.readFileSync(this.archivo, 'utf8'));
      this.lecturas = (j.lecturas || []).slice(-this.maxLecturas);
      this.eventos = (j.eventos || []).slice(-this.maxEventos);
      this.idEvento = this.eventos.reduce((m, e) => Math.max(m, e.id || 0), 0);
      this.ultimo = this.lecturas[this.lecturas.length - 1] || null;
      console.log(`[almacen] ${this.lecturas.length} lecturas y ${this.eventos.length} eventos recuperados`);
    } catch { /* primera ejecución */ }
  }

  guardar() {
    if (!this.archivo || !this.sucio) return;
    try {
      fs.mkdirSync(path.dirname(this.archivo), { recursive: true });
      const tmp = this.archivo + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify({ lecturas: this.lecturas, eventos: this.eventos }));
      fs.renameSync(tmp, this.archivo);
      this.sucio = false;
    } catch (e) {
      console.warn('[almacen] no se pudo guardar:', e.message);
    }
  }

  // Agrega una lectura y devuelve los eventos que generó.
  agregar(datos, origen) {
    const l = { ...normalizar(datos), ts: Date.now(), origen };
    const prev = this.ultimo;
    this.lecturas.push(l);
    if (this.lecturas.length > this.maxLecturas) this.lecturas.splice(0, this.lecturas.length - this.maxLecturas);
    this.ultimo = l;
    this.sucio = true;
    return { lectura: l, eventos: this.detectar(prev, l) };
  }

  evento(tipo, severidad, titulo, detalle = '', origen = null) {
    const e = { id: ++this.idEvento, ts: Date.now(), tipo, severidad, titulo, detalle, origen };
    this.eventos.push(e);
    if (this.eventos.length > this.maxEventos) this.eventos.splice(0, this.eventos.length - this.maxEventos);
    this.sucio = true;
    return e;
  }

  detectar(p, l) {
    const ev = [];
    const o = l.origen;
    const sev = ['ok', 'warning', 'serious', 'critical'];
    // Nueva sesión: cambio de fuente, reinicio del nodo o más de 1 min sin datos.
    let nuevaSesion = !p || p.origen !== o || l.ts - p.ts > 60000;
    if (!p || p.origen !== o) {
      ev.push(this.evento('fuente', 'info', o === 'simulador' ? 'Simulador en línea' : 'Nodo ESP32 en línea', `Recibiendo datos desde: ${o}`, o));
    } else if (l.seq < p.seq && l.seq <= 3) {
      nuevaSesion = true;
      ev.push(this.evento('reinicio', 'info', 'El nodo se reinició', `Secuencia reiniciada (${p.seq} → ${l.seq})`, o));
    }
    if (p && p.calentando && !l.calentando) {
      ev.push(this.evento('sensor', 'info', 'MQ-2 listo', 'Finalizó el precalentamiento del sensor de gas', o));
    }
    if (p && l.nivel !== p.nivel) {
      const N = NIVELES[l.nivel];
      const sube = l.nivel > p.nivel;
      ev.push(this.evento('nivel', sube ? sev[l.nivel] : 'ok',
        `${sube ? 'Sube' : 'Baja'} a nivel ${l.nivel} · ${N.nombre}`,
        `IR ${dec(l.ir)} · T ${l.temp == null ? '—' : dec(l.temp)} °C · Gas ${dec(l.p_gas)} %`, o));
    }
    if (p && l.llama && !p.llama) ev.push(this.evento('llama', 'critical', 'Llama detectada', `Sensor KY-026: ${l.llama_mv ?? '—'} mV`, o));
    if (p && !l.llama && p.llama) ev.push(this.evento('llama', 'ok', 'Llama extinguida', 'El sensor de llama volvió a valores normales', o));
    if (p && l.vallas !== p.vallas) {
      ev.push(this.evento('vallas', l.vallas ? 'serious' : 'ok', l.vallas ? 'Vallas cerradas' : 'Vallas abiertas',
        l.vallas ? 'El sendero quedó cortado (servos a 90°)' : 'Sendero habilitado nuevamente', o));
    }
    if (p && l.rociador !== p.rociador) {
      ev.push(this.evento('rociador', l.rociador ? 'serious' : 'ok', l.rociador ? 'Rociador activado' : 'Rociador detenido',
        l.rociador ? 'Bomba por ráfagas (2 s encendida / 4 s apagada)' : '', o));
    }
    if (p && p.enclavado && !l.enclavado && !nuevaSesion) ev.push(this.evento('rearme', 'ok', 'Sistema rearmado', 'Se liberó el enclavamiento de nivel 3', o));
    return ev;
  }

  historial(limite) {
    return limite ? this.lecturas.slice(-limite) : this.lecturas;
  }

  csv() {
    const cols = ['ts', 'origen', 'seq', 'temp', 'hum', 'gas_mv', 'p_gas', 'p_temp', 'ir', 'nivel', 'calentando', 'llama', 'llama_mv', 'vallas', 'rociador', 'bomba', 'enclavado', 'rssi'];
    const filas = this.lecturas.map((l) => cols.map((c) => (c === 'ts' ? new Date(l.ts).toISOString() : l[c] ?? '')).join(','));
    return [cols.join(','), ...filas].join('\n');
  }
}

module.exports = { Almacen, normalizar };
