import { useEffect, useMemo, useRef, useState } from 'react';
import { Activity, Diamond, MapPin, Pause, Play, Plus, RotateCcw, Volume2, X } from 'lucide-react';
import { getEasingCurvePoints, solveCubicBezier } from '../engine/mapCompositor';
import type { EasingType, MapOverlay, MapProject, SfxCue, TimelineSelection } from '../types/project';

interface TimelineEditorProps {
  project: MapProject;
  currentTimeMs: number;
  isPlaying: boolean;
  selection: TimelineSelection;
  subscribePlayhead?: (listener: (timeMs: number) => void) => () => void;
  onTogglePlay: () => void;
  onSeek: (timeMs: number) => void;
  onSelect: (sel: TimelineSelection) => void;
  onUpdateProject: (updater: (prev: MapProject) => MapProject) => void;
  onAddCameraKeyframe: () => void;
  onAddOverlay: () => void;
  onAddSfx: () => void;
}

interface SpeedPreset {
  id: string;
  label: string;
  easing: EasingType;
  points: [number, number, number, number];
}

const SPEED_PRESETS: SpeedPreset[] = [
  { id: 'smooth', label: 'Smooth', easing: 'easeInOutCubic', points: [0.65, 0, 0.35, 1] },
  { id: 'whip', label: 'Whip', easing: 'custom', points: [0.85, 0, 0.15, 1] },
  { id: 'snap', label: 'Snap Out', easing: 'expoOut', points: [0.16, 1, 0.3, 1] },
  { id: 'glide', label: 'Slow Land', easing: 'custom', points: [0.22, 1, 0.36, 1] },
  { id: 'linear', label: 'Linear', easing: 'linear', points: [0, 0, 1, 1] },
];

