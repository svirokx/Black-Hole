// ============================================
// BLACK HOLE — Main Application
// Loader, scroll animations, initialization
// ============================================

import { BlackHoleRenderer } from './blackhole.js';
import { BlackHoleAudio } from './audio.js';

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
        // Staggered reveal for siblings
        const parent = entry.target.parentElement;
        const siblings = parent.querySelectorAll('.reveal');
        let delay = 0;
        siblings.forEach((sib) => {
          if (sib === entry.target || entry.target.contains(sib)) return;
        });

        entry.target.style.transitionDelay = '0s';

        // Check if parent has multiple reveal children for stagger
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

  // Initially show "off" icon
  iconOn.style.display = 'none';
  iconOff.style.display = 'block';
}

// ---------- Main Init ----------

async function init() {
  const canvas = document.getElementById('blackhole-canvas');

  // Initialize black hole renderer
  const bhRenderer = new BlackHoleRenderer(canvas);

  // Animation loop
  const startTime = performance.now();
  function animate() {
    const elapsed = (performance.now() - startTime) / 1000;
    bhRenderer.update(elapsed);
    requestAnimationFrame(animate);
  }

  // Start rendering immediately (behind loader)
  animate();

  // Wait a moment for first frame, then hide loader
  setTimeout(() => {
    hideLoader();
  }, 2500);

  // Init other features
  initScrollReveal();
  initHeroParallax();
  initSound();
}

// Start when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
