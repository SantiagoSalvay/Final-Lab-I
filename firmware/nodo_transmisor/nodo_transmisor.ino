// Nodo único de detección temprana de incendios: sensores, riesgo, avisos, vallas, bomba, OLED y WiFi.
#include <DHT.h>
#include <ESP32Servo.h>
#include <WiFi.h>
#include <HTTPClient.h>
#include <WiFiClientSecure.h>

#define USAR_OLED 1  // 0 si no hay OLED o faltan las librerias Adafruit SSD1306 y GFX
#define USAR_WIFI 1  // 0 para trabajar solo por USB

#if USAR_OLED
#include <Wire.h>
#include <Adafruit_GFX.h>
#include <Adafruit_SSD1306.h>
Adafruit_SSD1306 oled(128, 64, &Wire, -1);
#endif

const char* WIFI_SSID    = "Test_Lab-I";
const char* WIFI_PASS    = "proyectolab1";
const char* SERVER_URL   = "http://10.29.205.192:3000/api/lecturas";
const char* DEVICE_TOKEN = "";  // igual al DEVICE_TOKEN del servidor; vacío si no se usa
const unsigned long ENVIO_MS = 1000;

const int PIN_DHT    = 4;
const int PIN_MQ2    = 34;
const int PIN_LLAMA  = 35;
const int PIN_R      = 27;  // rojo y azul estan cruzados en el cableado del modulo
const int PIN_G      = 26;
const int PIN_B      = 25;
const int PIN_BUZZER = 33;
const int PIN_RELE   = 32;
const int PIN_SERVO1 = 18;
const int PIN_SERVO2 = 19;
const int PIN_BOTON  = 23;
const int PIN_SDA    = 21;
const int PIN_SCL    = 22;

const bool LED_ANODO_COMUN  = false;
const bool RELE_ACTIVO_ALTO = true;

const float GAS_MIN_MV  = 525.0;
const float GAS_MAX_MV  = 2500.0;
const float TEMP_MIN_C  = 20.0;
const float TEMP_MAX_C  = 60.0;
const float PESO_GAS    = 0.70;
const float PESO_TEMP   = 0.30;
const float IR_N1       = 30.0;
const float IR_N2       = 52.0;
const float IR_N3       = 75.0;
const float HIST_IR     = 3.0;
const float T_OVERRIDE_C   = 40.0;
const float GAS_OVERRIDE_P = 85.0;
const float LLAMA_UMBRAL_MV = 1800.0;

const int ANGULO_ABIERTA = 0;
const int ANGULO_CERRADA = 90;

const unsigned long BOMBA_ON_MS  = 3000;
const unsigned long BOMBA_OFF_MS = 5000;
const int MAX_RAFAGAS = 6;

const unsigned long PERIODO_MS   = 1000;
const unsigned long PRECALENT_MS = 60000;
const bool MODO_CALIBRACION = false;

struct Datos {
  uint32_t seq;
  float t, h, gasMv, pGas, pTemp, ir, llamaMv;
  uint8_t nivel;
  bool calentando, llama, vallas, bomba, rociador, enclavado;
};

DHT dht(PIN_DHT, DHT22);
Servo servo1;
Servo servo2;
Datos datos;
portMUX_TYPE mux = portMUX_INITIALIZER_UNLOCKED;

uint32_t secuencia = 0;
unsigned long tUltimo = 0, tDht = 0, tServo = 0, tBomba = 0, tBoton = 0, tOled = 0;
float ultimaT = NAN, ultimaH = NAN;
uint8_t nivelBase = 0, nivelActual = 0;
bool alarmaLatched = false, condicionActiva = false;
bool releEncendido = false, botonAnterior = false;
int rafagas = 0;
int anguloActual = ANGULO_ABIERTA, anguloObjetivo = ANGULO_ABIERTA;
volatile int ultimoHttp = 0;
volatile bool rearmeRemoto = false;

// Limita un valor entre 0 y 100.
float clamp100(float v) { return v < 0 ? 0 : (v > 100 ? 100 : v); }

// Promedia 16 lecturas de un pin analógico en mV.
float leerMv(int pin) {
  uint32_t acc = 0;
  for (int i = 0; i < 16; i++) { acc += analogReadMilliVolts(pin); delay(2); }
  return acc / 16.0;
}

