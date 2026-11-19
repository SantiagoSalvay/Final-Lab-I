// Página pública: estado del sendero en lenguaje simple, sin datos técnicos ni controles.

import { GraficoLinea, leerTema } from './graficos.js';
import { Escena } from './escena.js';
import { Sirena } from './sonido.js';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const entero = (v) => (v == null || Number.isNaN(v) ? '—' : Math.round(v).toLocaleString('es-AR'));

const ESTADOS = [
  {
    etiqueta: 'Riesgo bajo', titulo: 'Sendero habilitado',
    mensaje: 'Las condiciones son normales. Podés disfrutar del recorrido.',
    recs: ['Respetá la señalización y los senderos marcados.', 'No hagas fuego en ningún lugar del parque.'],
    icono: '<path d="M20 6 9 17l-5-5"/>',
  },
  {
    etiqueta: 'Riesgo moderado', titulo: 'Precaución',
    mensaje: 'El riesgo de incendio está aumentando.',
    recs: ['No hagas fuego ni fumes en el sendero.', 'No arrojes colillas, vidrios ni residuos.', 'Prestá atención a los avisos del personal.'],
    icono: '<path d="M12 8v5M12 16h.01"/><circle cx="12" cy="12" r="9"/>',
  },
  {
    etiqueta: 'Riesgo alto', titulo: 'Alerta de incendio',
    mensaje: 'Hay condiciones peligrosas para que se produzca un incendio.',
    recs: ['Se recomienda no ingresar al sendero.', 'Si ya estás adentro, dirigite con calma hacia la salida.', 'Seguí las indicaciones del personal.'],
    icono: '<path d="M12 3 2 20h20L12 3z"/><path d="M12 10v4M12 17h.01"/>',
  },
  {
    etiqueta: 'Peligro', titulo: 'Sendero cerrado',
    mensaje: 'Se detectó un posible incendio. Las vallas están cerradas.',
    recs: ['No ingreses ni cruces las vallas.', 'Alejate de la zona en dirección contraria al humo.', 'Si ves fuego, llamá al 100.'],
    icono: '<path d="M12 2c1 4 6 6 6 12a6 6 0 0 1-12 0c0-3 2-5 3-7 1 2 2 3 3 3 0-3 0-5 0-8z"/>',
  },
];
const SIN_DATOS = {
  etiqueta: 'Sin conexión', titulo: 'Sin información actualizada',
  mensaje: 'No estamos recibiendo datos del sensor en este momento.',
  recs: ['Ante cualquier duda, consultá al personal del parque.', 'Si ves humo o fuego, llamá al 100.'],
  icono: '<path d="M2 8.5a15 15 0 0 1 20 0M5.5 12a10 10 0 0 1 13 0M9 15.5a5 5 0 0 1 6 0M12 19h.01M3 3l18 18"/>',
};
const NIVEL_RIESGO = ['Bajo', 'Moderado', 'Alto', 'Muy alto'];

const st = { lecturas: [], eventos: [], sistema: null, offset: 0, ultimoLatido: 0, recibio: false, nivelPrevio: null };
let tema = leerTema();
const escena = new Escena($('#escena'), { publico: true });
const sirena = new Sirena();

// ---------- Descripciones simples ----------
const nivelDeIr = (ir) => (ir >= 75 ? 3 : ir >= 52 ? 2 : ir >= 30 ? 1 : 0);
function describir(l) {
  const t = l.temp;
  const h = l.hum;
  const g = l.p_gas;
  return {
    temp: {
      valor: t == null ? '—' : `${entero(t)} °C`,
      desc: t == null ? 'Sin dato' : t < 10 ? 'Frío' : t < 25 ? 'Agradable' : t < 32 ? 'Caluroso' : t <= 40 ? 'Muy caluroso' : 'Calor extremo',
      est: t == null ? '' : t > 40 ? 'critical' : t >= 32 ? 'warning' : 'ok',
    },
    hum: {
      valor: h == null ? '—' : `${entero(h)} %`,
      desc: h == null ? 'Sin dato' : h < 25 ? 'Muy seco: favorece incendios' : h < 40 ? 'Seco' : h <= 70 ? 'Normal' : 'Húmedo',
      est: h == null ? '' : h < 25 ? 'serious' : h < 40 ? 'warning' : 'ok',
    },
    humo: l.calentando
      ? { valor: 'Midiendo…', desc: 'El sensor se está iniciando', est: '' }
      : {
          valor: g < 15 ? 'Aire limpio' : g < 40 ? 'Humo leve' : g < 70 ? 'Humo moderado' : 'Humo intenso',
          desc: g < 15 ? 'Sin humo detectado' : g < 40 ? 'Se percibe algo de humo' : g < 70 ? 'Hay humo en la zona' : 'Mucho humo en la zona',
          est: g < 15 ? 'ok' : g < 40 ? 'warning' : g < 70 ? 'serious' : 'critical',
        },
    fuego: {
      valor: l.llama ? '¡Detectado!' : 'No detectado',
      desc: l.llama ? 'Hay fuego cerca del sensor' : 'Sin llamas cerca del sensor',
      est: l.llama ? 'critical' : 'ok',
    },
  };
}

