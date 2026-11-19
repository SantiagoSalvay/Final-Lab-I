// Ilustración SVG del sendero, compartida por la página pública y el panel del encargado.
export const SVG_ESCENA = `<svg class="escena__svg" viewBox="0 0 1000 440" role="img" aria-labelledby="escena-titulo">
  <title id="escena-titulo">Ilustración del sendero con el nodo de monitoreo, las vallas y el rociador</title>
  <defs>
    <linearGradient id="g-cielo" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" class="st-cielo1" />
      <stop offset="1" class="st-cielo2" />
    </linearGradient>
    <linearGradient id="g-pasto" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" class="st-pasto1" />
      <stop offset="1" class="st-pasto2" />
    </linearGradient>
    <linearGradient id="g-camino" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#cdb789" />
      <stop offset="1" stop-color="#e2cb98" />
    </linearGradient>
    <radialGradient id="g-sol">
      <stop offset="0" stop-color="#fff6d5" />
      <stop offset=".45" stop-color="#ffe08a" stop-opacity=".9" />
      <stop offset="1" stop-color="#ffd166" stop-opacity="0" />
    </radialGradient>
    <radialGradient id="g-fuego" cx=".5" cy=".7" r=".6">
      <stop offset="0" stop-color="#ffb347" stop-opacity=".85" />
      <stop offset="1" stop-color="#ff4d00" stop-opacity="0" />
    </radialGradient>
    <linearGradient id="g-tinte" x1="0" y1="1" x2="0" y2="0">
      <stop offset="0" stop-color="#ff5a1f" stop-opacity=".55" />
      <stop offset=".6" stop-color="#b3261e" stop-opacity=".25" />
      <stop offset="1" stop-color="#3a0d0d" stop-opacity=".45" />
    </linearGradient>
    <pattern id="p-franjas" width="20" height="10" patternUnits="userSpaceOnUse">
      <rect width="20" height="10" fill="#f5f5f5" />
      <rect width="10" height="10" fill="#d32f2f" />
    </pattern>
    <filter id="f-brillo" x="-50%" y="-50%" width="200%" height="200%">
      <feGaussianBlur stdDeviation="4" result="b" />
      <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
    </filter>
    <symbol id="s-pino" viewBox="0 0 60 120">
      <rect x="26" y="92" width="8" height="28" rx="2" fill="#6b4a2b" />
      <path d="M30 4 8 52h12L4 82h17L2 102h56L39 82h17L40 52h12z" class="copa-osc" />
      <path d="M30 4 18 30l12-6z" fill="#ffffff" opacity=".12" />
    </symbol>
    <symbol id="s-arbol" viewBox="0 0 80 120">
      <path d="M37 70h6l2 50h-10z" fill="#6b4a2b" />
      <circle cx="40" cy="40" r="26" class="copa" />
      <circle cx="22" cy="58" r="19" class="copa" />
      <circle cx="58" cy="58" r="19" class="copa" />
      <circle cx="40" cy="66" r="18" class="copa-osc" />
      <circle cx="32" cy="30" r="10" fill="#ffffff" opacity=".1" />
    </symbol>
    <symbol id="s-llama" viewBox="0 0 40 60">
      <path d="M20 2c4 12 16 18 16 34a16 16 0 0 1-32 0c0-9 6-13 8-20 2 6 4 8 6 8 0-8 1-14 2-22z" fill="#ff6a00" />
      <path d="M20 22c3 8 9 11 9 20a9 9 0 0 1-18 0c0-5 3-8 5-12 1 3 2 4 3 4 0-4 0-8 1-12z" fill="#ffc53d" />
    </symbol>
  </defs>

  <!-- Cielo -->
  <rect width="1000" height="260" fill="url(#g-cielo)" />
  <circle cx="845" cy="72" r="80" fill="url(#g-sol)" class="sol" />
  <g class="nubes" fill="#ffffff">
    <g class="nube" style="--dur:70s;--del:-10s"><ellipse cx="0" cy="62" rx="46" ry="14" /><ellipse cx="22" cy="52" rx="26" ry="14" /><ellipse cx="-18" cy="56" rx="20" ry="10" /></g>
    <g class="nube" style="--dur:95s;--del:-55s"><ellipse cx="0" cy="98" rx="60" ry="13" /><ellipse cx="-14" cy="88" rx="30" ry="13" /><ellipse cx="22" cy="90" rx="22" ry="10" /></g>
    <g class="nube" style="--dur:80s;--del:-35s"><ellipse cx="0" cy="40" rx="34" ry="10" /><ellipse cx="12" cy="33" rx="18" ry="9" /></g>
  </g>

  <!-- Montañas y lomas -->
  <path d="M0 218 L80 170 L150 200 L250 128 L345 196 L440 150 L540 206 L640 142 L745 198 L845 160 L1000 206 V260 H0Z" class="montana1" />
  <path d="M250 128 L282 152 L268 150 L250 160 L236 150 L222 148Z M640 142 L668 162 L652 160 L640 168 L628 160 L614 162Z" fill="#ffffff" opacity=".55" />
  <path d="M0 238 Q130 190 260 226 T540 220 T800 212 T1000 222 V262 H0Z" class="montana2" />

  <!-- Suelo y sendero -->
  <rect y="238" width="1000" height="202" fill="url(#g-pasto)" />
  <path d="M489 238 C472 300 432 352 330 440 L670 440 C580 352 530 300 511 238Z" fill="url(#g-camino)" />
  <path d="M489 238 C472 300 432 352 330 440 M511 238 C530 300 580 352 670 440" fill="none" stroke="#a88a55" stroke-width="2.5" stroke-dasharray="2 7" stroke-linecap="round" opacity=".7" />
  <ellipse cx="320" cy="384" rx="70" ry="13" class="charco" />

  <!-- Árboles del fondo -->
  <g class="bosque">
    <g class="arbol" style="--sw:5s;--dl:-1s"><use href="#s-pino" x="40" y="186" width="34" height="68" /></g>
    <g class="arbol" style="--sw:6s;--dl:-2s"><use href="#s-arbol" x="100" y="196" width="44" height="64" /></g>
    <g class="arbol" style="--sw:5.5s;--dl:-3s"><use href="#s-pino" x="170" y="182" width="38" height="76" /></g>
    <g class="arbol" style="--sw:6.4s;--dl:-.5s"><use href="#s-pino" x="240" y="194" width="30" height="62" /></g>
    <g class="arbol" style="--sw:5.2s;--dl:-4s"><use href="#s-arbol" x="300" y="198" width="40" height="60" /></g>
    <g class="arbol" style="--sw:6.2s;--dl:-1.6s"><use href="#s-pino" x="378" y="198" width="28" height="56" /></g>
    <g class="arbol" style="--sw:5.4s;--dl:-2.6s"><use href="#s-pino" x="588" y="196" width="30" height="60" /></g>
    <g class="arbol arbol--fuego" style="--sw:6s;--dl:-3.3s"><use href="#s-arbol" x="660" y="192" width="46" height="68" /></g>
    <g class="arbol" style="--sw:5.8s;--dl:-.8s"><use href="#s-pino" x="730" y="182" width="38" height="76" /></g>
    <g class="arbol" style="--sw:6.6s;--dl:-2.2s"><use href="#s-arbol" x="820" y="196" width="44" height="64" /></g>
    <g class="arbol" style="--sw:5.1s;--dl:-3.8s"><use href="#s-pino" x="900" y="186" width="34" height="70" /></g>
    <g class="arbol" style="--sw:6.1s;--dl:-1.2s"><use href="#s-pino" x="955" y="196" width="28" height="58" /></g>
  </g>

  <!-- Árboles medios -->
  <g class="bosque">
    <g class="arbol" style="--sw:6.5s;--dl:-2s"><use href="#s-pino" x="20" y="226" width="56" height="112" /></g>
    <g class="arbol" style="--sw:7s;--dl:-4s"><use href="#s-arbol" x="150" y="248" width="70" height="100" /></g>
    <g class="arbol arbol--fuego" style="--sw:6.8s;--dl:-1s"><use href="#s-arbol" x="740" y="232" width="78" height="112" /></g>
    <g class="arbol" style="--sw:7.2s;--dl:-3s"><use href="#s-pino" x="870" y="214" width="60" height="124" /></g>
  </g>

  <!-- Fuego (visible con llama detectada) -->
  <g class="fuego" aria-hidden="true">
    <ellipse cx="779" cy="270" rx="70" ry="60" fill="url(#g-fuego)" class="fuego__halo" />
    <ellipse cx="683" cy="220" rx="40" ry="34" fill="url(#g-fuego)" class="fuego__halo" />
    <use href="#s-llama" x="752" y="232" width="28" height="42" class="llama l1" />
    <use href="#s-llama" x="776" y="222" width="34" height="52" class="llama l2" />
    <use href="#s-llama" x="796" y="244" width="22" height="34" class="llama l3" />
    <use href="#s-llama" x="670" y="196" width="22" height="34" class="llama l2" />
    <use href="#s-llama" x="688" y="206" width="16" height="26" class="llama l1" />
    <use href="#s-llama" x="720" y="318" width="20" height="28" class="llama l3" />
  </g>

  <!-- Cable al rociador y rociador -->
  <path d="M641 346 L641 392 Q470 404 302 374" fill="none" stroke="#4a5568" stroke-width="2.5" stroke-dasharray="6 5" class="cable" />
  <g class="rociador">
    <rect x="296" y="352" width="12" height="24" rx="2" fill="#5b6577" />
    <rect x="290" y="346" width="24" height="9" rx="3" fill="#8794a8" />
    <circle cx="302" cy="344" r="4" fill="#3987e5" class="rociador__luz" />
  </g>

  <!-- Vallas con servo -->
  <g class="valla">
    <rect x="388" y="334" width="12" height="52" rx="2" fill="#e8ebf0" stroke="#7b8494" />
    <rect x="384" y="382" width="20" height="6" rx="2" fill="#5b6577" />
    <circle cx="394" cy="330" r="5" class="valla__luz" />
    <g class="brazo brazo--1"><rect x="398" y="336" width="104" height="9" rx="3" fill="url(#p-franjas)" stroke="#7a1d1d" stroke-width=".8" /></g>
    <circle cx="398" cy="340" r="5" fill="#3a4250" />
  </g>
  <g class="valla">
    <rect x="600" y="334" width="12" height="52" rx="2" fill="#e8ebf0" stroke="#7b8494" />
    <rect x="596" y="382" width="20" height="6" rx="2" fill="#5b6577" />
    <circle cx="606" cy="330" r="5" class="valla__luz" />
    <g class="brazo brazo--2"><rect x="500" y="336" width="104" height="9" rx="3" fill="url(#p-franjas)" stroke="#7a1d1d" stroke-width=".8" /></g>
    <circle cx="602" cy="340" r="5" fill="#3a4250" />
  </g>
  <g class="cartel" transform="translate(500 302)">
    <g class="cartel__in">
      <rect x="-78" y="-15" width="156" height="30" rx="6" fill="#b3261e" stroke="#fff" stroke-width="2" />
      <text y="5" text-anchor="middle" fill="#fff" font-size="13" font-weight="700" letter-spacing="1.5">SENDERO CERRADO</text>
    </g>
  </g>

  <!-- Caminante -->
  <g class="caminante" aria-hidden="true">
    <g class="caminante__cuerpo">
      <circle cx="0" cy="-46" r="6" fill="#3b2f2a" />
      <path d="M-6 -38h12l2 20h-16z" fill="#1f6f8b" />
      <rect x="-9" y="-38" width="7" height="14" rx="2" fill="#c0392b" />
      <path d="M-4 -18l-4 18M4 -18l4 18" stroke="#2d3748" stroke-width="4" stroke-linecap="round" class="piernas" />
    </g>
  </g>

  <!-- Nodo ESP32 con sirena -->
  <g class="nodo">
    <rect x="636" y="252" width="9" height="96" rx="2" fill="#5b6577" />
    <rect x="628" y="344" width="25" height="6" rx="2" fill="#3a4250" />
    <line x1="660" y1="266" x2="660" y2="232" stroke="#3a4250" stroke-width="2.5" />
    <circle cx="660" cy="230" r="3.5" fill="#3a4250" />
    <g class="ondas-radio" fill="none" stroke="#3987e5" stroke-width="2.5" stroke-linecap="round">
      <path d="M668 222a12 12 0 0 1 0 16M674 216a20 20 0 0 1 0 28" />
      <path d="M652 222a12 12 0 0 0 0 16M646 216a20 20 0 0 0 0 28" />
    </g>
    <rect x="614" y="264" width="52" height="40" rx="5" fill="#eef1f6" stroke="#8a95a8" />
    <rect x="621" y="271" width="38" height="17" rx="2" fill="#0b1220" />
    <text x="640" y="283" text-anchor="middle" font-size="8.5" fill="#6ee7f9" font-family="ui-monospace,monospace" class="oled">N0 IR 0</text>
    <text x="640" y="299" text-anchor="middle" font-size="7" fill="#5b6577" font-weight="700" class="etiqueta-nodo">ESP32</text>
    <circle cx="640" cy="257" r="7" class="baliza" filter="url(#f-brillo)" />
    <g class="sirena">
      <path d="M636 312 l-14 -7 v18 l14 -7z" fill="#e0a100" stroke="#7a5a00" stroke-width="1" />
      <g class="ondas-sonido" fill="none" stroke="#fab219" stroke-width="2.5" stroke-linecap="round">
        <path d="M615 306a10 10 0 0 0 0 12" />
        <path d="M609 300a18 18 0 0 0 0 24" />
        <path d="M603 294a26 26 0 0 0 0 36" />
      </g>
    </g>
  </g>

  <!-- Árboles cercanos -->
  <g class="bosque">
    <g class="arbol" style="--sw:8s;--dl:-2s"><use href="#s-pino" x="-30" y="250" width="100" height="200" /></g>
    <g class="arbol" style="--sw:7.5s;--dl:-5s"><use href="#s-arbol" x="96" y="304" width="110" height="160" /></g>
    <g class="arbol" style="--sw:7.8s;--dl:-3s"><use href="#s-arbol" x="820" y="300" width="120" height="170" /></g>
    <g class="arbol" style="--sw:8.2s;--dl:-1s"><use href="#s-pino" x="930" y="240" width="96" height="210" /></g>
  </g>

  <rect width="1000" height="440" fill="url(#g-tinte)" class="tinte" />
</svg>`;
