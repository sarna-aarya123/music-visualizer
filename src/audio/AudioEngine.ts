/**
 * Owns the Web Audio graph and the play/pause/replace lifecycle.
 * Knows nothing about React, Three.js, or visual features — it only
 * decodes audio, plays it, and exposes an AnalyserNode for FeatureExtractor
 * to read from.
 *
 * AudioBufferSourceNode can only be started once, so "pause" is emulated:
 * we track how far into the buffer we are (startOffset) and, on resume,
 * start a fresh source node at that offset.
 */
export class AudioEngine {
  private ctx: AudioContext | null = null;
  private gainNode: GainNode | null = null;
  private analyserNode: AnalyserNode | null = null;
  private sourceNode: AudioBufferSourceNode | null = null;
  private buffer: AudioBuffer | null = null;

  private startOffset = 0;
  private startedAtCtxTime = 0;
  private playing = false;

  private onEndedCallback: (() => void) | null = null;

  /** Must be called synchronously inside a user-gesture handler before any
   *  `await`, so the browser's autoplay policy allows the context to run. */
  ensureContext(): AudioContext {
    if (!this.ctx) {
      const ctx = new AudioContext();
      const gain = ctx.createGain();
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 2048;
      // We do our own attack/release smoothing in FeatureExtractor, so we
      // want raw-ish data here.
      analyser.smoothingTimeConstant = 0;
      gain.connect(analyser);
      analyser.connect(ctx.destination);

      this.ctx = ctx;
      this.gainNode = gain;
      this.analyserNode = analyser;
    }
    if (this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
    return this.ctx;
  }

  get analyser(): AnalyserNode | null {
    return this.analyserNode;
  }

  get sampleRate(): number {
    return this.ctx?.sampleRate ?? 44100;
  }

  get duration(): number {
    return this.buffer?.duration ?? 0;
  }

  setOnEnded(cb: (() => void) | null): void {
    this.onEndedCallback = cb;
  }

  /** Decodes a new file and resets playback to the start. Throws on
   *  unsupported/corrupt audio so callers can surface an error state. */
  async loadFile(file: File): Promise<void> {
    const ctx = this.ensureContext();
    this.stopInternal();
    this.playing = false;
    this.startOffset = 0;

    const arrayBuffer = await file.arrayBuffer();
    this.buffer = await ctx.decodeAudioData(arrayBuffer);
  }

  play(): void {
    if (!this.ctx || !this.gainNode || !this.buffer || this.playing) return;
    if (this.ctx.state === 'suspended') this.ctx.resume();

    const source = this.ctx.createBufferSource();
    source.buffer = this.buffer;
    source.connect(this.gainNode);
    source.onended = () => {
      // Only fires for natural end-of-track — pause()/loadFile() detach
      // this handler before manually stopping a source.
      this.playing = false;
      this.startOffset = 0;
      this.sourceNode = null;
      this.onEndedCallback?.();
    };

    source.start(0, this.startOffset % this.buffer.duration);
    this.sourceNode = source;
    this.startedAtCtxTime = this.ctx.currentTime;
    this.playing = true;
  }

  pause(): void {
    if (!this.playing || !this.ctx) return;
    this.startOffset += this.ctx.currentTime - this.startedAtCtxTime;
    this.stopInternal();
    this.playing = false;
  }

  getCurrentTime(): number {
    if (!this.ctx) return this.startOffset;
    if (this.playing) return this.startOffset + (this.ctx.currentTime - this.startedAtCtxTime);
    return this.startOffset;
  }

  isPlaying(): boolean {
    return this.playing;
  }

  private stopInternal(): void {
    if (this.sourceNode) {
      this.sourceNode.onended = null;
      try {
        this.sourceNode.stop();
      } catch {
        // already stopped/finished — fine to ignore
      }
      this.sourceNode.disconnect();
      this.sourceNode = null;
    }
  }

  dispose(): void {
    this.stopInternal();
    this.ctx?.close();
    this.ctx = null;
    this.analyserNode = null;
    this.gainNode = null;
    this.buffer = null;
  }
}

/** Single shared instance — this app only ever plays one track at a time. */
export const audioEngine = new AudioEngine();
