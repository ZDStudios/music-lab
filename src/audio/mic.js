/* Microphone pitch tracking, so you can hum a melody into the grid. */

export class MicPitch {
  constructor(ctx) {
    this.ctx = ctx;
    this.stream = null;
    this.analyser = null;
    this.buf = null;
  }

  get active() {
    return !!this.analyser;
  }

  async start() {
    if (this.analyser) return true;
    if (!navigator.mediaDevices?.getUserMedia) return false;
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
    const src = this.ctx.createMediaStreamSource(this.stream);
    const hp = this.ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 60;
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 2048;
    src.connect(hp).connect(this.analyser);
    this.buf = new Float32Array(this.analyser.fftSize);
    return true;
  }

  stop() {
    if (this.stream) this.stream.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.analyser = null;
    this.buf = null;
  }

  /** Autocorrelation pitch detection. Returns null when the input is too quiet. */
  read() {
    if (!this.analyser) return null;
    const buf = this.buf;
    this.analyser.getFloatTimeDomainData(buf);
    const n = buf.length;

    let rms = 0;
    for (let i = 0; i < n; i++) rms += buf[i] * buf[i];
    rms = Math.sqrt(rms / n);
    if (rms < 0.012) return null;

    // Trim near-silent edges to sharpen the correlation.
    const thresh = 0.2;
    let start = 0;
    let end = n - 1;
    while (start < n / 2 && Math.abs(buf[start]) < thresh) start++;
    while (end > n / 2 && Math.abs(buf[end]) < thresh) end--;
    const slice = buf.slice(start, end);
    const len = slice.length;
    if (len < 256) return null;

    const c = new Float32Array(len).fill(0);
    for (let lag = 0; lag < len; lag++) {
      let sum = 0;
      for (let i = 0; i < len - lag; i++) sum += slice[i] * slice[i + lag];
      c[lag] = sum;
    }

    let d = 0;
    while (d < len - 1 && c[d] > c[d + 1]) d++;
    let maxVal = -1;
    let maxLag = -1;
    for (let lag = d; lag < len; lag++) {
      if (c[lag] > maxVal) { maxVal = c[lag]; maxLag = lag; }
    }
    if (maxLag <= 0 || c[0] <= 0) return null;

    // Parabolic interpolation around the peak for sub-sample accuracy.
    const y1 = c[maxLag - 1] || 0;
    const y2 = c[maxLag];
    const y3 = c[maxLag + 1] || 0;
    const a = (y1 + y3 - 2 * y2) / 2;
    const b = (y3 - y1) / 2;
    const lag = a ? maxLag - b / (2 * a) : maxLag;

    const freq = this.ctx.sampleRate / lag;
    if (freq < 65 || freq > 1600) return null;
    return { freq, clarity: maxVal / c[0], rms };
  }
}
