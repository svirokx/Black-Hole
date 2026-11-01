// ============================================
// PERFORMANCE ENGINE — «Стабильный FPS»
// ============================================
//
// Приоритет: СТАБИЛЬНОСТЬ и ПЛАВНОСТЬ, а не максимальные эффекты.
// Даже мощная видеокарта (RTX, Apple M) получит ровные 60+ FPS
// без микро-дёрганий вместо 45 FPS с красивыми шейдерами.
//
// Алгоритм:
// 1. Определяем GPU → выбираем начальный уровень (НЕ максимум, а средний)
// 2. Бенчмарк 4 секунды — замеряем не средний FPS, а СТАБИЛЬНОСТЬ:
//    jitter (дрожание), дропы кадров, percentile 1%
// 3. Рантайм: каждые 3 секунды проверяем стабильность
//    - Если дёргается (jitter > порога ИЛИ дропы) → понижаем НА ОДИН ШАГ
//    - Повышаем ТОЛЬКО при идеально ровном FPS в течение 10+ секунд
// 4. Плавная деградация (8 уровней):
//    Сначала пост-эффекты → потом pixelRatio → потом шаги → тени в последнюю
//
// НЕ ограничиваем FPS — requestAnimationFrame стремится к Hz монитора
// ============================================

// ---------- 8 уровней деградации ----------
// Порядок снижения: пост-эффекты → разрешение (pixelRatio) → шаги → тени
//
// dpr = null → использовать window.devicePixelRatio (до 2.0)
// dpr = число → фиксированный pixelRatio

export const LEVELS = [
  { level: 0, label: 'Минимум',     steps: 95,  dpr: 1.0, resMul: 0.48, shadows: false, postFX: 'off' },
  // === Уровень 1: Низкие ===
  { level: 1, label: 'Низкие',      steps: 105, dpr: 1.0, resMul: 0.60, shadows: false, postFX: 'off' },
  // === Уровень 2: Средне-Низкие ===
  { level: 2, label: 'Ср-Низкие',   steps: 115, dpr: 1.0, resMul: 0.74, shadows: false, postFX: 'off' },
  // === Уровень 3: Средние ===
  { level: 3, label: 'Средние',     steps: 120, dpr: 1.0, resMul: 0.87, shadows: false, postFX: 'off' },
  // === Уровень 4: Средне-Высокие ===
  { level: 4, label: 'Ср-Высокие',  steps: 125, dpr: 1.0, resMul: 0.97, shadows: true, postFX: 'basic' },
  // === Уровень 5: Высокие ===
  { level: 5, label: 'Высокие',     steps: 140, dpr: 1.15, resMul: 1.0, shadows: true, postFX: 'full' },
  // === Уровень 6: Очень Высокие ===
  { level: 6, label: 'Оч.Высокие',  steps: 150, dpr: null, resMul: 1.0, shadows: true, postFX: 'full' },
  // === Уровень 7: Ультра ===
  { level: 7, label: 'Ультра',      steps: 165, dpr: null, resMul: 1.0, shadows: true, postFX: 'full' },
];

// ---------- GPU-классификация ----------

const GPU_PATTERNS = {
  // Мощные GPU → начинаем с уровня 4 (НЕ с максимума!)
  // Стабильность важнее красоты
  high: [
    /rtx\s?\d/i, /geforce\s?rtx/i,
    /rx\s?[67]\d{3}/i,
    /radeon\s?pro\s?w/i,
    /apple\s?m[2-9]/i,          // M2+ мощнее
    /arc\s?a[7-9]/i,
    /a100|h100|l40/i,
  ],
  // Средние GPU → начинаем с уровня 3
  medium: [
    /gtx\s?1[0-9]{3}/i,
    /rx\s?5[5-9]/i, /rx\s?6[0-4]/i,
    /iris\s?xe/i,
    /apple\s?m1/i,              // M1 — среднее
    /apple\s?gpu/i,
    /adreno\s?[6-7]\d{2}/i,
    /mali-g7[7-9]/i,
    /radeon\s?rx\s?vega/i,
  ],
  // Слабые GPU → начинаем с уровня 1
  low: [
    /intel.*hd/i, /intel.*uhd/i,       // Intel HD/UHD (с номером или без)
    /mali-g[5-6]/i, /mali-t/i,
    /adreno\s?[3-5]\d{2}/i,
    /powervr/i, /vivante/i,
    /mesa/i, /swiftshader/i, /llvmpipe/i,
  ],
};

