// ============================================
// PERFORMANCE ENGINE — Автоматическая оптимизация графики
// ============================================
//
// Модуль определяет возможности устройства и автоматически
// подбирает оптимальный уровень графики для максимального FPS.
//
// Принцип работы:
// 1. При загрузке — определяем GPU по WEBGL_debug_renderer_info
// 2. Первые 4 секунды — замеряем реальный FPS (бенчмарк)
// 3. На основе GPU + реального FPS выбираем профиль графики
// 4. В рантайме продолжаем мониторить — если просадки, понижаем
// 5. Не ограничиваем FPS — стремимся к частоте монитора (144Hz+)
// ============================================

// ---------- Профили графики ----------
// Каждый профиль содержит настройки, которые передаются в рендерер

export const PROFILES = {
  low: {
    key: 'low',
    label: 'Низкие',
    steps: 90,          // шагов трассировки луча
    resMul: 0.5,        // множитель разрешения
    pixelRatio: 1.0,    // фиксированный pixelRatio
    shadows: false,     // тени выключены
    postEffects: false,  // пост-обработка выключена
    starLayers: 1,      // слоёв звёзд
    diskDetail: 0.5,    // детализация аккреционного диска
  },
  medium: {
    key: 'medium',
    label: 'Средние',
    steps: 180,
    resMul: 0.8,
    pixelRatio: null,   // null = использовать devicePixelRatio
    shadows: true,
    postEffects: true,
    starLayers: 2,
    diskDetail: 0.8,
  },
  high: {
    key: 'high',
    label: 'Катастрофа',
    steps: 300,
    resMul: 1.0,
    pixelRatio: null,   // null = devicePixelRatio (до 2.0)
    shadows: true,
    postEffects: true,
    starLayers: 3,
    diskDetail: 1.0,
  },
};

// ---------- Классификация GPU ----------
// Ключевые слова из WEBGL_debug_renderer_info → предварительная оценка

const GPU_TIERS = [
  // === Мощные GPU ===
  {
    tier: 'high',
    patterns: [
      /rtx\s?\d/i,                // NVIDIA RTX 2060–5090
      /rx\s?[67]\d{3}/i,          // AMD Radeon RX 6000 / 7000
      /radeon\s?pro\s?w/i,        // AMD Radeon Pro (рабочие станции)
      /apple\s?m[1-9]/i,          // Apple M1 / M2 / M3 / M4
      /arc\s?a[7-9]/i,            // Intel Arc A770, A780
      /geforce\s?rtx/i,           // RTX обобщённый
      /a100|h100|l40/i,           // серверные (вдруг)
    ],
  },
  // === Средние GPU ===
  {
    tier: 'medium',
    patterns: [
      /gtx\s?1[0-9]{3}/i,        // NVIDIA GTX 1060–1660
      /gtx\s?[2-9][0-9]{2}/i,    // NVIDIA GTX 960, 980
      /rx\s?5[5-9]\d{1}/i,       // AMD RX 580, 590
      /rx\s?6[0-4]\d{2}/i,       // AMD RX 6400–6500
      /iris\s?xe/i,               // Intel Iris Xe
      /intel\s?arc\s?a[3-5]/i,   // Intel Arc A380–A580
      /radeon\s?rx\s?vega/i,     // Vega серия
      /adreno\s?[6-7]\d{2}/i,    // Qualcomm Adreno 6xx–7xx (мощные мобильные)
      /mali-g7[7-9]/i,           // ARM Mali-G78+ (мощные мобильные)
      /apple\s?gpu/i,            // Generic Apple (iPhone / iPad)
    ],
  },
  // === Слабые GPU ===
  {
    tier: 'low',
    patterns: [
      /intel.*hd\s?\d/i,          // Intel HD Graphics
      /intel.*uhd\s?\d/i,         // Intel UHD Graphics
      /mali-g[5-6]/i,            // ARM Mali-G51–G68
      /mali-t/i,                  // ARM Mali-T (старые)
      /adreno\s?[3-5]\d{2}/i,   // Qualcomm Adreno 3xx–5xx
      /powervr/i,                // Imagination PowerVR
      /vivante/i,                // Vivante (бюджетные устройства)
      /mesa/i,                   // Mesa (программный рендер Linux)
      /swiftshader/i,            // Google SwiftShader (программный)
      /llvmpipe/i,               // LLVM программный рендер
    ],
  },
];

