// ============================================
// BLACK HOLE — Object Creation & Physics
// Spawn planets, asteroids, photons that orbit
// and spiral into the Kerr black hole
// ============================================

import * as THREE from 'three';

const SPIN = 0.97;
const M = 1.0;
const R_HORIZON = M + Math.sqrt(M * M - SPIN * SPIN);
const ISCO = 1.55;

// Object types with visual properties
const OBJECT_TYPES = [
  {
    name: 'Rocky Planet',
    color: 0xcc8844,
    emissive: 0x331100,
    size: 0.35,
    glow: 0xffaa55,
    glowSize: 1.2,
    trailColor: new THREE.Color(0.8, 0.5, 0.2),
  },
  {
    name: 'Gas Giant',
    color: 0x4488cc,
    emissive: 0x112244,
    size: 0.55,
    glow: 0x66aaff,
    glowSize: 1.8,
    trailColor: new THREE.Color(0.3, 0.5, 0.9),
  },
  {
    name: 'Asteroid',
    color: 0x888888,
    emissive: 0x222222,
    size: 0.2,
    glow: 0xaaaaaa,
    glowSize: 0.8,
    trailColor: new THREE.Color(0.5, 0.5, 0.5),
  },
  {
    name: 'Star',
    color: 0xffffaa,
    emissive: 0xffdd44,
    size: 0.45,
    glow: 0xffee88,
    glowSize: 2.5,
    trailColor: new THREE.Color(1.0, 0.9, 0.4),
  },
  {
    name: 'Photon Burst',
    color: 0xffffff,
    emissive: 0xffffdd,
    size: 0.15,
    glow: 0xffffff,
    glowSize: 1.5,
    trailColor: new THREE.Color(1.0, 1.0, 0.8),
  },
];

// Create glow sprite texture
function createGlowTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');

  const gradient = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  gradient.addColorStop(0, 'rgba(255, 255, 255, 0.8)');
  gradient.addColorStop(0.2, 'rgba(255, 255, 255, 0.3)');
  gradient.addColorStop(0.5, 'rgba(255, 255, 255, 0.08)');
  gradient.addColorStop(1, 'rgba(255, 255, 255, 0)');

  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 128, 128);

  const texture = new THREE.CanvasTexture(canvas);
  return texture;
}

// Create trail texture
function createTrailTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 4;
  const ctx = canvas.getContext('2d');

  const gradient = ctx.createLinearGradient(0, 0, 64, 0);
  gradient.addColorStop(0, 'rgba(255, 255, 255, 0)');
  gradient.addColorStop(0.3, 'rgba(255, 255, 255, 0.4)');
  gradient.addColorStop(1, 'rgba(255, 255, 255, 0.8)');

  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 64, 4);

  return new THREE.CanvasTexture(canvas);
}

export class ParticleSystem {
  constructor(renderer) {
    this.bhRenderer = renderer;
    this.particles = [];
    this.maxParticles = 30;
    this.glowTexture = createGlowTexture();

    // Create a separate scene for 3D particles
    this.scene = new THREE.Scene();

    // Camera that will match the shader camera
    this.camera = new THREE.PerspectiveCamera(
      2 * Math.atan(0.5) * (180 / Math.PI), // ~53.13° to match shader
      window.innerWidth / window.innerHeight,
      0.1,
      200
    );

    // Shared geometry/materials
    this.sphereGeo = new THREE.IcosahedronGeometry(1, 2);

    window.addEventListener('resize', () => {
      this.camera.aspect = window.innerWidth / window.innerHeight;
      this.camera.updateProjectionMatrix();
    });
  }

