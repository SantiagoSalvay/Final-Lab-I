// Panel SATI: recibe el flujo en vivo del servidor (SSE) y actualiza escena, indicadores, gráficos y registros.

import { GraficoLinea, sparkline, leerTema } from './graficos.js';
import { Escena } from './escena.js';
import { Sirena } from './sonido.js';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const fmt = (v, d = 1) => (v == null || Number.isNaN(v) ? '—' : Number(v).toLocaleString('es-AR', { minimumFractionDigits: d, maximumFractionDigits: d }));
const hora = (t) => new Date(t).toLocaleTimeString('es-AR', { hour12: false });

const NOMBRES = ['Normal', 'Precaución', 'Alerta', 'Alarma'];
const ACCIONES = [
  'Sendero habilitado. Monitoreo continuo.',
  'Condiciones de riesgo en aumento. Vigilancia reforzada.',
  'Riesgo alto de incendio. Alarma intermitente, preparar evacuación.',
  'Incendio probable. Vallas cerradas, rociador activo, evacuar el sendero.',
];
const MAX_LOCAL = 3600;
const FILAS_TABLA = 40;

const st = {
  lecturas: [],
  eventos: [],
  sistema: null,
  config: null,
  ventana: 300000,
  filtro: 'todos',
  offset: 0, // reloj del servidor − reloj local
  ultimoEstadoLocal: 0,
  nivelPrevio: null,
  recibioInicial: false,
};

let tema = leerTema();
const escena = new Escena($('#escena'));
const sirena = new Sirena();

// ---------- Gráficos ----------
const colorNivel = (p) => (p ? tema.n[p.nivel ?? 0] : tema.serie);
const graficos = {
  ir: new GraficoLinea($('#g-ir'), {
    min: 0, max: 100, unidad: '', decimales: 1, bandas: [[0, 30], [30, 52], [52, 75], [75, 100]], colorSerie: colorNivel,
    extraTooltip: (p) => ` <span>· nivel ${p.nivel} ${NOMBRES[p.nivel]}</span>`,
  }),
  temp: new GraficoLinea($('#g-temp'), { minRango: 4, unidad: '°C', decimales: 1 }),
  hum: new GraficoLinea($('#g-hum'), { min: 0, max: 100, minRango: 10, unidad: '%', decimales: 0 }),
  gas: new GraficoLinea($('#g-gas'), { min: 0, max: 100, minRango: 10, unidad: '%', decimales: 1, extraTooltip: (p) => ` <span>· ${p.mv ?? '—'} mV</span>` }),
};

function actualizarSeries() {
  const L = st.lecturas;
  graficos.ir.setDatos(L.map((l) => ({ t: l.ts, v: l.ir, nivel: l.nivel, seq: l.seq })), st.ventana);
  graficos.temp.setDatos(L.map((l) => ({ t: l.ts, v: l.temp, seq: l.seq })), st.ventana);
  graficos.hum.setDatos(L.map((l) => ({ t: l.ts, v: l.hum, seq: l.seq })), st.ventana);
  graficos.gas.setDatos(L.map((l) => ({ t: l.ts, v: l.p_gas, mv: l.gas_mv, seq: l.seq })), st.ventana);
}

let ultimoDibujo = 0;
function bucle(t) {
  if (!document.hidden && t - ultimoDibujo > 33) {
    ultimoDibujo = t;
    const ahora = Date.now() + st.offset - 1000;
    for (const g of Object.values(graficos)) g.dibujar(ahora);
  }
  requestAnimationFrame(bucle);
}
requestAnimationFrame(bucle);

