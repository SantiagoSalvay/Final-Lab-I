# SATI · Sistema de Alerta Temprana de Incendios

Proyecto final de Laboratorio I. Un nodo **ESP32** instalado en un sendero mide temperatura, humedad, gas/humo y llama; calcula un índice de riesgo, maneja alarmas, vallas y un rociador, y **sube sus datos a una página web** que los muestra en vivo.

```
ESP32 (DHT22 · MQ-2 · KY-026)  ──WiFi / HTTP POST JSON──▶  Servidor SATI (Node.js)  ──SSE──▶  Panel web
        └── USB (línea DATA) ──▶ monitor_pc.py   o   herramientas/puente_serial.py (respaldo)
```

## Qué incluye

| Carpeta | Contenido |
|---|---|
| `server/` | Servidor Node.js **sin dependencias**: recibe lecturas, guarda historial, detecta eventos y transmite en vivo |
| `public/` | **Página pública** (`/`, para visitantes, en lenguaje simple) y **panel del encargado** (`/operador`, técnico y con clave) |
| `firmware/nodo_transmisor/` | Firmware completo del nodo (OLED, rearme, bomba por ráfagas, histéresis, WiFi + JSON) |
| `herramientas/` | `simular_nodo.js` (hace de ESP32 desde la PC) y `puente_serial.py` (USB → web) |
| `docs/firmware.md` | Explicación de cada subrutina del firmware, para el informe |
| `test/` | Pruebas de la lógica de niveles |

## Cómo correrlo en la PC

