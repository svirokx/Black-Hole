// ============================================
// BLACK HOLE — Main Application
// Loader, scroll animations, creation mode,
// scale HUD, TON 618 supermassive simulation
// ============================================

import { BlackHoleRenderer } from './blackhole.js';
import { BlackHoleAudio } from './audio.js';
import { ParticleSystem } from './particles.js';
import {
  PerformanceEngine,
  setLowGraphics,
  setMediumGraphics,
  setHighGraphics,
} from './performance.js';

// ---------- TON 618 Scale Constants ----------
// TON 618: 66 billion solar masses
// Rs = 2GM/c² ≈ 1.95 × 10^14 m ≈ 1300 AU
// In shader: M = 1, so 1 unit = Rs/2 = 650 AU
const AU_PER_UNIT = 650; // 1 shader unit = 650 AU for TON 618
const LY_PER_AU = 1 / 63241; // 1 AU ≈ 1/63241 light-years

// ---------- Loader ----------

const loader = document.getElementById('loader');

function hideLoader() {
  loader.classList.add('hidden');
  setTimeout(() => {
    loader.style.display = 'none';
  }, 800);
}

// ---------- Scroll Reveal ----------

function initScrollReveal() {
  const reveals = document.querySelectorAll('.reveal');

  const observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        const parent = entry.target.parentElement;
        const allReveals = Array.from(parent.children).filter(c =>
          c.classList.contains('reveal') && !c.classList.contains('visible')
        );
        const idx = allReveals.indexOf(entry.target);
        if (idx > 0) {
          entry.target.style.transitionDelay = `${idx * 0.1}s`;
        }
        entry.target.classList.add('visible');
      }
    });
  }, {
    threshold: 0.1,
    rootMargin: '0px 0px -50px 0px',
  });

  reveals.forEach((el) => observer.observe(el));
}

// ---------- Hero Parallax + HUD visibility ----------

function initHeroParallax() {
  const hero = document.getElementById('hero');
  const overlay = hero.querySelector('.hero-overlay');
  const scrollIndicator = hero.querySelector('.scroll-indicator');

  window.addEventListener('scroll', () => {
    const scrollY = window.scrollY;
    const heroH = hero.offsetHeight;

    if (scrollY < heroH) {
      const progress = scrollY / heroH;
      overlay.style.opacity = 1 - progress * 1.5;
      overlay.style.transform = `translateY(${scrollY * 0.3}px)`;

      if (scrollIndicator) {
        scrollIndicator.style.opacity = Math.max(0, 1 - progress * 3);
      }
    }

    // Toggle HUD visibility
    if (scrollY > heroH * 0.5) {
      document.body.classList.add('scrolled-past-hero');
    } else {
      document.body.classList.remove('scrolled-past-hero');
    }
  }, { passive: true });
}

// ---------- Sound Toggle ----------

function initSound() {
  const audio = new BlackHoleAudio();
  const btn = document.getElementById('sound-toggle');
  const iconOn = btn.querySelector('.sound-on');
  const iconOff = btn.querySelector('.sound-off');

  btn.addEventListener('click', () => {
    const playing = audio.toggle();
    iconOn.style.display = playing ? 'block' : 'none';
    iconOff.style.display = playing ? 'none' : 'block';
    btn.classList.toggle('active', playing);
  });

  iconOn.style.display = 'none';
  iconOff.style.display = 'block';
}

// ---------- Scale Ruler ----------

function initScaleRuler(bhRenderer) {
  const scaleLabel = document.getElementById('scale-label');
  if (!scaleLabel) return;

  function updateScale() {
    // Camera distance in shader units
    const camDist = bhRenderer.camDist;
    // Approximate visible width at center = 2 * camDist * tan(FOV/2)
    // FOV vertical ≈ 53°, so tan(26.5°) ≈ 0.5
    const visibleWidth = 2 * camDist * 0.5; // in shader units
    // The ruler is ~120px, screen is ~window.innerWidth
    const rulerFraction = 120 / window.innerWidth;
    const rulerWidth = visibleWidth * rulerFraction; // shader units

    const rulerAU = rulerWidth * AU_PER_UNIT;

    let label;
    if (rulerAU > 63241) {
      // light-years
      const ly = rulerAU / 63241;
      label = ly >= 100 ? `${Math.round(ly).toLocaleString()} ly` : `${ly.toFixed(1)} ly`;
    } else if (rulerAU > 100) {
      label = `${Math.round(rulerAU).toLocaleString()} AU`;
    } else if (rulerAU > 1) {
      label = `${rulerAU.toFixed(1)} AU`;
    } else {
      const mkm = rulerAU * 149.598; // million km per AU
      label = `${mkm.toFixed(0)} M km`;
    }

    scaleLabel.textContent = label;
    requestAnimationFrame(updateScale);
  }
  updateScale();
}