// ---------- Animación de números ----------
function animarNumero(el, destino, dec = 1, alPaso) {
  if (destino == null || Number.isNaN(destino)) { el.textContent = '—'; el._v = null; return; }
  const desde = el._v ?? destino;
  el._v = destino;
  const t0 = performance.now();
  const dur = 650;
  cancelAnimationFrame(el._raf);
  const paso = (t) => {
    const k = Math.min(1, (t - t0) / dur);
    const e = 1 - Math.pow(1 - k, 3);
    const v = desde + (destino - desde) * e;
    el.textContent = fmt(v, dec);
    if (alPaso) alPaso(v);
    if (k < 1) el._raf = requestAnimationFrame(paso);
  };
  el._raf = requestAnimationFrame(paso);
}

// ---------- Gauge del IR ----------
const GC = { cx: 120, cy: 120 };
const polar = (v, r) => {
  const a = Math.PI * (1 - v / 100);
  return [GC.cx + r * Math.cos(a), GC.cy - r * Math.sin(a)];
};
const arco = (a, b, r) => {
  const [x1, y1] = polar(a, r);
  const [x2, y2] = polar(b, r);
  return `M${x1.toFixed(2)} ${y1.toFixed(2)} A${r} ${r} 0 0 1 ${x2.toFixed(2)} ${y2.toFixed(2)}`;
};
function construirGauge() {
  const ns = 'http://www.w3.org/2000/svg';
  const bandas = $('#gauge-bandas');
  const ticks = $('#gauge-ticks');
  bandas.replaceChildren();
  ticks.replaceChildren();
  [[0, 30], [30, 52], [52, 75], [75, 100]].forEach(([a, b], k) => {
    const p = document.createElementNS(ns, 'path');
    p.setAttribute('d', arco(a + (a ? 0.6 : 0), b - (b < 100 ? 0.6 : 0), 92));
    p.setAttribute('fill', 'none');
    p.setAttribute('stroke', tema.n[k]);
    p.setAttribute('stroke-width', '16');
    bandas.appendChild(p);
  });
  [0, 30, 52, 75, 100].forEach((v) => {
    const [x, y] = polar(v, 112);
    const t = document.createElementNS(ns, 'text');
    t.setAttribute('x', x.toFixed(1));
    t.setAttribute('y', (y + 3).toFixed(1));
    t.setAttribute('text-anchor', v === 0 ? 'end' : v === 100 ? 'start' : 'middle');
    t.textContent = v;
    ticks.appendChild(t);
  });
}
construirGauge();
function fijarGauge(ir) {
  $('#gauge-aguja').style.transform = `rotate(${(Math.max(0, Math.min(100, ir)) / 100) * 180 - 90}deg)`;
  animarNumero($('#gauge-num'), ir, 1, (v) => {
    const c = Math.max(0.01, Math.min(100, v));
    $('#gauge-valor').setAttribute('d', arco(0, c, 74));
  });
}

// ---------- Renderizado de una lectura ----------
const spark = { temp: [], hum: [], gas: [], llama: [] };

