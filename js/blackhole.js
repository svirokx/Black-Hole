// ============================================
// BLACK HOLE — Kerr (rotating) Black Hole Simulation
// Ray-tracing with frame-dragging, Doppler beaming,
// gravitational redshift, accretion disk
// Inspired by Interstellar's Gargantua
// ============================================

import * as THREE from 'three';

// ---------- GLSL Shaders ----------

const vertexShader = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position, 1.0);
}
`;

const fragmentShader = /* glsl */ `
precision highp float;

varying vec2 vUv;

uniform vec2 uResolution;
uniform float uTime;
uniform float uCamDist;
uniform float uCamTheta;
uniform float uCamPhi;

#define PI 3.14159265359
#define MAX_STEPS 256
#define SPIN 0.97
#define M 1.0

// Kerr event horizon: r+ = M + sqrt(M^2 - a^2)
#define R_HORIZON (M + sqrt(M * M - SPIN * SPIN))

// ISCO for prograde (Kerr a=0.97 ≈ 1.55M) and disk outer
#define DISK_INNER 1.55
#define DISK_OUTER 14.0

// Hash for stars
float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}
float hash3(vec3 p) {
  return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453);
}

// Smooth noise
float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = hash(i);
  float b = hash(i + vec2(1.0, 0.0));
  float c = hash(i + vec2(0.0, 1.0));
  float d = hash(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

// Star field
vec3 starField(vec3 rd) {
  vec3 col = vec3(0.0);
  for (int i = 0; i < 3; i++) {
    float scale = 150.0 + float(i) * 250.0;
    vec3 q = rd * scale;
    vec3 id = floor(q);
    vec3 f = fract(q) - 0.5;
    float h = hash3(id + float(i) * 47.0);
    if (h > 0.965) {
      vec3 off = vec3(hash3(id + 11.0), hash3(id + 23.0), hash3(id + 37.0)) * 0.4 - 0.2;
      float d = length(f - off);
      float brightness = smoothstep(0.07, 0.0, d) * (0.4 + 0.6 * hash3(id + 99.0));
      // Star color temperature
      float temp = hash3(id + 55.0);
      vec3 sCol = mix(vec3(0.7, 0.8, 1.0), vec3(1.0, 0.9, 0.7), temp);
      sCol = mix(sCol, vec3(1.0, 0.6, 0.4), step(0.92, temp));
      // Twinkle
      brightness *= 0.8 + 0.2 * sin(hash3(id + 77.0) * 100.0 + uTime * 0.5);
      col += sCol * brightness;
    }
  }
  // Subtle nebula / milky way band
  float band = exp(-8.0 * pow(abs(rd.y - 0.1), 2.0));
  float n = noise(rd.xz * 3.0 + rd.y * 2.0) * noise(rd.xz * 7.0 - uTime * 0.01);
  col += vec3(0.06, 0.03, 0.09) * band * n;
  col += vec3(0.03, 0.05, 0.08) * band * noise(rd.zx * 5.0) * 0.5;
  return col;
}

// Accretion disk color with temperature gradient, turbulence, spiral structure
vec3 diskColor(float r, float angle, float time) {
  float t = smoothstep(DISK_OUTER, DISK_INNER, r); // 0=outer, 1=inner

  // Blackbody temperature gradient
  vec3 cold = vec3(0.6, 0.12, 0.03);   // deep red outer
  vec3 warm = vec3(1.0, 0.55, 0.15);   // orange-gold mid
  vec3 hot  = vec3(1.0, 0.92, 0.82);   // white-gold inner
  vec3 ultra = vec3(0.85, 0.9, 1.0);   // blue-white innermost

  vec3 col = mix(cold, warm, smoothstep(0.0, 0.35, t));
  col = mix(col, hot, smoothstep(0.35, 0.7, t));
  col = mix(col, ultra, smoothstep(0.7, 1.0, t));

  // Brightness peaks near inner edge
  float brightness = 0.2 + 0.8 * pow(t, 0.4);

  // Spiral arm structure
  float spiral1 = sin(angle * 4.0 - log(r + 1.0) * 6.0 + time * 0.25) * 0.5 + 0.5;
  float spiral2 = sin(angle * 2.0 + log(r + 1.0) * 3.0 - time * 0.15) * 0.5 + 0.5;
  brightness *= 0.7 + 0.3 * mix(spiral1, spiral2, 0.5);

  // Fine turbulence
  float turb = noise(vec2(angle * 8.0, r * 3.0 + time * 0.05));
  float turb2 = noise(vec2(angle * 20.0, r * 8.0 - time * 0.1));
  brightness *= 0.8 + 0.15 * turb + 0.05 * turb2;

  // Thin ring glow at ISCO
  float iscoGlow = exp(-pow((r - DISK_INNER) * 2.0, 2.0)) * 0.5;
  col += vec3(0.5, 0.7, 1.0) * iscoGlow;

  return col * brightness * 1.8;
}

void main() {
  vec2 uv = (gl_FragCoord.xy - 0.5 * uResolution) / uResolution.y;

  // Camera in spherical coordinates
  float camR = uCamDist;
  vec3 camPos = vec3(
    camR * sin(uCamTheta) * cos(uCamPhi),
    camR * cos(uCamTheta),
    camR * sin(uCamTheta) * sin(uCamPhi)
  );

  // Camera basis
  vec3 forward = normalize(-camPos);
  vec3 worldUp = vec3(0.0, 1.0, 0.0);
  // Avoid degenerate cross product when looking straight up/down
  if (abs(dot(forward, worldUp)) > 0.999) worldUp = vec3(0.0, 0.0, 1.0);
  vec3 right = normalize(cross(forward, worldUp));
  vec3 up = cross(right, forward);

  // Ray direction
  float fov = 1.0;
  vec3 rd = normalize(forward * fov + right * uv.x + up * uv.y);

  // ---- Ray tracing in Kerr spacetime ----
  // Using pseudo-Kerr approximation with frame-dragging
  // Spin axis = +Y

  vec3 pos = camPos;
  vec3 vel = rd;
  vec3 spinAxis = vec3(0.0, 1.0, 0.0);
  float a = SPIN;

  vec3 color = vec3(0.0);
  float diskAlpha = 0.0;
  bool hitHorizon = false;
  float prevY = pos.y;

  for (int i = 0; i < MAX_STEPS; i++) {
    // Kerr oblate spheroidal r
    float r2_xy = dot(pos.xz, pos.xz);
    float r2_bls = r2_xy + pos.y * pos.y - a * a;
    float r = sqrt(0.5 * (r2_bls + sqrt(r2_bls * r2_bls + 4.0 * a * a * pos.y * pos.y)));

    // Event horizon check
    if (r < R_HORIZON * 0.5) {
      hitHorizon = true;
      break;
    }
    // Escape
    if (r > 60.0) break;

    // Adaptive step size
    float dt = 0.015 + 0.12 * smoothstep(2.5, 25.0, r);

    // Σ = r² + a²cos²θ  (in Cartesian: a²*y²/r²)
    float cosTheta2 = (pos.y * pos.y) / (r * r);
    float Sigma = r * r + a * a * cosTheta2;

    // Angular momentum of photon
    vec3 h = cross(pos, vel);
    float h2 = dot(h, h);

    // Gravitational acceleration (Schwarzschild-like for Kerr)
    vec3 acc = -1.5 * h2 / (r * r * r * r * r) * pos;

    // Frame-dragging acceleration (gravitomagnetic effect)
    // Proportional to a*M/Σ, drags photon in spin direction
    float dragStrength = 2.0 * a * M / (Sigma * r);
    vec3 dragForce = dragStrength * cross(spinAxis, vel);

    // Additional radial correction for Kerr vs Schwarzschild
    float kerrCorrection = 1.0 + a * a / (r * r);
    acc *= kerrCorrection;
    acc += dragForce;

    // Symplectic (leapfrog) integration
    vec3 vel_half = vel + acc * dt * 0.5;
    vec3 newPos = pos + vel_half * dt;

    // Recompute at new position
    float nr2_xy = dot(newPos.xz, newPos.xz);
    float nr2_bls = nr2_xy + newPos.y * newPos.y - a * a;
    float nr = sqrt(0.5 * (nr2_bls + sqrt(nr2_bls * nr2_bls + 4.0 * a * a * newPos.y * newPos.y)));

    float nCosTheta2 = (newPos.y * newPos.y) / max(nr * nr, 0.001);
    float nSigma = nr * nr + a * a * nCosTheta2;

    vec3 nh = cross(newPos, vel_half);
    float nh2 = dot(nh, nh);
    vec3 nAcc = -1.5 * nh2 / (nr * nr * nr * nr * nr) * newPos;
    float nDrag = 2.0 * a * M / (nSigma * nr);
    nAcc *= (1.0 + a * a / (nr * nr));
    nAcc += nDrag * cross(spinAxis, vel_half);

    vel = vel_half + nAcc * dt * 0.5;
    vel = normalize(vel);

    // Disk crossing (y=0 plane)
    float newY = newPos.y;
    if (prevY * newY < 0.0 && diskAlpha < 0.97) {
      float frac = abs(prevY) / (abs(prevY) + abs(newY) + 0.0001);
      vec3 crossPos = mix(pos, newPos, frac);
      float cR = length(crossPos.xz); // cylindrical radius for disk

      if (cR > DISK_INNER && cR < DISK_OUTER) {
        float angle = atan(crossPos.z, crossPos.x);

        // Keplerian disk velocity at radius cR
        // v_phi = sqrt(M / cR) for Newtonian; modified for Kerr
        float v_orb = sqrt(M / cR) / (1.0 + a * sqrt(M / (cR * cR * cR)));
        vec3 diskVelDir = normalize(vec3(-crossPos.z, 0.0, crossPos.x)); // tangential
        vec3 diskVel = diskVelDir * v_orb;

        // Doppler factor: stronger for Kerr due to higher orbital velocities
        float doppler = 1.0 / (1.0 - dot(normalize(vel), diskVel));
        doppler = clamp(doppler, 0.3, 4.0);
        float dopplerColor = pow(doppler, 3.0); // intensity ∝ δ³ (relativistic)
        float dopplerShift = pow(doppler, 1.0); // color shift ∝ δ

        // Gravitational redshift
        float redshift = sqrt(max(0.0, 1.0 - 2.0 * M / (r + 0.001)));

        // Get base disk color
        vec3 dCol = diskColor(cR, angle, uTime);

        // Apply Doppler boost (brighter approaching side)
        dCol *= dopplerColor * redshift;

        // Slight color shift from Doppler: approaching = blueshift, receding = redshift
        if (doppler > 1.0) {
          dCol = mix(dCol, dCol * vec3(0.85, 0.9, 1.2), (doppler - 1.0) * 0.3);
        } else {
          dCol = mix(dCol, dCol * vec3(1.2, 0.85, 0.7), (1.0 - doppler) * 0.3);
        }

        float alpha = smoothstep(DISK_OUTER, DISK_OUTER - 1.5, cR) *
                      smoothstep(DISK_INNER - 0.3, DISK_INNER + 0.3, cR);
        alpha *= 0.92;

        // Composite (front-to-back)
        color += dCol * alpha * (1.0 - diskAlpha);
        diskAlpha += alpha * (1.0 - diskAlpha);
      }
    }

    prevY = newY;
    pos = newPos;
  }

  // Background stars
  if (!hitHorizon) {
    vec3 bg = starField(normalize(vel));
    color += bg * (1.0 - diskAlpha);
  }

  // Photon ring glow (asymmetric for Kerr — brighter on approaching side)
  float centerDist = length(uv);
  float bhAngular = R_HORIZON * 2.6 / uCamDist;
  float ringGlow = exp(-pow((centerDist - bhAngular) * uCamDist * 1.2, 2.0) * 1.5);
  // Asymmetry: left side brighter (approaching in default view)
  float asym = 1.0 + 0.3 * (-uv.x / (centerDist + 0.001));
  color += vec3(1.0, 0.75, 0.35) * ringGlow * 0.06 * asym;

  // Inner shadow darkening
  float shadowMask = smoothstep(bhAngular * 0.6, bhAngular * 1.2, centerDist);
  if (hitHorizon) color *= 0.0;

  // Vignette
  float vignette = 1.0 - 0.25 * dot(uv, uv);
  color *= vignette;

  // ACES tone mapping
  color = color * (2.51 * color + 0.03) / (color * (2.43 * color + 0.59) + 0.14);

  // Gamma
  color = pow(clamp(color, 0.0, 1.0), vec3(1.0 / 2.2));

  gl_FragColor = vec4(color, 1.0);
}
`;

// ---------- Renderer Class ----------

export class BlackHoleRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.targetTheta = Math.PI * 0.42;
    this.targetPhi = 0;
    this.currentTheta = Math.PI * 0.42;
    this.currentPhi = 0;
    this.camDist = 25;
    this.isDragging = false;
    this.lastMouse = { x: 0, y: 0 };
    this.autoRotate = true;

    this.init();
    this.setupControls();
  }

  init() {
    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: false,
      alpha: false,
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    this.renderer.setSize(window.innerWidth, window.innerHeight);

    this.scene = new THREE.Scene();
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

    const geometry = new THREE.PlaneGeometry(2, 2);
    this.uniforms = {
      uResolution: { value: new THREE.Vector2(window.innerWidth, window.innerHeight) },
      uTime: { value: 0 },
      uCamDist: { value: this.camDist },
      uCamTheta: { value: this.currentTheta },
      uCamPhi: { value: this.currentPhi },
    };

    const material = new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader,
      uniforms: this.uniforms,
    });

    this.quad = new THREE.Mesh(geometry, material);
    this.scene.add(this.quad);

    window.addEventListener('resize', () => this.onResize());
  }

  setupControls() {
    // Mouse orbit
    this.canvas.addEventListener('mousedown', (e) => {
      this.isDragging = true;
      this.lastMouse.x = e.clientX;
      this.lastMouse.y = e.clientY;
      this.autoRotate = false;
      this.canvas.style.cursor = 'grabbing';
    });

    window.addEventListener('mousemove', (e) => {
      if (!this.isDragging) return;
      const dx = e.clientX - this.lastMouse.x;
      const dy = e.clientY - this.lastMouse.y;
      this.targetPhi -= dx * 0.005;
      this.targetTheta += dy * 0.005;
      this.targetTheta = Math.max(0.15, Math.min(Math.PI - 0.15, this.targetTheta));
      this.lastMouse.x = e.clientX;
      this.lastMouse.y = e.clientY;
    });

    window.addEventListener('mouseup', () => {
      this.isDragging = false;
      this.canvas.style.cursor = 'grab';
    });

    this.canvas.style.cursor = 'grab';

    // Touch
    this.canvas.addEventListener('touchstart', (e) => {
      if (e.touches.length === 1) {
        this.isDragging = true;
        this.lastMouse.x = e.touches[0].clientX;
        this.lastMouse.y = e.touches[0].clientY;
        this.autoRotate = false;
      }
    }, { passive: true });

    window.addEventListener('touchmove', (e) => {
      if (!this.isDragging || e.touches.length !== 1) return;
      const dx = e.touches[0].clientX - this.lastMouse.x;
      const dy = e.touches[0].clientY - this.lastMouse.y;
      this.targetPhi -= dx * 0.005;
      this.targetTheta += dy * 0.005;
      this.targetTheta = Math.max(0.15, Math.min(Math.PI - 0.15, this.targetTheta));
      this.lastMouse.x = e.touches[0].clientX;
      this.lastMouse.y = e.touches[0].clientY;
    }, { passive: true });

    window.addEventListener('touchend', () => {
      this.isDragging = false;
    });

    // Scroll zoom
    this.canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.camDist += e.deltaY * 0.01;
      this.camDist = Math.max(5, Math.min(60, this.camDist));
    }, { passive: false });
  }

  onResize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setSize(w, h);
    this.uniforms.uResolution.value.set(w, h);
  }

  update(time) {
    if (this.autoRotate) {
      this.targetPhi += 0.0008;
    }

    this.currentTheta += (this.targetTheta - this.currentTheta) * 0.05;
    this.currentPhi += (this.targetPhi - this.currentPhi) * 0.05;

    this.uniforms.uTime.value = time;
    this.uniforms.uCamDist.value = this.camDist;
    this.uniforms.uCamTheta.value = this.currentTheta;
    this.uniforms.uCamPhi.value = this.currentPhi;

    this.renderer.render(this.scene, this.camera);
  }

  dispose() {
    this.renderer.dispose();
  }
}
