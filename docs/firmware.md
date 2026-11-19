# Firmware `nodo_transmisor.ino` — explicación para el informe

El código lleva un solo comentario corto por subrutina; las explicaciones van acá.

## Qué se sumó respecto del firmware anterior

| Pedido | Cómo quedó |
|---|---|
| OLED SSD1306 por I2C | `actualizarOled()`, I2C en SDA 21 / SCL 22, dirección 0x3C, refresco cada 500 ms |
| Botón de rearme | `leerBoton()` con antirrebote de 50 ms, GPIO23 con `INPUT_PULLUP` (apretado = LOW) |
| Bomba por ráfagas en nivel 3 | `actualizarBomba()`: relé 2 s encendido / 4 s apagado mientras dure el nivel 3 |
| Histéresis y rearme de nivel | `nivelPorIR()` y `evaluarNivel()` |
| Envío por WiFi en JSON con reconexión | `tareaRed()` + `enviarHttp()` en el núcleo 0 |
| Línea `DATA` por USB | `enviarSerie()`, mismo formato que antes |
| Correcciones | `GAS_OVERRIDE_P = 85` y `LLAMA_UMBRAL_MV = 1800` |

> Importante: este archivo se escribió a partir de la especificación, sin tener la copia de Jefe a la vista.
> Antes de reemplazarla, compararla con su `nodo_transmisor.ino` (sobre todo pines, `PIN_R = 27` / `PIN_B = 25`
> y el formato de la línea `DATA`).

## Antes de cargarlo

1. Librerías: *DHT sensor library* + *Adafruit Unified Sensor*, *ESP32Servo*, *Adafruit SSD1306* + *Adafruit GFX*.
2. Editar las 4 constantes de red al principio:
   - `WIFI_SSID` / `WIFI_PASS`: el hotspot del celular.
   - `SERVER_URL`: `http://IP-DE-LA-PC:3000/api/lecturas` si el servidor corre en la notebook, o `https://<app>.onrender.com/api/lecturas` si está desplegado.
   - `DEVICE_TOKEN`: igual al configurado en el servidor (vacío si no se usa).
3. Placa *NodeMCU-32S*, puerto COM6, 115200 baudios.

## Subrutinas

**`leerMv(pin)`** — Hace 16 lecturas con `analogReadMilliVolts` (que ya usa la calibración de fábrica del ADC) y devuelve el promedio. El ADC está con atenuación de 11 dB para poder medir hasta ~3,1 V.

**`limitar100(v)`** — Recorta un porcentaje al rango 0–100.

**`medir()`** — Lee el DHT22 cada 2 s (el sensor no admite lecturas más rápidas; si falla se conserva el último valor válido), lee el MQ-2 y el sensor de llama, y calcula:
- `pGas = (gasMv − 525) / (2500 − 525) × 100`
- `pTemp = (T − 20) / (60 − 20) × 100`
- `IR = 0,70 · pGas + 0,30 · pTemp`
- hay llama si el KY-026 da menos de 1800 mV (≈3150 mV sin llama, ≈370 mV con llama cerca).

**`nivelPorIR(ir, previo)`** — Elige el nivel por umbrales (30 / 52 / 75). Para **subir** alcanza con pasar el umbral; para **bajar** el IR tiene que quedar 5 puntos por debajo (histéresis). Así el nivel no "tiembla" cuando el IR ronda un umbral. Ejemplo: en nivel 2 (umbral 52) se baja recién con IR < 47.

**`evaluarNivel()`** — Máquina de estados del nivel:
1. Condición de alarma: IR ≥ 75, T > 40 °C, pGas > 85 % o llama. Durante el precalentamiento del MQ-2 (primeros 60 s) solo cuenta la llama.
2. Si hay alarma → nivel 3 y queda **enclavado**.
3. Si no está enclavado → nivel por IR con histéresis (máximo 2), o 0 durante el precalentamiento.
4. Con el nivel 3 enclavado, el sistema sigue en alarma aunque las condiciones bajen, hasta que alguien presione el **botón de rearme** (o el rearme remoto desde la web). El rearme se acepta solo si ya no hay condición de alarma y el IR está por debajo de 70; si no, se rechaza y el OLED lo muestra.
5. Al entrar a nivel 3 se guarda `tNivel3`, que marca el inicio del ciclo de la bomba.

