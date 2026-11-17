import { useEffect, useMemo, useRef, useState } from 'react';
import { AudioLines, Clapperboard, FileAudio, Mic, Upload } from 'lucide-react';
import { buildWordTimingsFromText } from '../data/presets';
import { computeWaveformPeaks } from '../engine/sfxEngine';
import type { MapProject, ThemePresetId, VoicePersona, WordTiming } from '../types/project';

interface ScriptAudioDrawerProps {
  project: MapProject;
  onUpdateProject: (updater: (prev: MapProject) => MapProject) => void;
  onBuildComplete?: () => void;
}

const VOICES: Array<{ id: VoicePersona; label: string; tone: string }> = [
  { id: 'Charon', label: 'Charon', tone: 'Deep Documentary' },
  { id: 'Fenrir', label: 'Fenrir', tone: 'Dramatic Thriller' },
  { id: 'Kore', label: 'Kore', tone: 'Crisp Storytelling' },
  { id: 'Puck', label: 'Puck', tone: 'Fast Explainer' },
  { id: 'Zephyr', label: 'Zephyr', tone: 'Warm Editorial' },
];

function parseTranscriptInput(raw: string, fallbackDurationMs: number): { text: string; words: WordTiming[]; timed: boolean } {
  const trimmed = raw.trim();
  if (!trimmed) return { text: '', words: [], timed: false };

  // JSON array of { word, startMs, endMs } or { word, start, end }
  if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
    try {
      const parsed = JSON.parse(trimmed);
      const arr = Array.isArray(parsed) ? parsed : parsed.words;
      if (Array.isArray(arr) && arr.length > 0) {
        const words: WordTiming[] = arr
          .map((item: any, idx: number) => ({
            id: `up-w-${idx + 1}`,
            word: String(item.word || item.text || '').trim(),
            startMs: typeof item.startMs === 'number' ? item.startMs : Math.round((Number(item.start) || 0) * 1000),
            endMs: typeof item.endMs === 'number' ? item.endMs : Math.round((Number(item.end) || 0.3) * 1000),
          }))
          .filter((w) => w.word.length > 0);
        if (words.length > 0) {
          return { text: words.map((w) => w.word).join(' '), words, timed: true };
        }
      }
    } catch {
      // Fall through to SRT / VTT / plain text
    }
  }

  // SRT / WebVTT blocks
  if (trimmed.includes('-->')) {
    const blocks = trimmed.replace(/^WEBVTT[^\n]*\n+/i, '').split(/\r?\n\r?\n/);
    const outWords: WordTiming[] = [];
    const textParts: string[] = [];
    const toMs = (t: string) => {
      const clean = t.trim().split(/\s+/)[0];
      const parts = clean.match(/(?:(\d+):)?(\d+):(\d+)[,.](\d+)/);
      if (!parts) return 0;
      const h = Number(parts[1] || 0);
      const m = Number(parts[2] || 0);
      const s = Number(parts[3] || 0);
      const ms = Number(parts[4].padEnd(3, '0').slice(0, 3));
      return h * 3600000 + m * 60000 + s * 1000 + ms;
    };
    for (const block of blocks) {
      const lines = block.split(/\r?\n/).filter(Boolean);
      const timeLineIdx = lines.findIndex((l) => l.includes('-->'));
      if (timeLineIdx === -1) continue;
      const [sStr, eStr] = lines[timeLineIdx].split('-->');
      const startMs = toMs(sStr);
      const endMs = Math.max(startMs + 120, toMs(eStr));
      const phrase = lines
        .slice(timeLineIdx + 1)
        .join(' ')
        .replace(/<[^>]+>/g, '')
        .trim();
      if (!phrase) continue;
      textParts.push(phrase);
      const tokens = phrase.split(/\s+/);
      const step = Math.max(100, endMs - startMs) / Math.max(1, tokens.length);
      tokens.forEach((tok, idx) => {
        outWords.push({
          id: `srt-w-${outWords.length + 1}`,
          word: tok,
          startMs: Math.round(startMs + idx * step),
          endMs: Math.round(startMs + (idx + 1) * step),
        });
      });
    }
    if (outWords.length > 0) {
      return { text: textParts.join(' '), words: outWords, timed: true };
    }
  }

  return { text: trimmed, words: buildWordTimingsFromText(trimmed, fallbackDurationMs), timed: false };
}

