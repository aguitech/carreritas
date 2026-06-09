# 🏎️ Carreritas

Mini juego de carreras 3D en el navegador. **Three.js puro, sin build tools.**

Modelos de carros cortesía de [codimexa.com](https://codimexa.com/demos/lancer/) (Lancer Evo, GT-R R35, Mustang GT).

## 🎮 Cómo jugar

1. **Elige tu carro** — cada uno tiene stats diferentes (velocidad, aceleración, manejo)
2. **Elige tu color** — el paint se aplica en tiempo real
3. **Acelera, gira, da drift** con el handbrake
4. **Nitro** con Shift (mientras aceleras)
5. **Completa 3 vueltas** lo más rápido posible
6. **Mejor tiempo** se guarda en `localStorage`

## 🎯 Controles

### Teclado
- `W` / `↑` — Acelerar
- `S` / `↓` — Frenar / reversa
- `A` / `←` — Girar izquierda
- `D` / `→` — Girar derecha
- `Espacio` — Handbrake (drift)
- `Shift` — Nitro (requiere acelerar)

### Mobile (touch)
- Botones en pantalla (auto-detect)

## 🚗 Los carros

| Carro | Velocidad | Aceleración | Manejo | Estilo |
|---|---|---|---|---|
| Lancer Evo | 200 | 1.0 | 0.95 | Balance total |
| GT-R R35 | 230 | 1.05 | 1.0 | Tracción total |
| Mustang GT | 215 | 1.1 | 0.78 | Muscle, drifts largos |

## ✨ Características

- **3 carros 3D** (.glb) con stats diferenciados
- **Color picker** — pinta tu carro antes de salir
- **Pista cerrada** con curvas, chicanes, curvas suaves
- **Sistema de checkpoints** invisible + validación de vuelta
- **Física arcade** con aceleración, fricción, drift con handbrake, nitro con drain/regen
- **Cámara chase** que reacciona a la velocidad (FOV punch)
- **Minimapa** con posición y dirección del carro
- **3 vueltas cronometradas** + high score persistente
- **Nitro flash overlay** + boost visual feedback
- **Drift particles** (humo en las ruedas traseras)
- **Confetti** en el finish screen
- **Controles touch** para mobile
- **Skybox procedural**, montañas, árboles, barreras

## 🛠️ Stack

- **Three.js 0.160** vía CDN (importmap)
- **GLTFLoader** para los modelos .glb
- **HTML5 Canvas** para minimapa
- **CSS3** para UI
- **0 dependencias npm**

## 🚀 Demo

👉 [aguitech.github.io/carreritas](https://aguitech.github.io/carreritas/)

## 📂 Estructura

```
carreritas/
├── index.html          # Layout + HUD + screens
├── styles.css          # Estilos
├── game.v1.js          # Motor del juego (filename versioned for cache-busting)
├── favicon.svg
├── README.md
└── cars/
    ├── lancer.glb      # ~3.9 MB (optimizado)
    ├── gtr.glb         # ~8.7 MB
    └── mustang.glb     # ~2.0 MB
```

## 🔧 Notas técnicas

- **Filename versioning** (`game.v1.js`, `game.v2.js`, …): cada deploy bumpa el número. Evita el cache del navegador sin tener que depender de query strings.
- **Fallback-then-swap**: si el `.glb` falla, un carro primitivo aparece inmediatamente. El juego nunca se queda esperando un asset.
- **Loader killer** (en construcción): re-oculta el loader cada 200ms durante 5s. Gana contra cualquier CSS que intente mostrarlo.

## 🏃 Desarrollo local

```bash
git clone https://github.com/aguitech/carreritas.git
cd carreritas
python3 -m http.server 8000
# Abre http://localhost:8000
```

## 📜 Créditos

- Modelos 3D: [codimexa.com/demos/lancer](https://codimexa.com/demos/lancer/) (descargados, optimizados y reutilizados con fines educativos/demostrativos)
- Three.js: [threejs.org](https://threejs.org/)
- Optimización: [@gltf-transform/cli](https://gltf-transform.dev/)

## ⚖️ Licencia

MIT — Hecho con 💜 para la cultura racing.

---

**🏁 ¡A correr!**
