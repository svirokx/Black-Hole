// ============================================
// BLACK HOLE — Sound Engine
// Deep drone inspired by NASA's Perseus cluster
// black hole sonification
// ============================================

export class BlackHoleAudio {
  constructor() {
    this.ctx = null;
    this.isPlaying = false;
    this.masterGain = null;
    this.oscillators = [];
    this.initialized = false;
  }

  init() {
    if (this.initialized) return;
    this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    this.masterGain = this.ctx.createGain();
    this.masterGain.gain.value = 0;
    this.masterGain.connect(this.ctx.destination);

    // Create layered drone
    // Base: very low fundamental
    this._createOsc(30, 'sine', 0.25);      // Sub bass
    this._createOsc(60, 'sine', 0.15);      // Bass
    this._createOsc(90, 'sine', 0.08);      // 3rd harmonic
    this._createOsc(45, 'triangle', 0.06);  // Lower mid
    this._createOsc(120, 'sine', 0.04);     // 4th harmonic

    // Texture: filtered noise for "space" feel
    this._createNoise(0.03);

    // Slow LFO modulation on master gain for breathing effect
    const lfo = this.ctx.createOscillator();
    const lfoGain = this.ctx.createGain();
    lfo.type = 'sine';
    lfo.frequency.value = 0.05; // Very slow
    lfoGain.gain.value = 0.02;  // Subtle
    lfo.connect(lfoGain);
    lfoGain.connect(this.masterGain.gain);
    lfo.start();

    this.initialized = true;
  }

  _createOsc(freq, type, volume) {
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = type;
    osc.frequency.value = freq;

    // Slight detuning for richness
    osc.detune.value = (Math.random() - 0.5) * 10;

    gain.gain.value = volume;
    osc.connect(gain);
    gain.connect(this.masterGain);
    osc.start();
    this.oscillators.push({ osc, gain });
  }

  _createNoise(volume) {
    const bufferSize = this.ctx.sampleRate * 2;
    const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = (Math.random() * 2 - 1);
    }

    const noise = this.ctx.createBufferSource();
    noise.buffer = buffer;
    noise.loop = true;

    // Low-pass filter — keep only very low rumble
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 80;
    filter.Q.value = 1;

    const gain = this.ctx.createGain();
    gain.gain.value = volume;

    noise.connect(filter);
    filter.connect(gain);
    gain.connect(this.masterGain);
    noise.start();
  }

  toggle() {
    if (!this.initialized) this.init();

    if (this.isPlaying) {
      // Fade out
      this.masterGain.gain.linearRampToValueAtTime(0, this.ctx.currentTime + 1);
      this.isPlaying = false;
    } else {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      // Fade in
      this.masterGain.gain.linearRampToValueAtTime(0.15, this.ctx.currentTime + 2);
      this.isPlaying = true;
    }

    return this.isPlaying;
  }

  dispose() {
    if (this.ctx) {
      this.oscillators.forEach(o => o.osc.stop());
      this.ctx.close();
    }
  }
}
