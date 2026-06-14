// ============================================
// BLACK HOLE — Kerr Supermassive Simulation
// TON 618 — 66 billion M☉
// Physically accurate ray-tracing with:
//   - Kerr metric geodesics
//   - Gravitational lensing (Einstein ring)
//   - Doppler beaming & gravitational redshift
//   - Frame dragging
//   - Auto-adaptive GPU quality via performance.js
// ============================================

import * as THREE from 'three';

// ---------- GLSL ----------

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

uniform vec2  uResolution;
uniform float uTime;
uniform float uCamDist;
uniform float uCamTheta;
uniform float uCamPhi;
uniform float uMaxSteps;

#define PI       3.14159265359
#define M        1.0
#define SPIN     0.97
#define R_HORIZON (M + sqrt(M * M - SPIN * SPIN))
#define DISK_INNER 1.55
#define DISK_OUTER 18.0

// ==================== Noise ====================
float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}
float hash3(vec3 p) {
  return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453);
}
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x),
             mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
}
float fbm(vec2 p) {
  float v = 0.0, a = 0.5;
  for (int i = 0; i < 4; i++) {
    v += a * noise(p);
    p = p * 2.0 + 100.0;
    a *= 0.5;
  }
  return v;
}

// ==================== Star Field ====================
vec3 starField(vec3 rd) {
  vec3 col = vec3(0.0);
  for (int layer = 0; layer < 3; layer++) {
    float scale = 120.0 + float(layer) * 200.0;
    vec3 q = rd * scale;
    vec3 id = floor(q);
    vec3 f = fract(q) - 0.5;
    float h = hash3(id + float(layer) * 47.0);
    if (h > 0.965) {
      vec3 off = vec3(hash3(id + 11.0), hash3(id + 23.0), hash3(id + 37.0)) * 0.4 - 0.2;
      float d = length(f - off);
      float br = smoothstep(0.07, 0.0, d) * (0.4 + 0.6 * hash3(id + 99.0));
      float temp = hash3(id + 55.0);
      vec3 sCol = mix(vec3(0.7, 0.85, 1.0), vec3(1.0, 0.9, 0.7), temp);
      sCol = mix(sCol, vec3(1.0, 0.5, 0.3), step(0.93, temp));
      sCol = mix(sCol, vec3(0.5, 0.7, 1.0), step(0.97, temp));
      br *= 0.8 + 0.2 * sin(hash3(id + 77.0) * 80.0 + uTime * 0.3);
      col += sCol * br;
    }
  }
  // Nebula / galactic band
  float band = exp(-6.0 * pow(abs(rd.y - 0.05), 2.0));
  float n1 = fbm(rd.xz * 3.0 + rd.y * 2.0);
  float n2 = fbm(rd.xz * 5.0 - vec2(uTime * 0.003));
  col += vec3(0.06, 0.02, 0.1) * band * n1 * 1.2;
  col += vec3(0.02, 0.05, 0.08) * band * n2 * 0.6;
  return col;
}

