import { useState } from 'react';
import { CheckCircle2, Download, Film, X } from 'lucide-react';
import { buildSrtContent, exportProjectToMp4, type ExportResult } from '../engine/mp4Exporter';
import type { MapProject } from '../types/project';

interface ExportModalProps {
  project: MapProject;
  onClose: () => void;
}

export function ExportModal({ project, onClose }: ExportModalProps) {
  const [resolution, setResolution] = useState<'1080x1920' | '720x1280'>('1080x1920');
  const [fps, setFps] = useState<30 | 60>(30);
  const [includeSubtitles, setIncludeSubtitles] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [progress, setProgress] = useState(0);
  const [statusText, setStatusText] = useState('');
  const [result, setResult] = useState<ExportResult | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const handleStartExport = async () => {
    setExporting(true);
    setResult(null);
    setErrorMsg(null);
    setProgress(2);

    const [width, height] = resolution === '1080x1920' ? [1080, 1920] : [720, 1280];

    try {
      const res = await exportProjectToMp4(project, {
        width,
        height,
        fps,
        includeSubtitles,
        onProgress: (pct, text) => {
          setProgress(pct);
          setStatusText(text);
        },
      });
      setResult(res);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'MP4 export failed.');
    } finally {
      setExporting(false);
    }
  };

  const handleDownloadVideo = () => {
    if (!result) return;
    const url = URL.createObjectURL(result.blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = result.filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleDownloadSrt = () => {
    const track =
      project.subtitleTracks.find((t) => t.languageCode === project.activeLanguageCode) || project.subtitleTracks[0];
    if (!track) return;
    const srt = buildSrtContent(track);
    const blob = new Blob([srt], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${project.title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.srt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-xs p-4">
      <div className="w-full max-w-md rounded-xl border border-white/12 bg-[#131924] p-6 shadow-2xl space-y-5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <Film className="h-5 w-5 text-amber-400" />
            <h2 className="font-display text-base font-bold text-white">Export 9:16 Social Video</h2>
          </div>
          <button
            type="button"
            disabled={exporting}
            onClick={onClose}
            className="text-slate-400 hover:text-white disabled:opacity-40 cursor-pointer"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-3 text-xs">
          <div>
            <label className="block text-slate-400 mb-1.5">Output Resolution (9:16 Vertical)</label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setResolution('1080x1920')}
                className={`rounded-lg border px-3 py-2 text-left cursor-pointer ${
                  resolution === '1080x1920'
                    ? 'border-amber-500 bg-amber-500/15 text-white font-semibold'
                    : 'border-white/10 bg-[#0B0F17] text-slate-300'
                }`}
              >
                1080 × 1920 · Full HD
              </button>
              <button
                type="button"
                onClick={() => setResolution('720x1280')}
                className={`rounded-lg border px-3 py-2 text-left cursor-pointer ${
                  resolution === '720x1280'
                    ? 'border-amber-500 bg-amber-500/15 text-white font-semibold'
                    : 'border-white/10 bg-[#0B0F17] text-slate-300'
                }`}
              >
                720 × 1280 · Fast Draft
              </button>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-slate-400 mb-1">Frame Rate</label>
              <select
                value={fps}
                onChange={(e) => setFps(Number(e.target.value) as 30 | 60)}
                className="w-full rounded-lg border border-white/10 bg-[#0B0F17] px-3 py-2 text-slate-100"
              >
                <option value={30}>30 fps (Standard)</option>
                <option value={60}>60 fps (Ultra Smooth)</option>
              </select>
            </div>
            <div>
              <label className="block text-slate-400 mb-1">Subtitle Track</label>
              <label className="flex items-center justify-between rounded-lg border border-white/10 bg-[#0B0F17] px-3 py-2 cursor-pointer">
                <span>Burn-in ({project.activeLanguageCode.toUpperCase()})</span>
                <input
                  type="checkbox"
                  checked={includeSubtitles}
                  onChange={(e) => setIncludeSubtitles(e.target.checked)}
                  className="accent-amber-500"
                />
              </label>
            </div>
          </div>
        </div>

        {exporting && (
          <div className="space-y-2 rounded-lg border border-white/10 bg-[#0B0F17] p-3">
            <div className="flex items-center justify-between text-xs">
              <span className="text-slate-300 truncate">{statusText}</span>
              <span className="font-mono text-amber-400">{progress}%</span>
            </div>
            <div className="h-2 w-full overflow-hidden rounded-full bg-slate-800">
              <div
                style={{ width: `${progress}%` }}
                className="h-full bg-amber-500 transition-all duration-150"
              />
            </div>
          </div>
        )}

        {errorMsg && (
          <div className="rounded-lg border border-red-500/40 bg-red-500/10 p-3 text-xs text-red-200">
            {errorMsg}
          </div>
        )}

        {result && (
          <div className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 p-3 space-y-3">
            <div className="flex items-center gap-2 text-xs font-semibold text-emerald-300">
              <CheckCircle2 className="h-4 w-4" />
              Ready: {result.filename} ({(result.blob.size / (1024 * 1024)).toFixed(2)} MB)
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={handleDownloadVideo}
                className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-lg bg-emerald-500 px-3 py-2 text-xs font-bold text-slate-950 hover:bg-emerald-400 cursor-pointer"
              >
                <Download className="h-3.5 w-3.5" />
                Save .{result.extension.toUpperCase()}
              </button>
              <button
                type="button"
                onClick={handleDownloadSrt}
                className="inline-flex items-center justify-center rounded-lg border border-white/15 bg-[#0B0F17] px-3 py-2 text-xs text-slate-200 hover:border-white/30 cursor-pointer"
              >
                Save .SRT
              </button>
            </div>
          </div>
        )}

        <div className="flex items-center justify-end gap-2 pt-2 border-t border-white/8">
          <button
            type="button"
            disabled={exporting}
            onClick={onClose}
            className="rounded-lg px-4 py-2 text-xs font-medium text-slate-300 hover:text-white disabled:opacity-40 cursor-pointer"
          >
            Close
          </button>
          <button
            type="button"
            disabled={exporting}
            onClick={handleStartExport}
            className="inline-flex items-center gap-2 rounded-lg bg-amber-500 px-5 py-2 text-xs font-bold text-slate-950 hover:bg-amber-400 disabled:opacity-50 cursor-pointer"
          >
            {exporting ? 'Rendering Video...' : 'Render MP4'}
          </button>
        </div>
      </div>
    </div>
  );
}
