# Firmware `nodo_transmisor.ino` — explicación para el informe

El código lleva un solo comentario corto por subrutina; las explicaciones van acá.

## Qué se le sumó a la versión de Jefe

La versión de Jefe ya tenía OLED, botón de rearme, bomba por ráfagas, histéresis, enclavamiento, WiFi con reconexión y la línea `DATA`. Para que funcione con el panel web se cambió solo esto:

| Cambio | Por qué |
|---|---|
| `SERVER_URL` apunta a `/api/lecturas` (antes `/api/datos`) | Es la ruta del servidor (igual el servidor acepta las dos) |
| `ENVIO_MS` de 2000 a 1000 y solo se manda si hay dato nuevo (`ultimoSeqEnviado`) | El panel muestra una lectura por segundo, sin repetidas |
| JSON con `bomba`, `llama_mv`, `enclavado`, `uptime_s` y `rssi`; `rociador` ahora indica que el ciclo de ráfagas está activo | La escena anima el agua con `bomba`, y el panel muestra el enclavamiento, el sensor de llama y la señal WiFi |
| `DEVICE_TOKEN` (header `X-Device-Token`) | Para que solo el nodo pueda publicar si el servidor está en internet |
| Red, URL y token en `secretos.h` (`#include "secretos.h"`) | Las claves no se suben a GitHub; el repo trae `secretos.ejemplo.h` como plantilla |
| `setConnectTimeout(3000)` | Si el servidor no responde, el envío no queda colgado |
| Rearme remoto (`rearmeRemoto`) | Si el panel pide rearmar, el servidor responde `"rearme":true`; la tarea de red levanta la bandera y el `loop` llama a `rearmar()`, con las mismas reglas que el botón |
| Pila de la tarea de red de 8192 a 12288 | Margen para HTTPS si se usa Render |

Todo lo demás (pines, umbrales, `HIST_IR = 3`, bomba 3 s / 5 s con 6 ráfagas, `GAS_OVERRIDE_P = 85`, `LLAMA_UMBRAL_MV = 1800`) quedó como lo tenía Jefe.

## Antes de cargarlo

1. Librerías: *DHT sensor library* + *Adafruit Unified Sensor*, *ESP32Servo*, *Adafruit SSD1306* + *Adafruit GFX*.
2. Placa *NodeMCU-32S* (core esp32 3.3.12), puerto COM6.
3. Copiar `secretos.ejemplo.h` como `secretos.h` (no se sube a GitHub) y completar `WIFI_SSID` / `WIFI_PASS` con el hotspot del celular (tiene que ser de 2,4 GHz).
4. En el mismo `secretos.h`, `SERVER_URL`: `http://IP-DE-LA-NOTEBOOK:3000/api/lecturas`, o `https://<app>.onrender.com/api/lecturas` si está en Render.

## Subrutinas

**`clamp100(v)`** — Recorta un porcentaje al rango 0–100.

**`leerMv(pin)`** — Promedia 16 lecturas de `analogReadMilliVolts` (ADC con atenuación de 11 dB, hasta ~3,1 V). Usa la calibración de fábrica del ADC del ESP32.

**`actualizarDht()`** — El DHT22 no admite lecturas más rápidas que cada 2 s, así que se lee como máximo cada 2 s y, si falla, se conserva el último valor válido.

**`setLed(r, g, b)`** — Maneja el LED RGB. Contempla el ánodo común invirtiendo la lógica, y tiene en cuenta que el rojo y el azul están cruzados en el cableado (`PIN_R = 27`, `PIN_B = 25`).

**`setRele(encendido)`** — Enciende o apaga la bomba respetando si el relé se activa en alto o en bajo, y guarda el estado en `releEncendido`.

**`copiarDatos()`** — Los datos se comparten entre el `loop` (núcleo 1) y la tarea de red (núcleo 0). La copia se hace dentro de una sección crítica (`portENTER_CRITICAL`) para no leer un dato a medio escribir.

**`nivelDesdeIr(ir, previo)`** — Nivel 0 a 2 por los umbrales 30 y 52. Para bajar, el IR tiene que caer 3 puntos (`HIST_IR`) por debajo del umbral del nivel en el que está. Por ejemplo, en nivel 2 se baja recién con IR < 49. Así el nivel no oscila cuando el IR ronda un umbral.

