// ============================================
// BLACK HOLE — Kerr (rotating) Supermassive Simulation
// TON 618 — 66 billion M☉
// Ray-tracing: Kerr metric, frame-dragging, Doppler
// Full quality on all devices, no visual downgrade
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

// Kerr event horizon
#define R_HORIZON (M + sqrt(M * M - SPIN * SPIN))

// Disk limits
#define DISK_INNER 1.55
#define DISK_OUTER 16.0

// --- Noise ---
float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}
float hash3(vec3 p) {
  return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453);
}

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

float fbm(vec2 p) {
  float v = 0.0, a = 0.5;
  vec2 shift = vec2(100.0);
  for (int i = 0; i < 5; i++) {
    v += a * noise(p);
    p = p * 2.0 + shift;
    a *= 0.5;
  }
  return v;
}

// --- Star field with nebula ---
vec3 starField(vec3 rd) {
  vec3 col = vec3(0.0);

  // 3 star layers — full quality always
  for (int i = 0; i < 3; i++) {
    float scale = 150.0 + float(i) * 250.0;
    vec3 q = rd * scale;
    vec3 id = floor(q);
    vec3 f = fract(q) - 0.5;
    float h = hash3(id + float(i) * 47.0);
    if (h > 0.96) {
      vec3 off = vec3(hash3(id+11.0), hash3(id+23.0), hash3(id+37.0)) * 0.4 - 0.2;
      float d = length(f - off);
      float brightness = smoothstep(0.08, 0.0, d) * (0.4 + 0.6 * hash3(id+99.0));
      float temp = hash3(id + 55.0);
      vec3 sCol = mix(vec3(0.7, 0.85, 1.0), vec3(1.0, 0.9, 0.7), temp);
      sCol = mix(sCol, vec3(1.0, 0.5, 0.3), step(0.93, temp));
      sCol = mix(sCol, vec3(0.5, 0.6, 1.0), step(0.97, temp));
      brightness *= 0.8 + 0.2 * sin(hash3(id+77.0) * 100.0 + uTime * 0.3);
      col += sCol * brightness;
    }
  }

  // Nebula / galactic background
  float band = exp(-6.0 * pow(abs(rd.y - 0.08), 2.0));
  float n1 = fbm(rd.xz * 3.0 + rd.y * 2.0);
  float n2 = fbm(rd.xz * 5.0 - vec2(uTime * 0.003));
  col += vec3(0.08, 0.03, 0.12) * band * n1 * 1.2;
  col += vec3(0.02, 0.06, 0.1) * band * n2 * 0.6;
  float dust = fbm(rd.xz * 12.0 + rd.y * 4.0) * fbm(rd.zx * 8.0);
  col += vec3(0.04, 0.02, 0.06) * dust * band * 0.5;

  return col;
}

