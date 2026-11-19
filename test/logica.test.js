'use strict';
const test = require('node:test');
const assert = require('node:assert');
const L = require('../server/logica');

const evaluar = (estado, ir, extra = {}) =>
  L.evaluarNivel(estado, { ir, temp: 25, pg: 0, llama: false, calentando: false, pedirRearme: false, ...extra });

test('fórmula del IR coincide con el ejemplo del documento', () => {
  const pg = L.pGas(640);
  const pt = L.pTemp(24.5);
  assert.ok(Math.abs(pg - 5.8) < 0.06);
  assert.ok(Math.abs(pt - 11.3) < 0.06);
  assert.ok(Math.abs(L.indiceRiesgo(pg, pt) - 7.5) < 0.06);
});

test('pGas y pTemp quedan limitados entre 0 y 100', () => {
  assert.strictEqual(L.pGas(100), 0);
  assert.strictEqual(L.pGas(4000), 100);
  assert.strictEqual(L.pTemp(5), 0);
  assert.strictEqual(L.pTemp(90), 100);
});

test('subida inmediata por umbrales de IR', () => {
  const e = { nivel: 0, enclavado: false };
  assert.strictEqual(evaluar(e, 29.9).nivel, 0);
  assert.strictEqual(evaluar(e, 30).nivel, 1);
  assert.strictEqual(evaluar(e, 52).nivel, 2);
  assert.strictEqual(evaluar(e, 75).nivel, 3);
});

test('histéresis: baja solo 5 puntos por debajo del umbral', () => {
  assert.strictEqual(evaluar({ nivel: 2, enclavado: false }, 48).nivel, 2);
  assert.strictEqual(evaluar({ nivel: 2, enclavado: false }, 46.9).nivel, 1);
  assert.strictEqual(evaluar({ nivel: 1, enclavado: false }, 26).nivel, 1);
  assert.strictEqual(evaluar({ nivel: 1, enclavado: false }, 24).nivel, 0);
  assert.strictEqual(evaluar({ nivel: 2, enclavado: false }, 10).nivel, 0);
});

test('disparos directos a nivel 3: T > 40, pGas > 85, llama', () => {
  const e = { nivel: 0, enclavado: false };
  assert.strictEqual(evaluar(e, 10, { temp: 40.1 }).nivel, 3);
  assert.strictEqual(evaluar(e, 10, { temp: 40 }).nivel, 0);
  assert.strictEqual(evaluar(e, 10, { pg: 85.1 }).nivel, 3);
  assert.strictEqual(evaluar(e, 10, { llama: true }).nivel, 3);
});

test('nivel 3 queda enclavado hasta el rearme', () => {
  let e = evaluar({ nivel: 0, enclavado: false }, 80);
  assert.deepStrictEqual([e.nivel, e.enclavado], [3, true]);
  e = evaluar(e, 5);
  assert.strictEqual(e.nivel, 3);
  const rechazado = evaluar({ nivel: 3, enclavado: true }, 80, { pedirRearme: true });
  assert.ok(rechazado.rearmeRechazado);
  assert.strictEqual(rechazado.nivel, 3);
  const ok = evaluar({ nivel: 3, enclavado: true }, 35, { pedirRearme: true });
  assert.ok(ok.rearmado);
  assert.deepStrictEqual([ok.nivel, ok.enclavado], [1, false]);
});

test('precalentamiento: nivel 0 salvo llama', () => {
  const e = { nivel: 0, enclavado: false };
  assert.strictEqual(evaluar(e, 90, { calentando: true, pg: 95 }).nivel, 0);
  assert.strictEqual(evaluar(e, 0, { calentando: true, llama: true }).nivel, 3);
});
