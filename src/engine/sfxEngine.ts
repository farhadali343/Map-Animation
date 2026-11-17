import type { SfxCue, SfxType } from '../types/project';

let liveCtx: AudioContext | null = null;

function getLiveAudioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  if (!liveCtx) {
    const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (AudioCtx) liveCtx = new AudioCtx();
  }
  if (liveCtx && liveCtx.state === 'suspended') {
    liveCtx.resume().catch(() => {});
  }
  return liveCtx;
}

function scheduleSfxOnContext(
  ctx: BaseAudioContext,
  dest: AudioNode,
  type: SfxType,
  whenSec: number,
  volume: number,
) {
  const safeVol = Math.max(0.01, Math.min(1, volume));

  if (type === 'whoosh') {
    const dur = 0.55;
    const bufferSize = Math.floor(ctx.sampleRate * dur);
    const noiseBuf = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = noiseBuf.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = (Math.random() * 2 - 1) * 0.75;
    }
    const src = ctx.createBufferSource();
    src.buffer = noiseBuf;

    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.Q.setValueAtTime(1.8, whenSec);
    filter.frequency.setValueAtTime(160, whenSec);
    filter.frequency.exponentialRampToValueAtTime(1600, whenSec + 0.22);
    filter.frequency.exponentialRampToValueAtTime(220, whenSec + dur);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.001, whenSec);
    gain.gain.linearRampToValueAtTime(0.42 * safeVol, whenSec + 0.18);
    gain.gain.exponentialRampToValueAtTime(0.001, whenSec + dur);

    src.connect(filter);
    filter.connect(gain);
    gain.connect(dest);
    src.start(whenSec);
    src.stop(whenSec + dur);
    return;
  }

  if (type === 'pop') {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(240, whenSec);
    osc.frequency.exponentialRampToValueAtTime(720, whenSec + 0.065);
    gain.gain.setValueAtTime(0.001, whenSec);
    gain.gain.linearRampToValueAtTime(0.32 * safeVol, whenSec + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.001, whenSec + 0.11);
    osc.connect(gain);
    gain.connect(dest);
    osc.start(whenSec);
    osc.stop(whenSec + 0.12);
    return;
  }

  if (type === 'tick') {
    // Sequence of 4 crisp counter ticks
    for (let k = 0; k < 4; k++) {
      const t = whenSec + k * 0.11;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(1100 + k * 140, t);
      osc.frequency.exponentialRampToValueAtTime(480, t + 0.045);
      gain.gain.setValueAtTime(0.001, t);
      gain.gain.linearRampToValueAtTime(0.24 * safeVol, t + 0.005);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.055);
      osc.connect(gain);
      gain.connect(dest);
      osc.start(t);
      osc.stop(t + 0.06);
    }
    return;
  }

  if (type === 'stamp') {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(135, whenSec);
    osc.frequency.exponentialRampToValueAtTime(38, whenSec + 0.24);
    gain.gain.setValueAtTime(0.001, whenSec);
    gain.gain.linearRampToValueAtTime(0.65 * safeVol, whenSec + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.001, whenSec + 0.28);
    osc.connect(gain);
    gain.connect(dest);
    osc.start(whenSec);
    osc.stop(whenSec + 0.3);
    return;
  }

  if (type === 'drone') {
    const osc1 = ctx.createOscillator();
    const osc2 = ctx.createOscillator();
    const filter = ctx.createBiquadFilter();
    const gain = ctx.createGain();
    osc1.type = 'sawtooth';
    osc2.type = 'triangle';
    osc1.frequency.setValueAtTime(55, whenSec);
    osc2.frequency.setValueAtTime(82.4, whenSec);
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(180, whenSec);
    gain.gain.setValueAtTime(0.001, whenSec);
    gain.gain.linearRampToValueAtTime(0.14 * safeVol, whenSec + 1.2);
    gain.gain.linearRampToValueAtTime(0.09 * safeVol, whenSec + 6.5);
    gain.gain.exponentialRampToValueAtTime(0.001, whenSec + 8.5);
    osc1.connect(filter);
    osc2.connect(filter);
    filter.connect(gain);
    gain.connect(dest);
    osc1.start(whenSec);
    osc2.start(whenSec);
    osc1.stop(whenSec + 8.6);
    osc2.stop(whenSec + 8.6);
  }
}

