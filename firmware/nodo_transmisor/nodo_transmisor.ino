#include <WiFi.h>
#include <HTTPClient.h>
#include <WiFiClientSecure.h>
#include <Wire.h>
#include <Adafruit_GFX.h>
#include <Adafruit_SSD1306.h>
#include <DHT.h>
#include <ESP32Servo.h>

// ===================== Red =====================
const char* WIFI_SSID    = "Test_Lab-I";
const char* WIFI_PASS    = "proyectolab1";
const char* SERVER_URL   = "http://10.29.205.192:3000/api/lecturas";
const char* DEVICE_TOKEN = "";

// ===================== Pines =====================
const int PIN_DHT    = 4;
const int PIN_MQ2    = 34;
const int PIN_LLAMA  = 35;
const int PIN_R      = 27;
const int PIN_G      = 26;
const int PIN_B      = 25;
const int PIN_BUZZER = 33;
const int PIN_RELE   = 32;
const int PIN_SERVO1 = 18;
const int PIN_SERVO2 = 19;
const int PIN_BOTON  = 23;
const int PIN_SDA    = 21;
const int PIN_SCL    = 22;

// ===================== Calibración y umbrales =====================
const float GAS_MIN_MV      = 525.0;
const float GAS_MAX_MV      = 2500.0;
const float T_MIN           = 20.0;
const float T_MAX           = 60.0;
const float W_GAS           = 0.70;
const float W_TEMP          = 0.30;
const float UMBRAL_N1       = 30.0;
const float UMBRAL_N2       = 52.0;
const float UMBRAL_N3       = 75.0;
const float HISTERESIS      = 5.0;
const float T_OVERRIDE      = 40.0;
const float GAS_OVERRIDE_P  = 85.0;
const int   LLAMA_UMBRAL_MV = 1800;
const int   ADC_MUESTRAS    = 16;

// ===================== Tiempos =====================
const unsigned long PERIODO_MS        = 1000;
const unsigned long PRECALENT_MS      = 60000;
const unsigned long DHT_PERIODO_MS    = 2000;
const unsigned long BOMBA_ON_MS       = 2000;
const unsigned long BOMBA_OFF_MS      = 4000;
const unsigned long BUZZER_ON_MS      = 200;
const unsigned long BUZZER_CICLO_MS   = 1000;
const unsigned long LED_PARPADEO_MS   = 250;
const unsigned long SERVO_PASO_MS     = 20;
const int           SERVO_PASO_GRADOS = 2;
const int           SERVO_ABIERTA     = 0;
const int           SERVO_CERRADA     = 90;
const unsigned long OLED_PERIODO_MS   = 500;
const unsigned long REBOTE_MS         = 50;
const unsigned long WIFI_REINTENTO_MS = 8000;

// ===================== Objetos =====================
DHT dht(PIN_DHT, DHT22);
Adafruit_SSD1306 oled(128, 64, &Wire, -1);
Servo valla1;
Servo valla2;
WiFiClient clientePlano;
WiFiClientSecure clienteSeguro;
HTTPClient http;

// ===================== Estado de medición =====================
unsigned long seq = 0;
float tempC = NAN;
float hum = NAN;
int gasMv = 0;
int llamaMv = 0;
float pGas = 0;
float pTemp = 0;
float ir = 0;
int nivel = 0;
bool precalent = true;
bool llama = false;
bool enclavado = false;
bool vallasCerradas = false;
bool bombaOn = false;

unsigned long tArranque = 0;
unsigned long tMedicion = 0;
unsigned long tDht = 0;
unsigned long tNivel3 = 0;
unsigned long tServo = 0;
unsigned long tOled = 0;
int posVallas = SERVO_ABIERTA;

bool oledOk = false;
bool pedirRearme = false;
int estadoBoton = HIGH;
int lecturaBotonPrev = HIGH;
unsigned long tRebote = 0;
const char* mensaje = "";
unsigned long tMensaje = 0;

// ===================== Estado compartido con la tarea de red =====================
const size_t JSON_MAX = 400;
char jsonBuf[JSON_MAX];
volatile bool jsonNuevo = false;
volatile bool rearmeRemoto = false;
volatile bool wifiOk = false;
volatile int rssiActual = 0;
volatile int codigoHttp = 0;
volatile unsigned long enviosOk = 0;
portMUX_TYPE muxJson = portMUX_INITIALIZER_UNLOCKED;
bool esHttps = false;

// Lee un pin analógico en mV promediando varias muestras.
int leerMv(int pin) {
  uint32_t suma = 0;
  for (int i = 0; i < ADC_MUESTRAS; i++) suma += analogReadMilliVolts(pin);
  return suma / ADC_MUESTRAS;
}

