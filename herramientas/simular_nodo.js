#!/usr/bin/env node
'use strict';
// Simula al ESP32 desde la PC: manda un POST JSON por segundo al servidor, igual que el nodo real.
// Uso: node herramientas/simular_nodo.js [URL] [--token XXX] [--escenario normal|precaucion|alerta|incendio]
// Teclas: n = normal, p = precaución, a = alerta, i = incendio, r = rearme, q = salir.

require('../server/env');
const { NodoVirtual } = require('../server/simulador');

const args = process.argv.slice(2);
const opt = (n, def) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : def; };
const URL_DESTINO = args.find((a) => /^https?:\/\//.test(a)) || 'http://localhost:3000/api/lecturas';
const TOKEN = opt('--token', process.env.DEVICE_TOKEN || '');

let enviados = 0;
let errores = 0;

const nodo = new NodoVirtual(async (lectura) => {
  try {
    const r = await fetch(URL_DESTINO, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(TOKEN ? { 'X-Device-Token': TOKEN } : {}) },
      body: JSON.stringify(lectura),
      signal: AbortSignal.timeout(4000),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(`HTTP ${r.status} ${j.error || ''}`);
    enviados++;
    if (j.rearme) { nodo.rearmar(); console.log('\n  ↺ Rearme remoto recibido desde el panel'); }
    process.stdout.write(`\r  #${lectura.seq}  nivel ${lectura.nivel}  IR ${lectura.ir.toFixed(1).padStart(5)}  T ${lectura.temp.toFixed(1)}°C  gas ${String(lectura.gas_mv).padStart(4)} mV  llama ${lectura.llama ? 'SÍ' : 'no'}  [${nodo.escenario}]  ok ${enviados} / err ${errores}   `);
  } catch (e) {
    errores++;
    process.stdout.write(`\r  ✗ No se pudo enviar (#${lectura.seq}): ${e.message}                                   `);
  }
});

console.log(`\n  Simulando nodo ESP32 → ${URL_DESTINO}`);
console.log('  Teclas: [n]ormal  [p]recaución  [a]lerta  [i]ncendio  [r]earme  [q] salir\n');
nodo.iniciar({ escenario: opt('--escenario', 'normal') });

if (process.stdin.isTTY) {
  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.on('data', (b) => {
    const k = b.toString().toLowerCase();
    const mapa = { n: 'normal', p: 'precaucion', a: 'alerta', i: 'incendio' };
    if (mapa[k]) nodo.fijarEscenario(mapa[k]);
    else if (k === 'r') nodo.rearmar();
    else if (k === 'q' || b[0] === 3) { console.log('\n'); process.exit(0); }
  });
}
