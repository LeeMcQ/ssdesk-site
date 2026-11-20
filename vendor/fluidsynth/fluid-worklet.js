import './worklet-polyfill.js';
// AudioWorklet for the FluidSynth hymn engine (js/core/fluidengine.js).
//
// FluidSynth 2.6.2 (WebAssembly, LGPL-2.1, see NOTICE.txt) makes the sound. The song is played by the small
// sequencer below rather than by FluidSynth's own file player, so the app keeps everything the standard engine
// does: words that follow the music (marker events), jump to a stanza, pause where it stopped, tempo and key
// changes while a hymn plays, and per-instrument volume.
//
// Messages in:  create {interp, polyphony} · font {buffer} · config {gain, interp, reverb, chorus}
//               song {times, msgs, end, at, play} · play · pause · stop · seek {t} · rate {r} · key {k} · trims {fam}
// Messages out: ready · created · font-loaded · pos {t} · mark {slide} · ended · error {message}
import createFluidSynthModule from './fluidsynth-2.6.2.mjs';

// Instrument family of each General MIDI program (index = program 0-127): the trims are by family.
const FAM = new Array(128).fill('');
const famRange = (name, a, b) => { for (let p = a; p <= b; p++) FAM[p] = name; };
famRange('piano', 0, 7); famRange('organ', 16, 23); famRange('bass', 32, 39); famRange('strings', 40, 51);
famRange('choir', 52, 55); famRange('brass', 56, 63); famRange('winds', 64, 79);

class FluidProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.M = null; this.fs = 0; this.bufL = 0; this.bufR = 0; this.bufN = 0;
    this.times = new Float64Array(0); this.msgs = new Uint32Array(0); this.end = 0;
    this.pos = 0; this.i = 0; this.playing = false; this.rate = 1; this.key = 0; this.done = false;
    this.sounding = new Int16Array(16 * 128).fill(-1); // note actually sounding for (channel, written note)
    this.prog = new Uint8Array(16); this.vol = new Int16Array(16).fill(-1); // last program and CC7 written per channel
    this.trims = {}; this.tick = 0;
    // If this computer cannot make the sound in time (the audio clock falls behind the wall clock), the sample
    // interpolation steps down (7 → 6 → 5 → 4) so the music does not crackle.
    this.interp = 7; this.cap = 7; this.lagT = 0; this.lagC = 0;
    this.port.onmessage = (e) => { try { this.handle(e.data); } catch (err) { this.port.postMessage({ type: 'error', message: String((err && err.message) || err) }); } };
    createFluidSynthModule().then((M) => { this.M = M; this.port.postMessage({ type: 'ready', rate: sampleRate }); },
      (err) => this.port.postMessage({ type: 'error', message: String((err && err.message) || err) }));
  }

  handle(m) {
    const M = this.M;
    if (!M) throw new Error('The music engine is still loading.');
    switch (m.type) {
      case 'create':
        if (this.fs) M._ss_fs_delete(this.fs);
        this.interp = m.interp == null ? 7 : m.interp;
        this.fs = M._ss_fs_new(sampleRate, m.polyphony || 256, Math.min(this.interp, this.cap));
        if (!this.fs) throw new Error('FluidSynth could not start.');
        this.port.postMessage({ type: 'created' });
        break;
      case 'font': {
        // FluidSynth reads every sample into memory while loading, so the file copy is removed straight after.
        M.FS.writeFile('/font.sf2', new Uint8Array(m.buffer));
        const p = M._malloc(16); M.stringToUTF8('/font.sf2', p, 16);
        const id = M._ss_fs_sfload(this.fs, p);
        M._free(p);
        try { M.FS.unlink('/font.sf2'); } catch (e) { /* */ }
        if (id < 0) throw new Error('The instrument sounds could not be loaded.');
        this.port.postMessage({ type: 'font-loaded' });
        break;
      }
      case 'config':
        if (m.interp != null) { this.interp = m.interp; M._ss_fs_set_interp(this.fs, Math.min(this.interp, this.cap)); }
        if (m.gain != null) M._ss_fs_set_gain(this.fs, m.gain);
        if (m.reverb) M._ss_fs_set_reverb(this.fs, 1, m.reverb.room, m.reverb.damp, m.reverb.width, m.reverb.level);
        if (m.chorus) M._ss_fs_set_chorus(this.fs, 1, m.chorus.nr, m.chorus.level, m.chorus.speed, m.chorus.depth);
        break;
      case 'song':
        this.silence(true);
        this.times = new Float64Array(m.times); this.msgs = new Uint32Array(m.msgs); this.end = m.end;
        this.seek(m.at || 0, false);
        this.playing = !!m.play; this.done = false;
        break;
      case 'play': this.playing = true; this.done = false; break;
      case 'pause': this.playing = false; this.silence(false); break;
      case 'stop': this.playing = false; this.done = true; this.silence(true); break;
      case 'seek': this.seek(m.t, true); break;
      case 'rate': this.rate = Math.max(0.25, Math.min(4, +m.r || 1)); break;
      case 'key': this.key = Math.max(-12, Math.min(12, m.k | 0)); break;
      case 'trims': this.trims = m.fam || {}; for (let ch = 0; ch < 16; ch++) if (ch !== 9) this.sendVol(ch); break;
      default: break;
    }
  }

  /** Release (soft) or cut (hard) every note. */
  silence(hard) {
    const M = this.M;
    if (!M || !this.fs) return;
    for (let ch = 0; ch < 16; ch++) { M._ss_fs_all_notes_off(this.fs, ch); if (hard) M._ss_fs_all_sounds_off(this.fs, ch); }
    this.sounding.fill(-1);
  }

  /** Move to t seconds (song time): cut the sound, then restore each channel's instrument and controllers as the
   *  song had them at that moment (notes start again with the next one written). */
  seek(t, keepPlaying) {
    const M = this.M;
    this.silence(true);
    // Every channel back to the General MIDI start state, then the song's own state up to t.
    for (let ch = 0; ch < 16; ch++) {
      M._ss_fs_cc(this.fs, ch, 121, 0); M._ss_fs_cc(this.fs, ch, 0, 0); M._ss_fs_cc(this.fs, ch, 32, 0);
      M._ss_fs_program(this.fs, ch, 0); M._ss_fs_pitchbend(this.fs, ch, 8192);
      M._ss_fs_cc(this.fs, ch, 7, 100); M._ss_fs_cc(this.fs, ch, 10, 64); M._ss_fs_cc(this.fs, ch, 91, 40); M._ss_fs_cc(this.fs, ch, 93, 0);
    }
    this.prog.fill(0); this.vol.fill(-1);
    for (let ch = 0; ch < 16; ch++) if (ch !== 9) this.sendVol(ch);
    const prog = new Int16Array(16).fill(-1), bend = new Int32Array(16).fill(-1), cc = new Int16Array(16 * 128).fill(-1);
    let i = 0;
    const n = this.times.length;
    for (; i < n && this.times[i] < t; i++) {
      const w = this.msgs[i], st = w & 0xff, hi = st & 0xf0, ch = st & 0x0f;
      if (hi === 0xc0) prog[ch] = (w >>> 8) & 0x7f;
      else if (hi === 0xb0) { const c = (w >>> 8) & 0x7f; if (c !== 64 && c < 120) cc[ch * 128 + c] = (w >>> 16) & 0x7f; }
      else if (hi === 0xe0) bend[ch] = ((w >>> 8) & 0x7f) | (((w >>> 16) & 0x7f) << 7);
    }
    for (let ch = 0; ch < 16; ch++) {
      for (let c = 0; c < 120; c++) if (c === 0 || c === 32) { const v = cc[ch * 128 + c]; if (v >= 0) M._ss_fs_cc(this.fs, ch, c, v); }
      if (prog[ch] >= 0) { M._ss_fs_program(this.fs, ch, prog[ch]); this.prog[ch] = prog[ch]; }
      for (let c = 1; c < 120; c++) {
        if (c === 32) continue;
        const v = cc[ch * 128 + c];
        if (v < 0) continue;
        if (c === 7) { this.vol[ch] = v; this.sendVol(ch); } else M._ss_fs_cc(this.fs, ch, c, v);
      }
      if (bend[ch] >= 0) M._ss_fs_pitchbend(this.fs, ch, bend[ch]);
    }
    this.i = i; this.pos = Math.max(0, t); this.done = false;
    if (!keepPlaying) this.playing = false;
    this.port.postMessage({ type: 'pos', t: this.pos });
  }

  /** CC7 for a channel with its instrument family's volume trim (dB) applied. */
  sendVol(ch) {
    if (!this.M || !this.fs) return;
    const db = +this.trims[FAM[this.prog[ch]]] || 0;
    if (this.vol[ch] < 0 && !db) return;
    const base = this.vol[ch] < 0 ? 100 : this.vol[ch];
    this.M._ss_fs_cc(this.fs, ch, 7, Math.max(0, Math.min(127, Math.round(base * Math.pow(10, db / 20)))));
  }

  dispatch(w) {
    const M = this.M, fs = this.fs, st = w & 0xff;
    if (st === 0) { this.port.postMessage({ type: 'mark', slide: w >>> 8 }); return; }
    const hi = st & 0xf0, ch = st & 0x0f, d1 = (w >>> 8) & 0x7f, d2 = (w >>> 16) & 0x7f;
    if (hi === 0x90 && d2 > 0) {
      const k = ch === 9 ? d1 : Math.max(0, Math.min(127, d1 + this.key));
      const s = ch * 128 + d1;
      if (this.sounding[s] >= 0) M._ss_fs_noteoff(fs, ch, this.sounding[s]);
      this.sounding[s] = k;
      M._ss_fs_noteon(fs, ch, k, d2);
    } else if (hi === 0x80 || hi === 0x90) {
      const s = ch * 128 + d1, k = this.sounding[s];
      if (k >= 0) { M._ss_fs_noteoff(fs, ch, k); this.sounding[s] = -1; }
    } else if (hi === 0xb0) {
      if (d1 === 7) { this.vol[ch] = d2; this.sendVol(ch); } else M._ss_fs_cc(fs, ch, d1, d2);
    } else if (hi === 0xc0) { M._ss_fs_program(fs, ch, d1); this.prog[ch] = d1; this.sendVol(ch); }
    else if (hi === 0xe0) M._ss_fs_pitchbend(fs, ch, d1 | (d2 << 7));
  }

  watchLoad() {
    const now = Date.now();
    if (!this.lagT || now - this.lagT > 4000) { this.lagT = now; this.lagC = currentTime; return; }   // (re)start after a pause
    if (now - this.lagT < 2000) return;
    const ratio = (currentTime - this.lagC) / ((now - this.lagT) / 1000);
    this.lagT = now; this.lagC = currentTime;
    if (ratio < 0.97 && this.cap > 4 && Math.min(this.interp, this.cap) > 4) {
      this.cap = Math.min(this.interp, this.cap) - 1;
      this.M._ss_fs_set_interp(this.fs, this.cap);
      this.port.postMessage({ type: 'slow', interp: this.cap });
    }
  }

  render(out0, out1, from, frames) {
    const M = this.M;
    if (frames > this.bufN) {
      if (this.bufL) { M._free(this.bufL); M._free(this.bufR); }
      this.bufL = M._malloc(frames * 4); this.bufR = M._malloc(frames * 4); this.bufN = frames;
    }
    M._ss_fs_render_f32(this.fs, this.bufL, this.bufR, frames);
    out0.set(new Float32Array(M.HEAPF32.buffer, this.bufL, frames), from);
    if (out1) out1.set(new Float32Array(M.HEAPF32.buffer, this.bufR, frames), from);
  }

  process(inputs, outputs) {
    const out = outputs[0], o0 = out && out[0], o1 = out && out[1];
    if (!o0) return true;
    const N = o0.length;
    if (!this.M || !this.fs) { o0.fill(0); if (o1) o1.fill(0); return true; }
    if (!this.playing) { this.render(o0, o1, 0, N); return true; }   // reverb tails ring on
    // Events fall inside this block: render up to each one so it sounds at its own sample.
    const step = this.rate / sampleRate;
    let done = 0;
    while (done < N) {
      while (this.i < this.times.length && this.times[this.i] <= this.pos) this.dispatch(this.msgs[this.i++]);
      let frames = N - done;
      if (this.i < this.times.length) frames = Math.max(1, Math.min(frames, Math.ceil((this.times[this.i] - this.pos) / step)));
      this.render(o0, o1, done, frames);
      this.pos += frames * step; done += frames;
    }
    if (++this.tick % 12 === 0) this.port.postMessage({ type: 'pos', t: this.pos });
    this.watchLoad();
    if (!this.done && this.i >= this.times.length && this.pos >= this.end) {
      this.done = true; this.playing = false; this.silence(false);
      this.port.postMessage({ type: 'ended', t: this.pos });
    }
    return true;
  }
}

registerProcessor('ssd-fluidsynth', FluidProcessor);
