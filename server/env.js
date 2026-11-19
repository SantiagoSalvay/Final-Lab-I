'use strict';
// Carga las variables del archivo .env (si existe) sin pisar las que ya vienen del sistema o de Render.

const fs = require('fs');
const path = require('path');

const archivo = path.join(__dirname, '..', '.env');

try {
  const texto = fs.readFileSync(archivo, 'utf8');
  for (const linea of texto.split(/\r?\n/)) {
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(linea);
    if (!m || linea.trim().startsWith('#')) continue;
    let valor = m[2];
    if (/^(["']).*\1$/.test(valor)) valor = valor.slice(1, -1);
    if (process.env[m[1]] === undefined) process.env[m[1]] = valor;
  }
} catch {
  // Sin .env: se usan solo las variables de entorno (por ejemplo, en Render).
}
