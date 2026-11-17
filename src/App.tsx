import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { APIProvider } from '@vis.gl/react-google-maps';
import { Captions, Check, Layers, RefreshCw } from 'lucide-react';
import { ExportModal } from './components/ExportModal';
import { GoogleMapsStage } from './components/GoogleMapsStage';
import { InspectorPanel } from './components/InspectorPanel';
import { ScriptAudioDrawer } from './components/ScriptAudioDrawer';
import { StageLayersPopover } from './components/StageLayersPopover';
import { StudioHeader, type WorkspaceTab } from './components/StudioHeader';
import { SubtitleStudioModal } from './components/SubtitleStudioModal';
import { ThemesView } from './components/ThemesView';
import { TimelineEditor } from './components/TimelineEditor';
import { THEME_PRESETS, createSampleProjects } from './data/presets';
import { preloadHybridTilesForProject, subscribeHybridTileUpdates } from './engine/hybridTileManager';
import { interpolateCamera, renderMapFrame, type RenderQualityTier } from './engine/mapCompositor';
import { playLiveSfx } from './engine/sfxEngine';
import type {
  CameraKeyframe,
  GeoRoute,
  LatLng,
  MapOverlay,
  MapProject,
  RegionMask,
  SfxCue,
  ThemePresetId,
  TimelineSelection,
} from './types/project';

const PREVIEW_WIDTH = 1080;
const PREVIEW_HEIGHT = 1920;
const PLAYBACK_WIDTH = 540;
const PLAYBACK_HEIGHT = 960;