// ==================== Accretion Disk ====================
vec3 diskColor(float r, float angle, float t) {
  float temp = smoothstep(DISK_OUTER, DISK_INNER, r);

  vec3 cold  = vec3(0.5, 0.08, 0.02);
  vec3 warm  = vec3(0.95, 0.4, 0.08);
  vec3 mid   = vec3(1.0, 0.65, 0.22);
  vec3 hot   = vec3(1.0, 0.85, 0.55);
  vec3 ultra = vec3(0.8, 0.88, 1.0);

  vec3 col = mix(cold, warm, smoothstep(0.0, 0.25, temp));
  col = mix(col, mid,  smoothstep(0.25, 0.45, temp));
  col = mix(col, hot,  smoothstep(0.45, 0.7,  temp));
  col = mix(col, ultra, smoothstep(0.7, 1.0,  temp));

  float brightness = 0.15 + 0.85 * pow(temp, 0.35);

  // Spiral arms
  float logR = log(r + 1.0);
  float sp1 = sin(angle * 3.0 - logR * 5.0 + t * 0.6) * 0.5 + 0.5;
  float sp2 = sin(angle * 5.0 + logR * 4.0 - t * 0.45) * 0.5 + 0.5;
  float sp3 = sin(angle * 7.0 - logR * 8.0 + t * 0.9) * 0.5 + 0.5;
  brightness *= 0.55 + 0.45 * (sp1 * 0.5 + sp2 * 0.35 + sp3 * 0.15);

  // Turbulence
  float tb1 = noise(vec2(angle * 10.0, r * 4.0 + t * 0.04));
  float tb2 = noise(vec2(angle * 25.0, r * 10.0 - t * 0.08));
  brightness *= 0.7 + 0.2 * tb1 + 0.1 * tb2;

  // Hot ISCO ring
  col += vec3(0.35, 0.6, 1.0) * exp(-pow((r - DISK_INNER) * 2.5, 2.0)) * 0.6;

  float innerFade = smoothstep(DISK_INNER - 0.1, DISK_INNER + 0.4, r);
  float outerFade = smoothstep(DISK_OUTER, DISK_OUTER - 3.0, r);

  return col * brightness * innerFade * outerFade * 2.2;
}