// ---------- Класс PerformanceEngine ----------

export class PerformanceEngine {
  /**
   * @param {WebGLRenderingContext | WebGL2RenderingContext} gl — контекст WebGL
   * @param {Object} callbacks — колбэки для переключения графики:
   *   { onLow: Function, onMedium: Function, onHigh: Function }
   */
  constructor(gl, callbacks = {}) {
    // WebGL контекст
    this.gl = gl;

    // Колбэки для каждого уровня графики
    this.callbacks = {
      onLow:    callbacks.onLow    || (() => {}),
      onMedium: callbacks.onMedium || (() => {}),
      onHigh:   callbacks.onHigh   || (() => {}),
    };

    // Текущий профиль
    this.currentProfile = null;

    // Информация об устройстве
    this.gpuInfo = { vendor: '', renderer: '', tier: 'unknown' };

    // Бенчмарк
    this.benchmarkActive    = false;
    this.benchmarkStartTime = 0;
    this.benchmarkDuration  = 4000;  // 4 секунды бенчмарка
    this.benchmarkFrames    = 0;
    this.benchmarkComplete  = false;

    // Рантайм-мониторинг FPS
    this.runtimeFrames   = 0;
    this.runtimeStart    = 0;
    this.runtimeReadings = [];   // история средних FPS за 2-секундные окна
    this.runtimeLocked   = false;

    // Частота обновления монитора (определяется автоматически)
    this.displayRefreshRate = 60;
    this.refreshRateDetected = false;

    // UI-элемент для отображения профиля
    this._badgeTimer = null;

    // Запускаем определение GPU
    this._detectGPU();

    // Определяем частоту монитора
    this._detectRefreshRate();
  }

  // ==================== Определение GPU ====================

  _detectGPU() {
    const ext = this.gl.getExtension('WEBGL_debug_renderer_info');

    if (ext) {
      this.gpuInfo.vendor   = this.gl.getParameter(ext.UNMASKED_VENDOR_WEBGL)   || '';
      this.gpuInfo.renderer = this.gl.getParameter(ext.UNMASAGED_RENDERER_WEBGL) || '';

      // Фоллбэк на правильное имя параметра (в разных браузерах разное)
      if (!this.gpuInfo.renderer) {
        this.gpuInfo.renderer = this.gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) || '';
      }
    }

    // Дополнительная информация
    this.gpuInfo.maxTextureSize   = this.gl.getParameter(this.gl.MAX_TEXTURE_SIZE);
    this.gpuInfo.maxViewportDims  = this.gl.getParameter(this.gl.MAX_VIEWPORT_DIMS);
    this.gpuInfo.maxRenderbuffer   = this.gl.getParameter(this.gl.MAX_RENDERBUFFER_SIZE);

    // Определяем тир GPU по паттернам
    this.gpuInfo.tier = this._classifyGPU(this.gpuInfo.renderer);

