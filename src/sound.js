const SAMPLE_RATE = 24000;
const DURATIONS = { launch: 1, burst: 1.25, debris: 2.4, rain: 3, drop: 0.12 };

// Bake noise, pressure decay and irregular crackles once, not per render frame.
export function synthesizeSound(kind, seed = 1) {
  const data = new Float32Array(Math.ceil(DURATIONS[kind] * SAMPLE_RATE));
  let low = 0;
  let mid = 0;
  let crackle = 0;
  let phase = 0;
  const noise = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296 * 2 - 1;
  };
  let nextCrackle = 0.03;
  let decay = 0.995;
  for (let i = 0; i < data.length; i += 1) {
    const t = i / SAMPLE_RATE;
    const p = i / data.length;
    const white = noise();
    low += (white - low) * 0.025;
    mid += (white - mid) * 0.38;
    const high = white - mid;
    const fade = Math.min(1, (data.length - 1 - i) / 240);
    let value = 0;
    if (kind === "launch") {
      const ignition = (mid * 0.9 + low * 3) * Math.exp(-t * 45);
      const burn = (mid * 0.5 + high * 0.12) * (1 - Math.exp(-t * 50)) * (1 - p) ** 0.7;
      // Mostly air and combustion, with a quiet unstable whistle behind it.
      phase += Math.PI * 2 * (620 + 680 * p + 23 * Math.sin(t * 39)) / SAMPLE_RATE;
      value = ignition + burn + Math.sin(phase) * 0.016 * Math.sin(Math.PI * p);
    } else if (kind === "burst") {
      const pressure = Math.sin(Math.PI * 2 * (58 * t + 1.8 * (1 - Math.exp(-t * 30))));
      const crack = white * Math.exp(-t * 85) * 0.65;
      const body = (low * 4 + pressure * 0.22) * Math.exp(-t * 10);
      const rumble = low * 1.8 * Math.exp(-t * 3.8) * (1 - Math.exp(-t * 28));
      value = crack + body + rumble;
    } else if (kind === "debris") {
      if (t >= nextCrackle) {
        crackle = (0.22 + (noise() + 1) * 0.21) * (1 - p) ** 1.4;
        decay = Math.exp(-1 / (SAMPLE_RATE * (0.004 + (noise() + 1) * 0.013)));
        nextCrackle = t + 0.025 + (noise() + 1) * (0.035 + p * 0.13);
      }
      crackle *= decay;
      const fizz = 0.025 * Math.sin(Math.min(1, t * 6) * Math.PI / 2) * (1 - p) ** 2;
      value = (high * 0.7 + mid * 0.3) * (crackle + fizz);
    } else if (kind === "rain") {
      if (t >= nextCrackle) {
        crackle = 0.02 + (noise() + 1) * 0.08;
        nextCrackle = t + 0.025 + (noise() + 1) * 0.09;
      }
      crackle *= 0.99;
      value = mid * 0.27 + high * (0.05 + crackle);
    } else if (kind === "drop") {
      value = (mid * 0.7 + high * 0.12) * Math.exp(-t * 60);
    }
    const attack = Math.min(1, i / (kind === "burst" ? 12 : 60));
    data[i] = Math.tanh(value * 1.35) * attack * fade * 0.85;
  }
  if (kind === "rain") {
    // Crossfade one loop seam so the rain bed never clicks on repeat.
    const overlap = SAMPLE_RATE / 5;
    for (let i = 0; i < overlap; i += 1) {
      const mix = i / overlap;
      data[data.length - overlap + i] = data[data.length - overlap + i] * (1 - mix) + data[i] * mix;
    }
    return data.slice(overlap);
  }
  return data;
}

export class SoundEngine {
  constructor() {
    this.enabled = true;
    this.context = null;
    this.buffers = {};
    this.voices = new Set();
    this.rainVoice = null;
    this.rainLevel = 0;
    this.lastRainAt = -1;
    this.variant = 0;
  }

