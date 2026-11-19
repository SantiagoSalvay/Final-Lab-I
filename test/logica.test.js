'use strict';
const test = require('node:test');
const assert = require('node:assert');
const L = require('../server/logica');

const base = { ir: 0, temp: 25, pg: 0, llama: false, calentando: false, pedirRearme: false };
const evaluar = (estado, ir, extra = {}) => L.evaluarNivel(estado, { ...base, ir, ...extra });

test('fórmula del IR con la calibración del MQ-2 (250 a 1800 mV)', () => {
  assert.strictEqual(L.pGas(250), 0);
  assert.strictEqual(L.pGas(1025), 50);
  assert.strictEqual(L.pGas(1800), 100);
  const pg = L.pGas(640);
  const pt = L.pTemp(24.5);
  assert.ok(Math.abs(pg - 25.2) < 0.06);
  assert.ok(Math.abs(pt - 11.3) < 0.06);
  assert.ok(Math.abs(L.indiceRiesgo(pg, pt) - 21.0) < 0.06);
});

test('pGas y pTemp quedan limitados entre 0 y 100', () => {
  assert.strictEqual(L.pGas(100), 0);
  assert.strictEqual(L.pGas(4000), 100);
  assert.strictEqual(L.pTemp(5), 0);
  assert.strictEqual(L.pTemp(90), 100);
});

test('subida inmediata por umbrales de IR', () => {
  const e = { nivelBase: 0, enclavado: false };
  assert.strictEqual(evaluar(e, 29.9).nivel, 0);
  assert.strictEqual(evaluar(e, 30).nivel, 1);
  assert.strictEqual(evaluar(e, 52).nivel, 2);
  assert.strictEqual(evaluar(e, 75).nivel, 3);
});

test('histéresis de 3 puntos para bajar (nivelDesdeIr)', () => {
  assert.strictEqual(evaluar({ nivelBase: 2 }, 49).nivel, 2);
  assert.strictEqual(evaluar({ nivelBase: 2 }, 48.9).nivel, 1);
  assert.strictEqual(evaluar({ nivelBase: 1 }, 27).nivel, 1);
  assert.strictEqual(evaluar({ nivelBase: 1 }, 26.9).nivel, 0);
  assert.strictEqual(evaluar({ nivelBase: 2 }, 10).nivel, 0);
});

test('disparos directos a nivel 3: T > 40, pGas > 85, llama', () => {
  const e = { nivelBase: 0, enclavado: false };
  assert.strictEqual(evaluar(e, 10, { temp: 40.1 }).nivel, 3);
  assert.strictEqual(evaluar(e, 10, { temp: 40 }).nivel, 0);
  assert.strictEqual(evaluar(e, 10, { pg: 85.1 }).nivel, 3);
  assert.strictEqual(evaluar(e, 10, { llama: true }).nivel, 3);
});

test('nivel 3 queda enclavado hasta el rearme, que se rechaza con la alarma activa', () => {
  let e = evaluar({ nivelBase: 0, enclavado: false }, 80);
  assert.deepStrictEqual([e.nivel, e.enclavado], [3, true]);
  e = evaluar(e, 5);
  assert.strictEqual(e.nivel, 3);
  const rechazado = evaluar({ nivelBase: 2, enclavado: true }, 80, { pedirRearme: true });
  assert.ok(rechazado.rearmeRechazado);
  assert.strictEqual(rechazado.nivel, 3);
  const ok = evaluar({ nivelBase: 2, enclavado: true }, 35, { pedirRearme: true });
  assert.ok(ok.rearmado);
  assert.deepStrictEqual([ok.nivel, ok.enclavado], [1, false]);
});

test('precalentamiento: nivel 0 salvo llama', () => {
  const e = { nivelBase: 0, enclavado: false };
  assert.strictEqual(evaluar(e, 90, { calentando: true, pg: 95, temp: 45 }).nivel, 0);
  assert.strictEqual(evaluar(e, 0, { calentando: true, llama: true }).nivel, 3);
});

test('bomba: 3 s encendida, 5 s apagada, hasta 6 ráfagas', () => {
  assert.deepStrictEqual(L.estadoBomba(0), { rociador: true, bomba: true });
  assert.deepStrictEqual(L.estadoBomba(3500), { rociador: true, bomba: false });
  assert.deepStrictEqual(L.estadoBomba(8000), { rociador: true, bomba: true });
  assert.deepStrictEqual(L.estadoBomba(6 * 8000), { rociador: false, bomba: false });
});
