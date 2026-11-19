'use strict';
// Servidor SATI: recibe lecturas del ESP32 por HTTP POST y las retransmite en vivo al panel web (SSE).

require('./env');
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Almacen } = require('./almacen');
const { NodoVirtual } = require('./simulador');
const { CFG, NIVELES } = require('./logica');

const PORT = Number(process.env.PORT) || 3000;
const DEVICE_TOKEN = process.env.DEVICE_TOKEN || '';
// Clave del encargado: siempre obligatoria. Si no se configura, se genera una al arrancar y se muestra en la consola.
const ADMIN_KEY_FIJA = !!process.env.ADMIN_KEY;
const ADMIN_KEY = process.env.ADMIN_KEY || crypto.randomBytes(4).toString('hex');
const TIMEOUT_NODO_MS = Number(process.env.TIMEOUT_NODO_MS) || 6000;
const DATA_DIR = process.env.DATA_DIR === 'off' ? null : process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const HIST_INICIAL = 900;

const almacen = new Almacen({ maxLecturas: Number(process.env.MAX_HISTORIAL) || 3600, dir: DATA_DIR });
const clientes = new Set();
let rearmeRemoto = 0; // timestamp del pedido de rearme pendiente para el nodo real
let enLinea = false;

// ---------- Tiempo real (Server-Sent Events) ----------
function enviar(res, evento, datos) {
  res.write(`event: ${evento}\ndata: ${JSON.stringify(datos)}\n\n`);
}
function difundir(evento, datos) {
  for (const c of clientes) enviar(c, evento, datos);
}

function estadoSistema() {
  const u = almacen.ultimo;
  const edad = u ? Date.now() - u.ts : null;
  return {
    conectado: edad != null && edad < TIMEOUT_NODO_MS,
    origen: u ? u.origen : null,
    edad_ms: edad,
    simulador: sim.info(),
    rearme_pendiente: rearmeRemoto > 0,
    clientes: clientes.size,
    servidor_ts: Date.now(),
  };
}

function registrarLectura(datos, origen) {
  const { lectura, eventos } = almacen.agregar(datos, origen);
  enLinea = true;
  difundir('lectura', lectura);
  for (const e of eventos) difundir('evento', e);
  return lectura;
}

function publicarEvento(...args) {
  const e = almacen.evento(...args);
  difundir('evento', e);
  return e;
}

// ---------- Simulador integrado ----------
const sim = new NodoVirtual((lectura, info) => {
  registrarLectura(lectura, 'simulador');
  if (info.rearmeRechazado) publicarEvento('rearme', 'warning', 'Rearme rechazado', 'Las condiciones de alarma siguen presentes', 'simulador');
});

// ---------- Utilidades HTTP ----------
const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json', '.webmanifest': 'application/manifest+json',
};

function json(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(obj));
}

function leerCuerpo(req, max = 16 * 1024) {
  return new Promise((ok, mal) => {
    let tam = 0;
    const partes = [];
    req.on('data', (c) => {
      tam += c.length;
      if (tam > max) { mal(new Error('cuerpo demasiado grande')); req.destroy(); return; }
      partes.push(c);
    });
    req.on('end', () => {
      const txt = Buffer.concat(partes).toString('utf8').trim();
      if (!txt) return ok({});
      try { ok(JSON.parse(txt)); } catch { mal(new Error('JSON inválido')); }
    });
    req.on('error', mal);
  });
}

function igualSeguro(a, b) {
  const ha = crypto.createHash('sha256').update(String(a || '')).digest();
  const hb = crypto.createHash('sha256').update(String(b || '')).digest();
  return crypto.timingSafeEqual(ha, hb);
}

// Límite de intentos fallidos de clave por IP (evita que se adivine probando).
const fallos = new Map();
const MAX_FALLOS = 8;
const VENTANA_FALLOS_MS = 10 * 60 * 1000;
const ipDe = (req) => String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
function bloqueado(req) {
  const f = fallos.get(ipDe(req));
  return f && f.n >= MAX_FALLOS && Date.now() - f.t < VENTANA_FALLOS_MS;
}
function registrarFallo(req) {
  const ip = ipDe(req);
  const f = fallos.get(ip);
  if (!f || Date.now() - f.t > VENTANA_FALLOS_MS) fallos.set(ip, { n: 1, t: Date.now() });
  else f.n += 1;
}

