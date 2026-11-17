import { useState } from 'react';
import { Download, Globe, Languages } from 'lucide-react';
import { buildSrtContent } from '../engine/mp4Exporter';
import type { MapProject } from '../types/project';

interface SubtitleStudioModalProps {
  project: MapProject;
  onUpdateProject: (updater: (prev: MapProject) => MapProject) => void;
}

const LANGUAGE_OPTIONS = [
  { code: 'ur', name: 'Urdu', rtl: true },
  { code: 'ur-Latn', name: 'Roman Urdu', rtl: false },
  { code: 'hi', name: 'Hindi', rtl: false },
  { code: 'es', name: 'Spanish', rtl: false },
  { code: 'fr', name: 'French', rtl: false },
  { code: 'ar', name: 'Arabic', rtl: true },
  { code: 'pt', name: 'Portuguese', rtl: false },
  { code: 'de', name: 'German', rtl: false },
  { code: 'ja', name: 'Japanese', rtl: false },
];

export function SubtitleStudioModal({ project, onUpdateProject }: SubtitleStudioModalProps) {
  const [selectedLangs, setSelectedLangs] = useState<string[]>(['es', 'ur']);
  const [translating, setTranslating] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const activeTrack =
    project.subtitleTracks.find((t) => t.languageCode === project.activeLanguageCode) || project.subtitleTracks[0];

  const toggleLang = (code: string) => {
    setSelectedLangs((prev) => (prev.includes(code) ? prev.filter((c) => c !== code) : [...prev, code]));
  };

  const handleTranslate = async () => {
    const sourceTrack = project.subtitleTracks[0];
    if (!sourceTrack || sourceTrack.words.length === 0 || selectedLangs.length === 0) return;

    setTranslating(true);
    setErrorMsg(null);

    try {
      const targetLanguages = LANGUAGE_OPTIONS.filter((l) => selectedLangs.includes(l.code));
      const res = await fetch('/api/ai/translate-subtitles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          words: sourceTrack.words,
          targetLanguages,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Subtitle translation failed');

      onUpdateProject((prev) => {
        const merged = [...prev.subtitleTracks];
        for (const newTrack of data.tracks || []) {
          const idx = merged.findIndex((t) => t.languageCode === newTrack.languageCode);
          if (idx >= 0) merged[idx] = newTrack;
          else merged.push(newTrack);
        }
        return {
          ...prev,
          subtitleTracks: merged,
          activeLanguageCode: data.tracks?.[0]?.languageCode || prev.activeLanguageCode,
        };
      });
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Translation failed.');
    } finally {
      setTranslating(false);
    }
  };

  const handleDownloadSrt = () => {
    if (!activeTrack) return;
    const srt = buildSrtContent(activeTrack);
    const blob = new Blob([srt], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${project.title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${activeTrack.languageCode}.srt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="h-full overflow-y-auto bg-[#070A10] p-6">
      <div className="mx-auto max-w-5xl space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-white/8 pb-4">
          <div>
            <h1 className="font-display text-xl font-bold text-white">Captions &amp; Translations</h1>
            <p className="text-xs text-slate-400 mt-1">
              Translate word-timed captions into global languages, refine typography, and export .SRT or burn into MP4.
            </p>
          </div>
          {activeTrack && (
            <button
              type="button"
              onClick={handleDownloadSrt}
              className="inline-flex items-center gap-2 rounded-lg border border-white/12 bg-[#111722] px-3.5 py-2 text-xs font-medium text-slate-100 hover:border-amber-500 cursor-pointer"
            >
              <Download className="h-3.5 w-3.5 text-amber-400" />
              Download {activeTrack.languageName} .SRT
            </button>
          )}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left: Global Language Tracks */}
          <div className="rounded-xl border border-white/8 bg-[#111722] p-5 space-y-4">
            <div className="flex items-center gap-2 text-sm font-semibold text-white">
              <Globe className="h-4 w-4 text-amber-400" />
              Generate Language Tracks
            </div>
            <div className="grid grid-cols-2 gap-2">
              {LANGUAGE_OPTIONS.map((lang) => {
                const active = selectedLangs.includes(lang.code);
                return (
                  <button
                    key={lang.code}
                    type="button"
                    onClick={() => toggleLang(lang.code)}
                    className={`rounded-lg border px-3 py-2 text-left text-xs transition-colors cursor-pointer ${
                      active
                        ? 'border-amber-500 bg-amber-500/15 text-white font-medium'
                        : 'border-white/8 bg-[#0B0F17] text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    {lang.name}
                  </button>
                );
              })}
            </div>
            <button
              type="button"
              disabled={translating || selectedLangs.length === 0}
              onClick={handleTranslate}
              className="w-full inline-flex items-center justify-center gap-2 rounded-lg bg-amber-500 px-4 py-2.5 text-xs font-bold text-slate-950 hover:bg-amber-400 disabled:opacity-50 cursor-pointer"
            >
              <Languages className="h-4 w-4" />
              {translating ? 'Translating Captions...' : 'Translate Selected Languages'}
            </button>
            {errorMsg && <p className="text-xs text-red-400">{errorMsg}</p>}
          </div>

          {/* Middle: Caption Typography Styling */}
          <div className="rounded-xl border border-white/8 bg-[#131924] p-5 space-y-4">
            <div className="text-sm font-semibold text-white">Caption Typography & Burn-in</div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">Display Font</label>
              <select
                value={project.subtitleStyle.fontFamily}
                onChange={(e) =>
                  onUpdateProject((p) => ({
                    ...p,
                    subtitleStyle: { ...p.subtitleStyle, fontFamily: e.target.value as any },
                  }))
                }
                className="w-full rounded-lg border border-white/10 bg-[#0B0F17] px-3 py-2 text-xs text-slate-100"
              >
                <option value="Plus Jakarta Sans">Plus Jakarta Sans (Modern Reels)</option>
                <option value="Oswald">Oswald (Bold Condensed Vox)</option>
                <option value="Playfair Display">Playfair Display (Archival)</option>
              </select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-slate-400 mb-1">Active Word Color</label>
                <input
                  type="color"
                  value={project.subtitleStyle.highlightColor}
                  onChange={(e) =>
                    onUpdateProject((p) => ({
                      ...p,
                      subtitleStyle: { ...p.subtitleStyle, highlightColor: e.target.value },
                    }))
                  }
                  className="h-9 w-full rounded border border-white/10 bg-[#0B0F17]"
                />
              </div>
              <div>
                <label className="block text-xs text-slate-400 mb-1">Vertical Position</label>
                <input
                  type="range"
                  min={0.62}
                  max={0.86}
                  step={0.01}
                  value={project.subtitleStyle.positionY}
                  onChange={(e) =>
                    onUpdateProject((p) => ({
                      ...p,
                      subtitleStyle: { ...p.subtitleStyle, positionY: Number(e.target.value) },
                    }))
                  }
                  className="w-full accent-amber-500 mt-2.5"
                />
              </div>
            </div>
            <div>
              <div className="flex justify-between text-xs text-slate-400 mb-1">
                <span>Font Size</span>
                <span className="font-mono tabular-nums">{project.subtitleStyle.fontSize} px</span>
              </div>
              <input
                type="range"
                min={28}
                max={64}
                step={2}
                value={project.subtitleStyle.fontSize}
                onChange={(e) =>
                  onUpdateProject((p) => ({
                    ...p,
                    subtitleStyle: { ...p.subtitleStyle, fontSize: Number(e.target.value) },
                  }))
                }
                className="w-full accent-amber-500"
              />
            </div>
            <label className="flex items-center justify-between rounded-lg border border-white/8 bg-[#0B0F17] px-3 py-2 text-xs cursor-pointer">
              <span>All Caps Captions</span>
              <input
                type="checkbox"
                checked={project.subtitleStyle.uppercase}
                onChange={(e) =>
                  onUpdateProject((p) => ({
                    ...p,
                    subtitleStyle: { ...p.subtitleStyle, uppercase: e.target.checked },
                  }))
                }
                className="accent-amber-500"
              />
            </label>
          </div>

          {/* Right: Active Track Word Editor */}
          <div className="rounded-xl border border-white/8 bg-[#131924] p-5 flex flex-col">
            <div className="flex items-center justify-between mb-3">
              <span className="text-sm font-semibold text-white">Active Track</span>
              <select
                value={project.activeLanguageCode}
                onChange={(e) => onUpdateProject((p) => ({ ...p, activeLanguageCode: e.target.value }))}
                className="rounded-md border border-white/10 bg-[#0B0F17] px-2.5 py-1 text-xs text-slate-100"
              >
                {project.subtitleTracks.map((t) => (
                  <option key={t.languageCode} value={t.languageCode}>
                    {t.languageName} ({t.words.length})
                  </option>
                ))}
              </select>
            </div>
            <div className="flex-1 max-h-72 overflow-y-auto space-y-1.5 pr-1">
              {(activeTrack?.words || []).map((w) => (
                <div
                  key={w.id}
                  className="flex items-center gap-2 rounded-md border border-white/6 bg-[#0B0F17] px-2.5 py-1.5 text-xs"
                >
                  <span className="font-mono text-[10px] text-slate-500 w-20 shrink-0">
                    {(w.startMs / 1000).toFixed(2)}s
                  </span>
                  <input
                    type="text"
                    value={w.word}
                    onChange={(e) =>
                      onUpdateProject((p) => ({
                        ...p,
                        subtitleTracks: p.subtitleTracks.map((tr) =>
                          tr.languageCode === activeTrack.languageCode
                            ? {
                                ...tr,
                                words: tr.words.map((item) =>
                                  item.id === w.id ? { ...item, word: e.target.value } : item,
                                ),
                              }
                            : tr,
                        ),
                      }))
                    }
                    className="flex-1 bg-transparent text-slate-100 focus:outline-none"
                  />
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
