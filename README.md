# 🕳️ Black Hole — Interactive 3D Simulation

A visually stunning, scientifically accurate black hole simulation built with WebGL and Three.js. Experience gravitational lensing, accretion disk physics, and the extreme warping of spacetime — right in your browser.

**[🌐 Live Demo →](https://svirokx.github.io/Black-Hole/)**

---

## Features

### 🌀 Kerr Black Hole Simulation
- Full **Kerr metric** ray-tracing (rotating black hole, spin a ≈ 0.97)
- Gravitational lensing with **Einstein rings** and **photon sphere**
- **Frame-dragging** (Lense-Thirring effect)
- Asymmetric shadow from spin
- Relativistic **Doppler beaming** on accretion disk
- Spiral accretion disk with temperature gradient
- Star field distortion with nebula
- **Free orbit camera** — drag mouse to view from any angle, scroll to zoom

### 🪐 Creation Mode
- Click the **+** button in the corner to enter creation mode
- Click anywhere on screen to spawn objects:
  - Rocky planets, Gas giants, Asteroids, Stars, Photon bursts
- Each object follows **Kerr geodesics** — real gravitational physics
- Watch them orbit, spiral in, and get absorbed
- **Spaghettification** effect near the event horizon
- Glowing trails show orbital paths
- Frame-dragging affects orbits

### 📚 Black Hole Catalog
- **40+ known black holes** with verified scientific data
- Organized by class:
  - **Supermassive** (M87*, Sgr A*, Phoenix A, TON 618, NGC 4889, etc.)
  - **Intermediate-mass** (HLX-1, Omega Centauri IMBH, GW190521 remnant)
  - **Stellar-mass** (Cygnus X-1, Gaia BH1/BH2/BH3, V404 Cygni, etc.)
  - **GW Mergers** (GW150914, GW190521, O4 run, and more)
- Filter by category
- All data from NASA, ESA, EHT, LIGO/Virgo, and peer-reviewed journals

### 🔊 Synthesized Audio
- Web Audio API drone based on NASA's sonification of the Perseus cluster
- Low-frequency oscillations matching real gravitational wave patterns

### 🎨 Design
- Dark cosmic theme with smooth scroll-reveal animations
- Responsive design (desktop and mobile)
- Loading screen with black hole animation
- No scroll buttons — content appears naturally as you scroll

---

## Tech Stack

- **Three.js** (v0.170.0) — 3D rendering
- **GLSL** — Custom ray-tracing fragment shader (Kerr metric)
- **Web Audio API** — Synthesized black hole sounds
- **Vanilla JS** — No frameworks, no build step
- **Google Fonts** — Space Grotesk + Inter

## Physics

The simulation implements:
- **Kerr metric** with spin parameter a = 0.97 (near-maximal)
- Oblate-spheroidal Boyer-Lindquist coordinates
- Photon geodesics with adaptive RK4 integration (256 steps)
- Frame-dragging (Lense-Thirring precession)
- ISCO at r ≈ 1.55M (prograde Kerr)
- Gravitational + Doppler frequency shift on disk emission
- Particle physics: leapfrog integrator, GR corrections, velocity clamping

## Local Development

Just open `index.html` in a browser — no build step needed.

Or use a local server:
```bash
npx serve .
# or
python -m http.server 8000
```

## Sources

- Event Horizon Telescope Collaboration (2019, 2022)
- LIGO/Virgo/KAGRA Collaboration (2016–2025)
- ESA Gaia Collaboration (2023, 2024)
- NASA, ESA, ESO image archives
- Kip Thorne, "The Science of Interstellar" (2014)

## License

MIT