// ==================== Main ====================
void main() {
  vec2 uv = (gl_FragCoord.xy - 0.5 * uResolution) / uResolution.y;

  // ---- Camera ----
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
  vec3 up    = cross(right, forward);

  vec3 rd = normalize(forward + right * uv.x + up * uv.y);

  // ---- Ray Tracing (Kerr geodesic) ----
  vec3  pos  = camPos;
  vec3  vel  = rd;
  float a    = SPIN;
  vec3  spinAxis = vec3(0.0, 1.0, 0.0);

  vec3  color     = vec3(0.0);
  float diskAlpha = 0.0;
  bool  hitHorizon = false;
  float prevY     = pos.y;
  float closestR  = 100.0;

  for (int i = 0; i < 350; i++) {
    if (float(i) >= uMaxSteps) break;

    // Boyer-Lindquist r (Kerr)
    float r2_xy  = dot(pos.xz, pos.xz);
    float r2_bls = r2_xy + pos.y * pos.y - a * a;
    float r = sqrt(0.5 * (r2_bls + sqrt(r2_bls * r2_bls + 4.0 * a * a * pos.y * pos.y)));

    closestR = min(closestR, r);

    // — Event horizon capture —
    if (r < R_HORIZON) {
      hitHorizon = true;
      break;
    }
    // — Escape to infinity —
    if (r > 50.0) break;

    // — Adaptive step size —
    // Tiny near BH (proper gravitational bending), large far away (speed)
    // After periapsis (ray moving outward), use larger steps to save budget
    float radVelStep = dot(normalize(pos), vel);
    float dt;
    if (r < 3.0) {
      // Критическая зона линзирования — мелкий шаг для изгиба лучей
      dt = max(0.008, (r - R_HORIZON) * 0.025 + 0.008);
      // После прохождения ближайшей точки (луч уходит наружу) — крупнее шаг
      if (radVelStep > 0.0 && r > closestR + 0.05) {
        dt = max(dt, r * 0.035);
      }
    } else if (r < 8.0) {
      dt = r * 0.04;
    } else {
      dt = min(1.2, r * 0.1);
    }

    // — Gravitational acceleration —
    // Schwarzschild null-geodesic: a = -1.5 L²/r⁵ · pos
    vec3  h  = cross(pos, vel);
    float h2 = dot(h, h);
    float r5 = r * r * r * r * r;
    vec3  acc = -1.5 * h2 / r5 * pos;

    // Kerr frame-dragging
    float cosTheta2 = pos.y * pos.y / max(r * r, 1e-4);
    float Sigma = r * r + a * a * cosTheta2;
    float drag  = 2.0 * a * M / (Sigma * r + 0.01);
    acc += drag * cross(spinAxis, vel);

    // — Leapfrog integrator —
    vec3 vel_half = vel + acc * dt * 0.5;
    vec3 newPos   = pos + vel_half * dt;

    // Recompute accel at new position
    float nr2_xy  = dot(newPos.xz, newPos.xz);
    float nr2_bls = nr2_xy + newPos.y * newPos.y - a * a;
    float nr = sqrt(0.5 * (nr2_bls + sqrt(nr2_bls * nr2_bls + 4.0 * a * a * newPos.y * newPos.y)));
    vec3  nh  = cross(newPos, vel_half);
    float nh2 = dot(nh, nh);
    float nr5 = nr * nr * nr * nr * nr;
    vec3  nAcc = -1.5 * nh2 / nr5 * newPos;
    float nCosTheta2 = newPos.y * newPos.y / max(nr * nr, 1e-4);
    float nSigma = nr * nr + a * a * nCosTheta2;
    nAcc += (2.0 * a * M / (nSigma * nr + 0.01)) * cross(spinAxis, vel_half);

    vel = normalize(vel_half + nAcc * dt * 0.5);

    // — Disk crossing (y sign change) —
    float newY = newPos.y;

    if (prevY * newY < 0.0 && diskAlpha < 0.95) {
      float frac = abs(prevY) / (abs(prevY) + abs(newY) + 1e-5);
      vec3  crossPos = mix(pos, newPos, frac);
      float cR = length(crossPos.xz);

      if (cR > DISK_INNER * 0.85 && cR < DISK_OUTER) {
        float angle = atan(crossPos.z, crossPos.x);

        // Doppler beaming
        float v_orb  = sqrt(M / max(cR, 0.5));
        vec3  diskVel = normalize(vec3(-crossPos.z, 0.0, crossPos.x)) * v_orb;
        float doppler = 1.0 / max(1.0 - dot(normalize(vel), diskVel), 0.15);
        doppler = clamp(doppler, 0.25, 5.0);
        float dopplerI = pow(doppler, 3.0);

        // Gravitational redshift
        float gRedshift = sqrt(max(0.0, 1.0 - 2.0 * M / (cR + 1e-4)));

        vec3 dCol = diskColor(cR, angle, uTime) * dopplerI * gRedshift;

        // Blue/red shift coloring
        if (doppler > 1.0) {
          dCol = mix(dCol, dCol * vec3(0.8, 0.88, 1.3), min((doppler - 1.0) * 0.25, 0.4));
        } else {
          dCol = mix(dCol, dCol * vec3(1.3, 0.75, 0.5), min((1.0 - doppler) * 0.3, 0.5));
        }

        float alpha = smoothstep(DISK_OUTER, DISK_OUTER - 2.5, cR)
                    * smoothstep(DISK_INNER * 0.8, DISK_INNER + 0.4, cR) * 0.92;
        color     += dCol * alpha * (1.0 - diskAlpha);
        diskAlpha += alpha * (1.0 - diskAlpha);
      }
    }

    // Volumetric disk glow — thick near inner edge for visible 3D volume
    float absY  = abs(newPos.y);
    float diskR = length(newPos.xz);
    if (absY < 2.0 && diskR > DISK_INNER * 0.85 && diskR < DISK_OUTER && diskAlpha < 0.95) {
      // Disk is thickest at inner edge (hot, turbulent) → thins out at outer
      float thickness = mix(1.2, 0.25, smoothstep(DISK_INNER, DISK_OUTER * 0.5, diskR));
      float vol = exp(-absY * absY / (thickness * thickness + 0.001)) * 0.05;
      float dAng = atan(newPos.z, newPos.x);
      vec3  vCol = diskColor(diskR, dAng, uTime) * 0.5;
      color     += vCol * vol * (1.0 - diskAlpha);
      diskAlpha += vol * 0.2 * (1.0 - diskAlpha);
    }

    // Hot corona — glowing gas near photon sphere
    if (r < 4.5 && r > R_HORIZON + 0.05 && diskAlpha < 0.95) {
      float coronaDist = r - R_HORIZON;
      float coronaGlow = exp(-coronaDist * 1.5) * 0.012;
      vec3 coronaCol = mix(vec3(1.0, 0.55, 0.15), vec3(0.6, 0.75, 1.0), exp(-coronaDist * 3.0));
      color += coronaCol * coronaGlow * (1.0 - diskAlpha);
    }

    prevY = newY;
    pos   = newPos;
  }

  // ---- Захват лучей ----
  // Луч не вылетел за r=50: проверяем, захвачен ли он или просто не хватило шагов
  {
    float fr2_xy  = dot(pos.xz, pos.xz);
    float fr2_bls = fr2_xy + pos.y * pos.y - a * a;
    float finalR  = sqrt(0.5 * (fr2_bls + sqrt(fr2_bls * fr2_bls + 4.0 * a * a * pos.y * pos.y)));
    if (!hitHorizon && finalR < 50.0) {
      float radVel = dot(normalize(pos), vel);
      // Если луч далеко от ЧД и летит наружу — он просто не успел выйти за 50,
      // но уже на траектории побега. Не захватываем.
      if (finalR > 8.0 && radVel > 0.05) {
        // Ушедший луч — используем текущее vel для звёзд/фона
      } else {
        hitHorizon = true;
        color = vec3(0.0);
        diskAlpha = 1.0;
      }
    }
  }

  // ---- Background stars (gravitationally lensed direction) ----
  if (!hitHorizon) {
    vec3 stars = starField(normalize(vel));

    // Гравитационное усиление: звёзды у края тени ярче (фокусировка)
    float rimDist = closestR - R_HORIZON;
    if (rimDist < 5.0) {
      float magnification = 1.0 + 0.6 * exp(-rimDist * 0.5);
      stars *= magnification;
    }

    color += stars * (1.0 - diskAlpha);
  }

  // ---- Фотонное кольцо + глубина тени ----
  // Свет, облетевший ЧД 1-2-3 раза, формирует тонкие кольца.
  // Широкая мягкая пенумбра с угловой вариацией создаёт объём —
  // тень выглядит как силуэт СФЕРЫ, а не плоский кружок.
  if (!hitHorizon) {
    float rimDist = closestR - R_HORIZON;

    // --- Широкая мягкая пенумбра (объёмность тени) ---
    // Тёплый тусклый свет, растекающийся от края тени.
    // Угловая вариация ломает равномерный круг → ощущение 3D сферы.
    float uvAng = atan(uv.y, uv.x);
    float angVar = 0.6 + 0.4 * sin(uvAng * 2.0 + 0.5);
    float softGlow = exp(-rimDist * 1.5) * 0.12 * angVar;
    vec3 softColor = vec3(0.5, 0.28, 0.08);
    color += softColor * softGlow * (1.0 - diskAlpha * 0.5);

    // --- Фотонные кольца ---
    // Первичное (1 оборот) — модулировано углом для 3D-вида
    float ring1 = exp(-rimDist * 4.5) * 0.40 * (0.75 + 0.25 * angVar);
    // Вторичное (2 оборота — тоньше)
    float ring2 = exp(-rimDist * 9.0) * 0.20 * (0.85 + 0.15 * angVar);
    // Третичное (каустика у самого края)
    float ring3 = exp(-rimDist * 16.0) * 0.12;

    vec3 ringColor = mix(
      vec3(1.0, 0.78, 0.4),
      vec3(0.85, 0.88, 1.0),
      smoothstep(0.0, 0.5, ring3 / max(ring1 + 0.01, 0.01))
    );

    float totalRing = ring1 + ring2 + ring3;
    color += ringColor * totalRing * (1.0 - diskAlpha * 0.3);

    // Каустика у самого края
    float caustic = exp(-pow(rimDist * 8.0, 2.0)) * 0.05;
    color += vec3(1.0, 0.92, 0.75) * caustic;
  }

  // ---- Линзированный диск (physics-based wrapping) ----
  // Лучи, прошедшие близко к ЧД, видят заднюю сторону диска
  // через гравитационное линзирование — «обволакивание» как в Интерстелларе.
  // Используем closestR (реальная физика луча), а не экранные координаты.
  if (!hitHorizon && closestR < 6.0 && diskAlpha < 0.9) {
    // Сила изгиба: чем ближе к ЧД, тем сильнее обволакивание
    float bendStrength = exp(-(closestR - R_HORIZON) * 1.2);

    // Вертикальная видимость: обволакивание видно сверху/снизу тени,
    // по бокам — прямой диск виден напрямую
    float uvAngle = atan(uv.y, uv.x);
    float vertFactor = abs(sin(uvAngle));
    // Также добавим слабое обволакивание по бокам (диск закручивается)
    vertFactor = 0.15 + 0.85 * vertFactor;

    // При боковом ракурсе (edge-on) обволакивание сильнее
    float edgeness = sin(uCamTheta);
    float wrapVis = bendStrength * vertFactor * smoothstep(0.1, 0.4, edgeness) * 0.65;

    if (wrapVis > 0.005) {
      // Позиция на задней стороне диска: ближние лучи видят внутренний диск
      float dR = mix(DISK_INNER + 0.5, DISK_OUTER * 0.45,
                    clamp((closestR - R_HORIZON) / 2.5, 0.0, 1.0));

      // Угол: используем ОТКЛОНЁННОЕ направление луча (vel) — вращается с диском
      float dA = atan(vel.z, vel.x) + PI;

      vec3 lCol = diskColor(dR, dA, uTime);

      // Доплеровская асимметрия приближающейся/удаляющейся стороны
      float dopplerHint = 1.0 + 0.3 * cos(dA - uCamPhi);
      lCol *= dopplerHint;

      // Гравитационное красное смещение
      float grs = sqrt(max(0.0, 1.0 - 2.0 * M / (dR + 0.01)));

      color += lCol * wrapVis * grs * (1.0 - diskAlpha * 0.4);
    }
  }

  // ---- Горизонт событий → абсолютная чернота ----
  if (hitHorizon) {
    color = vec3(0.0);
  }

  // Subtle vignette
  color *= 1.0 - 0.15 * dot(uv, uv);

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
    this.targetTheta  = Math.PI * 0.47;  // near edge-on (~85° from pole)
    this.targetPhi    = 0;
    this.currentTheta = Math.PI * 0.47;
    this.currentPhi   = 0;
    this.camDist      = 22;
    this.isDragging   = false;
    this.lastMouse    = { x: 0, y: 0 };
    this.autoRotate   = true;
    this.heroElement  = null;

    this.init();
    this.setupControls();
  }

  // ---------- Init ----------
  init() {
    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: false,
      alpha: false,
      powerPreference: 'high-performance',
    });

    this.scene  = new THREE.Scene();
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

    this.uniforms = {
      uResolution: { value: new THREE.Vector2(window.innerWidth, window.innerHeight) },
      uTime:       { value: 0 },
      uCamDist:    { value: this.camDist },
      uCamTheta:   { value: this.currentTheta },
      uCamPhi:     { value: this.currentPhi },
      uMaxSteps:   { value: 150 },
    };

    const material = new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader,
      uniforms: this.uniforms,
    });

    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material);
    this.scene.add(this.quad);

    window.addEventListener('resize', () => this.onResize());
  }

  // ---------- Controls ----------
  isHeroVisible() {
    if (!this.heroElement) this.heroElement = document.getElementById('hero');
    return this.heroElement ? window.scrollY < this.heroElement.offsetHeight * 0.8 : true;
  }

  setupControls() {
    const c = this.canvas;

    // Mouse drag → orbit
    c.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return;
      this.isDragging = true;
      this.lastMouse.x = e.clientX;
      this.lastMouse.y = e.clientY;
      this.autoRotate = false;
      c.style.cursor = 'grabbing';
    });
    window.addEventListener('mousemove', (e) => {
      if (!this.isDragging) return;
      this.targetPhi   += (e.clientX - this.lastMouse.x) * 0.005;
      this.targetTheta -= (e.clientY - this.lastMouse.y) * 0.005;
      this.targetTheta  = Math.max(0.15, Math.min(Math.PI - 0.15, this.targetTheta));
      this.lastMouse.x  = e.clientX;
      this.lastMouse.y  = e.clientY;
    });
    window.addEventListener('mouseup', () => {
      this.isDragging = false;
      c.style.cursor = 'grab';
    });
    c.style.cursor = 'grab';

    // Wheel zoom disabled — scroll navigates the page normally
    // Zoom only via pinch-to-zoom on touch devices

    // Touch controls
    let touchDecided = false, touchIsOrbit = false;
    this.pinchStartDist = 0;
    this.pinchStartCamDist = this.camDist;

    c.addEventListener('touchstart', (e) => {
      if (e.touches.length === 1) {
        this.lastMouse.x = e.touches[0].clientX;
        this.lastMouse.y = e.touches[0].clientY;
        touchDecided = false;
        touchIsOrbit = false;
      } else if (e.touches.length === 2) {
        e.preventDefault();
        touchDecided = true;
        touchIsOrbit = false;
        this.isDragging = false;
        const dx = e.touches[0].clientX - e.touches[1].clientX;
        const dy = e.touches[0].clientY - e.touches[1].clientY;
        this.pinchStartDist = Math.sqrt(dx * dx + dy * dy);
        this.pinchStartCamDist = this.camDist;
      }
    }, { passive: false });

    c.addEventListener('touchmove', (e) => {
      if (e.touches.length === 1) {
        const dx = e.touches[0].clientX - this.lastMouse.x;
        const dy = e.touches[0].clientY - this.lastMouse.y;
        if (!touchDecided && Math.abs(dx) + Math.abs(dy) > 10) {
          touchDecided = true;
          touchIsOrbit = Math.abs(dx) > Math.abs(dy) * 1.2;
          if (touchIsOrbit) { this.autoRotate = false; this.isDragging = true; }
        }
        if (touchIsOrbit) {
          e.preventDefault();
          this.targetPhi   += dx * 0.005;
          this.targetTheta -= dy * 0.005;
          this.targetTheta  = Math.max(0.15, Math.min(Math.PI - 0.15, this.targetTheta));
          this.lastMouse.x  = e.touches[0].clientX;
          this.lastMouse.y  = e.touches[0].clientY;
        }
      } else if (e.touches.length === 2) {
        e.preventDefault();
        const dx = e.touches[0].clientX - e.touches[1].clientX;
        const dy = e.touches[0].clientY - e.touches[1].clientY;
        const dist = Math.sqrt(dx * dx + dy * dy);
        this.camDist = Math.max(4, Math.min(60,
          this.pinchStartCamDist * (this.pinchStartDist / Math.max(dist, 1))
        ));
      }
    }, { passive: false });

    c.addEventListener('touchend', () => {
      this.isDragging = false;
      touchDecided = false;
      touchIsOrbit = false;
    });
  }

  // ---------- Resize ----------
  onResize() {
    const w = window.innerWidth, h = window.innerHeight;
    const dpr = this.renderer.getPixelRatio(); // сохраняем текущий DPR
    this.renderer.setSize(w, h);
    this.uniforms.uResolution.value.set(w * dpr, h * dpr);
  }

  // ---------- Frame ----------
  update(time) {
    if (this.autoRotate) this.targetPhi += 0.0008;

    this.currentTheta += (this.targetTheta - this.currentTheta) * 0.05;
    this.currentPhi   += (this.targetPhi   - this.currentPhi)   * 0.05;

    this.uniforms.uTime.value     = time;
    this.uniforms.uCamDist.value  = this.camDist;
    this.uniforms.uCamTheta.value = this.currentTheta;
    this.uniforms.uCamPhi.value   = this.currentPhi;

    this.renderer.render(this.scene, this.camera);
  }

  dispose() {
    this.renderer.dispose();
  }
}