export default function App() {
  const [projects, setProjects] = useState<MapProject[]>(() => createSampleProjects());
  const [activeProjectId, setActiveProjectId] = useState<string>('demo-spain-borders');
  const [activeTab, setActiveTab] = useState<WorkspaceTab>('director');
  const [currentTimeMs, setCurrentTimeMs] = useState<number>(0);
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [selection, setSelection] = useState<TimelineSelection>(null);
  const [showExportModal, setShowExportModal] = useState<boolean>(false);
  const [quotaExceeded, setQuotaExceeded] = useState<boolean>(false);
  const [tileTick, setTileTick] = useState<number>(0);
  const [mobilePane, setMobilePane] = useState<'story' | 'stage' | 'inspector'>('stage');
  const [preloadNonce, setPreloadNonce] = useState<number>(0);
  const [tileLoadStatus, setTileLoadStatus] = useState<{
    pct: number;
    loaded: number;
    total: number;
    ready: boolean;
    warming: boolean;
  }>({ pct: 0, loaded: 0, total: 0, ready: false, warming: true });

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const playbackSurfaceRef = useRef<OffscreenCanvas | HTMLCanvasElement | null>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const lastFrameTsRef = useRef<number | null>(null);
  const emaFrameMsRef = useRef<number>(8);
  const playheadMsRef = useRef<number>(0);
  const isPlayingRef = useRef<boolean>(false);
  const playheadListenersRef = useRef<Set<(ms: number) => void>>(new Set());

  isPlayingRef.current = isPlaying;

  const subscribePlayhead = useCallback((listener: (ms: number) => void) => {
    playheadListenersRef.current.add(listener);
    return () => {
      playheadListenersRef.current.delete(listener);
    };
  }, []);

  const activeProject = useMemo(
    () => projects.find((p) => p.id === activeProjectId) || projects[0],
    [projects, activeProjectId],
  );

  // Listen for Google Maps Platform quota exhaustion (Tier 1 & Tier 2)
  useEffect(() => {
    const onQuota = () => setQuotaExceeded(true);
    window.addEventListener('gmp-quota-exceeded', onQuota);
    return () => window.removeEventListener('gmp-quota-exceeded', onQuota);
  }, []);

  const updateActiveProject = useCallback(
    (updater: (prev: MapProject) => MapProject) => {
      setProjects((prevList) =>
        prevList.map((item) => (item.id === activeProject.id ? updater(item) : item)),
      );
    },
    [activeProject.id],
  );

  const tileWarmSignature = useMemo(() => {
    const camSig = activeProject.cameraKeyframes
      .map(
        (k) =>
          `${k.timeMs}:${k.lat.toFixed(3)},${k.lng.toFixed(3)},${k.zoom.toFixed(2)},${k.projectionMode},${k.mapStyle || 'satellite'}`,
      )
      .join(';');
    const hy = activeProject.hybridMap;
    return [
      activeProject.id,
      activeProject.durationMs,
      hy ? `${hy.enabled}:${hy.showBordersAndLabels}:${hy.showHighways}` : 'clean',
      activeProject.mapDepth?.enabled ? 'dp1' : 'dp0',
      camSig,
      preloadNonce,
    ].join('|');
  }, [activeProject, preloadNonce]);

  // Pre-warm full zoom-pyramid satellite tiles along the entire camera trajectory so mid-video zooming never blurs or stalls
  useEffect(() => {
    const controller = new AbortController();
    setTileLoadStatus((prev) => ({ ...prev, ready: false, warming: true, pct: 0 }));

    preloadHybridTilesForProject(
      activeProject,
      PLAYBACK_WIDTH,
      PLAYBACK_HEIGHT,
      interpolateCamera,
      (pct, _msg, loaded = 0, total = 0) => {
        if (controller.signal.aborted) return;
        setTileLoadStatus({
          pct,
          loaded,
          total,
          ready: pct >= 100,
          warming: pct < 100,
        });
      },
      controller.signal,
    )
      .then((res) => {
        if (controller.signal.aborted) return;
        setTileLoadStatus({
          pct: 100,
          loaded: res.loaded,
          total: res.total,
          ready: true,
          warming: false,
        });
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setTileLoadStatus((prev) => ({ ...prev, warming: false }));
        }
      });
    return () => controller.abort();
  }, [tileWarmSignature]);

  // Repaint paused preview canvas automatically whenever async hybrid tiles finish loading
  useEffect(
    () =>
      subscribeHybridTileUpdates(() => {
        if (!isPlayingRef.current) {
          setTileTick((t) => t + 1);
        }
      }),
    [],
  );

  // Render crisp full-resolution 9:16 video canvas whenever paused/scrubbing/editing
  useEffect(() => {
    if (isPlaying || activeTab !== 'director') return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    renderMapFrame(ctx, activeProject, currentTimeMs, PREVIEW_WIDTH, PREVIEW_HEIGHT, {
      includeSafeZones: true,
      useLayeredOffscreen: true,
      qualityTier: 'full',
    });
  }, [activeProject, currentTimeMs, isPlaying, activeTab, tileTick]);

  // Sync voiceover HTMLAudioElement playback & volume
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.volume = Math.max(0, Math.min(1, activeProject.audio.voiceVolume));
  }, [activeProject.audio.voiceVolume]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !activeProject.audio.audioUrl) return;
    if (isPlaying) {
      if (Math.abs(audio.currentTime * 1000 - playheadMsRef.current) > 180) {
        audio.currentTime = playheadMsRef.current / 1000;
      }
      audio.play().catch(() => {});
    } else {
      audio.pause();
    }
  }, [isPlaying, activeProject.audio.audioUrl]);

  const handleSeek = useCallback(
    (nextMs: number) => {
      const clamped = Math.max(0, Math.min(activeProject.durationMs, Math.round(nextMs)));
      playheadMsRef.current = clamped;
      setCurrentTimeMs(clamped);
      playheadListenersRef.current.forEach((fn) => fn(clamped));
      if (audioRef.current && activeProject.audio.audioUrl) {
        audioRef.current.currentTime = clamped / 1000;
      }
    },
    [activeProject.durationMs, activeProject.audio.audioUrl],
  );

  const handleTogglePlay = useCallback(() => {
    setIsPlaying((prev) => {
      if (prev) {
        // Sync React playhead exact ms on pause so paused full-res render & inspector match
        setCurrentTimeMs(Math.round(playheadMsRef.current));
        return false;
      }
      if (playheadMsRef.current >= activeProject.durationMs - 40) {
        playheadMsRef.current = 0;
        setCurrentTimeMs(0);
        playheadListenersRef.current.forEach((fn) => fn(0));
        if (audioRef.current && activeProject.audio.audioUrl) {
          audioRef.current.currentTime = 0;
        }
      }
      return true;
    });
  }, [activeProject.durationMs, activeProject.audio.audioUrl]);

  // Spacebar toggles play/pause outside inputs
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code !== 'Space') return;
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || tag === 'BUTTON') return;
      e.preventDefault();
      handleTogglePlay();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [handleTogglePlay]);

  // Lock-free 60fps playback RAF loop using OffscreenCanvas layers + adaptive frame-budget throttling
  useEffect(() => {
    if (!isPlaying) {
      lastFrameTsRef.current = null;
      return;
    }

    if (!playbackSurfaceRef.current) {
      playbackSurfaceRef.current =
        typeof OffscreenCanvas !== 'undefined'
          ? new OffscreenCanvas(PLAYBACK_WIDTH, PLAYBACK_HEIGHT)
          : document.createElement('canvas');
      playbackSurfaceRef.current.width = PLAYBACK_WIDTH;
      playbackSurfaceRef.current.height = PLAYBACK_HEIGHT;
    }

    let rafId = 0;

    const tick = (now: number) => {
      if (lastFrameTsRef.current === null) {
        lastFrameTsRef.current = now;
      }
      const delta = Math.min(50, Math.max(0, now - lastFrameTsRef.current));
      lastFrameTsRef.current = now;

      const prev = playheadMsRef.current;
      let next = prev + delta;

      // Authoritative audio clock lock so word-level documentary captions highlight cleanly on beat
      const audio = audioRef.current;
      if (audio && activeProject.audio.audioUrl && !audio.paused && !audio.ended && audio.readyState >= 2) {
        const audioMs = audio.currentTime * 1000;
        if (Math.abs(audioMs - next) > 16) {
          next = audioMs;
        }
      }

      // Trigger SFX cues crossed in [prev, next]
      if (activeProject.audio.sfxVolume > 0.02) {
        for (const cue of activeProject.sfxCues) {
          if (cue.timeMs >= prev && cue.timeMs < next) {
            playLiveSfx(cue.type, cue.volume * activeProject.audio.sfxVolume);
          }
        }
      }

      if (next >= activeProject.durationMs) {
        next = activeProject.durationMs;
        playheadMsRef.current = next;
        playheadListenersRef.current.forEach((fn) => fn(next));
        setCurrentTimeMs(next);
        setIsPlaying(false);
        return;
      }

      playheadMsRef.current = next;

      // Adaptive OffscreenCanvas quality tier & resolution scaling to lock 60fps even during heavy Globe/Flow/Rain scenes
      const displayCanvas = canvasRef.current;
      const bufSurface = playbackSurfaceRef.current;
      if (displayCanvas && bufSurface && activeTab === 'director') {
        const ema = emaFrameMsRef.current;
        const qualityTier: RenderQualityTier = ema > 13.5 ? 'fast' : 'balanced';
        const targetW = ema > 15 ? 450 : ema < 7 ? 640 : PLAYBACK_WIDTH;
        const targetH = Math.round((targetW * 16) / 9);

        if (bufSurface.width !== targetW || bufSurface.height !== targetH) {
          bufSurface.width = targetW;
          bufSurface.height = targetH;
        }

        const bctx = bufSurface.getContext('2d') as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
        const dctx = displayCanvas.getContext('2d');
        if (bctx && dctx) {
          const t0 = performance.now();
          renderMapFrame(bctx, activeProject, next, targetW, targetH, {
            includeSafeZones: true,
            previewPlayback: true,
            useLayeredOffscreen: true,
            qualityTier,
          });
          dctx.clearRect(0, 0, PREVIEW_WIDTH, PREVIEW_HEIGHT);
          dctx.drawImage(bufSurface, 0, 0, PREVIEW_WIDTH, PREVIEW_HEIGHT);
          const renderMs = performance.now() - t0;
          emaFrameMsRef.current = ema * 0.82 + renderMs * 0.18;
        }
      }

      // Update timeline playhead needle & timecode cleanly via DOM refs
      playheadListenersRef.current.forEach((fn) => fn(next));

      rafId = requestAnimationFrame(tick);
    };

    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [isPlaying, activeProject, activeTab]);

  // Quick-add timeline elements at current playhead
  const handleAddCameraKeyframe = useCallback(
    (loc?: LatLng, customLabel?: string) => {
      const nowMs = playheadMsRef.current;
      const cam = interpolateCamera(activeProject, nowMs);
      const id = `cam-${Date.now()}`;
      const newKf: CameraKeyframe = {
        id,
        timeMs: Math.round(nowMs),
        label: customLabel || `Shot ${activeProject.cameraKeyframes.length + 1}`,
        lat: loc ? loc.lat : Number(cam.lat.toFixed(3)),
        lng: loc ? loc.lng : Number(cam.lng.toFixed(3)),
        zoom: Number(cam.zoom.toFixed(2)),
        pitch: Math.round(cam.pitch),
        bearing: Math.round(cam.bearing),
        projectionMode: cam.globeMix > 0.5 ? 'globe' : 'mercator',
        easing: 'easeInOutCubic',
      };
      updateActiveProject((prev) => ({
        ...prev,
        cameraKeyframes: [...prev.cameraKeyframes, newKf].sort((a, b) => a.timeMs - b.timeMs),
      }));
      setSelection({ kind: 'camera', id });
    },
    [activeProject, updateActiveProject],
  );

  const handleAddOverlay = useCallback(() => {
    const nowMs = playheadMsRef.current;
    const cam = interpolateCamera(activeProject, nowMs);
    const id = `ov-${Date.now()}`;
    const startMs = Math.round(nowMs);
    const endMs = Math.min(activeProject.durationMs, startMs + 3500);
    const newOverlay: MapOverlay = {
      id,
      type: 'title-badge',
      startMs,
      endMs,
      lat: Number(cam.lat.toFixed(3)),
      lng: Number(cam.lng.toFixed(3)),
      text: 'Key Region',
      accentColor: THEME_PRESETS[activeProject.themePreset].accentColor,
    };
    updateActiveProject((prev) => ({
      ...prev,
      overlays: [...prev.overlays, newOverlay],
    }));
    setSelection({ kind: 'overlay', id });
  }, [activeProject, updateActiveProject]);

  const handleAddRegionMask = useCallback(() => {
    const id = `mask-${Date.now()}`;
    const startMs = Math.round(playheadMsRef.current);
    const endMs = Math.min(activeProject.durationMs, startMs + 4500);
    const newMask: RegionMask = {
      id,
      regionName: 'Spain',
      label: 'Spain',
      startMs,
      endMs,
      fillMode: 'solid-tint',
      color: '#F59E0B',
      borderColor: '#FFFFFF',
      borderGlow: true,
      darkIsolationMask: false,
    };
    updateActiveProject((prev) => ({
      ...prev,
      regionMasks: [...prev.regionMasks, newMask],
    }));
    setSelection({ kind: 'region', id });
  }, [activeProject.durationMs, updateActiveProject]);

  const handleAddSfx = useCallback(() => {
    const id = `sfx-${Date.now()}`;
    const newCue: SfxCue = {
      id,
      type: 'whoosh',
      timeMs: Math.round(playheadMsRef.current),
      volume: 0.8,
      label: 'Whoosh',
    };
    playLiveSfx('whoosh', 0.7);
    updateActiveProject((prev) => ({
      ...prev,
      sfxCues: [...prev.sfxCues, newCue],
    }));
    setSelection({ kind: 'sfx', id });
  }, [updateActiveProject]);

  const handleAddComputedRoute = useCallback(
    (name: string, points: LatLng[], distanceLabel: string) => {
      const id = `route-${Date.now()}`;
      const startMs = Math.round(playheadMsRef.current);
      const endMs = Math.min(activeProject.durationMs, startMs + 5500);
      const newRoute: GeoRoute = {
        id,
        name,
        startMs,
        endMs,
        points,
        style: 'solid',
        color: '#FACC15',
        width: 5,
        glow: true,
        easing: 'easeInOutCubic',
        dashAnimation: 'draw',
        showTrailGhost: true,
        distanceLabel,
        travelerType: 'car',
      };
      updateActiveProject((prev) => ({
        ...prev,
        routes: [...prev.routes, newRoute],
      }));
      setSelection({ kind: 'route', id });
      setActiveTab('director');
    },
    [activeProject.durationMs, updateActiveProject],
  );

  const handleSelectProject = useCallback((projId: string) => {
    setIsPlaying(false);
    setActiveProjectId(projId);
    playheadMsRef.current = 0;
    setCurrentTimeMs(0);
    playheadListenersRef.current.forEach((fn) => fn(0));
    setSelection(null);
    setActiveTab('director');
  }, []);

  const handleApplyTheme = useCallback(
    (themeId: ThemePresetId) => {
      const def = THEME_PRESETS[themeId];
      updateActiveProject((prev) => ({
        ...prev,
        themePreset: themeId,
        subtitleStyle: {
          ...prev.subtitleStyle,
          fontFamily: def.defaultFont,
          highlightColor: def.accentColor,
        },
      }));
      setActiveTab('director');
    },
    [updateActiveProject],
  );

  const liveCam = useMemo(
    () => (activeTab === 'map-picker' ? interpolateCamera(activeProject, currentTimeMs) : activeProject.cameraKeyframes[0] || { lat: 25, lng: 0, zoom: 2.2 }),
    [activeProject, currentTimeMs, activeTab],
  );

  const mapsApiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY || '';

  return (
    <APIProvider apiKey={mapsApiKey} language="en" region="US">
      <div className="h-screen w-screen overflow-hidden bg-[#0B0F17] text-slate-100 flex flex-col">
        {quotaExceeded && (
          <div className="bg-amber-50 border-b border-amber-200 text-amber-900 px-4 py-2.5 text-xs md:text-sm text-center sticky top-0 z-50 shadow-sm">
            <span>
              Google Maps Platform quota reached. If you are the app owner, visit{' '}
              <a
                href="https://developers.google.com/maps/ai/ai-studio?utm_campaign=gmp_mcp_codeassist_v1_aistudio#quota_exceeded_errors"
                target="_blank"
                rel="noopener noreferrer"
                className="underline font-semibold text-amber-950 hover:text-amber-800"
              >
                maps developer site
              </a>{' '}
              for instructions to update your account.
            </span>
          </div>
        )}

        <StudioHeader
          activeTab={activeTab}
          onSelectTab={setActiveTab}
          onOpenExport={() => {
            setIsPlaying(false);
            setShowExportModal(true);
          }}
        />

        {/* Hidden audio player synced to Voiceover URL */}
        <audio ref={audioRef} src={activeProject.audio.audioUrl || undefined} preload="auto" />

        {/* Main Workspace Body */}
        <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
          {activeTab === 'director' && (
            <>
              {/* Responsive panel switcher below xl */}
              <div className="xl:hidden shrink-0 border-b border-white/8 bg-[#0B0F17] px-3 py-1.5 flex items-center gap-1.5">
                {(['story', 'stage', 'inspector'] as const).map((pane) => (
                  <button
                    key={pane}
                    type="button"
                    onClick={() => setMobilePane(pane)}
                    className={`flex-1 rounded-md py-1 text-xs font-semibold transition-colors cursor-pointer ${
                      mobilePane === pane
                        ? 'bg-amber-500 text-slate-950'
                        : 'border border-white/10 bg-[#070A10] text-slate-300 hover:text-white'
                    }`}
                  >
                    {pane === 'story' ? 'Voiceover' : pane === 'stage' ? 'Stage' : 'Inspector'}
                  </button>
                ))}
              </div>

              <div className="flex-1 min-h-0 flex overflow-hidden">
                {/* Left Drawer: Upload VO & Transcript Deck */}
                <div className={`${mobilePane === 'story' ? 'flex w-full' : 'hidden'} xl:flex xl:w-auto shrink-0 min-h-0`}>
                  <ScriptAudioDrawer
                    key={activeProject.id}
                    project={activeProject}
                    onUpdateProject={updateActiveProject}
                    onBuildComplete={() => {
                      handleSeek(0);
                      setMobilePane('stage');
                      setPreloadNonce((n) => n + 1);
                    }}
                  />
                </div>

                {/* Center: 9:16 Vertical Stage */}
                <main className={`${mobilePane === 'stage' ? 'flex' : 'hidden'} xl:flex flex-1 min-w-0 flex-col bg-[#070A10] overflow-hidden`}>
                  {/* Clean Stage Control Strip */}
                  <div className="h-11 shrink-0 border-b border-white/8 bg-[#0B0F17] px-3 sm:px-4 flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0 shrink-0">
                      <select
                        value={activeProject.id}
                        onChange={(e) => handleSelectProject(e.target.value)}
                        aria-label="Select documentary story"
                        className="rounded-md border border-white/10 bg-[#070A10] px-2.5 py-1 text-xs font-semibold text-slate-100 focus:border-amber-500 focus:outline-none truncate max-w-[180px] sm:max-w-[240px]"
                      >
                        {projects.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.title}
                          </option>
                        ))}
                      </select>

                      <button
                        type="button"
                        onClick={handleAddRegionMask}
                        className="inline-flex items-center gap-1 rounded-md border border-white/10 bg-[#070A10] px-2.5 py-1 text-[11px] font-medium text-slate-200 hover:border-amber-500/60 cursor-pointer whitespace-nowrap"
                      >
                        <Layers className="h-3 w-3 text-amber-400" />
                        + Region
                      </button>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      {/* Zoom-Pyramid Tile Preload Readiness Indicator */}
                      <div className="hidden md:flex items-center gap-2 pr-1 text-[11px] text-slate-300 tabular-nums">
                        {tileLoadStatus.warming ? (
                          <div className="flex items-center gap-2">
                            <span className="text-amber-300 whitespace-nowrap">
                              Caching zoom {tileLoadStatus.pct}%
                            </span>
                            <div className="h-1.5 w-20 overflow-hidden rounded-full bg-white/10">
                              <div
                                className="h-full bg-amber-400 transition-all duration-150"
                                style={{ width: `${Math.max(6, tileLoadStatus.pct)}%` }}
                              />
                            </div>
                          </div>
                        ) : (
                          <button
                            type="button"
                            onClick={() => setPreloadNonce((n) => n + 1)}
                            title="All zoom levels cached. Click to refresh tile cache."
                            className="inline-flex items-center gap-1 text-[11px] text-emerald-300/90 hover:text-emerald-200 cursor-pointer whitespace-nowrap"
                          >
                            <Check className="h-3 w-3" />
                            <span>Map Ready</span>
                            <RefreshCw className="h-2.5 w-2.5 opacity-60 ml-0.5" />
                          </button>
                        )}
                      </div>

                      <StageLayersPopover
                        project={activeProject}
                        onUpdateProject={updateActiveProject}
                      />

                      <button
                        type="button"
                        onClick={() =>
                          updateActiveProject((p) => ({ ...p, showSubtitles: !p.showSubtitles }))
                        }
                        className={`inline-flex items-center gap-1 rounded-md border px-2.5 py-1 text-[11px] font-medium cursor-pointer whitespace-nowrap ${
                          activeProject.showSubtitles
                            ? 'border-amber-500/60 bg-amber-500/15 text-amber-300'
                            : 'border-white/10 bg-[#070A10] text-slate-400 hover:text-white'
                        }`}
                      >
                        <Captions className="h-3 w-3" />
                        Captions
                      </button>
                    </div>
                  </div>

                  {/* Centered 9:16 Portrait Canvas */}
                  <div className="flex-1 min-h-0 flex items-center justify-center p-2 sm:p-4 overflow-hidden">
                    <div className="relative h-full max-h-full aspect-[9/16] rounded-xl border border-white/12 bg-[#040911] shadow-2xl overflow-hidden flex items-center justify-center">
                      <canvas
                        ref={canvasRef}
                        width={PREVIEW_WIDTH}
                        height={PREVIEW_HEIGHT}
                        className="h-full w-full block object-contain"
                      />
                    </div>
                  </div>
                </main>

                {/* Right Inspector */}
                <div className={`${mobilePane === 'inspector' ? 'flex w-full' : 'hidden'} xl:flex xl:w-auto shrink-0 min-h-0`}>
                  <InspectorPanel
                    project={activeProject}
                    selection={selection}
                    onUpdateProject={updateActiveProject}
                    onClearSelection={() => setSelection(null)}
                  />
                </div>
              </div>

              {/* Bottom Multi-Track Timeline */}
              <TimelineEditor
                project={activeProject}
                currentTimeMs={currentTimeMs}
                isPlaying={isPlaying}
                selection={selection}
                subscribePlayhead={subscribePlayhead}
                onTogglePlay={handleTogglePlay}
                onSeek={handleSeek}
                onSelect={setSelection}
                onUpdateProject={updateActiveProject}
                onAddCameraKeyframe={() => handleAddCameraKeyframe()}
                onAddOverlay={handleAddOverlay}
                onAddSfx={handleAddSfx}
              />
            </>
          )}

          {activeTab === 'map-picker' && (
            <GoogleMapsStage
              center={{ lat: liveCam.lat, lng: liveCam.lng }}
              zoom={liveCam.zoom}
              onAddKeyframeAt={(loc, label) => {
                handleAddCameraKeyframe(loc, label);
                setActiveTab('director');
              }}
              onAddComputedRoute={handleAddComputedRoute}
            />
          )}

          {activeTab === 'subtitles' && (
            <SubtitleStudioModal project={activeProject} onUpdateProject={updateActiveProject} />
          )}

          {activeTab === 'themes' && (
            <ThemesView
              projects={projects}
              activeProject={activeProject}
              onSelectProject={handleSelectProject}
              onApplyTheme={handleApplyTheme}
            />
          )}
        </div>

        {showExportModal && (
          <ExportModal project={activeProject} onClose={() => setShowExportModal(false)} />
        )}
      </div>
    </APIProvider>
  );
}