// Начальный уровень по GPU-тиру (консервативный — стабильность!)
const GPU_START_LEVEL = { high: 5, medium: 3, low: 0 };

// ---------- Класс StablePerformanceEngine ----------

export class StablePerformanceEngine {
  /**
   * @param {WebGLRenderingContext} gl — WebGL контекст
   * @param {Function} onChange — колбэк (settings) вызывается при смене уровня
   */
  constructor(gl, onChange) {
    this.gl = gl;
    this.onChange = onChange || (() => {});

    // Текущий уровень (индекс в массиве LEVELS)
    this.currentLevel = 3; // по умолчанию — средний

    // Информация о GPU
    this.gpuRenderer = '';
    this.gpuTier = 'medium';

    // Частота обновления монитора
    this.displayHz = 60;
    this._hzDetected = false;

    // Целевое время кадра (мс)
    this.targetFrameTime = 1000 / 60;

    // --- Бенчмарк ---
    this._benchmarkActive = false;
    this._benchmarkStart  = 0;
    this._benchmarkFrameTimes = [];
    this._benchmarkDone   = false;

    // --- Рантайм-мониторинг ---
    this._lastFrameTime   = 0;
    this._windowFrameTimes = [];
    this._windowStart     = 0;
    this._stableCount     = 0;
    this.measuredFps      = 60;
    this._locked          = false;

    // --- UI ---
    this._badgeTimeout = null;

    // Определяем GPU и частоту монитора
    this._detectGPU();
    this._detectHz();
  }

  // ==================== Определение GPU ====================

  setMeasuredFps(fps) {
    if (!Number.isFinite(fps) || fps < 1) return;
    this.measuredFps = fps;
    this.targetFrameTime = 1000 / Math.max(30, this.displayHz);
    const now = performance.now();
    if (!this._fpsWindowStart) this._fpsWindowStart = now;
    if (!this._windowStart) this._windowStart = now;
    this._fpsWindowSamples = (this._fpsWindowSamples || 0) + 1;
    if (now - this._fpsWindowStart < 1800 || this._fpsWindowSamples < 2) return;

    const target = Math.max(30, this.displayHz * 0.90);
    if (fps < target * 0.86 && this.currentLevel > 0) {
      const next = Math.max(0, this.currentLevel - (fps < target * 0.5 ? 2 : 1));
      this._applyLevel(next);
      this._stableCount = 0;
    } else if (fps > target * 1.08 && this.currentLevel < this.maxLevel) {
      this._stableCount++;
      if (this._stableCount >= 2) {
        this._applyLevel(this.currentLevel + 1);
        this._stableCount = 0;
      }
    } else {
      this._stableCount = 0;
    }

    this._fpsWindowStart = now;
    this._fpsWindowSamples = 0;
  }

  _detectGPU() {
    // Пробуем WEBGL_debug_renderer_info (deprecated в Firefox)
    const ext = this.gl.getExtension('WEBGL_debug_renderer_info');
    if (ext) {
      try {
        this.gpuRenderer = this.gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) || '';
      } catch (_) { /* deprecated — fallback ниже */ }
    }
    // Fallback: gl.RENDERER (менее детальный, но всегда работает)
    if (!this.gpuRenderer) {
      this.gpuRenderer = this.gl.getParameter(this.gl.RENDERER) || '';
    }