function renderLectura(l, nueva) {
  const nivel = l.nivel;
  escena.actualizar(l);

  // Nivel
  const hero = $('#nivel-hero');
  if (st.nivelPrevio !== nivel) {
    const num = $('#nivel-num');
    num.classList.remove('cambio');
    void num.offsetWidth;
    num.classList.add('cambio');
  }
  hero.dataset.nivel = nivel;
  $('#nivel-num').textContent = nivel;
  $('#nivel-nombre').textContent = NOMBRES[nivel];
  $('#nivel-accion').textContent = l.calentando && nivel === 0 ? 'Sensor de gas en precalentamiento: el nivel se fija en 0 salvo llama.' : ACCIONES[nivel];
  $$('#escalera li').forEach((li) => {
    const n = Number(li.dataset.n);
    li.classList.toggle('activo', n === nivel);
    li.classList.toggle('pasado', n < nivel);
  });
  fijarGauge(l.ir);
  const aGas = 0.7 * l.p_gas;
  const aTemp = 0.3 * l.p_temp;
  animarNumero($('#aporte-gas'), aGas, 1);
  animarNumero($('#aporte-temp'), aTemp, 1);
  $('#aporte-barra-gas').style.width = `${aGas}%`;
  $('#aporte-barra-temp').style.width = `${aTemp}%`;

  // Avisos
  $('#aviso-calentando').hidden = !l.calentando;
  $('#hud-calentando').hidden = !l.calentando;
  if (l.calentando) {
    const rest = Math.max(0, 60 - (l.uptime_s ?? 0));
    $('#hud-calentando-s').textContent = rest;
    $('#progreso-calentando').style.width = `${Math.min(100, ((l.uptime_s ?? 0) / 60) * 100)}%`;
  }
  $('#aviso-enclavado').hidden = !(l.enclavado && nivel === 3);

  // KPIs
  const v = (k) => $(`[data-v="${k}"]`);
  animarNumero(v('temp'), l.temp, 1);
  animarNumero(v('p_temp'), l.p_temp, 1);
  animarNumero(v('hum'), l.hum, 0);
  v('hum_txt').textContent = l.hum == null ? '—' : l.hum < 25 ? 'muy seco' : l.hum < 40 ? 'ambiente seco' : l.hum <= 70 ? 'confortable' : 'húmedo';
  animarNumero(v('p_gas'), l.p_gas, 1);
  animarNumero(v('gas_mv'), l.gas_mv, 0);
  animarNumero(v('llama_mv'), l.llama_mv, 0);
  v('llama_txt').textContent = l.llama ? 'LLAMA DETECTADA' : 'Sin llama';
  const barra = (k, pct) => { $(`[data-barra="${k}"]`).style.width = `${Math.max(0, Math.min(100, pct))}%`; };
  barra('temp', l.p_temp);
  barra('hum', l.hum ?? 0);
  barra('gas', l.p_gas);
  barra('llama', l.llama_mv == null ? 0 : ((3300 - l.llama_mv) / 3300) * 100);
  const alerta = (k, si) => { $(`[data-kpi="${k}"]`).dataset.alerta = si ? 'true' : 'false'; };
  alerta('temp', l.temp != null && l.temp > 40);
  alerta('gas', l.p_gas > 85 && !l.calentando);
  alerta('llama', l.llama);
  alerta('hum', false);

  if (nueva) {
    for (const [k, val] of [['temp', l.temp], ['hum', l.hum], ['gas', l.p_gas], ['llama', l.llama_mv]]) {
      spark[k].push(val);
      if (spark[k].length > 90) spark[k].shift();
    }
  }
  dibujarSparks();

  // Chips de actuadores
  const chip = (k, txt, on) => { const c = $(`[data-chip="${k}"]`); c.querySelector('b').textContent = txt; c.dataset.on = on; };
  chip('vallas', l.vallas ? 'cerradas' : 'abiertas', l.vallas ? 'true' : 'false');
  chip('sirena', nivel === 3 ? 'continua' : nivel === 2 ? 'intermitente' : 'en silencio', nivel === 3 ? 'true' : nivel === 2 ? 'warn' : 'false');
  chip('rociador', l.bomba ? 'rociando' : l.rociador ? 'activo (pausa)' : 'en espera', l.rociador ? 'true' : 'false');

  // Info del nodo
  $('#info-seq').textContent = `#${l.seq}`;
  $('#info-rssi').textContent = l.rssi == null ? '—' : `${l.rssi} dBm · ${l.rssi > -60 ? 'excelente' : l.rssi > -70 ? 'buena' : l.rssi > -80 ? 'regular' : 'débil'}`;
  $('#info-uptime').textContent = l.uptime_s == null ? '—' : duracion(l.uptime_s);
  $('#info-origen').textContent = { esp32: 'ESP32 (WiFi)', simulador: 'Simulador', 'puente-usb': 'Puente USB' }[l.origen] || l.origen;
  $('#hud-paquete').textContent = `Paquete #${l.seq} · ${hora(l.ts)} · IR ${fmt(l.ir)} · ${fmt(l.temp)} °C · ${fmt(l.hum, 0)} %HR`;

  // Sonido, banner, título y favicon
  sirena.fijarModo(nivel === 3 ? 'continua' : nivel === 2 ? 'intermitente' : 'off');
  const banner = $('#banner-alarma');
  banner.hidden = nivel !== 3;
  if (nivel === 3) {
    const causas = [];
    if (l.llama) causas.push('llama detectada');
    if (l.temp != null && l.temp > 40) causas.push(`temperatura ${fmt(l.temp)} °C`);
    if (l.p_gas > 85) causas.push(`gas ${fmt(l.p_gas)} %`);
    if (l.ir >= 75) causas.push(`IR ${fmt(l.ir)}`);
    $('#banner-detalle').textContent = `${causas.length ? 'Causa: ' + causas.join(', ') + '. ' : 'Alarma enclavada a la espera de rearme. '}Vallas cerradas y rociador activo: evacuar el sendero.`;
  }
  document.title = nivel === 3 ? '⚠ ALARMA · SATI' : nivel === 2 ? '▲ Alerta · SATI' : 'SATI · Panel del encargado';
  if (st.nivelPrevio !== nivel) actualizarFavicon(nivel);
  st.nivelPrevio = nivel;
}

