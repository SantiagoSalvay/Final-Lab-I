"""Puente USB -> web: lee las lineas DATA del nodo por el puerto serie y las sube al servidor SATI.

Sirve de respaldo si el WiFi del ESP32 falla en la demo: se conecta el nodo por USB a la PC
y esta reenvia cada lectura al panel. Ocupa el puerto COM, asi que no se puede usar a la vez
que monitor_pc.py.

Uso:
    pip install pyserial
    python herramientas/puente_serial.py COM6 http://localhost:3000/api/lecturas
"""

import json
import sys
import time
import urllib.request

import serial  # pyserial

CAMPOS = ["seq", "tempC", "hum", "gasMv", "pGas", "pTemp", "ir", "nivel",
          "precalent", "llamaMv", "llama", "vallas"]


def a_numero(txt):
    """Convierte un campo de texto a numero; 'nan' queda como None."""
    try:
        v = float(txt)
        return None if v != v else v
    except ValueError:
        return None


def linea_a_json(linea):
    """Transforma 'DATA,...' en el JSON que espera el servidor."""
    partes = linea.strip().split(",")
    if len(partes) != len(CAMPOS) + 1 or partes[0] != "DATA":
        return None
    d = {k: a_numero(v) for k, v in zip(CAMPOS, partes[1:])}
    nivel = int(d["nivel"] or 0)
    return {
        "seq": int(d["seq"] or 0),
        "temp": d["tempC"],
        "hum": d["hum"],
        "gas_mv": int(d["gasMv"] or 0),
        "p_gas": d["pGas"],
        "p_temp": d["pTemp"],
        "ir": d["ir"],
        "nivel": nivel,
        "calentando": d["precalent"] == 1,
        "llama": d["llama"] == 1,
        "llama_mv": int(d["llamaMv"] or 0),
        "vallas": d["vallas"] == 1,
        "rociador": nivel == 3,
        "enclavado": nivel == 3,
    }


def enviar(url, datos):
    """Hace el POST JSON y devuelve la respuesta del servidor."""
    req = urllib.request.Request(
        url + ("&" if "?" in url else "?") + "origen=puente",
        data=json.dumps(datos).encode(),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=4) as r:
        return json.loads(r.read().decode() or "{}")


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)
    puerto = sys.argv[1]
    url = sys.argv[2] if len(sys.argv) > 2 else "http://localhost:3000/api/lecturas"
    print(f"Puente {puerto} -> {url}  (Ctrl+C para salir)")
    while True:
        try:
            with serial.Serial(puerto, 115200, timeout=2) as ser:
                while True:
                    linea = ser.readline().decode(errors="ignore")
                    datos = linea_a_json(linea) if linea.startswith("DATA") else None
                    if not datos:
                        continue
                    try:
                        enviar(url, datos)
                        print(f"\r#{datos['seq']} nivel {datos['nivel']} IR {datos['ir']}   ", end="")
                    except Exception as e:  # noqa: BLE001
                        print(f"\nNo se pudo enviar: {e}")
        except serial.SerialException as e:
            print(f"\nPuerto no disponible ({e}). Reintentando en 3 s...")
            time.sleep(3)
        except KeyboardInterrupt:
            print("\nFin.")
            return


if __name__ == "__main__":
    main()