// ---------- Estado principal ----------
function pintarEstado(e, nivel) {
  const card = $('#estado-pub');
  card.dataset.nivel = nivel;
  $('#estado-etiqueta').textContent = e.etiqueta;
  $('#estado-titulo').textContent = e.titulo;
  $('#estado-mensaje').textContent = e.mensaje;
  $('#estado-icono').innerHTML = e.icono;
  $('#estado-recs').replaceChildren(...e.recs.map((r) => { const li = document.createElement('li'); li.textContent = r; return li; }));
}

function hace(ts) {
  const s = Math.max(0, Math.round((Date.now() + st.offset - ts) / 1000));
  return s < 5 ? 'recién' : s < 60 ? `hace ${s} segundos` : s < 3600 ? `hace ${Math.floor(s / 60)} min` : `hace ${Math.floor(s / 3600)} h`;
}

function renderLectura(l) {
  const n = l.nivel;
  escena.actualizar(l);
  if (st.sistema?.conectado !== false) pintarEstado(ESTADOS[n], n);
  const nota = $('#estado-nota');
  nota.hidden = !(l.calentando && n === 0);
  nota.textContent = 'El sensor de humo se está iniciando; en un minuto la información estará completa.';

  const d = describir(l);
  for (const k of Object.keys(d)) {
    const c = $(`[data-c="${k}"]`);
    c.dataset.estado = d[k].est;
    $(`[data-v="${k}"]`).textContent = d[k].valor;
    $(`[data-d="${k}"]`).textContent = d[k].desc;
  }

  // Medidor
  const ir = Math.max(0, Math.min(100, l.ir));
  $('#medidor-marca').style.left = `${ir}%`;
  const nr = nivelDeIr(ir);
  $('#medidor-texto').textContent = `${NIVEL_RIESGO[nr]} (${entero(ir)} de 100)`;
  $$('.medidor__barra span').forEach((s) => s.classList.toggle('activo', Number(s.dataset.n) === nr));

  // Chips
  const chip = (k, txt, on) => { const c = $(`[data-chip="${k}"]`); c.querySelector('b').textContent = txt; c.dataset.on = on; };
  chip('vallas', l.vallas ? 'cerrado' : 'abierto', l.vallas ? 'true' : 'false');
  chip('sirena', n === 3 ? 'sonando' : n === 2 ? 'intermitente' : 'apagada', n === 3 ? 'true' : n === 2 ? 'warn' : 'false');

  $('#banner-alarma').hidden = n !== 3;
  sirena.fijarModo(n === 3 ? 'continua' : n === 2 ? 'intermitente' : 'off');
  document.title = n === 3 ? '⚠ Sendero cerrado · SATI' : n === 2 ? '▲ Alerta · SATI' : 'Estado del Sendero · SATI';
  if (st.nivelPrevio !== n) favicon(n);
  st.nivelPrevio = n;
  $('#estado-act').textContent = `Actualizado ${hace(l.ts)}`;
}