// --- Accretion disk ---
vec3 diskColor(float r, float angle, float time) {
  float t = smoothstep(DISK_OUTER, DISK_INNER, r);

  // Multi-stop blackbody gradient
  vec3 cold  = vec3(0.5, 0.08, 0.02);
  vec3 warm  = vec3(0.95, 0.4, 0.08);
  vec3 mid   = vec3(1.0, 0.65, 0.2);
  vec3 hot   = vec3(1.0, 0.88, 0.65);
  vec3 ultra = vec3(0.82, 0.88, 1.0);

  vec3 col = mix(cold, warm, smoothstep(0.0, 0.25, t));
  col = mix(col, mid,  smoothstep(0.25, 0.45, t));
  col = mix(col, hot,  smoothstep(0.45, 0.7, t));
  col = mix(col, ultra, smoothstep(0.7, 1.0, t));

  float brightness = 0.15 + 0.85 * pow(t, 0.35);

  // Logarithmic spiral arms
  float logR = log(r + 1.0);
  float sp1 = sin(angle * 3.0 - logR * 5.0 + time * 0.2) * 0.5 + 0.5;
  float sp2 = sin(angle * 5.0 + logR * 4.0 - time * 0.15) * 0.5 + 0.5;
  float sp3 = sin(angle * 7.0 - logR * 8.0 + time * 0.3) * 0.5 + 0.5;
  brightness *= 0.55 + 0.45 * (sp1 * 0.5 + sp2 * 0.35 + sp3 * 0.15);

  // Multi-scale turbulence
  float tb1 = noise(vec2(angle * 10.0, r * 4.0 + time * 0.04));
  float tb2 = noise(vec2(angle * 25.0, r * 10.0 - time * 0.08));
  float tb3 = noise(vec2(angle * 50.0, r * 20.0 + time * 0.12));
  brightness *= 0.7 + 0.18 * tb1 + 0.08 * tb2 + 0.04 * tb3;

  // Hot ISCO ring
  float iscoGlow = exp(-pow((r - DISK_INNER) * 2.5, 2.0)) * 0.7;
  col += vec3(0.4, 0.65, 1.0) * iscoGlow;

  // Edge fades
  float innerFade = smoothstep(DISK_INNER - 0.1, DISK_INNER + 0.4, r);
  float outerFade = smoothstep(DISK_OUTER, DISK_OUTER - 2.5, r);

  return col * brightness * innerFade * outerFade * 2.0;
}