// Lee el DHT22 como máximo cada 2 s y conserva el último dato válido.
void actualizarDht() {
  if (millis() - tDht < 2000) return;
  tDht = millis();
  float h = dht.readHumidity();
  float t = dht.readTemperature();
  if (!isnan(h) && !isnan(t)) { ultimaH = h; ultimaT = t; }
}

// Enciende o apaga cada color del LED RGB (invierte si es ánodo común).
void setLed(bool r, bool g, bool b) {
  digitalWrite(PIN_R, LED_ANODO_COMUN ? !r : r);
  digitalWrite(PIN_G, LED_ANODO_COMUN ? !g : g);
  digitalWrite(PIN_B, LED_ANODO_COMUN ? !b : b);
}

// Enciende o apaga el relé de la bomba según su lógica de activación.
void setRele(bool encendido) {
  releEncendido = encendido;
  digitalWrite(PIN_RELE, (encendido == RELE_ACTIVO_ALTO) ? HIGH : LOW);
}

// Copia los datos compartidos con la tarea de red de forma segura.
Datos copiarDatos() {
  portENTER_CRITICAL(&mux);
  Datos d = datos;
  portEXIT_CRITICAL(&mux);
  return d;
}

// Devuelve el nivel 0 a 2 con histéresis para que no oscile en los umbrales.
uint8_t nivelDesdeIr(float ir, uint8_t previo) {
  if (ir >= IR_N2 - (previo >= 2 ? HIST_IR : 0)) return 2;
  if (ir >= IR_N1 - (previo >= 1 ? HIST_IR : 0)) return 1;
  return 0;
}

// Pone LED y buzzer según el nivel, sin bloquear el programa.
void actualizarAvisos() {
  bool rapido = (millis() / 200) % 2;
  bool lento  = (millis() / 500) % 2;
  switch (nivelActual) {
    case 0: setLed(false, true, false);  digitalWrite(PIN_BUZZER, LOW); break;
    case 1: setLed(true, true, false);   digitalWrite(PIN_BUZZER, LOW); break;
    case 2: setLed(true, false, false);  digitalWrite(PIN_BUZZER, lento); break;
    default: setLed(rapido, false, false); digitalWrite(PIN_BUZZER, HIGH); break;
  }
}

// Mueve las vallas 2 grados cada 20 ms hacia el objetivo, sin bloquear.
void actualizarVallas() {
  if (millis() - tServo < 20) return;
  tServo = millis();
  if (anguloActual == anguloObjetivo) return;
  anguloActual += (anguloObjetivo > anguloActual) ? 2 : -2;
  servo1.write(anguloActual);
  servo2.write(anguloActual);
}

// Maneja la bomba por ráfagas cortas mientras la alarma está activa.
void actualizarBomba() {
  if (!alarmaLatched || rafagas >= MAX_RAFAGAS) {
    if (releEncendido) setRele(false);
    return;
  }
  unsigned long ahora = millis();
  if (releEncendido) {
    if (ahora - tBomba >= BOMBA_ON_MS) { setRele(false); tBomba = ahora; rafagas++; }
  } else if (ahora - tBomba >= BOMBA_OFF_MS) {
    setRele(true);
    tBomba = ahora;
  }
}

// Rearma el sistema si la condición de alarma ya terminó.
void rearmar() {
  if (!alarmaLatched) return;
  if (condicionActiva) { Serial.println("REARME rechazado: la condicion de alarma sigue activa"); return; }
  alarmaLatched = false;
  rafagas = 0;
  setRele(false);
  Serial.println("REARME: alarma desactivada, vallas abiertas");
}

// Detecta el botón de rearme con antirrebote.
void leerBoton() {
  bool apretado = digitalRead(PIN_BOTON) == LOW;
  if (apretado != botonAnterior && millis() - tBoton > 40) {
    tBoton = millis();
    botonAnterior = apretado;
    if (apretado) rearmar();
  }
}

