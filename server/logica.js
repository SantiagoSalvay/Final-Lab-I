'use strict';
// Lógica del nodo replicada en JS: misma fórmula, umbrales, histéresis y rearme que nodo_transmisor.ino.

const CFG = Object.freeze({
  GAS_MIN_MV: 250,
  GAS_MAX_MV: 1800,
  T_MIN: 20,
  T_MAX: 60,
  W_GAS: 0.7,
  W_TEMP: 0.3,
  UMBRALES: [0, 30, 52, 75], // IR mínimo de cada nivel
  T_OVERRIDE: 40, // °C (estrictamente mayor)
  GAS_OVERRIDE_P: 85, // % (estrictamente mayor)
  LLAMA_UMBRAL_MV: 1800, // por debajo = llama
  HISTERESIS: 3, // puntos de IR para bajar de nivel (HIST_IR)
  PRECALENTAMIENTO_S: 60,
  BOMBA_ON_MS: 3000,
  BOMBA_OFF_MS: 5000,
  MAX_RAFAGAS: 6,
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

// condicionActiva del firmware: la llama siempre cuenta; el resto, solo después del precalentamiento.
function condicionAlarma({ ir, temp, pg, llama, calentando = false }) {
  const tempAlta = temp != null && temp > CFG.T_OVERRIDE;
  return !!llama || (!calentando && (ir >= CFG.UMBRALES[3] || tempAlta || pg > CFG.GAS_OVERRIDE_P));
}

// nivelDesdeIr del firmware: nivel 0 a 2 con histéresis para que no oscile en los umbrales.
function nivelPorIR(ir, previo) {
  const [, N1, N2] = CFG.UMBRALES;
  const H = CFG.HISTERESIS;
  if (ir >= N2 - (previo >= 2 ? H : 0)) return 2;
  if (ir >= N1 - (previo >= 1 ? H : 0)) return 1;
  return 0;
}

/**
 * Máquina de estados del nivel (idéntica a evaluar() + rearmar() del firmware).
 * estado: { nivelBase, enclavado } — se devuelve uno nuevo con el nivel mostrado.
 */
function evaluarNivel(estado, { ir, temp, pg, llama, calentando, pedirRearme }) {
  let { nivelBase = 0, enclavado = false } = estado;
  const alarma = condicionAlarma({ ir, temp, pg, llama, calentando });
  let rearmado = false;
  let rearmeRechazado = false;

  if (pedirRearme && enclavado) {
    if (alarma) rearmeRechazado = true;
    else { enclavado = false; rearmado = true; }
  }
  if (alarma) enclavado = true;
  nivelBase = calentando ? 0 : nivelPorIR(ir, nivelBase);
  const nivel = enclavado ? 3 : nivelBase;
  return { nivel, nivelBase, enclavado, rearmado, rearmeRechazado };
}

// Estado de la bomba: ráfagas de BOMBA_ON/BOMBA_OFF desde que se enclavó, hasta MAX_RAFAGAS.
function estadoBomba(msDesdeAlarma) {
  const ciclo = CFG.BOMBA_ON_MS + CFG.BOMBA_OFF_MS;
  const rafaga = Math.floor(msDesdeAlarma / ciclo);
  const activo = rafaga < CFG.MAX_RAFAGAS;
  return { rociador: activo, bomba: activo && msDesdeAlarma % ciclo < CFG.BOMBA_ON_MS };
}

module.exports = { CFG, NIVELES, clamp, r1, pGas, pTemp, indiceRiesgo, condicionAlarma, nivelPorIR, evaluarNivel, estadoBomba };
