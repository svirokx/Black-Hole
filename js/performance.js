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
  // === Уровень 0: Абсолютный минимум (экстренный) ===
  { level: 0, label: 'Минимум',     steps:  80, dpr: 1.0,  resMul: 0.65, shadows: false, postFX: 'off' },
  // === Уровень 1: Низкие ===
  { level: 1, label: 'Низкие',      steps: 120, dpr: 1.0,  resMul: 0.80, shadows: false, postFX: 'off' },
  // === Уровень 2: Средне-Низкие (тени включаются) ===
  { level: 2, label: 'Ср-Низкие',   steps: 150, dpr: 1.0,  resMul: 0.90, shadows: true,  postFX: 'off' },
  // === Уровень 3: Средние (базовое качество) ===
  { level: 3, label: 'Средние',     steps: 180, dpr: 1.0,  resMul: 1.0,  shadows: true,  postFX: 'off' },
  // === Уровень 4: Средне-Высокие (повышаем разрешение) ===
  { level: 4, label: 'Ср-Высокие',  steps: 220, dpr: 1.25, resMul: 1.0,  shadows: true,  postFX: 'basic' },
  // === Уровень 5: Высокие (pixelRatio 1.5) ===
  { level: 5, label: 'Высокие',     steps: 260, dpr: 1.5,  resMul: 1.0,  shadows: true,  postFX: 'full' },
  // === Уровень 6: Очень Высокие (нативный pixelRatio) ===
  { level: 6, label: 'Оч.Высокие',  steps: 300, dpr: null, resMul: 1.0,  shadows: true,  postFX: 'full' },
  // === Уровень 7: Ультра (максимум всего) ===
  { level: 7, label: 'Ультра',      steps: 350, dpr: null, resMul: 1.0,  shadows: true,  postFX: 'full' },
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
    /intel.*hd\s?\d/i, /intel.*uhd\s?\d/i,
    /mali-g[5-6]/i, /mali-t/i,
    /adreno\s?[3-5]\d{2}/i,
    /powervr/i, /vivante/i,
    /mesa/i, /swiftshader/i, /llvmpipe/i,
  ],
};