function formatTimecode(ms: number): string {
  const clamped = Math.max(0, Math.round(ms));
  const mins = Math.floor(clamped / 60000);
  const secs = Math.floor((clamped % 60000) / 1000);
  const centis = Math.floor((clamped % 1000) / 10);
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}.${String(centis).padStart(2, '0')}`;
}

export function TimelineEditor({
  project,
  currentTimeMs,
  isPlaying,
  selection,
  subscribePlayhead,
  onTogglePlay,
  onSeek,
  onSelect,
  onUpdateProject,
  onAddCameraKeyframe,
  onAddOverlay,
  onAddSfx,
}: TimelineEditorProps) {
  const trackAreaRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const timecodeRef = useRef<HTMLSpanElement>(null);
  const playheadRef = useRef<HTMLDivElement>(null);
  const [showCurveEditor, setShowCurveEditor] = useState(false);
  const [selectedSegKfId, setSelectedSegKfId] = useState<string | null>(null);
  const [draggingHandle, setDraggingHandle] = useState<'p1' | 'p2' | null>(null);
  const [isScrubbing, setIsScrubbing] = useState(false);
  const [generatingPins, setGeneratingPins] = useState(false);

  // Smooth 60fps DOM-level playhead + timecode updates during active playback (zero React re-renders)
  useEffect(() => {
    if (!subscribePlayhead) return;
    return subscribePlayhead((ms) => {
      if (timecodeRef.current) {
        timecodeRef.current.textContent = formatTimecode(ms);
      }
      if (playheadRef.current) {
        const pct = Math.max(0, Math.min(100, (ms / Math.max(1, project.durationMs)) * 100));
        playheadRef.current.style.left = `${pct}%`;
      }
    });
  }, [subscribePlayhead, project.durationMs]);

  const sortedKeyframes = useMemo(
    () => [...project.cameraKeyframes].sort((a, b) => a.timeMs - b.timeMs),
    [project.cameraKeyframes],
  );

  // Build list of camera transition segments [prev -> next]
  const segments = useMemo(() => {
    const list: Array<{
      id: string;
      from: (typeof sortedKeyframes)[number];
      to: (typeof sortedKeyframes)[number];
    }> = [];
    for (let i = 0; i < sortedKeyframes.length - 1; i++) {
      list.push({
        id: sortedKeyframes[i + 1].id,
        from: sortedKeyframes[i],
        to: sortedKeyframes[i + 1],
      });
    }
    return list;
  }, [sortedKeyframes]);

  // Sync active segment when user selects a camera keyframe
  useEffect(() => {
    if (selection?.kind === 'camera') {
      const idx = sortedKeyframes.findIndex((k) => k.id === selection.id);
      if (idx > 0) {
        setSelectedSegKfId(sortedKeyframes[idx].id);
      } else if (idx === 0 && sortedKeyframes.length > 1) {
        setSelectedSegKfId(sortedKeyframes[1].id);
      }
    }
  }, [selection, sortedKeyframes]);

  const activeSegment = useMemo(() => {
    if (segments.length === 0) return null;
    if (selectedSegKfId) {
      const found = segments.find((s) => s.id === selectedSegKfId);
      if (found) return found;
    }
    // Otherwise pick segment under playhead
    const atPlayhead = segments.find(
      (s) => currentTimeMs >= s.from.timeMs && currentTimeMs <= s.to.timeMs,
    );
    return atPlayhead || segments[0];
  }, [segments, selectedSegKfId, currentTimeMs]);

  const activePoints = useMemo<[number, number, number, number]>(() => {
    if (!activeSegment) return [0.65, 0, 0.35, 1];
    return getEasingCurvePoints(activeSegment.to.easing, activeSegment.to.curvePoints);
  }, [activeSegment]);

  // Precompute velocity bell curve + Bezier samples for SVG graph
  const graphData = useMemo(() => {
    const [x1, y1, x2, y2] = activePoints;
    const W = 180;
    const H = 136;
    const PAD_X = 16;
    const PAD_Y = 18;
    const innerW = W - PAD_X * 2;
    const innerH = H - PAD_Y * 2;

    const toSvgX = (nx: number) => PAD_X + nx * innerW;
    const toSvgY = (ny: number) => PAD_Y + (1 - ny) * innerH;

    const samples: Array<{ t: number; y: number; v: number }> = [];
    const steps = 36;
    let prevY = 0;
    let maxV = 0.001;
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const y = solveCubicBezier(t, x1, y1, x2, y2);
      const v = i === 0 ? 0 : Math.max(0, (y - prevY) * steps);
      if (v > maxV) maxV = v;
      samples.push({ t, y, v });
      prevY = y;
    }
    if (samples.length > 1) samples[0].v = samples[1].v * 0.65;

    const curvePath = `M ${toSvgX(0)} ${toSvgY(0)} C ${toSvgX(x1)} ${toSvgY(y1)}, ${toSvgX(x2)} ${toSvgY(y2)}, ${toSvgX(1)} ${toSvgY(1)}`;

    const normScale = Math.max(1.5, maxV);
    const velLinePts = samples
      .map((s) => `${toSvgX(s.t).toFixed(1)},${toSvgY(Math.min(1.05, s.v / normScale)).toFixed(1)}`)
      .join(' L ');
    const velAreaPath = `M ${toSvgX(0)} ${toSvgY(0)} L ${velLinePts} L ${toSvgX(1)} ${toSvgY(0)} Z`;
    const velStrokePath = `M ${velLinePts}`;

    // Playhead position on curve if inside active segment
    let playheadDot: { cx: number; cy: number } | null = null;
    if (activeSegment && currentTimeMs >= activeSegment.from.timeMs && currentTimeMs <= activeSegment.to.timeMs) {
      const span = Math.max(1, activeSegment.to.timeMs - activeSegment.from.timeMs);
      const t = (currentTimeMs - activeSegment.from.timeMs) / span;
      const y = solveCubicBezier(t, x1, y1, x2, y2);
      playheadDot = { cx: toSvgX(t), cy: toSvgY(y) };
    }

    return {
      W,
      H,
      PAD_X,
      PAD_Y,
      innerW,
      innerH,
      toSvgX,
      toSvgY,
      curvePath,
      velAreaPath,
      velStrokePath,
      peakSpeed: maxV,
      playheadDot,
    };
  }, [activePoints, activeSegment, currentTimeMs]);

  const updateSegmentCurve = (easing: EasingType, points: [number, number, number, number]) => {
    if (!activeSegment) return;
    onUpdateProject((prev) => ({
      ...prev,
      cameraKeyframes: prev.cameraKeyframes.map((k) =>
        k.id === activeSegment.to.id ? { ...k, easing, curvePoints: points } : k,
      ),
    }));
  };

  const handleApplyToAll = () => {
    if (!activeSegment) return;
    const pts = activePoints;
    const easing = activeSegment.to.easing;
    onUpdateProject((prev) => ({
      ...prev,
      cameraKeyframes: prev.cameraKeyframes.map((k, idx) =>
        idx === 0 ? k : { ...k, easing, curvePoints: pts },
      ),
    }));
  };

  const handleSvgPointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    if (!draggingHandle || !svgRef.current || !activeSegment) return;
    const rect = svgRef.current.getBoundingClientRect();
    const svgX = ((e.clientX - rect.left) / rect.width) * graphData.W;
    const svgY = ((e.clientY - rect.top) / rect.height) * graphData.H;

    const nx = Math.max(0.02, Math.min(0.98, (svgX - graphData.PAD_X) / graphData.innerW));
    const ny = Math.max(-0.18, Math.min(1.18, 1 - (svgY - graphData.PAD_Y) / graphData.innerH));
    const rx = Number(nx.toFixed(2));
    const ry = Number(ny.toFixed(2));

    const [x1, y1, x2, y2] = activePoints;
    const nextPts: [number, number, number, number] =
      draggingHandle === 'p1' ? [rx, ry, x2, y2] : [x1, y1, rx, ry];

    updateSegmentCurve('custom', nextPts);
  };

  const handleAutoGenerateCityPins = async () => {
    if (generatingPins) return;
    setGeneratingPins(true);
    try {
      const res = await fetch('/api/ai/generate-city-pins', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: project.title,
          scriptText: project.scriptText,
          durationMs: project.durationMs,
          regionMasks: project.regionMasks.map((r) => ({
            regionName: r.regionName,
            startMs: r.startMs,
            endMs: r.endMs,
          })),
          cameraKeyframes: project.cameraKeyframes.map((k) => ({
            timeMs: k.timeMs,
            label: k.label,
            lat: k.lat,
            lng: k.lng,
            zoom: k.zoom,
          })),
          routes: project.routes.map((rt) => ({
            name: rt.name,
            startMs: rt.startMs,
            endMs: rt.endMs,
            points: rt.points,
          })),
        }),
      });
      const data = (await res.json()) as { markers?: MapOverlay[] };
      if (!res.ok || !data.markers || data.markers.length === 0) return;

      const markers = data.markers;
      const popSfx: SfxCue[] = markers.map((m, idx) => ({
        id: `sfx-city-${Date.now()}-${idx + 1}`,
        type: 'pop',
        timeMs: m.startMs,
        volume: 0.72,
        label: `City Pin: ${m.text}`,
      }));

      onUpdateProject((prev) => ({
        ...prev,
        overlays: [
          ...prev.overlays.filter((ov) => !ov.id.startsWith('city-pop-')),
          ...markers,
        ],
        sfxCues: [
          ...prev.sfxCues.filter((s) => !s.id.startsWith('sfx-city-')),
          ...popSfx,
        ],
      }));

      onSelect({ kind: 'overlay', id: markers[0].id });
      onSeek(Math.min(project.durationMs, markers[0].startMs + 280));
    } catch {
      // Silently ignore network errors without breaking timeline state
    } finally {
      setGeneratingPins(false);
    }
  };

  const seekFromClientX = (clientX: number) => {
    const el = trackAreaRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / Math.max(1, rect.width)));
    onSeek(Math.round(ratio * project.durationMs));
  };

  const handleTrackPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement)?.closest('button')) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    setIsScrubbing(true);
    seekFromClientX(e.clientX);
  };

  const handleTrackPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isScrubbing) return;
    seekFromClientX(e.clientX);
  };

  const handleTrackPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isScrubbing) return;
    setIsScrubbing(false);
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
  };

  const playheadPct = Math.max(0, Math.min(100, (currentTimeMs / Math.max(1, project.durationMs)) * 100));

  return (
    <section className="h-52 sm:h-60 shrink-0 border-t border-white/8 bg-[#111722] flex flex-col select-none">
      {/* Transport & Quick Add Bar */}
      <div className="h-10 shrink-0 border-b border-white/8 px-3 sm:px-4 flex items-center justify-between gap-3 bg-[#0B0F17] overflow-x-auto">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onTogglePlay}
            className="inline-flex h-7 w-7 items-center justify-center rounded-md bg-amber-500 text-slate-950 hover:bg-amber-400 cursor-pointer"
            aria-label={isPlaying ? 'Pause' : 'Play'}
          >
            {isPlaying ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5 ml-0.5" />}
          </button>
          <button
            type="button"
            onClick={() => onSeek(0)}
            className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-white/10 bg-[#070A10] text-slate-300 hover:text-white cursor-pointer"
            aria-label="Restart"
          >
            <RotateCcw className="h-3.5 w-3.5" />
          </button>
          <span className="font-mono tabular-nums text-xs text-slate-200">
            <span ref={timecodeRef}>{formatTimecode(currentTimeMs)}</span>{' '}
            <span className="text-slate-500">/ {formatTimecode(project.durationMs)}</span>
          </span>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleAutoGenerateCityPins}
            disabled={generatingPins}
            className="inline-flex items-center gap-1.5 rounded-md border border-white/10 bg-[#070A10] px-2.5 py-1 text-[11px] font-medium text-slate-200 hover:border-amber-500/60 disabled:opacity-50 cursor-pointer whitespace-nowrap shrink-0"
          >
            <MapPin className="h-3 w-3 text-amber-400" />
            {generatingPins ? 'Placing Pins...' : 'City Pins'}
          </button>
          <button
            type="button"
            onClick={() => setShowCurveEditor((v) => !v)}
            className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-[11px] font-medium transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
              showCurveEditor
                ? 'border-amber-500/70 bg-amber-500/15 text-amber-300'
                : 'border-white/10 bg-[#070A10] text-slate-200 hover:border-amber-500/60'
            }`}
          >
            <Activity className="h-3 w-3 text-amber-400" />
            Speed Curve
          </button>
          <button
            type="button"
            onClick={onAddCameraKeyframe}
            className="inline-flex items-center gap-1 rounded-md border border-white/10 bg-[#070A10] px-2.5 py-1 text-[11px] font-medium text-slate-200 hover:border-amber-500/60 cursor-pointer whitespace-nowrap shrink-0"
          >
            <Plus className="h-3 w-3 text-amber-400" />
            Keyframe
          </button>
          <button
            type="button"
            onClick={onAddOverlay}
            className="inline-flex items-center gap-1 rounded-md border border-white/10 bg-[#070A10] px-2.5 py-1 text-[11px] font-medium text-slate-200 hover:border-sky-400/60 cursor-pointer whitespace-nowrap shrink-0"
          >
            <Plus className="h-3 w-3 text-sky-400" />
            Add Asset
          </button>
          <button
            type="button"
            onClick={onAddSfx}
            className="inline-flex items-center gap-1 rounded-md border border-white/10 bg-[#070A10] px-2.5 py-1 text-[11px] font-medium text-slate-200 hover:border-emerald-400/60 cursor-pointer whitespace-nowrap shrink-0"
          >
            <Volume2 className="h-3 w-3 text-emerald-400" />
            Add SFX
          </button>
        </div>
      </div>

      {/* Multi-Track Grid + Optional Docked Speed-Ramping Curve Editor */}
      <div className="flex-1 flex overflow-hidden">
        {/* Track Labels */}
        <div className="w-24 sm:w-36 shrink-0 border-r border-white/8 bg-[#0B0F17] text-[10px] sm:text-[11px] font-medium text-slate-400 flex flex-col">
          <div className="h-6 border-b border-white/6 px-2 sm:px-3 flex items-center text-[10px] text-slate-500">Timecode</div>
          <div className="flex-1 border-b border-white/6 px-2 sm:px-3 flex items-center">Camera</div>
          <div className="flex-1 border-b border-white/6 px-2 sm:px-3 flex items-center truncate">Regions & Routes</div>
          <div className="flex-1 border-b border-white/6 px-2 sm:px-3 flex items-center">Overlays</div>
          <div className="flex-1 px-2 sm:px-3 flex items-center truncate">Voice & SFX</div>
        </div>

        {/* Interactive Timeline Lanes */}
        <div
          ref={trackAreaRef}
          onPointerDown={handleTrackPointerDown}
          onPointerMove={handleTrackPointerMove}
          onPointerUp={handleTrackPointerUp}
          onPointerCancel={handleTrackPointerUp}
          className="relative flex-1 min-w-0 bg-[#0B0F17] flex flex-col cursor-crosshair overflow-hidden touch-none"
        >
          {/* Time Ruler */}
          <div className="h-6 border-b border-white/6 flex items-center justify-between px-2 font-mono tabular-nums text-[10px] text-slate-500">
            {[0, 0.25, 0.5, 0.75, 1].map((r) => (
              <span key={r}>{formatTimecode(r * project.durationMs)}</span>
            ))}
          </div>

          {/* Track 1: Camera Keyframes & Speed-Ramp Segment Connectors */}
          <div className="relative flex-1 border-b border-white/6 flex items-center">
            {segments.map((seg) => {
              const leftPct = (seg.from.timeMs / Math.max(1, project.durationMs)) * 100;
              const rightPct = (seg.to.timeMs / Math.max(1, project.durationMs)) * 100;
              const segWidth = Math.max(0.5, rightPct - leftPct);
              const isSegActive = showCurveEditor && activeSegment?.id === seg.id;
              return (
                <button
                  key={`seg-${seg.id}`}
                  type="button"
                  title={`Edit speed ramp: ${seg.from.label} → ${seg.to.label}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    setSelectedSegKfId(seg.id);
                    onSelect({ kind: 'camera', id: seg.to.id });
                    setShowCurveEditor(true);
                  }}
                  style={{ left: `${leftPct}%`, width: `${segWidth}%` }}
                  className="group absolute inset-y-1 flex items-center cursor-pointer z-0"
                >
                  <span
                    className={`block w-full transition-colors ${
                      isSegActive
                        ? 'h-[3px] bg-amber-400 shadow-[0_0_8px_rgba(245,158,11,0.7)]'
                        : 'h-[1.5px] bg-amber-500/35 group-hover:bg-amber-400/80'
                    }`}
                  />
                </button>
              );
            })}

            {project.cameraKeyframes.map((kf) => {
              const leftPct = (kf.timeMs / Math.max(1, project.durationMs)) * 100;
              const isSelected = selection?.kind === 'camera' && selection.id === kf.id;
              return (
                <button
                  key={kf.id}
                  type="button"
                  title={`${kf.label} (${kf.zoom.toFixed(1)}x · ${kf.easing})`}
                  onClick={(e) => {
                    e.stopPropagation();
                    onSelect({ kind: 'camera', id: kf.id });
                    onSeek(kf.timeMs);
                  }}
                  style={{ left: `${leftPct}%` }}
                  className={`absolute -translate-x-1/2 flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium transition-transform cursor-pointer ${
                    isSelected
                      ? 'z-20 bg-amber-500 text-slate-950 scale-105'
                      : 'z-10 bg-slate-800/90 text-amber-300 border border-amber-500/40 hover:border-amber-400'
                  }`}
                >
                  <Diamond className="h-2.5 w-2.5 fill-current" />
                  <span className="max-w-[76px] truncate">{kf.label}</span>
                </button>
              );
            })}
          </div>

          {/* Track 2: Regions & Routes */}
          <div className="relative flex-1 border-b border-white/6 flex items-center">
            {project.regionMasks.map((mask) => {
              const left = (mask.startMs / Math.max(1, project.durationMs)) * 100;
              const width = Math.max(3, ((mask.endMs - mask.startMs) / Math.max(1, project.durationMs)) * 100);
              const isSelected = selection?.kind === 'region' && selection.id === mask.id;
              return (
                <button
                  key={mask.id}
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onSelect({ kind: 'region', id: mask.id });
                  }}
                  style={{ left: `${left}%`, width: `${width}%` }}
                  className={`absolute top-1.5 h-5 rounded px-1.5 text-left text-[10px] font-medium truncate cursor-pointer ${
                    isSelected
                      ? 'bg-orange-500 text-slate-950 ring-1 ring-white'
                      : 'bg-orange-500/25 text-orange-200 border border-orange-500/40'
                  }`}
                >
                  {mask.regionName}
                </button>
              );
            })}
            {project.routes.map((rt) => {
              const left = (rt.startMs / Math.max(1, project.durationMs)) * 100;
              const width = Math.max(3, ((rt.endMs - rt.startMs) / Math.max(1, project.durationMs)) * 100);
              const isSelected = selection?.kind === 'route' && selection.id === rt.id;
              return (
                <button
                  key={rt.id}
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onSelect({ kind: 'route', id: rt.id });
                  }}
                  style={{ left: `${left}%`, width: `${width}%` }}
                  className={`absolute bottom-1 h-4 rounded px-1.5 text-left text-[10px] font-medium truncate cursor-pointer ${
                    isSelected
                      ? 'bg-sky-400 text-slate-950 ring-1 ring-white'
                      : 'bg-sky-500/25 text-sky-200 border border-sky-400/40'
                  }`}
                >
                  {rt.name}
                </button>
              );
            })}
          </div>

          {/* Track 3: Overlays */}
          <div className="relative flex-1 border-b border-white/6 flex items-center">
            {project.overlays.map((ov) => {
              const left = (ov.startMs / Math.max(1, project.durationMs)) * 100;
              const width = Math.max(3.5, ((ov.endMs - ov.startMs) / Math.max(1, project.durationMs)) * 100);
              const isSelected = selection?.kind === 'overlay' && selection.id === ov.id;
              return (
                <button
                  key={ov.id}
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onSelect({ kind: 'overlay', id: ov.id });
                  }}
                  style={{ left: `${left}%`, width: `${width}%` }}
                  className={`absolute h-6 rounded px-1.5 text-left text-[10px] font-medium truncate cursor-pointer ${
                    isSelected
                      ? 'bg-indigo-400 text-slate-950 ring-1 ring-white'
                      : 'bg-indigo-500/25 text-indigo-200 border border-indigo-400/40'
                  }`}
                >
                  {ov.text || ov.type}
                </button>
              );
            })}
          </div>

          {/* Track 4: Audio Waveform & SFX Cues */}
          <div className="relative flex-1 flex items-center px-1 gap-px">
            {project.audio.waveformPeaks.map((peak, idx) => (
              <div
                key={idx}
                style={{ height: `${Math.max(12, Math.round(peak * 85))}%` }}
                className="flex-1 rounded-xs bg-slate-600/45"
              />
            ))}
            {project.sfxCues.map((cue) => {
              const left = (cue.timeMs / Math.max(1, project.durationMs)) * 100;
              const isSelected = selection?.kind === 'sfx' && selection.id === cue.id;
              return (
                <button
                  key={cue.id}
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onSelect({ kind: 'sfx', id: cue.id });
                  }}
                  style={{ left: `${left}%` }}
                  className={`absolute top-1 -translate-x-1/2 rounded px-1.5 py-0.5 text-[9px] font-mono uppercase cursor-pointer ${
                    isSelected
                      ? 'bg-emerald-400 text-slate-950 font-bold'
                      : 'bg-emerald-500/25 text-emerald-300 border border-emerald-500/40'
                  }`}
                >
                  {cue.type}
                </button>
              );
            })}
          </div>

          {/* Vertical Playhead Line */}
          <div
            ref={playheadRef}
            style={{ left: `${playheadPct}%` }}
            className="pointer-events-none absolute top-0 bottom-0 z-30 w-0.5 bg-amber-400 shadow-[0_0_8px_rgba(245,158,11,0.8)]"
          >
            <div className="h-2.5 w-2.5 -translate-x-[4px] bg-amber-400 rotate-45" />
          </div>
        </div>

        {/* Docked Speed-Ramping Curve Editor */}
        {showCurveEditor && (
          <div className="w-[372px] shrink-0 border-l border-white/8 bg-[#0E141F] flex flex-col overflow-hidden">
            {/* Segment Selector Header */}
            <div className="h-9 shrink-0 border-b border-white/8 px-3 flex items-center justify-between gap-2 bg-[#111827]">
              {segments.length > 0 && activeSegment ? (
                <select
                  value={activeSegment.id}
                  onChange={(e) => {
                    setSelectedSegKfId(e.target.value);
                    onSelect({ kind: 'camera', id: e.target.value });
                  }}
                  aria-label="Camera transition segment"
                  className="min-w-0 flex-1 rounded border border-white/10 bg-[#0B0F17] px-2 py-1 text-[11px] font-medium text-slate-100 focus:border-amber-500 focus:outline-none truncate"
                >
                  {segments.map((seg, i) => (
                    <option key={seg.id} value={seg.id}>
                      {i + 1}. {seg.from.label} → {seg.to.label} ({((seg.to.timeMs - seg.from.timeMs) / 1000).toFixed(1)}s)
                    </option>
                  ))}
                </select>
              ) : (
                <span className="text-[11px] text-slate-400 truncate">Add 2+ camera keyframes to edit curve</span>
              )}

              <button
                type="button"
                onClick={handleApplyToAll}
                disabled={!activeSegment}
                title="Apply this speed ramp to all camera transitions"
                className="rounded border border-white/10 bg-[#0B0F17] px-2 py-1 text-[10px] font-medium text-slate-300 hover:border-amber-500/60 hover:text-amber-300 disabled:opacity-40 cursor-pointer whitespace-nowrap shrink-0"
              >
                Apply All
              </button>
              <button
                type="button"
                onClick={() => setShowCurveEditor(false)}
                aria-label="Close speed curve editor"
                className="p-1 text-slate-400 hover:text-white cursor-pointer shrink-0"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>

            {activeSegment ? (
              <div className="flex-1 p-2.5 flex gap-3 min-h-0">
                {/* Interactive SVG Cubic-Bezier + Velocity Graph */}
                <div className="w-[184px] shrink-0 rounded-md border border-white/8 bg-[#080B11] flex items-center justify-center relative">
                  <svg
                    ref={svgRef}
                    viewBox={`0 0 ${graphData.W} ${graphData.H}`}
                    onPointerMove={handleSvgPointerMove}
                    onPointerUp={() => setDraggingHandle(null)}
                    onPointerLeave={() => setDraggingHandle(null)}
                    className="w-full h-full touch-none select-none"
                  >
                    {/* Grid lines */}
                    {[0, 0.25, 0.5, 0.75, 1].map((g) => (
                      <g key={g}>
                        <line
                          x1={graphData.toSvgX(g)}
                          y1={graphData.toSvgY(0)}
                          x2={graphData.toSvgX(g)}
                          y2={graphData.toSvgY(1)}
                          stroke={g === 0 || g === 1 ? 'rgba(255,255,255,0.16)' : 'rgba(255,255,255,0.06)'}
                          strokeWidth={1}
                        />
                        <line
                          x1={graphData.toSvgX(0)}
                          y1={graphData.toSvgY(g)}
                          x2={graphData.toSvgX(1)}
                          y2={graphData.toSvgY(g)}
                          stroke={g === 0 || g === 1 ? 'rgba(255,255,255,0.16)' : 'rgba(255,255,255,0.06)'}
                          strokeWidth={1}
                        />
                      </g>
                    ))}

                    {/* Linear baseline reference */}
                    <line
                      x1={graphData.toSvgX(0)}
                      y1={graphData.toSvgY(0)}
                      x2={graphData.toSvgX(1)}
                      y2={graphData.toSvgY(1)}
                      stroke="rgba(148,163,184,0.22)"
                      strokeDasharray="3 3"
                      strokeWidth={1}
                    />

                    {/* Speed Velocity Area Curve (dy/dt) */}
                    <path d={graphData.velAreaPath} fill="rgba(56, 189, 248, 0.12)" />
                    <path
                      d={graphData.velStrokePath}
                      fill="none"
                      stroke="rgba(56, 189, 248, 0.55)"
                      strokeWidth={1.2}
                    />

                    {/* Ease Progress Curve */}
                    <path d={graphData.curvePath} fill="none" stroke="#F59E0B" strokeWidth={2.4} />

                    {/* Tangent Lines */}
                    <line
                      x1={graphData.toSvgX(0)}
                      y1={graphData.toSvgY(0)}
                      x2={graphData.toSvgX(activePoints[0])}
                      y2={graphData.toSvgY(activePoints[1])}
                      stroke="#38BDF8"
                      strokeWidth={1.2}
                      strokeOpacity={0.75}
                    />
                    <line
                      x1={graphData.toSvgX(1)}
                      y1={graphData.toSvgY(1)}
                      x2={graphData.toSvgX(activePoints[2])}
                      y2={graphData.toSvgY(activePoints[3])}
                      stroke="#FACC15"
                      strokeWidth={1.2}
                      strokeOpacity={0.75}
                    />

                    {/* Live Playhead Position on Curve */}
                    {graphData.playheadDot && (
                      <circle
                        cx={graphData.playheadDot.cx}
                        cy={graphData.playheadDot.cy}
                        r={3.5}
                        fill="#FFFFFF"
                        stroke="#F59E0B"
                        strokeWidth={1.5}
                      />
                    )}

                    {/* Draggable Handle P1 (Ease Out from Prev) */}
                    <circle
                      cx={graphData.toSvgX(activePoints[0])}
                      cy={graphData.toSvgY(activePoints[1])}
                      r={5.5}
                      fill="#0B0F17"
                      stroke="#38BDF8"
                      strokeWidth={2.2}
                      className="cursor-grab active:cursor-grabbing"
                      onPointerDown={(e) => {
                        e.stopPropagation();
                        e.currentTarget.ownerSVGElement?.setPointerCapture(e.pointerId);
                        setDraggingHandle('p1');
                      }}
                    />

                    {/* Draggable Handle P2 (Ease In to Next) */}
                    <circle
                      cx={graphData.toSvgX(activePoints[2])}
                      cy={graphData.toSvgY(activePoints[3])}
                      r={5.5}
                      fill="#0B0F17"
                      stroke="#FACC15"
                      strokeWidth={2.2}
                      className="cursor-grab active:cursor-grabbing"
                      onPointerDown={(e) => {
                        e.stopPropagation();
                        e.currentTarget.ownerSVGElement?.setPointerCapture(e.pointerId);
                        setDraggingHandle('p2');
                      }}
                    />
                  </svg>
                </div>

                {/* Speed Presets + Numeric Readout */}
                <div className="flex-1 flex flex-col justify-between min-w-0">
                  <div className="grid grid-cols-2 gap-1.5">
                    {SPEED_PRESETS.map((preset) => {
                      const isMatch =
                        Math.abs(activePoints[0] - preset.points[0]) < 0.03 &&
                        Math.abs(activePoints[1] - preset.points[1]) < 0.03 &&
                        Math.abs(activePoints[2] - preset.points[2]) < 0.03 &&
                        Math.abs(activePoints[3] - preset.points[3]) < 0.03;
                      return (
                        <button
                          key={preset.id}
                          type="button"
                          onClick={() => updateSegmentCurve(preset.easing, preset.points)}
                          className={`rounded border px-2 py-1 text-[10px] font-medium transition-colors cursor-pointer whitespace-nowrap truncate ${
                            isMatch
                              ? 'border-amber-500 bg-amber-500/20 text-amber-300'
                              : 'border-white/8 bg-[#0B0F17] text-slate-300 hover:border-white/25'
                          }`}
                        >
                          {preset.label}
                        </button>
                      );
                    })}
                  </div>

                  <div className="space-y-1 border-t border-white/8 pt-1.5 text-[10px]">
                    <div className="flex items-center justify-between text-slate-400">
                      <span>Ease Out / In</span>
                      <span className="font-mono tabular-nums text-slate-200">
                        {Math.round(activePoints[0] * 100)}% / {Math.round((1 - activePoints[2]) * 100)}%
                      </span>
                    </div>
                    <div className="flex items-center justify-between text-slate-400">
                      <span>Peak Ramp</span>
                      <span className="font-mono tabular-nums text-sky-300">
                        {graphData.peakSpeed.toFixed(1)}x speed
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              <div className="flex-1 flex items-center justify-center p-4 text-center text-[11px] text-slate-400">
                Add at least two camera keyframes to adjust speed-ramping curves.
              </div>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