// Muestra el nivel y los valores principales en el OLED cada 500 ms.
void mostrarOled() {
#if USAR_OLED
  if (millis() - tOled < 500) return;
  tOled = millis();
  const char* nombres[] = {"NORMAL", "PRECAUCION", "ALERTA", "ALARMA"};
  Datos d = copiarDatos();
  oled.clearDisplay();
  oled.setTextColor(SSD1306_WHITE);
  oled.setTextSize(2);
  oled.setCursor(0, 0);
  oled.println(nombres[d.nivel]);
  oled.setTextSize(1);
  oled.printf("T:%.1fC  H:%.0f%%\n", d.t, d.h);
  oled.printf("Gas:%.0f%%  IR:%.0f\n", d.pGas, d.ir);
  oled.printf("Llama:%s  Vallas:%s\n", d.llama ? "SI" : "no", d.vallas ? "cerr" : "abier");
  oled.printf("Bomba:%s %s\n", releEncendido ? "ON" : "off", d.calentando ? "(calentando)" : "");
#if USAR_WIFI
  if (WiFi.status() == WL_CONNECTED) oled.printf("WiFi OK  HTTP:%d\n", ultimoHttp);
  else oled.println("WiFi: sin conexion");
#endif
  oled.display();
#endif
}

// Mide, calcula el índice y el nivel, y manda la línea DATA por USB.
void evaluar() {
  actualizarDht();
  float gasMv = leerMv(PIN_MQ2);
  float llamaMv = leerMv(PIN_LLAMA);

  if (MODO_CALIBRACION) {
    Serial.printf("MQ-2: %.0f mV   Llama: %.0f mV\n", gasMv, llamaMv);
    return;
  }

  float pGas  = clamp100((gasMv - GAS_MIN_MV) / (GAS_MAX_MV - GAS_MIN_MV) * 100.0);
  float pTemp = isnan(ultimaT) ? 0 : clamp100((ultimaT - TEMP_MIN_C) / (TEMP_MAX_C - TEMP_MIN_C) * 100.0);
  float ir    = PESO_GAS * pGas + PESO_TEMP * pTemp;

  bool calentando = millis() < PRECALENT_MS;
  bool llama = llamaMv < LLAMA_UMBRAL_MV;
  bool tempAlta = !isnan(ultimaT) && ultimaT > T_OVERRIDE_C;
  condicionActiva = llama || (!calentando && (ir >= IR_N3 || tempAlta || pGas > GAS_OVERRIDE_P));

  if (condicionActiva && !alarmaLatched) {
    alarmaLatched = true;
    rafagas = 0;
    tBomba = millis() - BOMBA_OFF_MS;
  }

  nivelBase = calentando ? 0 : nivelDesdeIr(ir, nivelBase);
  nivelActual = alarmaLatched ? 3 : nivelBase;
  anguloObjetivo = alarmaLatched ? ANGULO_CERRADA : ANGULO_ABIERTA;

  portENTER_CRITICAL(&mux);
  datos = {secuencia, ultimaT, ultimaH, gasMv, pGas, pTemp, ir, llamaMv, nivelActual,
           calentando, llama, anguloObjetivo == ANGULO_CERRADA, releEncendido,
           alarmaLatched && rafagas < MAX_RAFAGAS, alarmaLatched};
  portEXIT_CRITICAL(&mux);

  Serial.printf("DATA,%lu,%.2f,%.1f,%.0f,%.1f,%.1f,%.1f,%u,%u,%.0f,%u,%u\n",
                (unsigned long)secuencia++, ultimaT, ultimaH, gasMv,
                pGas, pTemp, ir, nivelActual, calentando ? 1 : 0,
                llamaMv, llama ? 1 : 0, anguloObjetivo == ANGULO_CERRADA ? 1 : 0);
}

#if USAR_WIFI
// Convierte un número a texto para el JSON, usando null si no es válido.
String numero(float v, int decimales) {
  return isnan(v) ? String("null") : String(v, decimales);
}

// Convierte un bool a texto JSON.
const char* jbool(bool v) { return v ? "true" : "false"; }

// Arma el JSON con el último dato medido.
String armarJson(const Datos& d) {
  String j = "{";
  j += "\"seq\":" + String(d.seq);
  j += ",\"temp\":" + numero(d.t, 1);
  j += ",\"hum\":" + numero(d.h, 0);
  j += ",\"gas_mv\":" + numero(d.gasMv, 0);
  j += ",\"p_gas\":" + numero(d.pGas, 1);
  j += ",\"p_temp\":" + numero(d.pTemp, 1);
  j += ",\"ir\":" + numero(d.ir, 1);
  j += ",\"nivel\":" + String(d.nivel);
  j += ",\"calentando\":" + String(jbool(d.calentando));
  j += ",\"llama\":" + String(jbool(d.llama));
  j += ",\"vallas\":" + String(jbool(d.vallas));
  j += ",\"rociador\":" + String(jbool(d.rociador));
  j += ",\"bomba\":" + String(jbool(d.bomba));
  j += ",\"llama_mv\":" + numero(d.llamaMv, 0);
  j += ",\"enclavado\":" + String(jbool(d.enclavado));
  j += ",\"uptime_s\":" + String(millis() / 1000);
  j += ",\"rssi\":" + String(WiFi.RSSI());
  j += "}";
  return j;
}