Requiere [Node.js](https://nodejs.org) 18 o superior.

```bash
npm start
```

Hay dos páginas:

| Página | Para quién | Qué tiene |
|---|---|---|
| <http://localhost:3000> | Visitantes del parque | Estado del sendero en lenguaje simple, vista animada, condiciones del ambiente, avisos, recomendaciones y teléfonos de emergencia. **No tiene datos técnicos ni controles.** |
| <http://localhost:3000/operador> | Encargado del sendero | Panel técnico completo (IR, mV, gráficos, historial, CSV), **rearme de la alarma** y simulador. Pide clave. |

### Claves (archivos que NO se suben a GitHub)

| Archivo | Qué tiene | Cómo crearlo |
|---|---|---|
| `.env` | `ADMIN_KEY` (clave del encargado) y `DEVICE_TOKEN` (token del nodo) | Copiar `.env.ejemplo` como `.env` y completar |
| `firmware/nodo_transmisor/secretos.h` | Red WiFi, clave, `SERVER_URL` y `DEVICE_TOKEN` del ESP32 | Copiar `secretos.ejemplo.h` como `secretos.h` y completar |

Los dos están en `.gitignore`. El `DEVICE_TOKEN` tiene que ser **igual** en los dos archivos. Si se clona el repo en otra PC (por ejemplo, la que programa el ESP32), hay que crear estos archivos a mano y pasar las claves por un medio privado.

Sin `ADMIN_KEY`, el servidor inventa una clave al arrancar y la muestra en la consola (cambia en cada reinicio). Después de 8 intentos fallidos, esa IP queda bloqueada 10 minutos.

Sin hardware: entrar a `/operador` → **Centro de pruebas** → **Iniciar** o un escenario (Normal, Precaución, Alerta, Incendio). Mientras el simulador está activo, la página pública muestra el aviso "Modo demostración".

## Conectar el ESP32

### Opción A — servidor en la notebook (recomendada para la demo)

1. Conectar la notebook y el ESP32 al **hotspot del celular**.
2. Averiguar la IP de la notebook (`ipconfig` → "Dirección IPv4", por ejemplo `192.168.43.100`).
3. En `secretos.h`: `SERVER_URL = "http://192.168.43.100:3000/api/lecturas"`.
4. `npm start`. La primera vez Windows pregunta por el firewall: **permitir Node.js en redes privadas** (si el hotspot quedó como red pública, permitir también ahí).
5. El panel se ve en `http://localhost:3000` desde la notebook, o en `http://192.168.43.100:3000` desde cualquier celular conectado al hotspot.

### Opción B — servidor en internet (Render)

1. Subir el repositorio a GitHub.
2. En [render.com](https://render.com): **New + → Blueprint** → elegir el repo (usa `render.yaml`).
3. Cargar `DEVICE_TOKEN` y `ADMIN_KEY` en las variables de entorno de Render, con los mismos valores del `.env` (el `.env` no se sube, Render no lo ve).
4. En `secretos.h`: `SERVER_URL = "https://<nombre>.onrender.com/api/lecturas"` y el mismo `DEVICE_TOKEN`.

El plan gratuito de Render "duerme" el servicio tras 15 min sin uso: abrir la página unos minutos antes de presentar. El historial se pierde al reiniciarse (no tiene disco persistente). Cualquier otro hosting con Node.js (Railway, Fly.io, una VM) sirve igual: `npm start` y la variable `PORT`.

### Respaldo por USB

Si el WiFi falla durante la demo, conectar el nodo por USB a la notebook y correr:

```bash
pip install pyserial
python herramientas/puente_serial.py COM6 http://localhost:3000/api/lecturas
```

El puente ocupa el puerto COM6, así que no puede usarse al mismo tiempo que `monitor_pc.py`. Por esta vía el rearme remoto no llega al nodo (el botón físico sí funciona).

## Variables de entorno del servidor

| Variable | Por defecto | Uso |
|---|---|---|
| `PORT` | `3000` | Puerto HTTP |
| `DEVICE_TOKEN` | vacío | Si se define, el nodo tiene que mandarlo en el header `X-Device-Token` |
| `ADMIN_KEY` | aleatoria (se muestra en consola) | Clave del encargado para `/operador`: rearme, simulador, exportar y limpiar |
| `TIMEOUT_NODO_MS` | `6000` | Tiempo sin datos para mostrar "Sin señal" |
| `MAX_HISTORIAL` | `3600` | Lecturas guardadas (1 h a 1 lectura/s) |
| `DATA_DIR` | `./data` | Dónde se guarda el historial (`off` para no guardar) |
| `SIMULADOR` | — | `1` arranca con el simulador encendido |

## API

| Método | Ruta | Descripción |
|---|---|---|
| `POST` | `/api/lecturas` | El nodo publica una lectura (JSON). Responde `{"ok":true,"rearme":false}`; `rearme:true` pide al nodo que se rearme |
| `GET` | `/api/stream` | Flujo en vivo (Server-Sent Events): `inicial`, `lectura`, `evento`, `estado` |
| `GET` | `/api/estado` | Última lectura y estado de conexión |
| `GET` | `/api/historial?limite=N` | Últimas N lecturas |
| `GET` | `/api/eventos` | Registro de alertas |
| `GET` | `/api/export.csv` | Historial completo en CSV 🔒 |
| `POST` | `/api/simulador` | `{"accion":"iniciar"\|"detener"\|"reiniciar","escenario":"normal"\|"precaucion"\|"alerta"\|"incendio"\|"manual","manual":{...}}` 🔒 |
| `POST` | `/api/rearme` | Rearme remoto (al simulador o al nodo real en su próximo envío) 🔒 |
| `POST` | `/api/historial/limpiar` | Borra historial y avisos 🔒 |

🔒 = requiere el header `X-Admin-Key` con la clave del encargado.

Ejemplo para probar la ingesta a mano:

```bash
curl -X POST http://localhost:3000/api/lecturas -H "Content-Type: application/json" -d "{\"seq\":1,\"temp\":24.5,\"hum\":48,\"gas_mv\":640,\"p_gas\":5.8,\"p_temp\":11.3,\"ir\":7.5,\"nivel\":0}"
```

## Lógica de niveles

`IR = 0,70 · pGas + 0,30 · pTemp`, con `pGas = (gasMv − 250) / (1800 − 250) × 100` y `pTemp = (T − 20) / (60 − 20) × 100`, ambos entre 0 y 100.

| Nivel | Condición | Maqueta |
|---|---|---|
| 0 Normal | IR < 30 | LED verde |
| 1 Precaución | IR ≥ 30 | LED amarillo |
| 2 Alerta | IR ≥ 52 | LED rojo fijo, buzzer intermitente |
| 3 Alarma | IR ≥ 75, T > 40 °C, pGas > 85 % o llama | LED rojo parpadeando, buzzer continuo, vallas a 90°, bomba 3 s / 5 s (hasta 6 ráfagas) |

- **Histéresis:** para bajar de nivel, el IR tiene que quedar 3 puntos por debajo del umbral.
- **Enclavamiento:** el nivel 3 se mantiene hasta que se presiona el rearme (botón GPIO23 o desde la web); el rearme se rechaza mientras siga la condición de alarma.
- **Precalentamiento:** los primeros 60 s el nivel queda en 0, salvo llama.

La misma lógica está en el firmware y en `server/logica.js` (que usa el simulador); `npm test` la verifica.

## Guion sugerido para la demo

1. Panel abierto en el proyector, nodo encendido: se ve "Nodo ESP32 · WiFi" y el MQ-2 precalentando.
2. Acercar alcohol o gas de encendedor al MQ-2 → sube a Precaución / Alerta: el cielo de la escena se pone brumoso, aparece humo y suena la sirena intermitente.
3. Acercar una llama al KY-026 → Nivel 3: banner rojo, vallas que bajan, rociador tirando agua, fuego en la escena.
4. Retirar la llama: el nivel queda **enclavado**. Mostrar que el rearme se rechaza si todavía hay condiciones de alarma, y que se acepta una vez normalizado (botón físico o "Rearme remoto").
5. Mostrar gráficos, registro de alertas y exportar el CSV.

Si algo del hardware falla, el **Centro de pruebas** reproduce los mismos escenarios con la misma lógica.
