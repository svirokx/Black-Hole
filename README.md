# Black Hole — Interactive 3D Simulation & Science

An immersive single-page website featuring a real-time 3D black hole simulation with gravitational lensing, accretion disk rendering, and comprehensive scientific content about black holes.

## Features

- **Realistic 3D Simulation** — Ray-tracing in Schwarzschild spacetime using WebGL shaders (Three.js)
- **Gravitational Lensing** — Light bending, Doppler beaming, and accretion disk warping
- **Interactive Camera** — Orbit the black hole by dragging with mouse/touch, zoom with scroll
- **Black Hole Sound** — Synthesized deep drone inspired by NASA's Perseus cluster sonification
- **Rich Scientific Content** — Verified information from NASA, ESA, EHT, and peer-reviewed journals
- **Smooth Scroll Animations** — Content reveals as you explore
- **Loading Screen** — Stylish black hole animation while assets load
- **Responsive Design** — Works on desktop and mobile
- **SEO Optimized** — Meta tags, Open Graph, sitemap, robots.txt

## Tech Stack

- HTML5, CSS3, Vanilla JavaScript (ES Modules)
- [Three.js](https://threejs.org/) — WebGL rendering
- Custom GLSL fragment shader — Schwarzschild ray tracer
- Web Audio API — Sound synthesis
- Intersection Observer API — Scroll animations
- Google Fonts (Space Grotesk, Inter)

## How the Simulation Works

The black hole is rendered using a fragment shader that traces photon paths through curved Schwarzschild spacetime. For each pixel:

1. A ray is cast from the camera
2. The photon's trajectory is numerically integrated using the geodesic equation
3. Intersections with the accretion disk (equatorial plane) are detected
4. Disk color is computed from temperature gradients, Doppler beaming, and gravitational redshift
5. Escaped rays sample a procedural star field
6. Absorbed rays (crossing the event horizon) render as black

## Sources

All scientific content is sourced from:
- NASA Science (science.nasa.gov)
- European Space Agency (ESA)
- Event Horizon Telescope Collaboration
- Peer-reviewed papers in The Astrophysical Journal, Classical and Quantum Gravity, MNRAS
- Nobel Prize Committee citations

Images are public domain / CC BY 4.0 from NASA, ESA, EHT, ESO, and Wikimedia Commons.

## License

Content and code are provided as-is for personal use.
