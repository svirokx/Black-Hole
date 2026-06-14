// ============================================
// BLACK HOLE — Main Application
// Loader, scroll animations, creation mode
// ============================================

import { BlackHoleRenderer } from './blackhole.js';
import { BlackHoleAudio } from './audio.js';
import { ParticleSystem } from './particles.js';

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

// ---------- Hero Parallax ----------

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

  // In create mode, prevent orbit rotation on click (only drag)
  canvas.addEventListener('mousedown', (e) => {
    if (createMode) {
      // Don't start orbit drag on single click in create mode
      // We'll let the existing drag logic work (it uses mousemove)
    }
  });
}

// ---------- Main Init ----------

async function init() {
  const canvas = document.getElementById('blackhole-canvas');

  // Initialize renderers
  const bhRenderer = new BlackHoleRenderer(canvas);
  const particleSystem = new ParticleSystem(bhRenderer);

  // Animation loop
  const startTime = performance.now();
  let lastTime = startTime;

  function animate() {
    const now = performance.now();
    const elapsed = (now - startTime) / 1000;
    const dt = Math.min((now - lastTime) / 1000, 0.05); // cap dt
    lastTime = now;

    // Update black hole shader
    bhRenderer.update(elapsed);

    // Update and render particles on top
    particleSystem.update(dt);
    particleSystem.render(bhRenderer.renderer);

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
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