void main() {
  vec2 uv = (gl_FragCoord.xy - 0.5 * uResolution) / uResolution.y;

  // Camera (spherical coords)
  float camR = uCamDist;
  vec3 camPos = vec3(
    camR * sin(uCamTheta) * cos(uCamPhi),
    camR * cos(uCamTheta),
    camR * sin(uCamTheta) * sin(uCamPhi)
  );

  vec3 forward = normalize(-camPos);
  vec3 worldUp = vec3(0.0, 1.0, 0.0);
  if (abs(dot(forward, worldUp)) > 0.999) worldUp = vec3(0.0, 0.0, 1.0);
  vec3 right = normalize(cross(forward, worldUp));
  vec3 up = cross(right, forward);

  vec3 rd = normalize(forward + right * uv.x + up * uv.y);

  // ---- Kerr ray tracing (full 256 steps always) ----
  vec3 pos = camPos;
  vec3 vel = rd;
  vec3 spinAxis = vec3(0.0, 1.0, 0.0);
  float a = SPIN;

  vec3 color = vec3(0.0);
  float diskAlpha = 0.0;
  bool hitHorizon = false;
  float prevY = pos.y;
  float closestR = 100.0;

  for (int i = 0; i < MAX_STEPS; i++) {
    float r2_xy = dot(pos.xz, pos.xz);
    float r2_bls = r2_xy + pos.y * pos.y - a * a;
    float r = sqrt(0.5 * (r2_bls + sqrt(r2_bls * r2_bls + 4.0 * a * a * pos.y * pos.y)));

    closestR = min(closestR, r);

    if (r < R_HORIZON * 0.5) { hitHorizon = true; break; }
    if (r > 65.0) break;

    // Adaptive step (smaller near BH for accuracy, no quality loss)
    float dt = 0.012 + 0.14 * smoothstep(2.0, 30.0, r);

    float cosTheta2 = (pos.y * pos.y) / max(r * r, 0.001);
    float Sigma = r * r + a * a * cosTheta2;

    vec3 h = cross(pos, vel);
    float h2 = dot(h, h);

    float kerrCorr = 1.0 + a * a / (r * r);
    vec3 acc = -1.5 * h2 / (r * r * r * r * r) * pos * kerrCorr;

    float dragStrength = 2.0 * a * M / (Sigma * r + 0.001);
    acc += dragStrength * cross(spinAxis, vel);

    // Leapfrog
    vec3 vel_half = vel + acc * dt * 0.5;
    vec3 newPos = pos + vel_half * dt;

    float nr2_xy = dot(newPos.xz, newPos.xz);
    float nr2_bls = nr2_xy + newPos.y * newPos.y - a * a;
    float nr = sqrt(0.5 * (nr2_bls + sqrt(nr2_bls * nr2_bls + 4.0 * a * a * newPos.y * newPos.y)));
    float nCosTheta2 = (newPos.y * newPos.y) / max(nr * nr, 0.001);
    float nSigma = nr * nr + a * a * nCosTheta2;
    vec3 nh = cross(newPos, vel_half);
    float nh2 = dot(nh, nh);
    float nKerrCorr = 1.0 + a * a / (nr * nr);
    vec3 nAcc = -1.5 * nh2 / (nr * nr * nr * nr * nr) * newPos * nKerrCorr;
    nAcc += (2.0 * a * M / (nSigma * nr + 0.001)) * cross(spinAxis, vel_half);

    vel = normalize(vel_half + nAcc * dt * 0.5);

    // Disk crossing
    float newY = newPos.y;
    if (prevY * newY < 0.0 && diskAlpha < 0.98) {
      float frac = abs(prevY) / (abs(prevY) + abs(newY) + 0.0001);
      vec3 crossPos = mix(pos, newPos, frac);
      float cR = length(crossPos.xz);

      if (cR > DISK_INNER * 0.9 && cR < DISK_OUTER) {
        float angle = atan(crossPos.z, crossPos.x);

        float v_orb = sqrt(M / max(cR, 0.5)) / (1.0 + a * sqrt(M / max(cR*cR*cR, 0.1)));
        vec3 diskVel = normalize(vec3(-crossPos.z, 0.0, crossPos.x)) * v_orb;

        float doppler = 1.0 / max(1.0 - dot(normalize(vel), diskVel), 0.15);
        doppler = clamp(doppler, 0.25, 5.0);
        float dopplerI = pow(doppler, 3.0);
        float gRedshift = sqrt(max(0.0, 1.0 - 2.0 * M / (cR + 0.001)));

        vec3 dCol = diskColor(cR, angle, uTime) * dopplerI * gRedshift;

        // Doppler color shift
        if (doppler > 1.0) {
          dCol = mix(dCol, dCol * vec3(0.8, 0.88, 1.25), min((doppler-1.0)*0.25, 0.4));
        } else {
          dCol = mix(dCol, dCol * vec3(1.3, 0.8, 0.6), min((1.0-doppler)*0.3, 0.5));
        }

        float alpha = smoothstep(DISK_OUTER, DISK_OUTER-2.0, cR) *
                      smoothstep(DISK_INNER*0.8, DISK_INNER+0.4, cR) * 0.93;

        color += dCol * alpha * (1.0 - diskAlpha);
        diskAlpha += alpha * (1.0 - diskAlpha);
      }
    }

    prevY = newY;
    pos = newPos;
  }

  // Background
  if (!hitHorizon) {
    color += starField(normalize(vel)) * (1.0 - diskAlpha);
  }

  // Photon ring glow (multi-layer, asymmetric)
  float centerDist = length(uv);
  float bhAng = R_HORIZON * 2.6 / uCamDist;
  float asym = 1.0 + 0.35 * (-uv.x / (centerDist + 0.001));

  float ring1 = exp(-pow((centerDist - bhAng) * uCamDist * 1.3, 2.0) * 2.0);
  float ring2 = exp(-pow((centerDist - bhAng * 1.15) * uCamDist * 2.0, 2.0) * 4.0);
  color += vec3(1.0, 0.72, 0.3) * ring1 * 0.05 * asym;
  color += vec3(1.0, 0.85, 0.5) * ring2 * 0.03 * asym;

  // Photon sphere glow
  float sphereGlow = exp(-pow((centerDist - bhAng*1.5) * uCamDist*0.5, 2.0) * 0.3);
  color += vec3(0.15, 0.08, 0.02) * sphereGlow * 0.04;

  // Proximity bloom
  if (closestR < 4.0 && !hitHorizon) {
    color += vec3(1.0, 0.6, 0.2) * exp(-(closestR - R_HORIZON)*0.8) * 0.015;
  }

  if (hitHorizon) color = vec3(0.0);

  // Vignette
  color *= 1.0 - 0.2 * dot(uv, uv);

  // ACES tone mapping
  color = color * (2.51 * color + 0.03) / (color * (2.43 * color + 0.59) + 0.14);
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
    this.pinchStartDist = 0;
    this.pinchStartCamDist = 25;

    this.init();
    this.setupControls();
  }

  init() {
    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: false,
      alpha: false,
      powerPreference: 'high-performance',
    });
    // Full native resolution — no downscaling
    this.renderer.setPixelRatio(window.devicePixelRatio);
    this.renderer.setSize(window.innerWidth, window.innerHeight);

    this.scene = new THREE.Scene();
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

    const geometry = new THREE.PlaneGeometry(2, 2);
    this.uniforms = {
      uResolution: { value: new THREE.Vector2(
        window.innerWidth * window.devicePixelRatio,
        window.innerHeight * window.devicePixelRatio
      )},
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
    const c = this.canvas;

    // --- Mouse orbit ---
    c.addEventListener('mousedown', (e) => {
      this.isDragging = true;
      this.lastMouse.x = e.clientX;
      this.lastMouse.y = e.clientY;
      this.autoRotate = false;
      c.style.cursor = 'grabbing';
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
      c.style.cursor = 'grab';
    });
    c.style.cursor = 'grab';

    // --- Touch: 1-finger orbit + 2-finger pinch zoom ---
    c.addEventListener('touchstart', (e) => {
      if (e.touches.length === 1) {
        this.isDragging = true;
        this.lastMouse.x = e.touches[0].clientX;
        this.lastMouse.y = e.touches[0].clientY;
        this.autoRotate = false;
      } else if (e.touches.length === 2) {
        this.isDragging = false;
        const dx = e.touches[0].clientX - e.touches[1].clientX;
        const dy = e.touches[0].clientY - e.touches[1].clientY;
        this.pinchStartDist = Math.sqrt(dx*dx + dy*dy);
        this.pinchStartCamDist = this.camDist;
      }
    }, { passive: true });

    c.addEventListener('touchmove', (e) => {
      if (e.touches.length === 1 && this.isDragging) {
        const dx = e.touches[0].clientX - this.lastMouse.x;
        const dy = e.touches[0].clientY - this.lastMouse.y;
        this.targetPhi -= dx * 0.005;
        this.targetTheta += dy * 0.005;
        this.targetTheta = Math.max(0.15, Math.min(Math.PI - 0.15, this.targetTheta));
        this.lastMouse.x = e.touches[0].clientX;
        this.lastMouse.y = e.touches[0].clientY;
      } else if (e.touches.length === 2) {
        const dx = e.touches[0].clientX - e.touches[1].clientX;
        const dy = e.touches[0].clientY - e.touches[1].clientY;
        const dist = Math.sqrt(dx*dx + dy*dy);
        this.camDist = Math.max(5, Math.min(60, this.pinchStartCamDist * (this.pinchStartDist / Math.max(dist, 1))));
      }
    }, { passive: true });

    c.addEventListener('touchend', () => { this.isDragging = false; });

    // --- Mouse wheel zoom ---
    c.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.camDist += e.deltaY * 0.01;
      this.camDist = Math.max(5, Math.min(60, this.camDist));
    }, { passive: false });
  }

  onResize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h);
    this.uniforms.uResolution.value.set(w * window.devicePixelRatio, h * window.devicePixelRatio);
  }

  update(time) {
    if (this.autoRotate) this.targetPhi += 0.0008;

    this.currentTheta += (this.targetTheta - this.currentTheta) * 0.05;
    this.currentPhi += (this.targetPhi - this.currentPhi) * 0.05;

    this.uniforms.uTime.value = time;
    this.uniforms.uCamDist.value = this.camDist;
    this.uniforms.uCamTheta.value = this.currentTheta;
    this.uniforms.uCamPhi.value = this.currentPhi;

    this.renderer.render(this.scene, this.camera);
  }

  dispose() { this.renderer.dispose(); }
}