function dibujarSparks() {
  const c = (k) => ($(`[data-kpi="${k}"]`).dataset.alerta === 'true' ? tema.n[3] : tema.serie);
  sparkline($('[data-spark="temp"]'), spark.temp, c('temp'), 2);
  sparkline($('[data-spark="hum"]'), spark.hum, c('hum'), 5);
  sparkline($('[data-spark="gas"]'), spark.gas, c('gas'), 5);
  sparkline($('[data-spark="llama"]'), spark.llama, c('llama'), 200);
}

function duracion(s) {
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60;
  return h ? `${h} h ${String(m).padStart(2, '0')} min` : m ? `${m} min ${String(x).padStart(2, '0')} s` : `${x} s`;
}

function actualizarFavicon(n) {
  const c = ['#0ca30c', '#fab219', '#ec835a', '#d03b3b'][n];
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><path d="M32 3 7 11v19c0 15 10.5 26 25 31 14.5-5 25-16 25-31V11z" fill="#0d2344" stroke="${c}" stroke-width="4"/><path d="M32 14c2 7 11 11 11 22a11 11 0 0 1-22 0c0-6 4-9 5-14 1.5 4 3 5.5 4.5 5.5 0-5 .5-9 1.5-13.5z" fill="${c}"/></svg>`;
  $('#favicon').href = `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

// ---------- Estado de conexión ----------
function renderSistema(s) {
  st.sistema = s;
  if (s.servidor_ts) st.offset = s.servidor_ts - Date.now();
  st.ultimoEstadoLocal = Date.now();
  const pill = $('#pill-conexion');
  if (s.conectado) {
    pill.dataset.estado = 'vivo';
    $('#txt-conexion').textContent = 'En vivo';
  } else {
    pill.dataset.estado = 'sin-senal';
    $('#txt-conexion').textContent = st.lecturas.length ? `Sin señal · ${Math.round((s.edad_ms ?? 0) / 1000)} s` : 'Esperando nodo';
  }
  const f = $('#pill-fuente');
  f.hidden = !s.origen || !s.conectado;
  f.dataset.origen = s.origen || '';
  f.textContent = s.origen === 'simulador' ? 'Modo simulación' : s.origen === 'puente-usb' ? 'Nodo ESP32 · USB' : 'Nodo ESP32 · WiFi';
  escena.sinSenal(!s.conectado);
  $('#escena-sinsenal').hidden = s.conectado;
  if (!s.conectado) {
    sirena.fijarModo('off');
    $('#banner-alarma').hidden = true;
  }
  $('#estado-actualizado').textContent = s.conectado && st.lecturas.length ? `Actualizado ${hora(st.lecturas[st.lecturas.length - 1].ts)}` : 'Sin datos recientes';

  // Simulador
  const sim = s.simulador || {};
  const sp = $('#sim-estado');
  sp.dataset.activo = sim.activo ? 'true' : 'false';
  sp.querySelector('span').textContent = sim.activo ? `Activo · ${sim.escenario}` : 'Inactivo';
  $$('#escenarios button').forEach((b) => b.setAttribute('aria-pressed', sim.activo && b.dataset.escenario === sim.escenario ? 'true' : 'false'));
}

// Si el servidor deja de mandar latidos, la conexión del navegador se cortó.
setInterval(() => {
  $('#reloj').textContent = new Date().toLocaleTimeString('es-AR', { hour12: false });
  if (st.recibioInicial && Date.now() - st.ultimoEstadoLocal > 4000) {
    $('#pill-conexion').dataset.estado = 'conectando';
    $('#txt-conexion').textContent = 'Reconectando con el servidor…';
  }
  refrescarTiempos();
}, 1000);

// ---------- Eventos ----------
const ICONOS = {
  nivel: '<path d="M12 3 2 20h20L12 3z"/><path d="M12 10v4M12 17h.01"/>',
  llama: '<path d="M12 2c1 4 6 6 6 12a6 6 0 0 1-12 0c0-3 2-5 3-7 1 2 2 3 3 3 0-3 0-5 0-8z"/>',
  vallas: '<path d="M4 20V8M20 20V8M4 11h16M4 15h16"/>',
  rociador: '<path d="M12 3s6 6.6 6 11a6 6 0 0 1-12 0c0-4.4 6-11 6-11z"/>',
  conexion: '<path d="M2 8.5a15 15 0 0 1 20 0M5.5 12a10 10 0 0 1 13 0M9 15.5a5 5 0 0 1 6 0M12 19h.01M3 3l18 18"/>',
  fuente: '<rect x="6" y="6" width="12" height="12" rx="2"/><path d="M9 2v4M15 2v4M9 18v4M15 18v4M2 9h4M2 15h4M18 9h4M18 15h4"/>',
  rearme: '<path d="M12 3v8M6.3 6.3a8 8 0 1 0 11.4 0"/>',
  sensor: '<path d="M10 4a2 2 0 1 1 4 0v9.5a4.5 4.5 0 1 1-4 0z"/>',
  escenario: '<path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0"/><circle cx="16" cy="6" r="2"/><circle cx="10" cy="12" r="2"/><circle cx="18" cy="18" r="2"/>',
  reinicio: '<path d="M4 12a8 8 0 1 0 2.3-5.7M4 4v5h5"/>',
};
const svgIcono = (tipo) => `<svg viewBox="0 0 24 24" aria-hidden="true">${ICONOS[tipo] || ICONOS.fuente}</svg>`;

function relativo(ts) {
  const s = Math.max(0, Math.round((Date.now() + st.offset - ts) / 1000));
  if (s < 5) return 'recién';
  if (s < 60) return `hace ${s} s`;
  if (s < 3600) return `hace ${Math.floor(s / 60)} min`;
  return `hace ${Math.floor(s / 3600)} h`;
}

function nodoEvento(e) {
  const li = document.createElement('li');
  li.className = 'evento';
  li.dataset.sev = e.severidad;
  li.dataset.alerta = ['warning', 'serious', 'critical'].includes(e.severidad) ? 'true' : 'false';
  const ic = document.createElement('span');
  ic.className = 'evento__ic';
  ic.innerHTML = svgIcono(e.tipo);
  const txt = document.createElement('div');
  txt.className = 'evento__txt';
  const t1 = document.createElement('strong');
  t1.textContent = e.titulo;
  const t2 = document.createElement('span');
  t2.textContent = e.detalle || (e.origen ? `Origen: ${e.origen}` : '');
  txt.append(t1, t2);
  const tm = document.createElement('time');
  tm.dataset.ts = e.ts;
  const b = document.createElement('b');
  b.textContent = hora(e.ts);
  const rel = document.createElement('span');
  rel.className = 'rel';
  rel.textContent = relativo(e.ts);
  tm.append(b, rel);
  li.append(ic, txt, tm);
  if (st.filtro === 'alertas' && li.dataset.alerta !== 'true') li.hidden = true;
  return li;
}

function renderEventos() {
  const ol = $('#eventos');
  ol.replaceChildren(...st.eventos.slice(-80).reverse().map(nodoEvento));
  $('#eventos-vacio').hidden = st.eventos.length > 0;
}

function agregarEvento(e) {
  st.eventos.push(e);
  const ol = $('#eventos');
  ol.prepend(nodoEvento(e));
  while (ol.children.length > 80) ol.lastElementChild.remove();
  $('#eventos-vacio').hidden = true;
  if (['warning', 'serious', 'critical'].includes(e.severidad) || e.tipo === 'rearme') toast(e);
}

function refrescarTiempos() {
  $$('#eventos time').forEach((t) => { t.querySelector('.rel').textContent = relativo(Number(t.dataset.ts)); });
}

$('#filtro-eventos').addEventListener('click', (ev) => {
  const b = ev.target.closest('button');
  if (!b) return;
  st.filtro = b.dataset.filtro;
  $$('#filtro-eventos button').forEach((x) => x.setAttribute('aria-selected', x === b ? 'true' : 'false'));
  $$('#eventos .evento').forEach((li) => { li.hidden = st.filtro === 'alertas' && li.dataset.alerta !== 'true'; });
});

// ---------- Toasts ----------
function toast(e) {
  const d = document.createElement('div');
  d.className = 'toast';
  d.dataset.sev = e.severidad;
  d.innerHTML = svgIcono(e.tipo);
  const t = document.createElement('div');
  const s = document.createElement('strong');
  s.textContent = e.titulo;
  const p = document.createElement('span');
  p.textContent = e.detalle || '';
  t.append(s, p);
  d.append(t);
  const cont = $('#toasts');
  cont.append(d);
  while (cont.children.length > 4) cont.firstElementChild.remove();
  setTimeout(() => { d.classList.add('saliendo'); setTimeout(() => d.remove(), 400); }, e.severidad === 'critical' ? 9000 : 6000);
}

// ---------- Tabla de historial ----------
function filaTabla(l) {
  const tr = document.createElement('tr');
  const celdas = [hora(l.ts), l.seq, fmt(l.temp), fmt(l.hum, 0), l.gas_mv, fmt(l.p_gas), fmt(l.ir)];
  for (const c of celdas) { const td = document.createElement('td'); td.textContent = c; tr.append(td); }
  const tdN = document.createElement('td');
  const badge = document.createElement('span');
  badge.className = 'badge';
  badge.dataset.n = l.nivel;
  badge.textContent = `${l.nivel} · ${NOMBRES[l.nivel]}`;
  tdN.append(badge);
  const tdL = document.createElement('td');
  tdL.textContent = l.llama ? 'Sí' : 'No';
  tdL.className = l.llama ? 'si' : 'no';
  const tdV = document.createElement('td');
  tdV.textContent = l.vallas ? 'Cerradas' : 'Abiertas';
  tdV.className = l.vallas ? 'si' : 'no';
  tr.append(tdN, tdL, tdV);
  return tr;
}

function renderTabla() {
  $('#tabla-cuerpo').replaceChildren(...st.lecturas.slice(-FILAS_TABLA).reverse().map(filaTabla));
}

function agregarFila(l) {
  const tb = $('#tabla-cuerpo');
  const tr = filaTabla(l);
  tr.classList.add('nueva');
  tb.prepend(tr);
  while (tb.children.length > FILAS_TABLA) tb.lastElementChild.remove();
}

// ---------- Conexión en vivo ----------
function conectar() {
  const es = new EventSource('api/stream');
  es.addEventListener('inicial', (m) => {
    const d = JSON.parse(m.data);
    st.config = d.config;
    st.lecturas = d.historial;
    st.eventos = d.eventos;
    st.recibioInicial = true;
    for (const k of Object.keys(spark)) spark[k] = [];
    for (const l of st.lecturas.slice(-90)) {
      spark.temp.push(l.temp); spark.hum.push(l.hum); spark.gas.push(l.p_gas); spark.llama.push(l.llama_mv);
    }
    actualizarSeries();
    renderEventos();
    renderTabla();
    const u = st.lecturas[st.lecturas.length - 1];
    if (u) renderLectura(u, false);
    renderSistema(d.estado);
  });
  es.addEventListener('lectura', (m) => {
    const l = JSON.parse(m.data);
    st.lecturas.push(l);
    if (st.lecturas.length > MAX_LOCAL) st.lecturas.splice(0, st.lecturas.length - MAX_LOCAL);
    actualizarSeries();
    renderLectura(l, true);
    agregarFila(l);
  });
  es.addEventListener('evento', (m) => agregarEvento(JSON.parse(m.data)));
  es.addEventListener('estado', (m) => renderSistema(JSON.parse(m.data)));
  es.addEventListener('reset', () => {
    st.lecturas = st.lecturas.slice(-1);
    st.eventos = [];
    actualizarSeries();
    renderEventos();
    renderTabla();
  });
  es.onerror = () => {
    $('#pill-conexion').dataset.estado = 'conectando';
    $('#txt-conexion').textContent = 'Reconectando con el servidor…';
  };
}

// ---------- Acceso del encargado ----------
const leerClave = () => { try { return sessionStorage.getItem('sati-clave') || ''; } catch { return ''; } };
const guardarClave = (c) => { try { if (c) sessionStorage.setItem('sati-clave', c); else sessionStorage.removeItem('sati-clave'); } catch { /* sin almacenamiento */ } };
let conectado = false;

async function verificarClave(clave) {
  const r = await fetch('api/operador/verificar', { method: 'POST', headers: { 'X-Admin-Key': clave } });
  if (r.status === 429) throw new Error('Demasiados intentos. Esperá unos minutos y volvé a probar.');
  return r.ok;
}

function mostrarLogin(mensaje = '') {
  $('#login').hidden = false;
  $('#login-error').textContent = mensaje;
  $('#login-clave').value = '';
  $('#login-clave').focus();
}

function entrar() {
  $('#login').hidden = true;
  if (!conectado) { conectado = true; conectar(); }
}

$('#login-form').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const clave = $('#login-clave').value.trim();
  if (!clave) return;
  $('#login-error').textContent = '';
  try {
    if (await verificarClave(clave)) { guardarClave(clave); entrar(); }
    else mostrarLogin('Clave incorrecta.');
  } catch (e) {
    mostrarLogin(e.message || 'No se pudo conectar con el servidor.');
  }
});