// Limita un valor entre 0 y 100.
float limitar100(float v) {
  if (v < 0) return 0;
  if (v > 100) return 100;
  return v;
}

// Nivel 0..3 por IR, subiendo al instante y bajando con histéresis.
int nivelPorIR(float valor, int previo) {
  const float U[4] = {0, UMBRAL_N1, UMBRAL_N2, UMBRAL_N3};
  int sube = valor >= U[3] ? 3 : valor >= U[2] ? 2 : valor >= U[1] ? 1 : 0;
  if (sube >= previo) return sube;
  int n = previo;
  while (n > sube && valor < U[n] - HISTERESIS) n--;
  return n;
}

// Muestra un aviso temporal en el OLED.
void avisar(const char* txt) {
  mensaje = txt;
  tMensaje = millis();
}

// Aplica precalentamiento, disparos directos, enclavamiento del nivel 3 y rearme.
void evaluarNivel() {
  bool alarma = ir >= UMBRAL_N3 || (!isnan(tempC) && tempC > T_OVERRIDE) || pGas > GAS_OVERRIDE_P || llama;
  if (precalent) alarma = llama;
  int previo = nivel;

  if (alarma) {
    nivel = 3;
    enclavado = true;
  } else if (!enclavado) {
    nivel = precalent ? 0 : min(2, nivelPorIR(ir, nivel));
  }

  if (pedirRearme && enclavado) {
    if (!alarma && (precalent || ir < UMBRAL_N3 - HISTERESIS)) {
      enclavado = false;
      nivel = precalent ? 0 : min(2, nivelPorIR(ir, 0));
      avisar("REARME OK");
    } else {
      avisar("REARME RECHAZADO");
    }
  }
  pedirRearme = false;

  if (nivel == 3 && previo != 3) tNivel3 = millis();
  vallasCerradas = (nivel == 3);
}

// Toma las lecturas de los sensores y calcula el índice de riesgo.
void medir() {
  unsigned long ahora = millis();
  if (ahora - tDht >= DHT_PERIODO_MS || tDht == 0) {
    tDht = ahora;
    float t = dht.readTemperature();
    float h = dht.readHumidity();
    if (!isnan(t)) tempC = t;
    if (!isnan(h)) hum = h;
  }
  gasMv = leerMv(PIN_MQ2);
  llamaMv = leerMv(PIN_LLAMA);
  precalent = (ahora - tArranque) < PRECALENT_MS;
  pGas = limitar100((gasMv - GAS_MIN_MV) / (GAS_MAX_MV - GAS_MIN_MV) * 100.0);
  pTemp = isnan(tempC) ? 0 : limitar100((tempC - T_MIN) / (T_MAX - T_MIN) * 100.0);
  ir = W_GAS * pGas + W_TEMP * pTemp;
  llama = llamaMv < LLAMA_UMBRAL_MV;
}

// Envía la línea DATA por USB para monitor_pc.py.
void enviarSerie() {
  Serial.printf("DATA,%lu,%.1f,%.1f,%d,%.1f,%.1f,%.1f,%d,%d,%d,%d,%d\n",
                seq, tempC, hum, gasMv, pGas, pTemp, ir, nivel,
                precalent ? 1 : 0, llamaMv, llama ? 1 : 0, vallasCerradas ? 1 : 0);
}

// Arma el JSON de la lectura y lo deja listo para la tarea de red.
void prepararJson() {
  char t[12], h[12];
  if (isnan(tempC)) strcpy(t, "null"); else snprintf(t, sizeof t, "%.1f", tempC);
  if (isnan(hum)) strcpy(h, "null"); else snprintf(h, sizeof h, "%.0f", hum);
  char local[JSON_MAX];
  snprintf(local, sizeof local,
           "{\"seq\":%lu,\"temp\":%s,\"hum\":%s,\"gas_mv\":%d,\"p_gas\":%.1f,\"p_temp\":%.1f,\"ir\":%.1f,"
           "\"nivel\":%d,\"calentando\":%s,\"llama\":%s,\"vallas\":%s,\"rociador\":%s,\"bomba\":%s,"
           "\"llama_mv\":%d,\"enclavado\":%s,\"uptime_s\":%lu,\"rssi\":%d}",
           seq, t, h, gasMv, pGas, pTemp, ir, nivel,
           precalent ? "true" : "false", llama ? "true" : "false", vallasCerradas ? "true" : "false",
           nivel == 3 ? "true" : "false", bombaOn ? "true" : "false",
           llamaMv, enclavado ? "true" : "false", (millis() - tArranque) / 1000, (int)rssiActual);
  portENTER_CRITICAL(&muxJson);
  memcpy(jsonBuf, local, JSON_MAX);
  jsonNuevo = true;
  portEXIT_CRITICAL(&muxJson);
}