// Начальный уровень по GPU-тиру (консервативный — стабильность!)
const GPU_START_LEVEL = { high: 5, medium: 4, low: 2 };

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
    this._windowFrameTimes = [];  // дельты кадров за текущее 3-секундное окно
    this._windowStart     = 0;
    this._stableCount     = 0;    // счётчик стабильных окон подряд
    this._locked          = false; // заблокирован ли авто-тюнинг

    // --- UI ---
    this._badgeTimeout = null;

    // Определяем GPU и частоту монитора
    this._detectGPU();
    this._detectHz();
  }

  // ==================== Определение GPU ====================

  _detectGPU() {
    const ext = this.gl.getExtension('WEBGL_debug_renderer_info');
    if (ext) {
      this.gpuRenderer = this.gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) || '';
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
    this.currentLevel = GPU_START_LEVEL[this.gpuTier] ?? 3;

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
        this.displayHz = Math.round(1000 / avgMs);
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

    // === Рантайм-мониторинг ===
    if (!this._locked) {
      this._runtimeTick(now, dt);
    }
  }

  _finishBenchmark() {
    this._benchmarkActive = false;
    this._benchmarkDone   = true;

    const times = this._benchmarkFrameTimes;
    const analysis = this._analyzeStability(times);

    console.log(`[Perf] Бенчмарк завершён:`);
    console.log(`  Средний FPS: ${analysis.avgFps.toFixed(1)}`);
    console.log(`  1% Low FPS:  ${analysis.p1Fps.toFixed(1)}`);
    console.log(`  Jitter:      ${analysis.jitter.toFixed(2)}мс`);
    console.log(`  Дропы:       ${analysis.drops} из ${times.length} кадров`);

    // Определяем оптимальный уровень
    let level = this.currentLevel;

    if (!analysis.stable) {
      // Нестабильно на текущем уровне → понижаем
      level = Math.max(0, level - 1);
      console.log(`[Perf] Бенчмарк нестабилен → понижаем до ${LEVELS[level].label}`);
    } else if (analysis.headroom) {
      // Есть запас → осторожно повышаем НА ОДИН шаг
      level = Math.min(LEVELS.length - 1, level + 1);
      console.log(`[Perf] Бенчмарк стабилен с запасом → повышаем до ${LEVELS[level].label}`);
    } else {
      console.log(`[Perf] Бенчмарк стабилен → оставляем ${LEVELS[level].label}`);
    }

    this._applyLevel(level);

    // Сбрасываем для рантайм-мониторинга
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

    // Стабильность: FPS выше 55 (или 92% от монитора), jitter < 5мс, мало дропов
    const targetMin = Math.min(55, this.displayHz * 0.92);
    const stable = avgFps >= targetMin && jitter < 5.0 && drops < frameTimes.length * 0.03;

    // Есть запас: средний FPS > 95% от монитора, jitter < 2мс, 0 дропов
    const headroom = avgFps >= this.displayHz * 0.95 && jitter < 2.5 && drops === 0;

    return { avgFps, p1Fps, jitter, drops, stable, headroom };
  }

  // ==================== Рантайм-мониторинг ====================

  _runtimeTick(now, dt) {
    // Инициализация окна
    if (this._windowStart === 0) {
      this._windowStart = now;
    }

    this._windowFrameTimes.push(dt);

    // Каждые 3 секунды — анализ окна
    if (now - this._windowStart >= 3000) {
      const analysis = this._analyzeStability(this._windowFrameTimes);

      // Сбрасываем окно
      this._windowFrameTimes = [];
      this._windowStart = now;

      if (!analysis.stable && this.currentLevel > 0) {
        // === НЕСТАБИЛЬНО → мгновенно понижаем на 1 шаг ===
        const newLevel = this.currentLevel - 1;
        console.log(
          `[Perf] Нестабильно (FPS:${analysis.avgFps.toFixed(0)}, ` +
          `jitter:${analysis.jitter.toFixed(1)}мс, drops:${analysis.drops}) ` +
          `→ понижаем: ${LEVELS[this.currentLevel].label} → ${LEVELS[newLevel].label}`
        );
        this._applyLevel(newLevel);
        this._stableCount = 0;

      } else if (analysis.headroom && this.currentLevel < LEVELS.length - 1) {
        // === Есть запас — повышаем ТОЛЬКО после 4 стабильных окон подряд (12с) ===
        this._stableCount++;
        if (this._stableCount >= 4) {
          const newLevel = this.currentLevel + 1;
          console.log(
            `[Perf] Стабильно 12с+ (FPS:${analysis.avgFps.toFixed(0)}) ` +
            `→ повышаем: ${LEVELS[this.currentLevel].label} → ${LEVELS[newLevel].label}`
          );
          this._applyLevel(newLevel);
          this._stableCount = 0;
        }

      } else if (analysis.stable) {
        // Стабильно, но без запаса — не меняем, считаем стабильные окна
        this._stableCount++;

        // После 6 стабильных окон подряд (18с) — блокируем
        if (this._stableCount >= 6) {
          this._locked = true;
          console.log(
            `[Perf] Стабильно 18с → заблокировано на «${LEVELS[this.currentLevel].label}» ` +
            `(${analysis.avgFps.toFixed(0)} FPS, jitter ${analysis.jitter.toFixed(1)}мс)`
          );
        }

      } else {
        // Пограничный случай — сбрасываем счётчик
        this._stableCount = 0;
      }
    }
  }

  // ==================== Применение уровня ====================

  _applyLevel(level) {
    level = Math.max(0, Math.min(LEVELS.length - 1, level));
    this.currentLevel = level;
    const settings = LEVELS[level];

    // Вычисляем реальный pixelRatio
    const resolvedDpr = settings.dpr === null
      ? Math.min(window.devicePixelRatio, 2.0)
      : settings.dpr;

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
  const effectiveDpr = resolvedDpr * resMul;
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