$('#btn-salir').addEventListener('click', () => {
  guardarClave('');
  location.reload();
});

(async () => {
  const clave = leerClave();
  try {
    if (clave && (await verificarClave(clave))) return entrar();
  } catch { /* se pide de nuevo */ }
  mostrarLogin();
})();

// ---------- Ventana de tiempo ----------
$('#ventana').addEventListener('click', (ev) => {
  const b = ev.target.closest('button');
  if (!b) return;
  st.ventana = Number(b.dataset.ventana);
  $$('#ventana button').forEach((x) => x.setAttribute('aria-selected', x === b ? 'true' : 'false'));
  actualizarSeries();
});

// ---------- Acciones del encargado ----------
async function api(ruta, cuerpo) {
  const r = await fetch(ruta, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Admin-Key': leerClave() },
    body: JSON.stringify(cuerpo || {}),
  });
  if (r.status === 401 || r.status === 429) {
    guardarClave('');
    mostrarLogin(r.status === 429 ? 'Demasiados intentos. Esperá unos minutos.' : 'La sesión venció. Ingresá la clave de nuevo.');
    throw new Error(String(r.status));
  }
  return r.json();
}

async function exportarCsv() {
  const r = await fetch('api/export.csv', { headers: { 'X-Admin-Key': leerClave() } });
  if (!r.ok) { mostrarLogin('Ingresá la clave de nuevo.'); return; }
  const url = URL.createObjectURL(await r.blob());
  const a = document.createElement('a');
  a.href = url;
  a.download = `sati_lecturas_${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

document.addEventListener('click', async (ev) => {
  const b = ev.target.closest('[data-accion], [data-sim], [data-escenario]');
  if (!b) return;
  try {
    if (b.dataset.accion === 'exportar') await exportarCsv();
    else if (b.dataset.accion === 'rearme') await api('api/rearme');
    else if (b.dataset.accion === 'limpiar') {
      if (confirm('¿Borrar el historial de lecturas y el registro de alertas?')) await api('api/historial/limpiar');
    } else if (b.dataset.sim) await api('api/simulador', { accion: b.dataset.sim });
    else if (b.dataset.escenario) await api('api/simulador', { accion: 'iniciar', escenario: b.dataset.escenario });
  } catch { /* informado por toast */ }
});

// Formulario manual con vista previa del IR
const form = $('#form-manual');
function previaManual() {
  const f = new FormData(form);
  const t = Number(f.get('temp'));
  const h = Number(f.get('hum'));
  const g = Number(f.get('gasMv'));
  const llama = f.get('llama') === 'on';
  $('#o-temp').textContent = `${fmt(t)} °C`;
  $('#o-hum').textContent = `${h} %`;
  $('#o-gas').textContent = `${g} mV`;
  const pg = Math.min(100, Math.max(0, ((g - 250) / (1800 - 250)) * 100));
  const pt = Math.min(100, Math.max(0, ((t - 20) / 40) * 100));
  const ir = 0.7 * pg + 0.3 * pt;
  const n = ir >= 75 || t > 40 || pg > 85 || llama ? 3 : ir >= 52 ? 2 : ir >= 30 ? 1 : 0;
  $('#manual-ir').textContent = fmt(ir);
  $('#manual-nivel').textContent = `${n} · ${NOMBRES[n]}`;
}
form.addEventListener('input', previaManual);
form.addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const f = new FormData(form);
  try {
    await api('api/simulador', {
      accion: 'iniciar', escenario: 'manual',
      manual: { temp: Number(f.get('temp')), hum: Number(f.get('hum')), gasMv: Number(f.get('gasMv')), llama: f.get('llama') === 'on' },
    });
  } catch { /* informado */ }
});
previaManual();

// ---------- Tema y sonido ----------
$('#btn-tema').addEventListener('click', () => {
  const nuevo = document.documentElement.dataset.theme === 'light' ? 'dark' : 'light';
  document.documentElement.dataset.theme = nuevo;
  try { localStorage.setItem('sati-tema', nuevo); } catch { /* sin almacenamiento */ }
  tema = leerTema();
  for (const g of Object.values(graficos)) g.tema = tema;
  construirGauge();
  dibujarSparks();
});

$('#btn-sonido').addEventListener('click', async (ev) => {
  const b = ev.currentTarget;
  const on = b.getAttribute('aria-pressed') !== 'true';
  b.setAttribute('aria-pressed', on ? 'true' : 'false');
  b.title = on ? 'Silenciar alarma sonora' : 'Activar sonido de alarma';
  await sirena.habilitar(on);
});

window.addEventListener('resize', () => dibujarSparks());
