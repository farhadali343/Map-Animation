import {
  AudioBufferSource,
  BufferTarget,
  CanvasSource,
  Mp4OutputFormat,
  Output,
  QUALITY_HIGH,
  WebMOutputFormat,
  getFirstEncodableAudioCodec,
  getFirstEncodableVideoCodec,
} from 'mediabunny';
import type { MapProject, SubtitleTrack } from '../types/project';
import { preloadHybridTilesForProject } from './hybridTileManager';
import { interpolateCamera, renderMapFrame } from './mapCompositor';
import { renderMixedAudioBuffer } from './sfxEngine';

export interface ExportOptions {
  width: number; // e.g. 1080 or 720
  height: number; // e.g. 1920 or 1280
  fps: 30 | 60;
  includeSubtitles: boolean;
  onProgress: (pct: number, statusText: string) => void;
}

export interface ExportResult {
  blob: Blob;
  filename: string;
  mimeType: string;
  extension: 'mp4' | 'webm';
}

export async function exportProjectToMp4(project: MapProject, options: ExportOptions): Promise<ExportResult> {
  const { width, height, fps, includeSubtitles, onProgress } = options;

  const renderProject: MapProject = {
    ...project,
    showSubtitles: includeSubtitles && project.showSubtitles,
    showSafeZones: false,
  };

  onProgress(2, 'Pre-loading hybrid satellite map tiles for all scenes...');
  await preloadHybridTilesForProject(renderProject, width, height, interpolateCamera, (pct, msg) => {
    onProgress(2 + Math.round(pct * 0.14), msg);
  });

  onProgress(17, 'Preparing audio mix (voiceover + SFX + ambience)...');
  const mixedAudio = await renderMixedAudioBuffer({
    durationMs: project.durationMs,
    voiceAudioUrl: project.audio.audioUrl,
    voiceVolume: project.audio.voiceVolume,
    sfxVolume: project.audio.sfxVolume,
    ambienceVolume: project.audio.ambienceVolume,
    sfxCues: project.sfxCues,
  });

  // Determine supported codecs (prefer MP4 H.264 + AAC, fallback cleanly to WebM VP9 + Opus if needed)
  let useMp4 = true;
  let videoCodec = await getFirstEncodableVideoCodec(['avc', 'hevc', 'vp9'], { width, height });
  let audioCodec = await getFirstEncodableAudioCodec(['aac', 'opus']);

  if (!videoCodec || !audioCodec || (videoCodec !== 'avc' && videoCodec !== 'hevc')) {
    const webmVideo = await getFirstEncodableVideoCodec(['vp9', 'vp8'], { width, height });
    const webmAudio = await getFirstEncodableAudioCodec(['opus', 'vorbis']);
    if (webmVideo && webmAudio) {
      useMp4 = false;
      videoCodec = webmVideo;
      audioCodec = webmAudio;
    }
  }

  if (!videoCodec || !audioCodec) {
    throw new Error('This browser does not support WebCodecs video/audio encoding.');
  }

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Unable to initialize 2D export canvas.');

  const target = new BufferTarget();
  const format = useMp4 ? new Mp4OutputFormat() : new WebMOutputFormat();
  const output = new Output({ format, target });

  const canvasSource = new CanvasSource(canvas, {
    codec: videoCodec,
    bitrate: QUALITY_HIGH,
  });
  const audioSource = new AudioBufferSource({
    codec: audioCodec,
    bitrate: QUALITY_HIGH,
  });

  output.addVideoTrack(canvasSource, { frameRate: fps });
  output.addAudioTrack(audioSource);

  await output.start();

  onProgress(22, 'Encoding mixed audio track...');
  await audioSource.add(mixedAudio);
  audioSource.close();

  const totalFrames = Math.max(1, Math.ceil((project.durationMs / 1000) * fps));
  const frameDurationSec = 1 / fps;

  for (let frameIdx = 0; frameIdx < totalFrames; frameIdx++) {
    const timeSec = frameIdx * frameDurationSec;
    const timeMs = timeSec * 1000;

    renderMapFrame(ctx, renderProject, timeMs, width, height, {
      includeSafeZones: false,
      useLayeredOffscreen: true,
      qualityTier: 'full',
    });
    await canvasSource.add(timeSec, frameDurationSec, { keyFrame: frameIdx % fps === 0 });

    if (frameIdx % 6 === 0 || frameIdx === totalFrames - 1) {
      const pct = 24 + Math.round(((frameIdx + 1) / totalFrames) * 72);
      onProgress(pct, `Rendering frame ${frameIdx + 1} / ${totalFrames} (${width}×${height})...`);
    }
  }

  canvasSource.close();
  onProgress(98, 'Finalizing container...');
  await output.finalize();

  const buffer = target.buffer;
  if (!buffer) throw new Error('Export finalized with empty output buffer.');

  const ext = useMp4 ? 'mp4' : 'webm';
  const mimeType = useMp4 ? 'video/mp4' : 'video/webm';
  const safeName = project.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'cartoreel-map';

  onProgress(100, 'Export complete!');
  return {
    blob: new Blob([buffer], { type: mimeType }),
    filename: `${safeName}-9x16.${ext}`,
    mimeType,
    extension: ext,
  };
}

function formatSrtTime(ms: number): string {
  const clamped = Math.max(0, Math.round(ms));
  const h = Math.floor(clamped / 3600000);
  const m = Math.floor((clamped % 3600000) / 60000);
  const s = Math.floor((clamped % 60000) / 1000);
  const rem = clamped % 1000;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')},${String(rem).padStart(3, '0')}`;
}

export function buildSrtContent(track: SubtitleTrack, wordsPerCue = 4): string {
  const lines: string[] = [];
  let idx = 1;
  for (let i = 0; i < track.words.length; i += wordsPerCue) {
    const chunk = track.words.slice(i, i + wordsPerCue);
    if (chunk.length === 0) continue;
    lines.push(String(idx++));
    lines.push(`${formatSrtTime(chunk[0].startMs)} --> ${formatSrtTime(chunk[chunk.length - 1].endMs)}`);
    lines.push(chunk.map((w) => w.word).join(' '));
    lines.push('');
  }
  return lines.join('\n');
}