// ---------- Scale Comparison Toggle ----------

function initScaleCompare(particleSystem) {
  const toggle = document.getElementById('scale-compare-toggle');
  const info = document.getElementById('scale-compare-info');
  if (!toggle || !info) return;

  toggle.addEventListener('click', () => {
    const visible = info.style.display !== 'none';
    info.style.display = visible ? 'none' : 'flex';
    toggle.classList.toggle('active', !visible);
    // Also toggle 3D scale rings in the scene
    particleSystem.toggleScaleRings(!visible);
  });
}

// ---------- Creation Mode ----------

function initCreationMode(bhRenderer, particleSystem) {
  const btn = document.getElementById('create-toggle');
  const canvas = document.getElementById('blackhole-canvas');
  const indicator = document.getElementById('create-indicator');
  let createMode = false;

  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    createMode = !createMode;
    btn.classList.toggle('active', createMode);
    canvas.classList.toggle('create-mode', createMode);

    if (indicator) {
      indicator.style.display = createMode ? 'flex' : 'none';
    }
  });

  // Spawn object on click in create mode
  canvas.addEventListener('click', (e) => {
    if (!createMode) return;

    // Convert click to NDC (-1 to 1)
    const rect = canvas.getBoundingClientRect();
    const ndcX = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    const ndcY = -(((e.clientY - rect.top) / rect.height) * 2 - 1);

    particleSystem.spawn(ndcX, ndcY);
  });
}

// ---------- Main Init ----------

async function init() {
  const canvas = document.getElementById('blackhole-canvas');

  // Инициализация рендереров
  const bhRenderer = new BlackHoleRenderer(canvas);
  const particleSystem = new ParticleSystem(bhRenderer);

  // Движок производительности — подключаем колбэки графики
  const gl = bhRenderer.renderer.getContext();
  const uniforms = bhRenderer.uniforms;
  const renderer3 = bhRenderer.renderer;

  const perfEngine = new PerformanceEngine(gl, {
    onLow:    (profile) => setLowGraphics(renderer3, uniforms, profile),
    onMedium: (profile) => setMediumGraphics(renderer3, uniforms, profile),
    onHigh:   (profile) => setHighGraphics(renderer3, uniforms, profile),
  });

  // Запускаем бенчмарк (первые 4 секунды)
  perfEngine.startBenchmark();

  // Цикл анимации — без ограничения FPS (следует за частотой монитора)
  const startTime = performance.now();
  let lastTime = startTime;

  function animate() {
    const now = performance.now();
    const elapsed = (now - startTime) / 1000;
    const dt = Math.min((now - lastTime) / 1000, 0.05);
    lastTime = now;

    // Обновляем шейдер чёрной дыры
    bhRenderer.update(elapsed);

    // Частицы поверх шейдера
    particleSystem.update(dt);
    particleSystem.render(bhRenderer.renderer);

    // Тик движка производительности (бенчмарк + рантайм-мониторинг)
    perfEngine.tick();

    requestAnimationFrame(animate);
  }

  animate();

  // Hide loader after first frame renders
  setTimeout(() => {
    hideLoader();
  }, 2500);

  // Init features
  initScrollReveal();
  initHeroParallax();
  initSound();
  initCreationMode(bhRenderer, particleSystem);
  initScaleRuler(bhRenderer);
  initScaleCompare(particleSystem);
}

function safeInit() {
  try {
    init();
  } catch (e) {
    console.error('Black Hole init error:', e);
    // Always hide loader even if initialization fails
    hideLoader();
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', safeInit);
} else {
  safeInit();
}