export function ScriptAudioDrawer({ project, onUpdateProject, onBuildComplete }: ScriptAudioDrawerProps) {
  const [mode, setMode] = useState<'upload-vo' | 'script-voice'>('upload-vo');
  const [scriptDraft, setScriptDraft] = useState(project.scriptText);
  const [transcriptDraft, setTranscriptDraft] = useState('');
  const [uploadedAudioName, setUploadedAudioName] = useState<string | null>(null);
  const [uploadedBase64, setUploadedBase64] = useState<string | null>(null);
  const [uploadedMime, setUploadedMime] = useState<string>('audio/mpeg');
  const [uploadedAudioUrl, setUploadedAudioUrl] = useState<string | null>(null);
  const [uploadedDurationMs, setUploadedDurationMs] = useState<number>(project.durationMs);
  const [uploadedPeaks, setUploadedPeaks] = useState<number[] | null>(null);
  const [busyStep, setBusyStep] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    setScriptDraft(project.scriptText);
  }, [project.id, project.scriptText]);

  const audioInputRef = useRef<HTMLInputElement>(null);
  const transcriptInputRef = useRef<HTMLInputElement>(null);

  const parsedTranscriptPreview = useMemo(
    () => parseTranscriptInput(transcriptDraft, uploadedDurationMs),
    [transcriptDraft, uploadedDurationMs],
  );

  const handleAudioFileChange = async (file: File | undefined) => {
    if (!file) return;
    setErrorMsg(null);
    setUploadedAudioName(file.name);
    setUploadedMime(file.type || 'audio/mpeg');

    const objUrl = URL.createObjectURL(file);
    setUploadedAudioUrl(objUrl);

    const buf = await file.arrayBuffer();
    const bytes = new Uint8Array(buf);
    let binary = '';
    for (let i = 0; i < bytes.byteLength; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    setUploadedBase64(btoa(binary));

    try {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const ctx = new AudioCtx();
      const decoded = await ctx.decodeAudioData(buf.slice(0));
      const durMs = Math.max(2000, Math.round(decoded.duration * 1000));
      const peaks = computeWaveformPeaks(decoded, 48);
      setUploadedDurationMs(durMs);
      setUploadedPeaks(peaks);
      onUpdateProject((prev) => ({
        ...prev,
        durationMs: durMs,
        audio: {
          ...prev.audio,
          sourceType: 'uploaded',
          audioUrl: objUrl,
          waveformPeaks: computeWaveformPeaks(decoded, 84),
        },
      }));
      ctx.close().catch(() => {});
    } catch {
      // Non-fatal fallback
    }
  };

  const handleTranscriptFileChange = async (file: File | undefined) => {
    if (!file) return;
    const text = await file.text();
    setTranscriptDraft(text);
  };

  const handleBuildFromUploadedVO = async () => {
    if (!uploadedBase64 && !transcriptDraft.trim()) {
      setErrorMsg('Upload a voiceover audio file or paste your transcript first.');
      return;
    }
    setErrorMsg(null);

    try {
      let words: WordTiming[] = [];
      let fullText = transcriptDraft.trim();

      if (parsedTranscriptPreview.timed && parsedTranscriptPreview.words.length > 0) {
        fullText = parsedTranscriptPreview.text;
        words = parsedTranscriptPreview.words;
        // Expand project duration if transcript extends beyond fallback
        const lastEnd = words[words.length - 1]?.endMs || uploadedDurationMs;
        if (!uploadedBase64 && lastEnd > uploadedDurationMs) {
          setUploadedDurationMs(lastEnd + 400);
        }
      } else if (uploadedBase64) {
        setBusyStep('Aligning word timestamps to audio...');
        const tRes = await fetch('/api/ai/transcribe', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            audioBase64: uploadedBase64,
            mimeType: uploadedMime,
            providedTranscript: transcriptDraft.trim() || undefined,
            durationMs: uploadedDurationMs,
          }),
        });
        const tData = await tRes.json();
        if (!tRes.ok) throw new Error(tData.error || 'Voiceover alignment failed');
        fullText = tData.fullText;
        words = tData.words;
      } else {
        fullText = parsedTranscriptPreview.text;
        words = parsedTranscriptPreview.words;
      }

      const finalDurationMs =
        uploadedBase64
          ? uploadedDurationMs
          : Math.max(8000, words[words.length - 1]?.endMs ? words[words.length - 1].endMs + 500 : uploadedDurationMs);

      setBusyStep('Building scenes, map routes & supporting assets...');
      const dirRes = await fetch('/api/ai/direct-storyboard', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          topicOrScript: fullText,
          words,
          durationMs: finalDurationMs,
          themePreset: project.themePreset,
          generateScriptIfTopic: false,
        }),
      });
      const dirData = await dirRes.json();
      if (!dirRes.ok) throw new Error(dirData.error || 'Map sequence build failed');

      setScriptDraft(dirData.scriptText);
      onUpdateProject((prev) => ({
        ...prev,
        title: dirData.title,
        scriptText: dirData.scriptText,
        durationMs: finalDurationMs,
        activeLanguageCode: 'en',
        subtitleTracks: [{ languageCode: 'en', languageName: 'English', words }],
        hybridMap: { enabled: true, showBordersAndLabels: false, showHighways: false, satelliteOpacity: 0.94, labelOpacity: 0.85 },
        audio: {
          ...prev.audio,
          sourceType: uploadedAudioUrl ? 'uploaded' : prev.audio.sourceType,
          audioUrl: uploadedAudioUrl || prev.audio.audioUrl,
        },
        cameraKeyframes: dirData.cameraKeyframes,
        regionMasks: dirData.regionMasks,
        routes: dirData.routes,
        overlays: dirData.overlays,
        sfxCues: dirData.sfxCues,
      }));
      onBuildComplete?.();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Unable to build video from voiceover.');
    } finally {
      setBusyStep(null);
    }
  };

  const handleBuildFromScript = async () => {
    if (!scriptDraft.trim()) {
      setErrorMsg('Enter a topic or narration script first.');
      return;
    }
    setErrorMsg(null);

    try {
      setBusyStep('Mapping locations & visual assets...');
      const dirRes = await fetch('/api/ai/direct-storyboard', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          topicOrScript: scriptDraft.trim(),
          durationMs: 24000,
          themePreset: project.themePreset,
          generateScriptIfTopic: true,
        }),
      });
      const dirData = await dirRes.json();
      if (!dirRes.ok) throw new Error(dirData.error || 'Storyboard build failed');

      const finalScript = dirData.scriptText || scriptDraft.trim();
      setScriptDraft(finalScript);

      setBusyStep(`Recording narrator voice (${project.audio.voiceName})...`);
      const ttsRes = await fetch('/api/ai/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: finalScript,
          voiceName: project.audio.voiceName,
          style: project.audio.voiceStyle,
        }),
      });
      const ttsData = await ttsRes.json();
      if (!ttsRes.ok) throw new Error(ttsData.error || 'Narrator audio synthesis failed');

      const wavBytes = Uint8Array.from(atob(ttsData.audioBase64), (c) => c.charCodeAt(0));
      const wavBlob = new Blob([wavBytes], { type: 'audio/wav' });
      const wavUrl = URL.createObjectURL(wavBlob);
      const actualDuration = Math.max(4000, Number(ttsData.durationMs) || 22000);

      let peaks = project.audio.waveformPeaks;
      try {
        const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        const ctx = new AudioCtx();
        const decoded = await ctx.decodeAudioData(wavBytes.buffer.slice(0));
        peaks = computeWaveformPeaks(decoded, 84);
        ctx.close().catch(() => {});
      } catch {
        // Ignore
      }

      const scaleRatio = actualDuration / 24000;
      const scaleTime = (t: number) => Math.round(t * scaleRatio);
      const words = buildWordTimingsFromText(finalScript, actualDuration);

      onUpdateProject((prev) => ({
        ...prev,
        title: dirData.title,
        scriptText: finalScript,
        durationMs: actualDuration,
        activeLanguageCode: 'en',
        subtitleTracks: [{ languageCode: 'en', languageName: 'English', words }],
        hybridMap: { enabled: true, showBordersAndLabels: false, showHighways: false, satelliteOpacity: 0.94, labelOpacity: 0.85 },
        audio: {
          ...prev.audio,
          sourceType: 'ai-tts',
          audioUrl: wavUrl,
          audioBase64: ttsData.audioBase64,
          mimeType: 'audio/wav',
          waveformPeaks: peaks,
        },
        cameraKeyframes: dirData.cameraKeyframes.map((k: any) => ({ ...k, timeMs: scaleTime(k.timeMs) })),
        regionMasks: dirData.regionMasks.map((r: any) => ({ ...r, startMs: scaleTime(r.startMs), endMs: scaleTime(r.endMs) })),
        routes: dirData.routes.map((r: any) => ({ ...r, startMs: scaleTime(r.startMs), endMs: scaleTime(r.endMs) })),
        overlays: dirData.overlays.map((o: any) => ({ ...o, startMs: scaleTime(o.startMs), endMs: scaleTime(o.endMs) })),
        sfxCues: dirData.sfxCues.map((s: any) => ({ ...s, timeMs: scaleTime(s.timeMs) })),
      }));
      onBuildComplete?.();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Unable to build video.');
    } finally {
      setBusyStep(null);
    }
  };

  return (
    <aside className="w-full xl:w-[340px] shrink-0 border-r border-white/8 bg-[#111722] flex flex-col overflow-hidden">
      {/* Mode Switcher — VO Upload Leads First */}
      <div className="p-3.5 border-b border-white/8">
        <div className="grid grid-cols-2 gap-1 rounded-lg bg-[#070A10] p-1 border border-white/8">
          <button
            type="button"
            onClick={() => setMode('upload-vo')}
            className={`flex items-center justify-center gap-1.5 rounded-md py-1.5 text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap ${
              mode === 'upload-vo' ? 'bg-amber-500 text-slate-950' : 'text-slate-400 hover:text-white'
            }`}
          >
            <Upload className="h-3.5 w-3.5" />
            Upload VO
          </button>
          <button
            type="button"
            onClick={() => setMode('script-voice')}
            className={`flex items-center justify-center gap-1.5 rounded-md py-1.5 text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap ${
              mode === 'script-voice' ? 'bg-amber-500 text-slate-950' : 'text-slate-400 hover:text-white'
            }`}
          >
            <Mic className="h-3.5 w-3.5" />
            Script &amp; Voice
          </button>
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto p-4 space-y-5">
        {mode === 'upload-vo' ? (
          <>
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-xs font-semibold text-slate-200">1. Voiceover Audio</label>
                {uploadedAudioName && (
                  <span className="font-mono tabular-nums text-[11px] text-amber-400">
                    {(uploadedDurationMs / 1000).toFixed(1)}s
                  </span>
                )}
              </div>
              <input
                ref={audioInputRef}
                type="file"
                accept="audio/*"
                className="hidden"
                onChange={(e) => handleAudioFileChange(e.target.files?.[0])}
              />
              <button
                type="button"
                onClick={() => audioInputRef.current?.click()}
                className={`w-full flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed px-3 py-4 text-xs transition-colors cursor-pointer ${
                  uploadedAudioName
                    ? 'border-amber-500/50 bg-[#070A10] text-slate-100'
                    : 'border-white/18 bg-[#070A10] text-slate-300 hover:border-amber-500/60 hover:text-white'
                }`}
              >
                <div className="flex items-center gap-2">
                  <FileAudio className="h-4 w-4 text-amber-400 shrink-0" />
                  <span className="truncate max-w-[240px] font-medium">
                    {uploadedAudioName ? uploadedAudioName : 'Select MP3, WAV, or M4A audio'}
                  </span>
                </div>
                {uploadedPeaks && (
                  <div className="flex items-end gap-0.5 h-5 w-full px-2 pt-1 opacity-80">
                    {uploadedPeaks.map((pk, idx) => (
                      <div
                        key={idx}
                        className="flex-1 rounded-xs bg-amber-400/75"
                        style={{ height: `${Math.max(15, Math.round(pk * 100))}%` }}
                      />
                    ))}
                  </div>
                )}
              </button>
            </div>

            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-xs font-semibold text-slate-200">2. Word-by-Word Transcript</label>
                <input
                  ref={transcriptInputRef}
                  type="file"
                  accept=".json,.srt,.vtt,.txt"
                  className="hidden"
                  onChange={(e) => handleTranscriptFileChange(e.target.files?.[0])}
                />
                <button
                  type="button"
                  onClick={() => transcriptInputRef.current?.click()}
                  className="text-[11px] font-medium text-amber-400 hover:text-amber-300 cursor-pointer whitespace-nowrap"
                >
                  Import JSON / SRT / VTT
                </button>
              </div>
              <textarea
                rows={6}
                value={transcriptDraft}
                onChange={(e) => setTranscriptDraft(e.target.value)}
                placeholder='Paste word timings JSON [{"word":"Spain","startMs":200,"endMs":600}], SRT/VTT captions, or leave blank to transcribe from audio...'
                className="w-full rounded-lg border border-white/10 bg-[#070A10] p-3 font-mono text-[11px] leading-relaxed text-slate-100 placeholder:text-slate-500 focus:border-amber-500 focus:outline-none resize-none"
              />
              {transcriptDraft.trim().length > 0 && (
                <div className="mt-1.5 flex items-center gap-2 text-[11px] text-slate-400 font-mono tabular-nums">
                  <span>{parsedTranscriptPreview.words.length} words</span>
                  <span aria-hidden="true">·</span>
                  <span>{parsedTranscriptPreview.timed ? 'Word timestamps ready' : 'Will sync to audio'}</span>
                </div>
              )}
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-200 mb-1.5">Map Look</label>
              <select
                value={project.themePreset}
                onChange={(e) =>
                  onUpdateProject((prev) => ({
                    ...prev,
                    themePreset: e.target.value as ThemePresetId,
                  }))
                }
                className="w-full rounded-lg border border-white/10 bg-[#070A10] px-3 py-2 text-xs text-slate-100 focus:border-amber-500 focus:outline-none"
              >
                <option value="vox-tactical">Satellite Tactical</option>
                <option value="3d-globe">3D Terrain &amp; Globe Flyover</option>
                <option value="vintage-parchment">Editorial Paper &amp; Ink</option>
              </select>
            </div>

            <button
              type="button"
              disabled={Boolean(busyStep)}
              onClick={handleBuildFromUploadedVO}
              className="w-full inline-flex items-center justify-center gap-2 rounded-lg bg-amber-500 px-4 py-2.5 text-xs font-bold text-slate-950 hover:bg-amber-400 disabled:opacity-50 cursor-pointer"
            >
              <AudioLines className="h-4 w-4" />
              {busyStep ? busyStep : 'Build Map Video'}
            </button>
          </>
        ) : (
          <>
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-xs font-semibold text-slate-200">Story Topic or Script</label>
                <span className="font-mono tabular-nums text-[11px] text-slate-400">
                  {scriptDraft.trim().split(/\s+/).filter(Boolean).length} words
                </span>
              </div>
              <textarea
                rows={6}
                value={scriptDraft}
                onChange={(e) => setScriptDraft(e.target.value)}
                placeholder="Paste your narration script or enter a topic like 'Why no bridge crosses the Amazon River'..."
                className="w-full rounded-lg border border-white/10 bg-[#070A10] p-3 text-xs leading-relaxed text-slate-100 placeholder:text-slate-500 focus:border-amber-500 focus:outline-none resize-none"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-200 mb-2">Narrator Voice</label>
              <div className="grid grid-cols-1 gap-1.5">
                {VOICES.map((v) => {
                  const selected = project.audio.voiceName === v.id;
                  return (
                    <button
                      key={v.id}
                      type="button"
                      onClick={() =>
                        onUpdateProject((prev) => ({
                          ...prev,
                          audio: { ...prev.audio, voiceName: v.id },
                        }))
                      }
                      className={`flex items-center justify-between rounded-lg border px-3 py-2 text-left text-xs transition-colors cursor-pointer ${
                        selected
                          ? 'border-amber-500/70 bg-amber-500/10 text-white'
                          : 'border-white/8 bg-[#070A10] text-slate-300 hover:border-white/20'
                      }`}
                    >
                      <span className="flex items-center gap-2 font-medium">
                        <Mic className="h-3.5 w-3.5 text-amber-400" />
                        {v.label}
                      </span>
                      <span className="text-[11px] text-slate-400">{v.tone}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-200 mb-1.5">Map Look</label>
              <select
                value={project.themePreset}
                onChange={(e) =>
                  onUpdateProject((prev) => ({
                    ...prev,
                    themePreset: e.target.value as ThemePresetId,
                  }))
                }
                className="w-full rounded-lg border border-white/10 bg-[#070A10] px-3 py-2 text-xs text-slate-100 focus:border-amber-500 focus:outline-none"
              >
                <option value="vox-tactical">Satellite Tactical</option>
                <option value="3d-globe">3D Terrain &amp; Globe Flyover</option>
                <option value="vintage-parchment">Editorial Paper &amp; Ink</option>
              </select>
            </div>

            <button
              type="button"
              disabled={Boolean(busyStep)}
              onClick={handleBuildFromScript}
              className="w-full inline-flex items-center justify-center gap-2 rounded-lg bg-amber-500 px-4 py-2.5 text-xs font-bold text-slate-950 hover:bg-amber-400 disabled:opacity-50 cursor-pointer"
            >
              <Clapperboard className="h-4 w-4" />
              {busyStep ? busyStep : 'Build Voiceover & Video'}
            </button>
          </>
        )}

        {errorMsg && (
          <div className="rounded-lg border border-red-500/40 bg-red-500/10 p-3 text-xs text-red-200">
            {errorMsg}
          </div>
        )}
      </div>
    </aside>
  );
}
