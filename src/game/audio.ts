export class ProceduralAudio {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private engineOsc1: OscillatorNode | null = null;
  private engineOsc2: OscillatorNode | null = null;
  private engineGain: GainNode | null = null;
  private engineFilter: BiquadFilterNode | null = null;
  private muted = false;
  private initialized = false;

  public unlock(): void {
    if (this.initialized) {
      if (this.ctx && this.ctx.state === 'suspended') {
        void this.ctx.resume();
      }
      return;
    }

    const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return;

    try {
      const ctx = new AudioCtx();
      this.ctx = ctx;

      const master = ctx.createGain();
      master.gain.value = this.muted ? 0 : 0.35;
      master.connect(ctx.destination);
      this.masterGain = master;

      // Friendly warm monster truck rumble (sawtooth + triangle low-passed)
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 180;
      filter.Q.value = 2.0;

      const engineGain = ctx.createGain();
      engineGain.gain.value = 0.08;

      const osc1 = ctx.createOscillator();
      osc1.type = 'sawtooth';
      osc1.frequency.value = 48;

      const osc2 = ctx.createOscillator();
      osc2.type = 'triangle';
      osc2.frequency.value = 96;

      osc1.connect(filter);
      osc2.connect(filter);
      filter.connect(engineGain);
      engineGain.connect(master);

      osc1.start();
      osc2.start();

      this.engineOsc1 = osc1;
      this.engineOsc2 = osc2;
      this.engineFilter = filter;
      this.engineGain = engineGain;
      this.initialized = true;
    } catch {
      // Ignore audio errors if blocked by browser policy
    }
  }

  public setMuted(muted: boolean): void {
    this.muted = muted;
    if (this.masterGain && this.ctx) {
      this.masterGain.gain.setTargetAtTime(muted ? 0 : 0.35, this.ctx.currentTime, 0.05);
    }
  }

  public isMuted(): boolean {
    return this.muted;
  }

  public updateEngine(speedRatio: number, throttle: boolean, boosting: boolean): void {
    if (!this.ctx || !this.engineOsc1 || !this.engineOsc2 || !this.engineFilter || !this.engineGain) {
      return;
    }
    const now = this.ctx.currentTime;
    const clamped = Math.min(1.4, Math.max(0, speedRatio));
    const baseFreq = 44 + clamped * 62 + (boosting ? 18 : 0);
    this.engineOsc1.frequency.setTargetAtTime(baseFreq, now, 0.08);
    this.engineOsc2.frequency.setTargetAtTime(baseFreq * 1.98, now, 0.08);
    this.engineFilter.frequency.setTargetAtTime(160 + clamped * 380 + (throttle ? 110 : 0), now, 0.08);
    this.engineGain.gain.setTargetAtTime(throttle || boosting ? 0.14 : 0.06, now, 0.1);
  }

  public playHorn(): void {
    this.unlock();
    if (!this.ctx || !this.masterGain || this.muted) return;
    const now = this.ctx.currentTime;

    // Cheerful two-tone monster truck air horn
    const freqs = [349.23, 440.0];
    freqs.forEach((f) => {
      if (!this.ctx || !this.masterGain) return;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(f, now);
      osc.frequency.exponentialRampToValueAtTime(f * 0.98, now + 0.32);

      const filter = this.ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 1400;

      gain.gain.setValueAtTime(0.001, now);
      gain.gain.linearRampToValueAtTime(0.22, now + 0.03);
      gain.gain.setValueAtTime(0.22, now + 0.22);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.36);

      osc.connect(filter);
      filter.connect(gain);
      gain.connect(this.masterGain);
      osc.start(now);
      osc.stop(now + 0.38);
    });
  }

  public playStarChime(): void {
    this.unlock();
    if (!this.ctx || !this.masterGain || this.muted) return;
    const now = this.ctx.currentTime;
    const notes = [523.25, 659.25, 783.99, 1046.5];
    notes.forEach((freq, idx) => {
      if (!this.ctx || !this.masterGain) return;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'sine';
      const start = now + idx * 0.055;
      osc.frequency.setValueAtTime(freq, start);
      gain.gain.setValueAtTime(0.001, start);
      gain.gain.linearRampToValueAtTime(0.18, start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, start + 0.32);
      osc.connect(gain);
      gain.connect(this.masterGain);
      osc.start(start);
      osc.stop(start + 0.35);
    });
  }

  public playSplash(strength = 1.0): void {
    this.unlock();
    if (!this.ctx || !this.masterGain || this.muted) return;
    const now = this.ctx.currentTime;
    const s = Math.min(1.4, Math.max(0.4, strength));

    // Crisp water spray hiss
    const bufferSize = Math.floor(this.ctx.sampleRate * 0.32);
    const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / bufferSize, 1.3);
    }

    const noise = this.ctx.createBufferSource();
    noise.buffer = buffer;

    const filter = this.ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(1150, now);
    filter.frequency.exponentialRampToValueAtTime(380, now + 0.3);
    filter.Q.value = 1.1;

    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.26 * s, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.31);

    noise.connect(filter);
    filter.connect(gain);
    gain.connect(this.masterGain);
    noise.start(now);

    // Bubbly low "kerplunk" drop
    const drop = this.ctx.createOscillator();
    const dropGain = this.ctx.createGain();
    drop.type = 'sine';
    drop.frequency.setValueAtTime(160, now);
    drop.frequency.exponentialRampToValueAtTime(340, now + 0.08);
    drop.frequency.exponentialRampToValueAtTime(110, now + 0.22);
    dropGain.gain.setValueAtTime(0.18 * s, now);
    dropGain.gain.exponentialRampToValueAtTime(0.001, now + 0.22);
    drop.connect(dropGain);
    dropGain.connect(this.masterGain);
    drop.start(now);
    drop.stop(now + 0.24);
  }

  public playPropSmash(): void {
    this.unlock();
    if (!this.ctx || !this.masterGain || this.muted) return;
    const now = this.ctx.currentTime;

    // Playful wooden pop + crunch
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(240, now);
    osc.frequency.exponentialRampToValueAtTime(85, now + 0.14);
    gain.gain.setValueAtTime(0.24, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.16);
    osc.connect(gain);
    gain.connect(this.masterGain);
    osc.start(now);
    osc.stop(now + 0.17);

    const bufLen = Math.floor(this.ctx.sampleRate * 0.12);
    const buf = this.ctx.createBuffer(1, bufLen, this.ctx.sampleRate);
    const ch = buf.getChannelData(0);
    for (let i = 0; i < bufLen; i++) {
      ch[i] = (Math.random() * 2 - 1) * (1 - i / bufLen);
    }
    const noise = this.ctx.createBufferSource();
    noise.buffer = buf;
    const bp = this.ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 1400;
    const nGain = this.ctx.createGain();
    nGain.gain.setValueAtTime(0.18, now);
    nGain.gain.exponentialRampToValueAtTime(0.001, now + 0.12);
    noise.connect(bp);
    bp.connect(nGain);
    nGain.connect(this.masterGain);
    noise.start(now);
  }

  public playAnimalChirp(kind: 'deer' | 'fox' | 'duck'): void {
    this.unlock();
    if (!this.ctx || !this.masterGain || this.muted) return;
    const now = this.ctx.currentTime;

    if (kind === 'duck') {
      // Friendly double quack
      [0, 0.14].forEach((offset) => {
        if (!this.ctx || !this.masterGain) return;
        const osc = this.ctx.createOscillator();
        const filter = this.ctx.createBiquadFilter();
        const gain = this.ctx.createGain();
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(420, now + offset);
        osc.frequency.exponentialRampToValueAtTime(290, now + offset + 0.09);
        filter.type = 'bandpass';
        filter.frequency.value = 1100;
        filter.Q.value = 2.6;
        gain.gain.setValueAtTime(0.001, now + offset);
        gain.gain.linearRampToValueAtTime(0.18, now + offset + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.001, now + offset + 0.11);
        osc.connect(filter);
        filter.connect(gain);
        gain.connect(this.masterGain);
        osc.start(now + offset);
        osc.stop(now + offset + 0.12);
      });
    } else if (kind === 'fox') {
      // Cheerful playful yip
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(620, now);
      osc.frequency.exponentialRampToValueAtTime(980, now + 0.07);
      osc.frequency.exponentialRampToValueAtTime(540, now + 0.16);
      gain.gain.setValueAtTime(0.16, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.18);
      osc.connect(gain);
      gain.connect(this.masterGain);
      osc.start(now);
      osc.stop(now + 0.19);
    } else {
      // Gentle forest deer bleat/chirp
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(480, now);
      osc.frequency.linearRampToValueAtTime(640, now + 0.08);
      osc.frequency.exponentialRampToValueAtTime(440, now + 0.22);
      gain.gain.setValueAtTime(0.15, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.24);
      osc.connect(gain);
      gain.connect(this.masterGain);
      osc.start(now);
      osc.stop(now + 0.25);
    }
  }

  public playFireworkBurst(): void {
    this.unlock();
    if (!this.ctx || !this.masterGain || this.muted) return;
    const now = this.ctx.currentTime;

    // Bright pop + sparkling crackle
    const bufLen = Math.floor(this.ctx.sampleRate * 0.45);
    const buf = this.ctx.createBuffer(1, bufLen, this.ctx.sampleRate);
    const ch = buf.getChannelData(0);
    for (let i = 0; i < bufLen; i++) {
      ch[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / bufLen, 1.5);
    }
    const src = this.ctx.createBufferSource();
    src.buffer = buf;

    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(2200, now);
    filter.frequency.exponentialRampToValueAtTime(420, now + 0.42);

    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.24, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.44);

    src.connect(filter);
    filter.connect(gain);
    gain.connect(this.masterGain);
    src.start(now);

    const sparkle = this.ctx.createOscillator();
    const sGain = this.ctx.createGain();
    sparkle.type = 'sine';
    sparkle.frequency.setValueAtTime(880 + Math.random() * 420, now);
    sparkle.frequency.exponentialRampToValueAtTime(260, now + 0.22);
    sGain.gain.setValueAtTime(0.12, now);
    sGain.gain.exponentialRampToValueAtTime(0.001, now + 0.24);
    sparkle.connect(sGain);
    sGain.connect(this.masterGain);
    sparkle.start(now);
    sparkle.stop(now + 0.25);
  }

  public playCelebrationFanfare(): void {
    this.unlock();
    if (!this.ctx || !this.masterGain || this.muted) return;
    const now = this.ctx.currentTime;
    const notes = [523.25, 659.25, 783.99, 1046.5, 1318.5];
    notes.forEach((freq, idx) => {
      if (!this.ctx || !this.masterGain) return;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'triangle';
      const start = now + idx * 0.09;
      osc.frequency.setValueAtTime(freq, start);
      gain.gain.setValueAtTime(0.001, start);
      gain.gain.linearRampToValueAtTime(0.22, start + 0.03);
      gain.gain.exponentialRampToValueAtTime(0.001, start + 0.55);
      osc.connect(gain);
      gain.connect(this.masterGain);
      osc.start(start);
      osc.stop(start + 0.58);
    });
  }

  public playLandingThump(strength: number): void {
    if (!this.ctx || !this.masterGain || this.muted) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(110, now);
    osc.frequency.exponentialRampToValueAtTime(38, now + 0.16);
    const vol = Math.min(0.32, Math.max(0.06, strength * 0.22));
    gain.gain.setValueAtTime(vol, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.18);
    osc.connect(gain);
    gain.connect(this.masterGain);
    osc.start(now);
    osc.stop(now + 0.2);
  }

  public dispose(): void {
    try {
      this.engineOsc1?.stop();
      this.engineOsc2?.stop();
      void this.ctx?.close();
    } catch {
      // Ignore cleanup errors
    }
    this.ctx = null;
    this.initialized = false;
  }
}