    console.log(`[Perf] GPU: ${this.gpuInfo.renderer}`);
    console.log(`[Perf] Vendor: ${this.gpuInfo.vendor}`);
    console.log(`[Perf] Предварительная оценка: ${this.gpuInfo.tier}`);
    console.log(`[Perf] Max Texture: ${this.gpuInfo.maxTextureSize}px`);
  }

  /**
   * Классифицирует GPU по строке рендерера
   * @param {string} renderer — строка из WEBGL_debug_renderer_info
   * @returns {'high'|'medium'|'low'} — тир устройства
   */
  _classifyGPU(renderer) {
    if (!renderer) return 'medium'; // неизвестно → среднее

    for (const tier of GPU_TIERS) {
      for (const pattern of tier.patterns) {
        if (pattern.test(renderer)) {
          return tier.tier;
        }
      }
    }

    // Если ничего не совпало — считаем средним
    return 'medium';
  }

  // ==================== Определение частоты монитора ====================

  _detectRefreshRate() {
    // Замеряем интервал между 10 кадрами requestAnimationFrame
    // чтобы определить реальную частоту обновления экрана
    let frames = 0;
    let startTime = 0;

    const measure = (timestamp) => {
      if (frames === 0) {
        startTime = timestamp;
      }
      frames++;

      if (frames >= 20) {
        const elapsed = timestamp - startTime;
        const avgFrameTime = elapsed / (frames - 1);
        this.displayRefreshRate = Math.round(1000 / avgFrameTime);
        this.refreshRateDetected = true;
        console.log(`[Perf] Частота монитора: ${this.displayRefreshRate}Hz`);
        return; // прекращаем замер
      }

      requestAnimationFrame(measure);
    };

    requestAnimationFrame(measure);
  }

  // ==================== Бенчмарк (первые 4 секунды) ====================

  /**
   * Начинает бенчмарк. Вызывать ПОСЛЕ первого рендер-кадра.
   * Устанавливает профиль на основе GPU-тира, затем
   * уточняет по реальному FPS за 4 секунды.
   */
  startBenchmark() {
    // Устанавливаем начальный профиль по GPU
    const initialProfile = this.gpuInfo.tier;
    this._applyProfile(initialProfile);

    // Начинаем замер реального FPS
    this.benchmarkActive    = true;
    this.benchmarkStartTime = performance.now();
    this.benchmarkFrames    = 0;

    console.log(`[Perf] Бенчмарк начат (${this.benchmarkDuration / 1000}с)...`);
  }

  /**
   * Вызывать каждый кадр из цикла анимации.
   * Во время бенчмарка — считает кадры.
   * После бенчмарка — мониторит FPS в реальном времени.
   */
  tick() {
    const now = performance.now();

    // === Фаза бенчмарка ===
    if (this.benchmarkActive) {
      this.benchmarkFrames++;
      const elapsed = now - this.benchmarkStartTime;

      if (elapsed >= this.benchmarkDuration) {
        this._finishBenchmark(elapsed);
      }
      return;
    }

    // === Рантайм-мониторинг ===
    if (!this.runtimeLocked) {
      this._runtimeMonitor(now);
    }
  }

  _finishBenchmark(elapsed) {
    this.benchmarkActive   = false;
    this.benchmarkComplete = true;

    const benchFps = (this.benchmarkFrames / elapsed) * 1000;
    console.log(`[Perf] Бенчмарк завершён: ${benchFps.toFixed(1)} FPS (${this.benchmarkFrames} кадров за ${(elapsed / 1000).toFixed(1)}с)`);

    // Определяем целевой FPS на основе монитора
    const targetFps = Math.max(this.displayRefreshRate * 0.75, 45);

    // Решаем профиль на основе реальной производительности
    let finalProfile;

    if (benchFps >= targetFps * 1.2) {
      // FPS значительно выше цели → можем повысить
      const tiers = ['low', 'medium', 'high'];
      const currentIdx = tiers.indexOf(this.currentProfile?.key || 'medium');
      finalProfile = tiers[Math.min(currentIdx + 1, 2)];
    } else if (benchFps < targetFps * 0.7) {
      // FPS значительно ниже цели → понижаем
      const tiers = ['low', 'medium', 'high'];
      const currentIdx = tiers.indexOf(this.currentProfile?.key || 'medium');
      finalProfile = tiers[Math.max(currentIdx - 1, 0)];
    } else {
      // FPS в норме → оставляем текущий
      finalProfile = this.currentProfile?.key || 'medium';
    }

    // Применяем финальный профиль
    this._applyProfile(finalProfile);

    // Запускаем рантайм-мониторинг
    this.runtimeStart  = performance.now();
    this.runtimeFrames = 0;

    console.log(`[Perf] Итоговый профиль: ${PROFILES[finalProfile].label}`);
  }

  // ==================== Рантайм-мониторинг ====================

  _runtimeMonitor(now) {
    this.runtimeFrames++;

    if (this.runtimeStart === 0) {
      this.runtimeStart = now;
      return;
    }

    const elapsed = now - this.runtimeStart;

    // Каждые 3 секунды проверяем средний FPS
    if (elapsed >= 3000) {
      const fps = (this.runtimeFrames / elapsed) * 1000;
      this.runtimeReadings.push(fps);
      this.runtimeFrames = 0;
      this.runtimeStart  = now;

      // Нужно минимум 2 замера для принятия решения
      if (this.runtimeReadings.length >= 2) {
        const avgFps = this.runtimeReadings.reduce((a, b) => a + b, 0)
                     / this.runtimeReadings.length;
        const tiers = ['low', 'medium', 'high'];
        const idx   = tiers.indexOf(this.currentProfile?.key || 'medium');

        if (avgFps < 24 && idx > 0) {
          // Сильные просадки → понижаем
          console.log(`[Perf] FPS просел (${avgFps.toFixed(0)}) → понижаем графику`);
          this._applyProfile(tiers[idx - 1]);
          this.runtimeReadings = [];
        } else if (avgFps > 55 && idx < 2) {
          // Запас производительности → повышаем
          console.log(`[Perf] FPS высокий (${avgFps.toFixed(0)}) → повышаем графику`);
          this._applyProfile(tiers[idx + 1]);
          this.runtimeReadings = [];
        } else if (this.runtimeReadings.length >= 5) {
          // 5 стабильных замеров → блокируем дальнейшие изменения
          this.runtimeLocked = true;
          console.log(`[Perf] Графика стабильна (${avgFps.toFixed(0)} FPS) → заблокировано на «${this.currentProfile.label}»`);
        }
      }
    }
  }

  // ==================== Применение профиля ====================

  _applyProfile(profileKey) {
    const profile = PROFILES[profileKey];
    if (!profile) return;

    this.currentProfile = profile;

    // Вызываем соответствующий колбэк
    switch (profileKey) {
      case 'low':
        this.callbacks.onLow(profile);
        break;
      case 'medium':
        this.callbacks.onMedium(profile);
        break;
      case 'high':
        this.callbacks.onHigh(profile);
        break;
    }

    // Показываем бейдж
    this._showBadge(profile.label);
  }

  // ==================== UI: бейдж качества ====================

  _showBadge(label) {
    let badge = document.getElementById('perf-badge');
    if (!badge) {
      badge = document.createElement('div');
      badge.id = 'perf-badge';
      badge.style.cssText = `
        position: fixed;
        bottom: 12px;
        left: 12px;
        z-index: 900;
        padding: 5px 12px;
        border-radius: 8px;
        background: rgba(255, 255, 255, 0.07);
        backdrop-filter: blur(8px);
        -webkit-backdrop-filter: blur(8px);
        color: rgba(255, 255, 255, 0.5);
        font: 500 11px/1 'Inter', system-ui, sans-serif;
        letter-spacing: 0.6px;
        text-transform: uppercase;
        pointer-events: none;
        transition: opacity 1.5s ease;
      `;
      document.body.appendChild(badge);
    }

    badge.textContent = label;
    badge.style.opacity = '1';

    clearTimeout(this._badgeTimer);
    this._badgeTimer = setTimeout(() => {
      badge.style.opacity = '0';
    }, 6000);
  }

  // ==================== Публичные методы ====================

  /** Получить текущий профиль */
  getProfile()   { return this.currentProfile; }

  /** Получить информацию о GPU */
  getGPUInfo()   { return { ...this.gpuInfo }; }

  /** Получить текущий FPS (приблизительно) */
  getCurrentFPS() {
    if (this.runtimeStart === 0 || this.runtimeFrames < 2) return 0;
    return (this.runtimeFrames / (performance.now() - this.runtimeStart)) * 1000;
  }

  /** Получить определённую частоту монитора */
  getRefreshRate() { return this.displayRefreshRate; }

  /** Принудительно установить профиль (для отладки / настроек) */
  forceProfile(key) {
    this.runtimeLocked = true;
    this._applyProfile(key);
    console.log(`[Perf] Принудительный профиль: ${PROFILES[key]?.label || key}`);
  }

  /** Разблокировать авто-настройку */
  unlockAutoTuning() {
    this.runtimeLocked   = false;
    this.runtimeReadings = [];
    this.runtimeFrames   = 0;
    this.runtimeStart    = 0;
    console.log('[Perf] Авто-настройка разблокирована');
  }
}