const esAdmin = (req) => igualSeguro(req.headers['x-admin-key'], ADMIN_KEY);
const esNodo = (req, url) => !DEVICE_TOKEN || igualSeguro(req.headers['x-device-token'] || url.searchParams.get('token'), DEVICE_TOKEN);

// Verifica la clave del encargado; responde 401/429 y devuelve false si no es válida.
function exigirEncargado(req, res) {
  if (bloqueado(req)) { json(res, 429, { ok: false, error: 'demasiados intentos, esperá unos minutos' }); return false; }
  if (esAdmin(req)) { fallos.delete(ipDe(req)); return true; }
  registrarFallo(req);
  json(res, 401, { ok: false, error: 'clave de encargado inválida' });
  return false;
}

function servirEstatico(req, res, url) {
  let rel = decodeURIComponent(url.pathname);
  if (rel === '/') rel = '/index.html';
  if (rel === '/operador/') { res.writeHead(301, { Location: '/operador' }); return res.end(); }
  if (rel === '/operador') rel = '/operador.html';
  const ruta = path.normalize(path.join(PUBLIC_DIR, rel));
  if (!ruta.startsWith(PUBLIC_DIR)) return json(res, 403, { error: 'prohibido' });
  fs.stat(ruta, (err, st) => {
    if (err || !st.isFile()) return json(res, 404, { error: 'no encontrado' });
    const etag = `"${st.size.toString(36)}-${Math.floor(st.mtimeMs).toString(36)}"`;
    if (req.headers['if-none-match'] === etag) { res.writeHead(304, { ETag: etag }); return res.end(); }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(ruta)] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
      ETag: etag,
    });
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(ruta).pipe(res);
  });
}

