// ============================================
// BLACK HOLE — Interstellar-style 3D Simulation
// Ray-tracing in Schwarzschild spacetime
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
#define MAX_STEPS 200
#define DISK_INNER 3.0
#define DISK_OUTER 12.0
#define RS 1.0

// Pseudo-random
float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

// Star field
vec3 starField(vec3 rd) {
  vec3 col = vec3(0.0);
  // Two layers of stars
  for(int i = 0; i < 2; i++) {
    float scale = 200.0 + float(i) * 300.0;
    vec3 q = rd * scale;
    vec3 id = floor(q);
    vec3 f = fract(q) - 0.5;
    float h = hash(id.xy + id.z * 113.0 + float(i) * 47.0);
    if(h > 0.97) {
      vec3 offset = vec3(hash(id.yz) - 0.5, hash(id.zx) - 0.5, hash(id.xy + 7.0) - 0.5) * 0.4;
      float d = length(f - offset);
      float brightness = smoothstep(0.08, 0.0, d) * (0.5 + 0.5 * hash(id.xy + 99.0));
      float temp = hash(id.xz + 33.0);
      vec3 starColor = mix(vec3(0.8, 0.85, 1.0), vec3(1.0, 0.95, 0.8), temp);
      starColor = mix(starColor, vec3(1.0, 0.7, 0.5), step(0.9, temp));
      col += starColor * brightness;
    }
  }
  // Subtle nebula glow
  float n1 = hash(floor(rd.xy * 5.0 + rd.z * 3.0));
  float n2 = hash(floor(rd.yz * 4.0 + rd.x * 2.0));
  col += vec3(0.05, 0.02, 0.08) * n1 * 0.3;
  col += vec3(0.02, 0.04, 0.07) * n2 * 0.2;
  return col;
}

// Disk color based on radius (blackbody-like temperature gradient)
vec3 diskColor(float r, float angle, float time) {
  float t = smoothstep(DISK_OUTER, DISK_INNER, r); // 0 at outer, 1 at inner

  // Temperature gradient: hot inner (white-blue) to cool outer (red-orange)
  vec3 hot = vec3(1.0, 0.95, 0.9);
  vec3 warm = vec3(1.0, 0.6, 0.2);
  vec3 cool = vec3(0.8, 0.2, 0.05);
  vec3 col = mix(cool, warm, smoothstep(0.0, 0.5, t));
  col = mix(col, hot, smoothstep(0.5, 1.0, t));

  // Brightness increases toward inner edge
  float brightness = 0.3 + 0.7 * pow(t, 0.5);

  // Swirl pattern
  float swirl = sin(angle * 6.0 - r * 2.0 + time * 0.3) * 0.15 + 0.85;
  float swirl2 = sin(angle * 3.0 + r * 1.5 - time * 0.2) * 0.1 + 0.9;
  brightness *= swirl * swirl2;

  // Turbulence
  float turb = hash(vec2(angle * 10.0, r * 5.0 + time * 0.1)) * 0.15 + 0.85;
  brightness *= turb;

  return col * brightness * 1.5;
}