// Hace el POST con el JSON y revisa si el servidor pidió un rearme.
void enviarHttp(const char* cuerpo) {
  http.setReuse(true);
  bool ok = esHttps ? http.begin(clienteSeguro, SERVER_URL) : http.begin(clientePlano, SERVER_URL);
  if (!ok) {
    codigoHttp = -1;
    return;
  }
  http.setConnectTimeout(4000);
  http.setTimeout(4000);
  http.addHeader("Content-Type", "application/json");
  if (strlen(DEVICE_TOKEN) > 0) http.addHeader("X-Device-Token", DEVICE_TOKEN);
  int code = http.POST((uint8_t*)cuerpo, strlen(cuerpo));
  codigoHttp = code;
  if (code == 200) {
    enviosOk++;
    if (http.getString().indexOf("\"rearme\":true") >= 0) rearmeRemoto = true;
  }
  http.end();
}

// Tarea en el núcleo 0: mantiene el WiFi y envía las lecturas sin frenar el loop.
void tareaRed(void* arg) {
  WiFi.mode(WIFI_STA);
  WiFi.setAutoReconnect(true);
  WiFi.begin(WIFI_SSID, WIFI_PASS);
  clienteSeguro.setInsecure();
  unsigned long tReintento = millis();
  char cuerpo[JSON_MAX];
  for (;;) {
    if (WiFi.status() != WL_CONNECTED) {
      wifiOk = false;
      if (millis() - tReintento > WIFI_REINTENTO_MS) {
        tReintento = millis();
        WiFi.disconnect();
        WiFi.begin(WIFI_SSID, WIFI_PASS);
      }
      vTaskDelay(pdMS_TO_TICKS(250));
      continue;
    }
    wifiOk = true;
    rssiActual = WiFi.RSSI();
    bool hay = false;
    portENTER_CRITICAL(&muxJson);
    if (jsonNuevo) {
      memcpy(cuerpo, jsonBuf, JSON_MAX);
      jsonNuevo = false;
      hay = true;
    }
    portEXIT_CRITICAL(&muxJson);
    if (hay) enviarHttp(cuerpo);
    vTaskDelay(pdMS_TO_TICKS(20));
  }
}

// Lee el botón de rearme con antirrebote.
void leerBoton() {
  int lectura = digitalRead(PIN_BOTON);
  if (lectura != lecturaBotonPrev) tRebote = millis();
  if (millis() - tRebote > REBOTE_MS && lectura != estadoBoton) {
    estadoBoton = lectura;
    if (estadoBoton == LOW) {
      pedirRearme = true;
      avisar("REARME...");
    }
  }
  lecturaBotonPrev = lectura;
}

// Enciende el LED RGB según el nivel.
void actualizarLed() {
  bool r = false, g = false;
  bool parpadeo = (millis() / LED_PARPADEO_MS) % 2 == 0;
  switch (nivel) {
    case 0: g = true; break;
    case 1: r = true; g = true; break;
    case 2: r = true; break;
    case 3: r = parpadeo; break;
  }
  digitalWrite(PIN_R, r ? HIGH : LOW);
  digitalWrite(PIN_G, g ? HIGH : LOW);
  digitalWrite(PIN_B, LOW);
}

// Maneja el buzzer: intermitente en nivel 2 y continuo en nivel 3.
void actualizarBuzzer() {
  bool suena = false;
  if (nivel == 3) suena = true;
  else if (nivel == 2) suena = (millis() % BUZZER_CICLO_MS) < BUZZER_ON_MS;
  digitalWrite(PIN_BUZZER, suena ? HIGH : LOW);
}

// Activa la bomba por ráfagas cortas mientras el nivel sea 3.
void actualizarBomba() {
  bombaOn = (nivel == 3) && ((millis() - tNivel3) % (BOMBA_ON_MS + BOMBA_OFF_MS)) < BOMBA_ON_MS;
  digitalWrite(PIN_RELE, bombaOn ? HIGH : LOW);
}

// Mueve las vallas de a 2° cada 20 ms hacia la posición objetivo.
void moverVallas() {
  if (millis() - tServo < SERVO_PASO_MS) return;
  tServo = millis();
  int objetivo = vallasCerradas ? SERVO_CERRADA : SERVO_ABIERTA;
  if (posVallas == objetivo) return;
  if (posVallas < objetivo) posVallas = min(objetivo, posVallas + SERVO_PASO_GRADOS);
  else posVallas = max(objetivo, posVallas - SERVO_PASO_GRADOS);
  valla1.write(posVallas);
  valla2.write(posVallas);
}