  spawn(ndcX, ndcY) {
    // Remove oldest if at limit
    if (this.particles.length >= this.maxParticles) {
      this.removeParticle(this.particles[0]);
    }

    // Random type
    const type = OBJECT_TYPES[Math.floor(Math.random() * OBJECT_TYPES.length)];

    // Camera position (matching shader)
    const camR = this.bhRenderer.camDist;
    const theta = this.bhRenderer.currentTheta;
    const phi = this.bhRenderer.currentPhi;

    const camPos = new THREE.Vector3(
      camR * Math.sin(theta) * Math.cos(phi),
      camR * Math.cos(theta),
      camR * Math.sin(theta) * Math.sin(phi)
    );

    // Camera basis
    const forward = new THREE.Vector3().copy(camPos).negate().normalize();
    let worldUp = new THREE.Vector3(0, 1, 0);
    if (Math.abs(forward.dot(worldUp)) > 0.999) worldUp.set(0, 0, 1);
    const right = new THREE.Vector3().crossVectors(forward, worldUp).normalize();
    const up = new THREE.Vector3().crossVectors(right, forward);

    // Place object at a distance from the black hole
    // Map NDC to direction, then find position along that ray
    const fov = 1.0;
    const halfH = 0.5;
    const halfW = halfH * (window.innerWidth / window.innerHeight);

    const rayDir = new THREE.Vector3()
      .copy(forward).multiplyScalar(fov)
      .addScaledVector(right, ndcX * halfW)
      .addScaledVector(up, ndcY * halfH)
      .normalize();

    // Place at a reasonable distance that looks right
    const placeDist = 10 + Math.random() * 10;
    const pos = new THREE.Vector3().copy(rayDir).multiplyScalar(placeDist);

    // Initial velocity: tangential (for orbit) + slight inward
    const toCenter = pos.clone().negate().normalize();
    const tangent = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), toCenter).normalize();
    // Give orbital velocity
    const r = pos.length();
    const v_orb = Math.sqrt(M / r) * 0.8; // slightly sub-orbital for inward spiral
    const vel = tangent.multiplyScalar(v_orb).addScaledVector(toCenter, v_orb * 0.1);

    // Create visual objects
    const mesh = new THREE.Mesh(
      this.sphereGeo,
      new THREE.MeshBasicMaterial({
        color: type.color,
        transparent: true,
        opacity: 1.0,
      })
    );
    mesh.scale.setScalar(type.size);
    mesh.position.copy(pos);

    // Glow sprite
    const spriteMat = new THREE.SpriteMaterial({
      map: this.glowTexture,
      color: type.glow,
      transparent: true,
      opacity: 0.6,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const sprite = new THREE.Sprite(spriteMat);
    sprite.scale.setScalar(type.glowSize);
    mesh.add(sprite);

    // Trail (line of recent positions)
    const trailMax = 80;
    const trailPositions = new Float32Array(trailMax * 3);
    const trailColors = new Float32Array(trailMax * 4);
    const trailGeo = new THREE.BufferGeometry();
    trailGeo.setAttribute('position', new THREE.BufferAttribute(trailPositions, 3));
    trailGeo.setAttribute('color', new THREE.BufferAttribute(trailColors, 4));
    trailGeo.setDrawRange(0, 0);

    const trailMat = new THREE.LineBasicMaterial({
      vertexColors: true,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const trail = new THREE.Line(trailGeo, trailMat);

    this.scene.add(mesh);
    this.scene.add(trail);

    const particle = {
      type,
      mesh,
      sprite,
      trail,
      trailGeo,
      trailPositions,
      trailColors,
      trailMax,
      trailCount: 0,
      trailIndex: 0,
      pos: pos.clone(),
      vel: vel.clone(),
      alive: true,
      age: 0,
      absorbed: false,
      absorbTimer: 0,
    };

    this.particles.push(particle);
    return particle;
  }

  removeParticle(p) {
    this.scene.remove(p.mesh);
    this.scene.remove(p.trail);
    p.mesh.geometry = null;
    p.alive = false;
    const idx = this.particles.indexOf(p);
    if (idx >= 0) this.particles.splice(idx, 1);
  }

  update(dt) {
    // Update camera to match shader camera
    const camR = this.bhRenderer.camDist;
    const theta = this.bhRenderer.currentTheta;
    const phi = this.bhRenderer.currentPhi;

    this.camera.position.set(
      camR * Math.sin(theta) * Math.cos(phi),
      camR * Math.cos(theta),
      camR * Math.sin(theta) * Math.sin(phi)
    );
    this.camera.lookAt(0, 0, 0);
    this.camera.updateMatrixWorld();

    // Physics substeps
    const substeps = 4;
    const subDt = dt / substeps;

    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      if (!p.alive) continue;

      p.age += dt;

      // Remove if too old
      if (p.age > 60) {
        this.removeParticle(p);
        continue;
      }

      // Physics integration (substeps for stability)
      for (let s = 0; s < substeps; s++) {
        this.integrateKerr(p, subDt);
      }

      const r = p.pos.length();

      // Event horizon absorption
      if (r < R_HORIZON * 1.2) {
        if (!p.absorbed) {
          p.absorbed = true;
          p.absorbTimer = 0;
        }
        p.absorbTimer += dt;

        // Shrink and brighten before disappearing
        const t = p.absorbTimer / 0.5; // 0.5s absorption animation
        const scale = p.type.size * Math.max(0, 1 - t);
        p.mesh.scale.setScalar(scale);
        p.mesh.material.opacity = Math.max(0, 1 - t);
        p.sprite.material.opacity = Math.max(0, 0.6 * (1 - t * 0.5));
        p.sprite.scale.setScalar(p.type.glowSize * (1 + t * 2)); // glow expands

        if (t > 1) {
          this.removeParticle(p);
          continue;
        }
      }

      // Spaghettification effect (stretch toward center as it gets close)
      if (r < 5 && !p.absorbed) {
        const stretchFactor = 1 + (5 - r) * 0.3;
        const toCenter = p.pos.clone().normalize();
        p.mesh.scale.set(
          p.type.size / Math.sqrt(stretchFactor),
          p.type.size / Math.sqrt(stretchFactor),
          p.type.size * stretchFactor
        );
        p.mesh.lookAt(0, 0, 0);
      }

      // Update mesh position
      p.mesh.position.copy(p.pos);

      // Update trail
      this.updateTrail(p);
    }
  }

  integrateKerr(p, dt) {
    const pos = p.pos;
    const vel = p.vel;
    const a = SPIN;

    // Kerr oblate-spheroidal r
    const r2_xy = pos.x * pos.x + pos.z * pos.z;
    const r2_bls = r2_xy + pos.y * pos.y - a * a;
    const r = Math.sqrt(0.5 * (r2_bls + Math.sqrt(r2_bls * r2_bls + 4 * a * a * pos.y * pos.y)));

    if (r < R_HORIZON * 0.3) return; // deep inside, stop

    // Gravitational acceleration (Newtonian + GR corrections)
    const r3 = r * r * r;
    const r5 = r3 * r * r;

    // Specific angular momentum
    const hx = pos.y * vel.z - pos.z * vel.y;
    const hy = pos.z * vel.x - pos.x * vel.z;
    const hz = pos.x * vel.y - pos.y * vel.x;
    const h2 = hx * hx + hy * hy + hz * hz;

    // GR correction (pseudo-Newtonian Kerr)
    const grFactor = 1.5 * h2 / r5;

    // Newtonian gravity
    const newtonFactor = M / r3;

    // Total radial acceleration
    const accFactor = newtonFactor + grFactor;

    let ax = -accFactor * pos.x;
    let ay = -accFactor * pos.y;
    let az = -accFactor * pos.z;

    // Frame dragging
    const cosTheta2 = (pos.y * pos.y) / (r * r + 0.001);
    const Sigma = r * r + a * a * cosTheta2;
    const dragStrength = 2 * a * M / (Sigma * r + 0.001);

    // cross(spinAxis, vel) where spinAxis = (0,1,0)
    ax += dragStrength * (-vel.z);
    // ay += 0 (spin axis component)
    az += dragStrength * vel.x;

    // Leapfrog
    const vhx = vel.x + ax * dt * 0.5;
    const vhy = vel.y + ay * dt * 0.5;
    const vhz = vel.z + az * dt * 0.5;

    pos.x += vhx * dt;
    pos.y += vhy * dt;
    pos.z += vhz * dt;

    // Recompute at new position
    const nr2_xy = pos.x * pos.x + pos.z * pos.z;
    const nr2_bls = nr2_xy + pos.y * pos.y - a * a;
    const nr = Math.sqrt(0.5 * (nr2_bls + Math.sqrt(nr2_bls * nr2_bls + 4 * a * a * pos.y * pos.y)));
    const nr3 = nr * nr * nr;
    const nr5 = nr3 * nr * nr;

    const nhx = pos.y * vhz - pos.z * vhy;
    const nhy = pos.z * vhx - pos.x * vhz;
    const nhz = pos.x * vhy - pos.y * vhx;
    const nh2 = nhx * nhx + nhy * nhy + nhz * nhz;

    const nGrFactor = 1.5 * nh2 / nr5;
    const nNewtonFactor = M / nr3;
    const nAccFactor = nNewtonFactor + nGrFactor;

    let nax = -nAccFactor * pos.x;
    let nay = -nAccFactor * pos.y;
    let naz = -nAccFactor * pos.z;

    const nCosTheta2 = (pos.y * pos.y) / (nr * nr + 0.001);
    const nSigma = nr * nr + a * a * nCosTheta2;
    const nDrag = 2 * a * M / (nSigma * nr + 0.001);

    nax += nDrag * (-vhz);
    naz += nDrag * vhx;

    vel.x = vhx + nax * dt * 0.5;
    vel.y = vhy + nay * dt * 0.5;
    vel.z = vhz + naz * dt * 0.5;

    // Clamp velocity (prevent numerical explosion)
    const speed = Math.sqrt(vel.x * vel.x + vel.y * vel.y + vel.z * vel.z);
    if (speed > 2.0) {
      vel.x *= 2.0 / speed;
      vel.y *= 2.0 / speed;
      vel.z *= 2.0 / speed;
    }
  }

  updateTrail(p) {
    // Add current position to trail ring buffer
    const idx = p.trailIndex % p.trailMax;
    p.trailPositions[idx * 3] = p.pos.x;
    p.trailPositions[idx * 3 + 1] = p.pos.y;
    p.trailPositions[idx * 3 + 2] = p.pos.z;

    const tc = p.type.trailColor;
    const alpha = p.absorbed ? Math.max(0, 1 - p.absorbTimer * 2) : 0.6;
    p.trailColors[idx * 4] = tc.r;
    p.trailColors[idx * 4 + 1] = tc.g;
    p.trailColors[idx * 4 + 2] = tc.b;
    p.trailColors[idx * 4 + 3] = alpha;

    p.trailIndex++;
    p.trailCount = Math.min(p.trailCount + 1, p.trailMax);

    // Update older trail points to fade out
    for (let i = 0; i < p.trailCount; i++) {
      const age = p.trailIndex - i - 1;
      const ringIdx = (p.trailIndex - 1 - i + p.trailMax * 100) % p.trailMax;
      const fade = i / p.trailCount;
      p.trailColors[ringIdx * 4 + 3] = alpha * (1 - fade) * 0.5;
    }

    // Rebuild buffer for draw order (newest first)
    const positions = new Float32Array(p.trailCount * 3);
    const colors = new Float32Array(p.trailCount * 4);
    for (let i = 0; i < p.trailCount; i++) {
      const ringIdx = (p.trailIndex - 1 - i + p.trailMax * 100) % p.trailMax;
      positions[i * 3] = p.trailPositions[ringIdx * 3];
      positions[i * 3 + 1] = p.trailPositions[ringIdx * 3 + 1];
      positions[i * 3 + 2] = p.trailPositions[ringIdx * 3 + 2];
      const fade = 1 - i / p.trailCount;
      colors[i * 4] = p.type.trailColor.r;
      colors[i * 4 + 1] = p.type.trailColor.g;
      colors[i * 4 + 2] = p.type.trailColor.b;
      colors[i * 4 + 3] = fade * (p.absorbed ? Math.max(0, 1 - p.absorbTimer * 2) : 0.4);
    }

    p.trailGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    p.trailGeo.setAttribute('color', new THREE.BufferAttribute(colors, 4));
    p.trailGeo.setDrawRange(0, p.trailCount);
  }

  render(renderer) {
    if (this.particles.length === 0) return;
    renderer.autoClear = false;
    renderer.render(this.scene, this.camera);
    renderer.autoClear = true;
  }
}
