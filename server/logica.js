'use strict';
// Lógica del nodo replicada en JS: misma fórmula, umbrales, histéresis y rearme que nodo_transmisor.ino.

const CFG = Object.freeze({
  GAS_MIN_MV: 525,
  GAS_MAX_MV: 2500,
  T_MIN: 20,
  T_MAX: 60,
  W_GAS: 0.7,
  W_TEMP: 0.3,
  UMBRALES: [0, 30, 52, 75], // IR mínimo de cada nivel
  T_OVERRIDE: 40, // °C (estrictamente mayor)
  GAS_OVERRIDE_P: 85, // % (estrictamente mayor)
  LLAMA_UMBRAL_MV: 1800, // por debajo = llama
  HISTERESIS: 5, // puntos de IR para bajar de nivel
  PRECALENTAMIENTO_S: 60,
  BOMBA_ON_MS: 2000,
  BOMBA_OFF_MS: 4000,
});

const NIVELES = Object.freeze([
  { n: 0, nombre: 'Normal', accion: 'Sendero habilitado. Monitoreo continuo.' },
  { n: 1, nombre: 'Precaución', accion: 'Condiciones de riesgo en aumento. Vigilancia reforzada.' },
  { n: 2, nombre: 'Alerta', accion: 'Riesgo alto de incendio. Alarma sonora intermitente, preparar evacuación.' },
  { n: 3, nombre: 'Alarma', accion: 'Incendio probable. Vallas cerradas, rociador activo, evacuar el sendero.' },
]);

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const r1 = (v) => Math.round(v * 10) / 10;

function pGas(gasMv) {
  return clamp(((gasMv - CFG.GAS_MIN_MV) / (CFG.GAS_MAX_MV - CFG.GAS_MIN_MV)) * 100, 0, 100);
}

function pTemp(t) {
  if (t == null || Number.isNaN(t)) return 0;
  return clamp(((t - CFG.T_MIN) / (CFG.T_MAX - CFG.T_MIN)) * 100, 0, 100);
}

function indiceRiesgo(pg, pt) {
  return CFG.W_GAS * pg + CFG.W_TEMP * pt;
}

function condicionAlarma({ ir, temp, pg, llama }) {
  return ir >= CFG.UMBRALES[3] || (temp != null && temp > CFG.T_OVERRIDE) || pg > CFG.GAS_OVERRIDE_P || !!llama;
}

// Nivel 0..2 a partir del IR, con histéresis para bajar.
function nivelPorIR(ir, previo) {
  const U = CFG.UMBRALES;
  const sube = ir >= U[3] ? 3 : ir >= U[2] ? 2 : ir >= U[1] ? 1 : 0;
  if (sube >= previo) return sube;
  let n = previo;
  while (n > sube && ir < U[n] - CFG.HISTERESIS) n--;
  return n;
}

/**
 * Máquina de estados del nivel (idéntica al firmware).
 * estado: { nivel, enclavado } — se devuelve uno nuevo.
 */
function evaluarNivel(estado, { ir, temp, pg, llama, calentando, pedirRearme }) {
  let { nivel, enclavado } = estado;
  const alarma = condicionAlarma({ ir, temp, pg: calentando ? 0 : pg, llama });
  let rearmado = false;
  let rearmeRechazado = false;

  if (calentando) {
    if (llama) { nivel = 3; enclavado = true; }
    else if (!enclavado) nivel = 0;
  } else if (alarma) {
    nivel = 3; enclavado = true;
  } else if (!enclavado) {
    nivel = Math.min(2, nivelPorIR(ir, nivel));
  }

  if (pedirRearme && enclavado) {
    const libre = calentando ? !llama : !alarma && ir < CFG.UMBRALES[3] - CFG.HISTERESIS;
    if (libre) {
      enclavado = false;
      nivel = calentando ? 0 : Math.min(2, nivelPorIR(ir, 0));
      rearmado = true;
    } else {
      rearmeRechazado = true;
    }
  }
  return { nivel, enclavado, rearmado, rearmeRechazado };
}

module.exports = { CFG, NIVELES, clamp, r1, pGas, pTemp, indiceRiesgo, condicionAlarma, nivelPorIR, evaluarNivel };