function favicon(n) {
  const c = ['#0ca30c', '#fab219', '#ec835a', '#d03b3b'][n];
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><path d="M32 3 7 11v19c0 15 10.5 26 25 31 14.5-5 25-16 25-31V11z" fill="#0d2344" stroke="${c}" stroke-width="4"/><path d="M32 14c2 7 11 11 11 22a11 11 0 0 1-22 0c0-6 4-9 5-14 1.5 4 3 5.5 4.5 5.5 0-5 .5-9 1.5-13.5z" fill="${c}"/></svg>`;
  $('#favicon').href = `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

function renderSistema(s) {
  st.sistema = s;
  st.ultimoLatido = Date.now();
  if (s.servidor_ts) st.offset = s.servidor_ts - Date.now();
  const pill = $('#pill-conexion');
  pill.dataset.estado = s.conectado ? 'vivo' : 'sin-senal';
  $('#txt-conexion').textContent = s.conectado ? 'En vivo' : 'Sin conexión';
  $('#banner-demo').hidden = !(s.conectado && s.origen === 'simulador');
  escena.sinSenal(!s.conectado);
  $('#escena-sinsenal').hidden = s.conectado;
  if (!s.conectado) {
    pintarEstado(SIN_DATOS, 'x');
    sirena.fijarModo('off');
    $('#banner-alarma').hidden = true;
    const u = st.lecturas[st.lecturas.length - 1];
    $('#estado-act').textContent = u ? `Último dato recibido ${hace(u.ts)}` : 'Todavía no se recibieron datos';
  } else if (st.lecturas.length) {
    const u = st.lecturas[st.lecturas.length - 1];
    pintarEstado(ESTADOS[u.nivel], u.nivel);
    $('#estado-act').textContent = `Actualizado ${hace(u.ts)}`;
  }
}

setInterval(() => {
  if (st.recibio && Date.now() - st.ultimoLatido > 4000) {
    $('#pill-conexion').dataset.estado = 'conectando';
    $('#txt-conexion').textContent = 'Reconectando…';
  }
  $$('#eventos time').forEach((t) => { t.textContent = hace(Number(t.dataset.ts)); });
}, 1000);

// ---------- Gráfico de riesgo ----------
const grafico = new GraficoLinea($('#g-riesgo'), {
  min: 0, max: 100, decimales: 0, unidad: 'de 100', bandas: [[0, 30], [30, 52], [52, 75], [75, 100]],
  colorSerie: (p) => (p ? tema.n[nivelDeIr(p.v)] : tema.serie),
  extraTooltip: (p) => ` <span>· ${NIVEL_RIESGO[nivelDeIr(p.v)]}</span>`,
});
const VENTANA = 15 * 60 * 1000;
function actualizarGrafico() {
  grafico.setDatos(st.lecturas.map((l) => ({ t: l.ts, v: l.ir, seq: l.seq })), VENTANA);
}
(function bucle(t0 = 0) {
  requestAnimationFrame((t) => {
    if (!document.hidden && t - t0 > 50) { grafico.dibujar(Date.now() + st.offset - 1000); t0 = t; }
    bucle(t0);
  });
})();

// ---------- Avisos en lenguaje simple ----------
function traducir(e) {
  const n = e.nivel ?? Number((/nivel (\d)/.exec(e.titulo) || [])[1]);
  switch (e.tipo) {
    case 'nivel':
      return [
        { sev: 'ok', titulo: 'Condiciones normales', texto: 'El riesgo volvió a ser bajo.' },
        { sev: 'warning', titulo: 'Precaución', texto: 'El riesgo de incendio aumentó a moderado.' },
        { sev: 'serious', titulo: 'Alerta de incendio', texto: 'Riesgo alto: se recomienda no ingresar.' },
        { sev: 'critical', titulo: 'Peligro: sendero cerrado', texto: 'Se detectó un posible incendio.' },
      ][n] || null;
    case 'llama':
      return e.severidad === 'critical'
        ? { sev: 'critical', titulo: 'Fuego detectado', texto: 'El sensor detectó llamas en la zona.' }
        : { sev: 'ok', titulo: 'Fuego controlado', texto: 'El sensor ya no detecta llamas.' };
    case 'vallas':
      return e.severidad === 'ok'
        ? { sev: 'ok', titulo: 'Sendero habilitado', texto: 'Las vallas se abrieron.' }
        : { sev: 'serious', titulo: 'Vallas cerradas', texto: 'El paso por el sendero está cortado.' };
    case 'rociador':
      return e.severidad === 'ok' ? null : { sev: 'serious', titulo: 'Rociadores activados', texto: 'Se activó el riego de la zona.' };
    case 'rearme':
      return e.titulo === 'Sistema rearmado' ? { sev: 'ok', titulo: 'Sistema normalizado', texto: 'El personal a cargo restableció el sistema.' } : null;
    case 'conexion':
      return { sev: 'warning', titulo: 'Sin conexión con el sensor', texto: 'La información puede no estar actualizada.' };
    default:
      return null;
  }
}

const ICONOS = {
  ok: '<path d="M20 6 9 17l-5-5"/>',
  warning: '<path d="M12 8v5M12 16h.01"/><circle cx="12" cy="12" r="9"/>',
  serious: '<path d="M12 3 2 20h20L12 3z"/><path d="M12 10v4M12 17h.01"/>',
  critical: '<path d="M12 2c1 4 6 6 6 12a6 6 0 0 1-12 0c0-3 2-5 3-7 1 2 2 3 3 3 0-3 0-5 0-8z"/>',
};

function nodoAviso(e, a) {
  const li = document.createElement('li');
  li.className = 'evento';
  li.dataset.sev = a.sev;
  const ic = document.createElement('span');
  ic.className = 'evento__ic';
  ic.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true">${ICONOS[a.sev]}</svg>`;
  const tx = document.createElement('div');
  tx.className = 'evento__txt';
  const t1 = document.createElement('strong');
  t1.textContent = a.titulo;
  const t2 = document.createElement('span');
  t2.textContent = a.texto;
  tx.append(t1, t2);
  const tm = document.createElement('time');
  tm.dataset.ts = e.ts;
  tm.textContent = hace(e.ts);
  li.append(ic, tx, tm);
  return li;
}

function renderAvisos() {
  const items = st.eventos.map((e) => [e, traducir(e)]).filter(([, a]) => a).slice(-15).reverse();
  $('#eventos').replaceChildren(...items.map(([e, a]) => nodoAviso(e, a)));
  $('#eventos-vacio').hidden = items.length > 0;
}

function toast(a) {
  const d = document.createElement('div');
  d.className = 'toast';
  d.dataset.sev = a.sev;
  d.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true">${ICONOS[a.sev]}</svg>`;
  const t = document.createElement('div');
  const s = document.createElement('strong');
  s.textContent = a.titulo;
  const p = document.createElement('span');
  p.textContent = a.texto;
  t.append(s, p);
  d.append(t);
  $('#toasts').append(d);
  setTimeout(() => { d.classList.add('saliendo'); setTimeout(() => d.remove(), 400); }, 7000);
}

// ---------- Conexión en vivo ----------
const es = new EventSource('api/stream');
es.addEventListener('inicial', (m) => {
  const d = JSON.parse(m.data);
  st.lecturas = d.historial;
  st.eventos = d.eventos;
  st.recibio = true;
  actualizarGrafico();
  renderAvisos();
  const u = st.lecturas[st.lecturas.length - 1];
  if (u) renderLectura(u);
  renderSistema(d.estado);
});
es.addEventListener('lectura', (m) => {
  const l = JSON.parse(m.data);
  st.lecturas.push(l);
  if (st.lecturas.length > 1200) st.lecturas.shift();
  actualizarGrafico();
  renderLectura(l);
});
es.addEventListener('evento', (m) => {
  const e = JSON.parse(m.data);
  st.eventos.push(e);
  const a = traducir(e);
  if (a) {
    renderAvisos();
    if (a.sev !== 'ok') toast(a);
  }
});
es.addEventListener('estado', (m) => renderSistema(JSON.parse(m.data)));
es.addEventListener('reset', () => { st.eventos = []; renderAvisos(); });
es.onerror = () => {
  $('#pill-conexion').dataset.estado = 'conectando';
  $('#txt-conexion').textContent = 'Reconectando…';
};

// ---------- Tema y sonido ----------
$('#btn-tema').addEventListener('click', () => {
  const nuevo = document.documentElement.dataset.theme === 'light' ? 'dark' : 'light';
  document.documentElement.dataset.theme = nuevo;
  try { localStorage.setItem('sati-tema-publico', nuevo); } catch { /* sin almacenamiento */ }
  tema = leerTema();
  grafico.tema = tema;
});
$('#btn-sonido').addEventListener('click', async (ev) => {
  const b = ev.currentTarget;
  const on = b.getAttribute('aria-pressed') !== 'true';
  b.setAttribute('aria-pressed', on ? 'true' : 'false');
  b.title = on ? 'Silenciar aviso sonoro' : 'Activar aviso sonoro';
  await sirena.habilitar(on);
});