// ==================== Функции-заглушки (колбэки) ====================
// Эти функции показывают, что именно меняется на каждом уровне.
// Интегрируйте их со своим рендерером (Three.js / собственный шейдер).

/**
 * Низкая графика — максимальная производительность.
 * Отключает тени, снижает разрешение, минимум шагов трассировки.
 * @param {THREE.WebGLRenderer} renderer — Three.js рендерер
 * @param {Object} uniforms — юниформы шейдера чёрной дыры
 */
export function setLowGraphics(renderer, uniforms, profile) {
  // Разрешение: фиксированный pixelRatio = 1 (без ретины)
  renderer.setPixelRatio(1.0);

  // Отключаем тени
  renderer.shadowMap.enabled = false;

  // Шейдер: минимум шагов трассировки
  if (uniforms.uMaxSteps) uniforms.uMaxSteps.value = profile.steps;

  // Обновляем разрешение в шейдере
  const w = window.innerWidth, h = window.innerHeight;
  if (uniforms.uResolution) {
    uniforms.uResolution.value.set(w * 1.0, h * 1.0);
  }

  renderer.setSize(w, h);

  console.log('[Perf] → Применены НИЗКИЕ настройки графики');
}

/**
 * Средняя графика — баланс качества и производительности.
 * Включает тени, нативный pixelRatio, базовые эффекты.
 * @param {THREE.WebGLRenderer} renderer
 * @param {Object} uniforms
 */