  async unlock() {
    if (!this.enabled) return;
    if (!this.context) {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (!AudioContext) return;
      this.context = new AudioContext();
      this.master = this.context.createGain();
      this.master.gain.value = 0.7;
      const limiter = this.context.createDynamicsCompressor();
      limiter.threshold.value = -12;
      limiter.knee.value = 8;
      limiter.ratio.value = 8;
      limiter.attack.value = 0.003;
      limiter.release.value = 0.15;
      this.master.connect(limiter).connect(this.context.destination);
      for (const kind of Object.keys(DURATIONS)) {
        this.buffers[kind] = [1, 71].map((seed) => {
          const samples = synthesizeSound(kind, seed);
          const buffer = this.context.createBuffer(1, samples.length, SAMPLE_RATE);
          buffer.copyToChannel(samples, 0);
          return buffer;
        });
      }
    }
    if (this.context.state === "suspended") await this.context.resume();
  }

  play(kind, volume, pan = 0, delay = 0, rate = 1, loop = false) {
    if (!this.enabled || this.context?.state !== "running" || this.voices.size >= 16) return null;
    const source = this.context.createBufferSource();
    const gain = this.context.createGain();
    const panner = this.context.createStereoPanner();
    source.buffer = this.buffers[kind][this.variant++ % 2];
    source.playbackRate.value = rate;
    source.loop = loop;
    gain.gain.value = volume;
    panner.pan.value = Math.max(-0.65, Math.min(0.65, pan));
    source.connect(gain).connect(panner).connect(this.master);
    const voice = { source, gain, panner };
    this.voices.add(voice);
    source.onended = () => {
      source.disconnect();
      gain.disconnect();
      panner.disconnect();
      this.voices.delete(voice);
    };
    source.start(this.context.currentTime + delay);
    return voice;
  }

  launch(duration = 1.2, pan = 0) {
    this.play("launch", 0.32, pan, 0, 1 / duration);
  }

  boom(intensity = 1, pan = 0) {
    this.play("burst", 0.7 * intensity, pan, 0, 0.96 + Math.random() * 0.08);
    this.play("debris", 0.46 * intensity, pan, 0.16, 0.95 + Math.random() * 0.1);
  }

  rainDrop(intensity = 0.5) {
    if (!this.enabled || this.context?.state !== "running") return;
    const now = this.context.currentTime;
    if (now - this.lastRainAt < 0.12) return;
    this.lastRainAt = now;
    this.play("drop", 0.09 * intensity, Math.random() - 0.5, 0, 0.85 + Math.random() * 0.3);
  }

  setRain(amount) {
    if (!this.enabled || this.context?.state !== "running") return;
    const level = amount < 0.015 ? 0 : Math.min(1, amount) * 0.38;
    if (level === 0) {
      if (this.rainVoice) {
        this.rainVoice.gain.gain.setTargetAtTime(0, this.context.currentTime, 0.035);
        this.rainVoice.source.stop(this.context.currentTime + 0.15);
        this.rainVoice = null;
      }
      this.rainLevel = 0;
      return;
    }
    if (!this.rainVoice) this.rainVoice = this.play("rain", 0, 0, 0, 1, true);
    if (this.rainVoice && Math.abs(level - this.rainLevel) > 0.008) {
      this.rainVoice.gain.gain.setTargetAtTime(level, this.context.currentTime, 0.12);
      this.rainLevel = level;
    }
  }

  stop() {
    for (const voice of this.voices) {
      try { voice.source.stop(); } catch {}
      try { voice.source.disconnect(); } catch {}
      try { voice.gain.disconnect(); } catch {}
      try { voice.panner.disconnect(); } catch {}
    }
    this.voices.clear();
    this.rainVoice = null;
    this.rainLevel = 0;
  }

  setEnabled(enabled) {
    this.enabled = enabled;
    if (!enabled) this.stop();
  }

  pause() {
    this.stop();
    if (this.context?.state === "running") this.context.suspend().catch(() => {});
  }
}
