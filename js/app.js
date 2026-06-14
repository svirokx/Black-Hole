// ============================================
// BLACK HOLE — Main Application
// Loader, scroll animations, sound, scale HUD
// TON 618 supermassive simulation
// ============================================

import { BlackHoleRenderer } from './blackhole.js';
import { BlackHoleAudio } from './audio.js';
import { ParticleSystem } from './particles.js';
import {
  StablePerformanceEngine,
  applyGraphicsSettings,
} from './performance.js';

// ---------- Scale Constants ----------
const AU_PER_UNIT = 650;

// ---------- Loader ----------

const loader = document.getElementById('loader');

function hideLoader() {
  loader.classList.add('hidden');
  setTimeout(() => { loader.style.display = 'none'; }, 800);
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
        if (idx > 0) entry.target.style.transitionDelay = `${idx * 0.1}s`;
        entry.target.classList.add('visible');
      }
    });
  }, { threshold: 0.1, rootMargin: '0px 0px -50px 0px' });
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
      if (scrollIndicator) scrollIndicator.style.opacity = Math.max(0, 1 - progress * 3);
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
    const camDist = bhRenderer.camDist;
    const visibleWidth = 2 * camDist * 0.5;
    const rulerFraction = 120 / window.innerWidth;
    const rulerAU = visibleWidth * rulerFraction * AU_PER_UNIT;

    let label;
    if (rulerAU > 63241) {
      const ly = rulerAU / 63241;
      label = ly >= 100 ? `${Math.round(ly).toLocaleString()} ly` : `${ly.toFixed(1)} ly`;
    } else if (rulerAU > 100) {
      label = `${Math.round(rulerAU).toLocaleString()} AU`;
    } else if (rulerAU > 1) {
      label = `${rulerAU.toFixed(1)} AU`;
    } else {
      label = `${(rulerAU * 149.598).toFixed(0)} M km`;
    }
    scaleLabel.textContent = label;
    requestAnimationFrame(updateScale);
  }
  updateScale();
}

// ---------- Main Init ----------

async function init() {
  const canvas = document.getElementById('blackhole-canvas');

  const bhRenderer = new BlackHoleRenderer(canvas);
  const particleSystem = new ParticleSystem(bhRenderer);

  const gl = bhRenderer.renderer.getContext();
  const perfEngine = new StablePerformanceEngine(gl, (settings) => {
    applyGraphicsSettings(bhRenderer.renderer, bhRenderer.uniforms, settings);
  });
  perfEngine.startBenchmark();

  const startTime = performance.now();
  let lastTime = startTime;

  function animate() {
    const now = performance.now();
    const elapsed = (now - startTime) / 1000;
    const dt = Math.min((now - lastTime) / 1000, 0.05);
    lastTime = now;

    bhRenderer.update(elapsed);
    particleSystem.update(dt);
    particleSystem.render(bhRenderer.renderer);
    perfEngine.tick();

    requestAnimationFrame(animate);
  }
  animate();

  setTimeout(() => hideLoader(), 2500);

  initScrollReveal();
  initHeroParallax();
  initSound();
  initScaleRuler(bhRenderer);
}

function safeInit() {
  // Проверяем WebGL перед запуском
  const testCanvas = document.createElement('canvas');
  const gl = testCanvas.getContext('webgl2') || testCanvas.getContext('webgl');
  if (!gl) {
    console.warn('[BH] WebGL не поддерживается — показываем fallback');
    const fallback = document.getElementById('webgl-fallback');
    if (fallback) fallback.classList.add('active');
    const canvas = document.getElementById('blackhole-canvas');
    if (canvas) canvas.style.display = 'none';
    hideLoader();
    initScrollReveal();
    initHeroParallax();
    initSound();
    return;
  }

  try { init(); }
  catch (e) {
    console.error('Black Hole init error:', e);
    const fallback = document.getElementById('webgl-fallback');
    if (fallback) fallback.classList.add('active');
    hideLoader();
    initScrollReveal();
    initHeroParallax();
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', safeInit);
} else {
  safeInit();
}