// Manda el JSON por HTTP POST (HTTP o HTTPS), avisa si la web pidió rearme y devuelve el código.
int enviarJson(const String& json) {
  HTTPClient http;
  WiFiClient plano;
  WiFiClientSecure seguro;
  if (String(SERVER_URL).startsWith("https")) {
    seguro.setInsecure();
    http.begin(seguro, SERVER_URL);
  } else {
    http.begin(plano, SERVER_URL);
  }
  http.setConnectTimeout(3000);
  http.setTimeout(2000);
  http.addHeader("Content-Type", "application/json");
  if (strlen(DEVICE_TOKEN) > 0) http.addHeader("X-Device-Token", DEVICE_TOKEN);
  int codigo = http.POST(json);
  if (codigo == 200 && http.getString().indexOf("\"rearme\":true") >= 0) rearmeRemoto = true;
  http.end();
  return codigo;
}

// Tarea en el otro núcleo: reconecta el WiFi y envía cada dato nuevo cada ENVIO_MS.
void tareaRed(void*) {
  unsigned long tEnvio = 0, tReintento = 0;
  uint32_t ultimoSeqEnviado = UINT32_MAX;
  for (;;) {
    if (WiFi.status() != WL_CONNECTED) {
      if (millis() - tReintento > 10000) {
        tReintento = millis();
        WiFi.disconnect();
        WiFi.begin(WIFI_SSID, WIFI_PASS);
      }
    } else if (millis() - tEnvio >= ENVIO_MS) {
      tEnvio = millis();
      Datos d = copiarDatos();
      if (secuencia > 0 && d.seq != ultimoSeqEnviado) {
        ultimoHttp = enviarJson(armarJson(d));
        ultimoSeqEnviado = d.seq;
      }
    }
    vTaskDelay(100 / portTICK_PERIOD_MS);
  }
}
#endif

// Inicia serie, sensores, salidas, servos, OLED y WiFi.
void setup() {
  Serial.begin(115200);
  delay(500);
  dht.begin();
  analogSetPinAttenuation(PIN_MQ2, ADC_11db);
  analogSetPinAttenuation(PIN_LLAMA, ADC_11db);
  pinMode(PIN_R, OUTPUT);
  pinMode(PIN_G, OUTPUT);
  pinMode(PIN_B, OUTPUT);
  pinMode(PIN_BUZZER, OUTPUT);
  pinMode(PIN_RELE, OUTPUT);
  pinMode(PIN_BOTON, INPUT_PULLUP);
  digitalWrite(PIN_BUZZER, LOW);
  setRele(false);
  servo1.setPeriodHertz(50);
  servo2.setPeriodHertz(50);
  servo1.attach(PIN_SERVO1, 500, 2400);
  servo2.attach(PIN_SERVO2, 500, 2400);
  servo1.write(ANGULO_ABIERTA);
  servo2.write(ANGULO_ABIERTA);
  datos = {0, NAN, NAN, 0, 0, 0, 0, 0, 0, true, false, false, false, false, false};
#if USAR_OLED
  Wire.begin(PIN_SDA, PIN_SCL);
  if (!oled.begin(SSD1306_SWITCHCAPVCC, 0x3C)) Serial.println("OLED no encontrado (0x3C)");
#endif
#if USAR_WIFI
  WiFi.mode(WIFI_STA);
  WiFi.setAutoReconnect(true);
  WiFi.begin(WIFI_SSID, WIFI_PASS);
  xTaskCreatePinnedToCore(tareaRed, "red", 12288, NULL, 1, NULL, 0);
#endif
}

// Atiende botón, rearme remoto, bomba, avisos, vallas y OLED, y mide una vez por segundo.
void loop() {
  leerBoton();
  if (rearmeRemoto) {
    rearmeRemoto = false;
    Serial.println("REARME pedido desde la web");
    rearmar();
  }
  actualizarBomba();
  actualizarAvisos();
  actualizarVallas();
  mostrarOled();

  if (millis() - tUltimo < PERIODO_MS) return;
  tUltimo = millis();
  evaluar();
}