    // Классифицируем
    this.gpuTier = 'medium';
    for (const [tier, patterns] of Object.entries(GPU_PATTERNS)) {
      for (const pat of patterns) {
        if (pat.test(this.gpuRenderer)) {
          this.gpuTier = tier;
          break;
        }
      }
      if (this.gpuTier !== 'medium' || tier === 'medium') {
        // Если уже нашли совпадение в high или low — выходим
        // Для medium проверяем все паттерны
        let found = false;
        for (const pat of patterns) {
          if (pat.test(this.gpuRenderer)) { found = true; break; }
        }
        if (found && tier !== 'medium') break;
      }
    }

    // Начальный уровень — консервативный, НЕ максимальный
    // На мобильных устройствах: ещё ниже
    this.isMobile = /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent)
                  || ('ontouchstart' in window && window.innerWidth < 1024);
    const startMap = this.isMobile
      ? { high: 2, medium: 1, low: 0 }  // Мобильные: начинаем ОЧЕНЬ низко
      : GPU_START_LEVEL;
    // На мобильных жёсткий потолок — уровень 3 максимум
    this.maxLevel = this.isMobile ? 3 : 7;
    this.currentLevel = startMap[this.gpuTier] ?? 1;

    console.log(`[Perf] GPU: ${this.gpuRenderer || 'неизвестно'}`);
    console.log(`[Perf] Тир: ${this.gpuTier} → начальный уровень: ${this.currentLevel} (${LEVELS[this.currentLevel].label})`);
  }

  // ==================== Определение частоты монитора ====================

  _detectHz() {
    let frames = 0;
    let start = 0;

    const measure = (ts) => {
      if (frames === 0) start = ts;
      frames++;
      if (frames >= 30) {
        const avgMs = (ts - start) / (frames - 1);
        this.displayHz = Math.max(30, Math.round(1000 / avgMs));
        this.targetFrameTime = 1000 / this.displayHz;
        this._hzDetected = true;
        console.log(`[Perf] Монитор: ${this.displayHz}Hz → целевой кадр: ${this.targetFrameTime.toFixed(1)}мс`);
        return;
      }
      requestAnimationFrame(measure);
    };
    requestAnimationFrame(measure);
  }

  // ==================== Бенчмарк ====================

  /** Вызвать после первого рендер-кадра */
  startBenchmark() {
    // Применяем начальный уровень
    this._applyLevel(this.currentLevel);

    this._benchmarkActive = true;
    this._benchmarkStart  = performance.now();
    this._benchmarkFrameTimes = [];
    this._lastFrameTime   = this._benchmarkStart;

    console.log('[Perf] Бенчмарк (4с) — замеряем стабильность...');
  }

  /**
   * Вызывать КАЖДЫЙ КАДР из анимационного цикла.
   * Автоматически переключается между бенчмарком и рантайм-мониторингом.
   */
  tick() {
    const now = performance.now();

    if (this._lastFrameTime === 0) {
      this._lastFrameTime = now;
      return;
    }

    const dt = now - this._lastFrameTime; // дельта кадра в мс
    this._lastFrameTime = now;

    // === Фаза бенчмарка ===
    if (this._benchmarkActive) {
      this._benchmarkFrameTimes.push(dt);
      if (now - this._benchmarkStart >= 4000) {
        this._finishBenchmark();
      }
      return;
    }

    // Runtime quality adaptation uses actual delivered FPS via setMeasuredFps().
  }

  _finishBenchmark() {
    this._benchmarkActive = false;
    this._benchmarkDone   = true;

    const analysis = this._analyzeStability(this._benchmarkFrameTimes);
    const targetFps = Math.max(30, this.displayHz * 0.9);
    let level = this.currentLevel;

    while (analysis.avgFps < targetFps * 0.72 && level > 0) level--;
    if (analysis.avgFps > targetFps * 1.08 && analysis.drops === 0 && level < this.maxLevel) level++;

    console.log(`[Perf] Benchmark: ${analysis.avgFps.toFixed(1)} FPS / ${this.displayHz} Hz; quality ${LEVELS[level].label}`);
    this._applyLevel(level);
    this._windowFrameTimes = [];
    this._windowStart = performance.now();
    this._stableCount = 0;
  }

  // ==================== Анализ стабильности ====================

  /**
   * Анализирует массив дельт кадров (мс) и определяет стабильность.
   * @param {number[]} frameTimes — массив дельт кадров в мс
   * @returns {{ avgFps, p1Fps, jitter, drops, stable, headroom }}
   */
  _analyzeStability(frameTimes) {
    if (frameTimes.length < 10) {
      return { avgFps: 60, p1Fps: 60, jitter: 0, drops: 0, stable: true, headroom: false };
    }

    // Средний FPS
    const avgDt = frameTimes.reduce((a, b) => a + b, 0) / frameTimes.length;
    const avgFps = 1000 / avgDt;

    // 1% percentile (худшие кадры)
    const sorted = [...frameTimes].sort((a, b) => b - a); // по убыванию (худшие первые)
    const p1Index = Math.max(0, Math.floor(frameTimes.length * 0.01));
    const p1Dt = sorted[p1Index];
    const p1Fps = 1000 / p1Dt;

    // Jitter — стандартное отклонение дельт кадров
    const variance = frameTimes.reduce((sum, dt) => sum + (dt - avgDt) ** 2, 0) / frameTimes.length;
    const jitter = Math.sqrt(variance);

    // Дропы — кадры, которые заняли > 150% от целевого времени
    const dropThreshold = this.targetFrameTime * 1.5;
    const drops = frameTimes.filter(dt => dt > dropThreshold).length;

    const targetMin = Math.max(30, this.displayHz * 0.82);
    const stable = avgFps >= targetMin && drops < frameTimes.length * 0.12;
    const headroom = avgFps >= this.displayHz * 0.96 && drops === 0;

    return { avgFps, p1Fps, jitter, drops, stable, headroom };
  }

  // ==================== Рантайм-мониторинг ====================

  _runtimeTick(now, dt) {
    // Инициализация окна
    if (this._windowStart === 0) {
      this._windowStart = now;
    }

    this._windowFrameTimes.push(dt);

    // Reassess measured frame rate every 1.5 seconds.
    if (now - this._windowStart >= 1500) {
      const analysis = this._analyzeStability(this._windowFrameTimes);
      this._windowFrameTimes = [];
      this._windowStart = now;
      const targetFps = Math.max(30, this.displayHz * 0.9);

      if (analysis.avgFps < targetFps * 0.82 && this.currentLevel > 0) {
        const drop = analysis.avgFps < targetFps * 0.55 ? 2 : 1;
        const next = Math.max(0, this.currentLevel - drop);
        console.log(`[Perf] ${analysis.avgFps.toFixed(0)} FPS (<${targetFps.toFixed(0)} target): ${LEVELS[this.currentLevel].label} → ${LEVELS[next].label}`);
        this._applyLevel(next);
        this._stableCount = 0;
      } else if (analysis.avgFps >= targetFps * 0.98 && analysis.drops === 0 && this.currentLevel < this.maxLevel) {
        this._stableCount++;
        if (this._stableCount >= 2) {
          const next = this.currentLevel + 1;
          console.log(`[Perf] ${analysis.avgFps.toFixed(0)} FPS headroom: ${LEVELS[this.currentLevel].label} → ${LEVELS[next].label}`);
          this._applyLevel(next);
          this._stableCount = 0;
        }
      } else {
        this._stableCount = 0;
      }
    }
  }

  // ==================== Применение уровня ====================

  _applyLevel(level) {
    level = Math.max(0, Math.min(this.maxLevel, Math.min(LEVELS.length - 1, level)));
    this.currentLevel = level;
    const settings = LEVELS[level];

    // Вычисляем реальный pixelRatio (на мобильных — максимум 1.0 для производительности)
    let resolvedDpr;
    if (settings.dpr === null) {
      resolvedDpr = this.isMobile
        ? Math.min(window.devicePixelRatio, 1.0)
        : Math.min(window.devicePixelRatio, 1.75);
    } else {
      resolvedDpr = this.isMobile ? Math.min(settings.dpr, 1.0) : settings.dpr;
    }

    // Передаём настройки в колбэк (app.js применит к рендереру)
    this.onChange({
      ...settings,
      resolvedDpr,
    });

    this._showBadge(settings.label);
  }

  // ==================== UI: бейдж ====================

  _showBadge(label) {
    let el = document.getElementById('perf-badge');
    if (!el) {
      el = document.createElement('div');
      el.id = 'perf-badge';
      el.style.cssText = `
        position:fixed; bottom:12px; left:12px; z-index:900;
        padding:5px 12px; border-radius:8px;
        background:rgba(255,255,255,0.07);
        backdrop-filter:blur(8px); -webkit-backdrop-filter:blur(8px);
        color:rgba(255,255,255,0.5);
        font:500 11px/1 'Inter',system-ui,sans-serif;
        letter-spacing:0.6px; text-transform:uppercase;
        pointer-events:none; transition:opacity 1.5s ease;
      `;
      document.body.appendChild(el);
    }
    el.textContent = label;
    el.style.opacity = '1';
    clearTimeout(this._badgeTimeout);
    this._badgeTimeout = setTimeout(() => { el.style.opacity = '0'; }, 6000);
  }

  // ==================== Публичные методы ====================

  /** Текущий уровень (объект из LEVELS) */
  getLevel() { return LEVELS[this.currentLevel]; }

  /** Текущий FPS (приблизительно) */
  getCurrentFPS() {
    if (this._windowFrameTimes.length < 2) return 0;
    const avg = this._windowFrameTimes.reduce((a, b) => a + b, 0) / this._windowFrameTimes.length;
    return 1000 / avg;
  }

  /** Частота монитора */
  getRefreshRate() { return this.displayHz; }

  /** GPU информация */
  getGPUInfo() { return { renderer: this.gpuRenderer, tier: this.gpuTier }; }

  /** Принудительно установить уровень (0–7) */
  forceLevel(level) {
    this._locked = true;
    this._applyLevel(level);
    console.log(`[Perf] Принудительный уровень: ${LEVELS[this.currentLevel].label}`);
  }

  /** Разблокировать авто-тюнинг */
  unlock() {
    this._locked = false;
    this._stableCount = 0;
    this._windowFrameTimes = [];
    this._windowStart = 0;
    console.log('[Perf] Авто-тюнинг разблокирован');
  }
}

// ==================== Функция применения настроек к рендереру ====================
// Вызывается из app.js как колбэк onChange

/**
 * Применяет настройки уровня к Three.js рендереру и юниформам шейдера.
 * @param {THREE.WebGLRenderer} renderer
 * @param {Object} uniforms — юниформы шейдера (uMaxSteps, uResolution)
 * @param {Object} settings — объект из LEVELS + resolvedDpr
 */
export function applyGraphicsSettings(renderer, uniforms, settings) {
  const { steps, resolvedDpr, resMul, shadows } = settings;

  // Шаги трассировки лучей
  if (uniforms.uMaxSteps) {
    uniforms.uMaxSteps.value = steps;
  }

  // Разрешение рендера
  const effectiveDpr = Math.max(0.35, Math.min(resolvedDpr * resMul, 1.75));
  renderer.setPixelRatio(effectiveDpr);

  // Тени
  renderer.shadowMap.enabled = shadows;

  // Обновляем размер и юниформу разрешения
  const w = window.innerWidth;
  const h = window.innerHeight;
  renderer.setSize(w, h);

  if (uniforms.uResolution) {
    uniforms.uResolution.value.set(w * effectiveDpr, h * effectiveDpr);
  }
}