// ---------- Rutas ----------
async function manejar(req, res) {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const p = url.pathname;
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Device-Token, X-Admin-Key');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }

  try {
    // El nodo ESP32 (o el puente serie) publica una lectura.
    if ((p === '/api/lecturas' || p === '/api/datos') && req.method === 'POST') {
      if (!esNodo(req, url)) return json(res, 401, { ok: false, error: 'token inválido' });
      const cuerpo = await leerCuerpo(req);
      const lote = Array.isArray(cuerpo) ? cuerpo : [cuerpo];
      if (!lote.length || typeof lote[0] !== 'object') return json(res, 400, { ok: false, error: 'se esperaba un objeto JSON' });
      if (sim.activo) {
        sim.detener();
        publicarEvento('fuente', 'info', 'Simulador detenido', 'Llegaron datos del nodo real; el simulador se apagó solo', 'servidor');
      }
      const origen = url.searchParams.get('origen') === 'puente' ? 'puente-usb' : 'esp32';
      for (const d of lote) registrarLectura(d, origen);
      const rearme = rearmeRemoto > 0 && Date.now() - rearmeRemoto < 30000;
      if (rearme) rearmeRemoto = 0;
      return json(res, 200, { ok: true, rearme, servidor_ts: Date.now() });
    }

    // Abierto desde el navegador: confirma que el servidor está accesible.
    if (p === '/api/lecturas' || p === '/api/datos') {
      const u = almacen.ultimo;
      return json(res, 200, {
        ok: true,
        mensaje: 'Servidor SATI accesible. El nodo ESP32 tiene que enviar sus lecturas a esta URL con HTTP POST (JSON).',
        ultima_lectura: u ? { seq: u.seq, origen: u.origen, hace_s: Math.round((Date.now() - u.ts) / 1000) } : null,
      });
    }

    if (p === '/api/stream' && req.method === 'GET') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      });
      res.write('retry: 2000\n\n');
      enviar(res, 'inicial', {
        historial: almacen.historial(HIST_INICIAL),
        eventos: almacen.eventos.slice(-60),
        estado: estadoSistema(),
        config: { ...CFG, NIVELES },
      });
      clientes.add(res);
      req.on('close', () => clientes.delete(res));
      return;
    }

    if (p === '/api/estado') return json(res, 200, { ultimo: almacen.ultimo, estado: estadoSistema() });
    if (p === '/api/historial') return json(res, 200, almacen.historial(Number(url.searchParams.get('limite')) || 0));
    if (p === '/api/eventos') return json(res, 200, almacen.eventos);
    if (p === '/api/config') return json(res, 200, { ...CFG, NIVELES });
    if (p === '/healthz') return json(res, 200, { ok: true, uptime_s: Math.round(process.uptime()) });

    // ---- Solo el encargado (clave en el header X-Admin-Key) ----
    if (p.startsWith('/api/') && !exigirEncargado(req, res)) return;

    if (p === '/api/operador/verificar') return json(res, 200, { ok: true });

    if (p === '/api/export.csv') {
      res.writeHead(200, {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="sati_lecturas_${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.csv"`,
      });
      return res.end(almacen.csv());
    }

    if (p === '/api/simulador' && req.method === 'POST') {
      const b = await leerCuerpo(req);
      if (b.accion === 'detener') {
        if (sim.activo) {
          sim.detener();
          publicarEvento('fuente', 'info', 'Simulador detenido', 'Detenido por el encargado', 'encargado');
        }
      } else {
        const estabaActivo = sim.activo;
        if (b.escenario) sim.fijarEscenario(b.escenario, b.manual);
        if (b.accion === 'iniciar' || b.accion === 'reiniciar') {
          sim.iniciar({ precalentamiento: b.accion === 'reiniciar' });
          if (!estabaActivo || b.accion === 'reiniciar') {
            publicarEvento('fuente', 'info', b.accion === 'reiniciar' ? 'Simulador reiniciado' : 'Simulador iniciado',
              b.accion === 'reiniciar' ? 'Arranque con 60 s de precalentamiento del MQ-2' : 'Modo demostración sin hardware', 'encargado');
          }
        }
        if (b.escenario && b.escenario !== 'manual') {
          publicarEvento('escenario', 'info', `Escenario: ${b.escenario}`, sim.info().descripcion, 'encargado');
        }
      }
      difundir('estado', estadoSistema());
      return json(res, 200, { ok: true, simulador: sim.info() });
    }

    if (p === '/api/rearme' && req.method === 'POST') {
      if (sim.activo) sim.rearmar();
      else rearmeRemoto = Date.now();
      publicarEvento('rearme', 'info', 'Rearme solicitado', sim.activo ? 'Enviado al nodo simulado' : 'Se enviará al nodo en su próxima transmisión', 'encargado');
      difundir('estado', estadoSistema());
      return json(res, 200, { ok: true });
    }

    if (p === '/api/historial/limpiar' && req.method === 'POST') {
      almacen.eventos = [];
      almacen.lecturas = almacen.ultimo ? [almacen.ultimo] : [];
      almacen.sucio = true;
      difundir('reset', {});
      return json(res, 200, { ok: true });
    }

    if (p.startsWith('/api/')) return json(res, 404, { error: 'ruta inexistente' });
    if (req.method === 'GET' || req.method === 'HEAD') return servirEstatico(req, res, url);
    return json(res, 405, { error: 'método no permitido' });
  } catch (e) {
    return json(res, 400, { ok: false, error: e.message });
  }
}

const server = http.createServer(manejar);
server.keepAliveTimeout = 65000;

// Latido: estado de conexión cada segundo y aviso de pérdida de señal.
setInterval(() => {
  const est = estadoSistema();
  if (enLinea && !est.conectado) {
    enLinea = false;
    publicarEvento('conexion', 'warning', 'Sin señal del nodo', `No llegan datos hace más de ${Math.round(TIMEOUT_NODO_MS / 1000)} s`, est.origen);
  }
  if (rearmeRemoto && Date.now() - rearmeRemoto > 30000) {
    rearmeRemoto = 0;
    publicarEvento('rearme', 'warning', 'Rearme sin confirmar', 'El nodo no transmitió en 30 s', 'servidor');
  }
  difundir('estado', est);
}, 1000);

setInterval(() => almacen.guardar(), 15000);
function salir() {
  almacen.guardar();
  process.exit(0);
}
process.on('SIGINT', salir);
process.on('SIGTERM', salir);

if (process.env.SIMULADOR === '1') sim.iniciar();

server.listen(PORT, () => {
  console.log(`\n  SATI · Sistema de Alerta Temprana de Incendios`);
  console.log(`  Página pública:     http://localhost:${PORT}`);
  console.log(`  Panel del encargado: http://localhost:${PORT}/operador`);
  console.log(`  Ingesta:  POST http://<ip-de-esta-pc>:${PORT}/api/lecturas`);
  console.log(`  Token de nodo: ${DEVICE_TOKEN ? 'requerido' : 'no configurado (acepta cualquiera)'}`);
  if (ADMIN_KEY_FIJA) console.log('  Clave del encargado: la definida en la variable ADMIN_KEY\n');
  else console.log(`  Clave del encargado (temporal, cambia en cada arranque): ${ADMIN_KEY}\n  Para fijarla, definí la variable de entorno ADMIN_KEY.\n`);
});