export function setMediumGraphics(renderer, uniforms, profile) {
  // Разрешение: нативный pixelRatio, но не выше 2.0
  const dpr = Math.min(window.devicePixelRatio, 2.0) * profile.resMul;
  renderer.setPixelRatio(dpr);

  // Тени: включены (средняя карта теней)
  renderer.shadowMap.enabled = true;

  // Шейдер: средние шаги
  if (uniforms.uMaxSteps) uniforms.uMaxSteps.value = profile.steps;

  const w = window.innerWidth, h = window.innerHeight;
  if (uniforms.uResolution) {
    uniforms.uResolution.value.set(w * dpr, h * dpr);
  }

  renderer.setSize(w, h);

  console.log('[Perf] → Применены СРЕДНИЕ настройки графики');
}

/**
 * Высокая графика — «Катастрофа».
 * Максимальные тени, все пост-эффекты, максимум шагов,
 * полное разрешение с ретиной.
 * @param {THREE.WebGLRenderer} renderer
 * @param {Object} uniforms
 */
export function setHighGraphics(renderer, uniforms, profile) {
  // Разрешение: максимальный pixelRatio (до 2.0 — выше бессмысленно)
  const dpr = Math.min(window.devicePixelRatio, 2.0);
  renderer.setPixelRatio(dpr);

  // Тени: включены (максимальные)
  renderer.shadowMap.enabled = true;

  // Шейдер: максимум шагов трассировки
  if (uniforms.uMaxSteps) uniforms.uMaxSteps.value = profile.steps;

  const w = window.innerWidth, h = window.innerHeight;
  if (uniforms.uResolution) {
    uniforms.uResolution.value.set(w * dpr, h * dpr);
  }

  renderer.setSize(w, h);

  console.log('[Perf] → Применены ВЫСОКИЕ настройки графики (Катастрофа)');
}