**`enviarSerie()`** — Imprime `DATA,seq,tempC,hum,gasMv,pGas,pTemp,ir,nivel,precalent,llamaMv,llama,vallas` (sin cambios, para `monitor_pc.py`).

**`prepararJson()`** — Arma el JSON y lo copia a un buffer compartido protegido con un *spinlock* (`portENTER_CRITICAL`), porque lo lee otra tarea en el otro núcleo. Si el DHT nunca respondió, `temp` y `hum` van como `null`.

**`enviarHttp(cuerpo)`** — `HTTP POST` al servidor con `Content-Type: application/json` y el header `X-Device-Token`. Funciona con `http://` y con `https://` (en ese caso usa `WiFiClientSecure` sin validar certificado, suficiente para la demo). Reutiliza la conexión (keep-alive) para no negociar TLS en cada envío. Si la respuesta trae `"rearme":true`, avisa al loop para que haga el rearme remoto.

**`tareaRed()`** — Tarea de FreeRTOS fijada al núcleo 0 (el mismo del WiFi). Conecta al WiFi, y si se cae reintenta cada 8 s; cuando hay una lectura nueva la manda. Como corre aparte, aunque el servidor tarde o el WiFi se corte, el `loop` (sensores, alarmas, vallas, bomba) **nunca se bloquea**. Si se acumulan lecturas mientras un envío tarda, se manda siempre la más reciente.

**`leerBoton()`** — Antirrebote por tiempo: el cambio de estado se acepta si se mantiene 50 ms. En el flanco de bajada (apretado) pide el rearme.

**`actualizarLed()`** — Nivel 0 verde, 1 amarillo (rojo + verde), 2 rojo fijo, 3 rojo parpadeando cada 250 ms.

**`actualizarBuzzer()`** — Nivel 2: 200 ms encendido cada 1 s. Nivel 3: continuo.

**`actualizarBomba()`** — En nivel 3 activa el relé 2 s y lo apaga 4 s, en ciclo, usando `millis()` (sin `delay`). Fuera del nivel 3 el relé queda apagado.

**`moverVallas()`** — Lleva los dos servos hacia 90° (cerradas, en nivel 3) o 0° (abiertas) de a 2° cada 20 ms, sin bloquear. Tarda ~0,9 s en cerrar.

**`actualizarOled()`** — Cada 500 ms: estado del WiFi y del último envío, nivel en grande (en nivel 3 el recuadro parpadea invertido), IR, temperatura, humedad, gas, y una línea de estado (precalentamiento con cuenta regresiva, llama, vallas cerradas, avisos de rearme o número de secuencia y señal WiFi).

**`setup()`** — Configura pines, ADC, DHT, OLED (si no responde se sigue sin él), servos en 0° y lanza la tarea de red.

**`loop()`** — Atiende el botón y el rearme remoto, mide y evalúa una vez por segundo (usando `tMedicion += 1000` para que el período no se corra) y actualiza las salidas en cada vuelta.

## JSON que manda el nodo

```json
{
  "seq": 123, "temp": 24.5, "hum": 48, "gas_mv": 640, "p_gas": 5.8, "p_temp": 11.3, "ir": 7.5,
  "nivel": 0, "calentando": false, "llama": false, "vallas": false, "rociador": false,
  "bomba": false, "llama_mv": 3150, "enclavado": false, "uptime_s": 125, "rssi": -58
}
```

Respecto del formato propuesto se agregaron `bomba` (estado del relé en ese segundo), `llama_mv`, `enclavado`, `uptime_s` y `rssi`. `rociador` vale `true` mientras dura el nivel 3 (ciclo de ráfagas activo).