// Dibuja el estado del nodo en el OLED.
void actualizarOled() {
  if (!oledOk || millis() - tOled < OLED_PERIODO_MS) return;
  tOled = millis();
  static const char* NOMBRES[4] = {"NORMAL", "PRECAUCION", "ALERTA", "ALARMA"};
  oled.clearDisplay();
  oled.setTextColor(SSD1306_WHITE);
  oled.setTextSize(1);
  oled.setCursor(0, 0);
  oled.print("SATI N-01");
  oled.setCursor(74, 0);
  if (wifiOk) oled.printf("WiFi %s", codigoHttp == 200 ? "OK" : "--");
  else oled.print("SIN WiFi");
  oled.drawFastHLine(0, 10, 128, SSD1306_WHITE);

  bool invertir = nivel == 3 && (millis() / 500) % 2 == 0;
  if (invertir) oled.fillRect(0, 13, 128, 18, SSD1306_WHITE);
  oled.setTextColor(invertir ? SSD1306_BLACK : SSD1306_WHITE);
  oled.setTextSize(2);
  oled.setCursor(2, 15);
  oled.printf("N%d", nivel);
  oled.setTextSize(1);
  oled.setCursor(32, 19);
  oled.print(NOMBRES[nivel]);
  oled.setTextColor(SSD1306_WHITE);

  oled.setCursor(0, 35);
  oled.printf("IR %.1f  T %.1fC", ir, isnan(tempC) ? 0.0 : tempC);
  oled.setCursor(0, 45);
  oled.printf("HR %.0f%%  Gas %.0f%%", isnan(hum) ? 0.0 : hum, pGas);

  oled.setCursor(0, 56);
  if (millis() - tMensaje < 2000 && mensaje[0]) oled.print(mensaje);
  else if (precalent) {
    unsigned long pasado = millis() - tArranque;
    oled.printf("PRECALENT MQ2 %lus", pasado < PRECALENT_MS ? (PRECALENT_MS - pasado) / 1000 : 0UL);
  }
  else if (llama) oled.print("LLAMA DETECTADA");
  else if (enclavado && nivel == 3) oled.print(vallasCerradas ? "VALLAS CERRADAS" : "ENCLAVADO");
  else oled.printf("#%lu  %ddBm", seq, (int)rssiActual);
  oled.display();
}

// Configura pines, sensores, OLED, servos y lanza la tarea de red.
void setup() {
  Serial.begin(115200);
  pinMode(PIN_R, OUTPUT);
  pinMode(PIN_G, OUTPUT);
  pinMode(PIN_B, OUTPUT);
  pinMode(PIN_BUZZER, OUTPUT);
  pinMode(PIN_RELE, OUTPUT);
  pinMode(PIN_BOTON, INPUT_PULLUP);
  digitalWrite(PIN_RELE, LOW);
  digitalWrite(PIN_BUZZER, LOW);

  analogReadResolution(12);
  analogSetPinAttenuation(PIN_MQ2, ADC_11db);
  analogSetPinAttenuation(PIN_LLAMA, ADC_11db);
  dht.begin();

  Wire.begin(PIN_SDA, PIN_SCL);
  Wire.setClock(400000);
  oledOk = oled.begin(SSD1306_SWITCHCAPVCC, 0x3C);
  if (oledOk) {
    oled.clearDisplay();
    oled.setTextColor(SSD1306_WHITE);
    oled.setTextSize(2);
    oled.setCursor(30, 16);
    oled.print("SATI");
    oled.setTextSize(1);
    oled.setCursor(10, 40);
    oled.print("Iniciando nodo...");
    oled.display();
  }

  valla1.setPeriodHertz(50);
  valla2.setPeriodHertz(50);
  valla1.attach(PIN_SERVO1, 500, 2400);
  valla2.attach(PIN_SERVO2, 500, 2400);
  valla1.write(SERVO_ABIERTA);
  valla2.write(SERVO_ABIERTA);

  esHttps = strncmp(SERVER_URL, "https", 5) == 0;
  xTaskCreatePinnedToCore(tareaRed, "red", 12288, NULL, 1, NULL, 0);

  tArranque = millis();
  tMedicion = millis();
}

// Ciclo principal no bloqueante: mide una vez por segundo y atiende las salidas.
void loop() {
  leerBoton();
  if (rearmeRemoto) {
    rearmeRemoto = false;
    pedirRearme = true;
    avisar("REARME REMOTO");
  }
  if (millis() - tMedicion >= PERIODO_MS) {
    tMedicion += PERIODO_MS;
    seq++;
    medir();
    evaluarNivel();
    enviarSerie();
    prepararJson();
  }
  actualizarLed();
  actualizarBuzzer();
  actualizarBomba();
  moverVallas();
  actualizarOled();
}