void main() {
  vec2 uv = (gl_FragCoord.xy - 0.5 * uResolution) / uResolution.y;

  // Camera position in spherical coords
  float camR = uCamDist;
  float camTheta = uCamTheta;
  float camPhi = uCamPhi;

  vec3 camPos = vec3(
    camR * sin(camTheta) * cos(camPhi),
    camR * cos(camTheta),
    camR * sin(camTheta) * sin(camPhi)
  );

  // Camera basis vectors
  vec3 forward = normalize(-camPos);
  vec3 right = normalize(cross(forward, vec3(0.0, 1.0, 0.0)));
  vec3 up = cross(right, forward);

  // Ray direction
  float fov = 1.0;
  vec3 rd = normalize(forward * fov + right * uv.x + up * uv.y);

  // ---- Ray tracing in Schwarzschild spacetime ----
  // Using the gravitational acceleration for photons:
  // a = -1.5 * h^2 / r^5 * pos
  // where h = |pos x vel| is the specific angular momentum

  vec3 pos = camPos;
  vec3 vel = rd; // normalized direction (speed of light = 1)

  vec3 color = vec3(0.0);
  float diskAlpha = 0.0;
  bool hitHorizon = false;
  float prevY = pos.y;

  // Adaptive step size
  float dt = 0.08;

  for(int i = 0; i < MAX_STEPS; i++) {
    float r = length(pos);

    // Check event horizon
    if(r < RS * 0.5) {
      hitHorizon = true;
      break;
    }

    // Escape condition
    if(r > 50.0) {
      break;
    }

    // Adaptive step: smaller steps near the BH
    dt = 0.02 + 0.15 * smoothstep(2.0, 20.0, r);

    // Gravitational acceleration (GR photon geodesic in Schwarzschild)
    vec3 h = cross(pos, vel);
    float h2 = dot(h, h);
    vec3 acc = -1.5 * h2 / (r * r * r * r * r) * pos;

    // Leapfrog integration (symplectic, conserves energy better)
    vec3 vel_half = vel + acc * dt * 0.5;
    vec3 newPos = pos + vel_half * dt;

    float newR = length(newPos);
    vec3 newH = cross(newPos, vel_half);
    float newH2 = dot(newH, newH);
    vec3 newAcc = -1.5 * newH2 / (newR * newR * newR * newR * newR) * newPos;
    vel = vel_half + newAcc * dt * 0.5;
    vel = normalize(vel); // keep speed = c = 1

    // Check disk crossing (y=0 plane)
    float newY = newPos.y;
    if(prevY * newY < 0.0 && diskAlpha < 0.95) {
      // Interpolate crossing point
      float frac = prevY / (prevY - newY);
      vec3 crossPos = mix(pos, newPos, frac);
      float crossR = length(crossPos);

      if(crossR > DISK_INNER && crossR < DISK_OUTER) {
        float angle = atan(crossPos.z, crossPos.x);

        // Doppler beaming: approaching side brighter
        vec3 diskVel = normalize(cross(vec3(0.0, 1.0, 0.0), normalize(crossPos)));
        float doppler = 1.0 + 0.3 * dot(normalize(vel), diskVel);
        doppler = clamp(doppler, 0.5, 2.0);

        // Gravitational redshift
        float redshift = sqrt(1.0 - RS / crossR);

        vec3 dCol = diskColor(crossR, angle, uTime) * doppler * redshift;
        float alpha = smoothstep(DISK_OUTER, DISK_OUTER - 1.0, crossR) *
                      smoothstep(DISK_INNER - 0.5, DISK_INNER + 0.5, crossR);
        alpha *= 0.9;

        // Composite (front-to-back)
        color += dCol * alpha * (1.0 - diskAlpha);
        diskAlpha += alpha * (1.0 - diskAlpha);
      }
    }

    prevY = newY;
    pos = newPos;
  }

  // Background stars for escaped rays
  if(!hitHorizon) {
    vec3 bg = starField(normalize(vel));
    color += bg * (1.0 - diskAlpha);
  }

  // Subtle glow around the black hole (photon ring)
  float centerDist = length(uv);
  float bhAngularSize = RS * 2.6 / uCamDist;
  float ringGlow = exp(-pow((centerDist - bhAngularSize) * uCamDist * 1.5, 2.0) * 2.0);
  color += vec3(1.0, 0.7, 0.3) * ringGlow * 0.08;

  // Vignette
  float vignette = 1.0 - 0.3 * dot(uv, uv);
  color *= vignette;

  // Tone mapping (ACES approximation)
  color = color * (2.51 * color + 0.03) / (color * (2.43 * color + 0.59) + 0.14);

  // Gamma
  color = pow(color, vec3(1.0 / 2.2));

  gl_FragColor = vec4(color, 1.0);
}
`;

// ---------- Renderer Class ----------

export class BlackHoleRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.mouse = { x: 0, y: 0 };
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
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);

    this.scene = new THREE.Scene();
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

    // Full-screen quad
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
    // Mouse drag for orbit
    this.canvas.addEventListener('mousedown', (e) => {
      this.isDragging = true;
      this.lastMouse.x = e.clientX;
      this.lastMouse.y = e.clientY;
      this.autoRotate = false;
    });

    window.addEventListener('mousemove', (e) => {
      if (!this.isDragging) return;
      const dx = e.clientX - this.lastMouse.x;
      const dy = e.clientY - this.lastMouse.y;
      this.targetPhi -= dx * 0.005;
      this.targetTheta += dy * 0.005;
      this.targetTheta = Math.max(0.1, Math.min(Math.PI - 0.1, this.targetTheta));
      this.lastMouse.x = e.clientX;
      this.lastMouse.y = e.clientY;
    });

    window.addEventListener('mouseup', () => {
      this.isDragging = false;
    });

    // Touch support
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
      this.targetTheta = Math.max(0.1, Math.min(Math.PI - 0.1, this.targetTheta));
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
      this.camDist = Math.max(6, Math.min(60, this.camDist));
    }, { passive: false });
  }

  onResize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setSize(w, h);
    this.uniforms.uResolution.value.set(w, h);
  }

  update(time) {
    // Auto-rotate when not dragging
    if (this.autoRotate) {
      this.targetPhi += 0.001;
    }

    // Smooth interpolation
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