**`actualizarAvisos()`** — Nivel 0: LED verde. Nivel 1: amarillo (rojo + verde). Nivel 2: rojo fijo con buzzer intermitente cada 500 ms. Nivel 3: rojo parpadeando cada 200 ms y buzzer continuo. Usa `millis()`, sin `delay`.

**`actualizarVallas()`** — Lleva los dos servos hacia el ángulo objetivo (0° abiertas, 90° cerradas) de a 2° cada 20 ms. Tarda unos 0,9 s en cerrar y no bloquea.

**`actualizarBomba()`** — Con la alarma enclavada, prende el relé 3 s y lo apaga 5 s, hasta 6 ráfagas. Al enclavarse, `tBomba` se adelanta para que la primera ráfaga arranque enseguida. Sin alarma, el relé queda apagado.

**`rearmar()`** — Libera el enclavamiento solo si ya no hay condición de alarma; si sigue, lo rechaza y lo avisa por el puerto serie. Al rearmar se reinician las ráfagas y se apaga la bomba; las vallas se abren solas en el siguiente ciclo.

**`leerBoton()`** — Botón en GPIO23 con `INPUT_PULLUP` (apretado = LOW) y antirrebote de 40 ms. Al apretarlo llama a `rearmar()`.

**`mostrarOled()`** — Cada 500 ms muestra el nombre del nivel en grande, temperatura, humedad, gas, IR, llama, vallas, bomba, precalentamiento y el estado del WiFi con el último código HTTP (200 = el servidor recibió el dato).

**`evaluar()`** — Se ejecuta una vez por segundo:
1. Lee los sensores y calcula `pGas = (gasMv − 525) / (2500 − 525) × 100`, `pTemp = (T − 20) / (60 − 20) × 100` e `IR = 0,70 · pGas + 0,30 · pTemp`.
2. Condición de alarma: llama (KY-026 < 1800 mV) en cualquier momento; además, pasado el precalentamiento de 60 s del MQ-2, IR ≥ 75, T > 40 °C o pGas > 85 %.
3. Si aparece la condición, se enclava la alarma (nivel 3) y arranca la bomba.
4. El nivel mostrado es 3 si está enclavada, o el de `nivelDesdeIr` si no (0 durante el precalentamiento).
5. Guarda los datos para la tarea de red y manda por USB `DATA,seq,tempC,hum,gasMv,pGas,pTemp,ir,nivel,precalent,llamaMv,llama,vallas` para `monitor_pc.py`.

Con `MODO_CALIBRACION = true` solo imprime los mV del MQ-2 y del sensor de llama, para calibrar.

**`numero(v, decimales)`** / **`jbool(v)`** — Pasan números y booleanos a texto JSON. Si el DHT nunca respondió, la temperatura y la humedad van como `null`.

**`armarJson(d)`** — Arma el JSON que recibe el servidor:

```json
{
  "seq": 123, "temp": 24.5, "hum": 48, "gas_mv": 640, "p_gas": 5.8, "p_temp": 11.3, "ir": 7.5,
  "nivel": 0, "calentando": false, "llama": false, "vallas": false, "rociador": false,
  "bomba": false, "llama_mv": 3150, "enclavado": false, "uptime_s": 125, "rssi": -58
}
```

**`enviarJson(json)`** — Hace un `HTTP POST` con `Content-Type: application/json`. Con una URL `https://` usa `WiFiClientSecure` sin validar el certificado (suficiente para la demo). Si la respuesta trae `"rearme":true`, levanta `rearmeRemoto`.

**`tareaRed()`** — Tarea de FreeRTOS en el núcleo 0. Si el WiFi se cae, reintenta cada 10 s; si está conectado, manda el último dato nuevo cada segundo. Como corre aparte, aunque la red falle o el servidor tarde, el `loop` (alarmas, vallas, bomba) sigue funcionando.

**`setup()`** — Inicializa el puerto serie, los sensores, las salidas, los servos (en 0°), el OLED y el WiFi, y lanza la tarea de red.

**`loop()`** — En cada vuelta atiende el botón, el rearme remoto, la bomba, los avisos, las vallas y el OLED; una vez por segundo llama a `evaluar()`.