export function playLiveSfx(type: SfxType, volume = 0.7) {
  const ctx = getLiveAudioContext();
  if (!ctx) return;
  scheduleSfxOnContext(ctx, ctx.destination, type, ctx.currentTime + 0.01, volume);
}

export async function renderMixedAudioBuffer(options: {
  durationMs: number;
  voiceAudioUrl: string | null;
  voiceVolume: number;
  sfxVolume: number;
  ambienceVolume: number;
  sfxCues: SfxCue[];
}): Promise<AudioBuffer> {
  const sampleRate = 44100;
  const durationSec = Math.max(1, options.durationMs / 1000);
  const frameCount = Math.ceil(durationSec * sampleRate);
  const offline = new OfflineAudioContext(2, frameCount, sampleRate);

  // 1. Optional Voiceover track
  if (options.voiceAudioUrl && options.voiceVolume > 0) {
    try {
      const resp = await fetch(options.voiceAudioUrl);
      const arr = await resp.arrayBuffer();
      const decoded = await offline.decodeAudioData(arr);
      const src = offline.createBufferSource();
      src.buffer = decoded;
      const gain = offline.createGain();
      gain.gain.setValueAtTime(options.voiceVolume, 0);
      src.connect(gain);
      gain.connect(offline.destination);
      src.start(0);
    } catch {
      // Ignore if audio URL cannot be decoded
    }
  }

  // 2. Subtle documentary ambient sub-bed across timeline
  if (options.ambienceVolume > 0.01) {
    const osc = offline.createOscillator();
    const oscSub = offline.createOscillator();
    const filter = offline.createBiquadFilter();
    const gain = offline.createGain();
    osc.type = 'sine';
    oscSub.type = 'triangle';
    osc.frequency.setValueAtTime(65.4, 0); // C2
    oscSub.frequency.setValueAtTime(98.0, 0); // G2
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(160, 0);
    gain.gain.setValueAtTime(0.001, 0);
    gain.gain.linearRampToValueAtTime(0.07 * options.ambienceVolume, 0.8);
    gain.gain.setValueAtTime(0.07 * options.ambienceVolume, Math.max(0.9, durationSec - 0.8));
    gain.gain.linearRampToValueAtTime(0.001, durationSec);
    osc.connect(filter);
    oscSub.connect(filter);
    filter.connect(gain);
    gain.connect(offline.destination);
    osc.start(0);
    oscSub.start(0);
    osc.stop(durationSec);
    oscSub.stop(durationSec);
  }

  // 3. Scheduled SFX cues
  if (options.sfxVolume > 0.01) {
    for (const cue of options.sfxCues) {
      const whenSec = cue.timeMs / 1000;
      if (whenSec >= 0 && whenSec < durationSec) {
        scheduleSfxOnContext(offline, offline.destination, cue.type, whenSec, cue.volume * options.sfxVolume);
      }
    }
  }

  return offline.startRendering();
}

export function computeWaveformPeaks(audioBuffer: AudioBuffer, bars = 96): number[] {
  const ch = audioBuffer.getChannelData(0);
  const step = Math.max(1, Math.floor(ch.length / bars));
  const peaks: number[] = [];
  for (let i = 0; i < bars; i++) {
    let maxVal = 0;
    const start = i * step;
    const end = Math.min(ch.length, start + step);
    for (let j = start; j < end; j += Math.max(1, Math.floor(step / 24))) {
      const v = Math.abs(ch[j]);
      if (v > maxVal) maxVal = v;
    }
    peaks.push(Math.min(1, Math.max(0.08, maxVal)));
  }
  return peaks;
}
