import { useEffect, useRef, useState } from 'react';
import { SlidersHorizontal, X } from 'lucide-react';
import { GlowingEdgeControl } from './GlowingEdgeControl';
import { HybridMapControl } from './HybridMapControl';
import { MapDepthControl } from './MapDepthControl';
import { MapGridControl } from './MapGridControl';
import type { MapProject } from '../types/project';

interface StageLayersPopoverProps {
  project: MapProject;
  onUpdateProject: (updater: (prev: MapProject) => MapProject) => void;
}

export function StageLayersPopover({ project, onUpdateProject }: StageLayersPopoverProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', handlePointerDown);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [open]);

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-[11px] font-medium transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
          open
            ? 'border-amber-500/70 bg-amber-500/15 text-amber-300'
            : 'border-white/10 bg-[#070A10] text-slate-300 hover:border-white/25 hover:text-white'
        }`}
      >
        <SlidersHorizontal className="h-3 w-3" />
        Layers
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-2 z-50 w-80 max-h-[72vh] overflow-y-auto rounded-xl border border-white/12 bg-[#111722] p-4 shadow-2xl space-y-3 text-xs">
          <div className="flex items-center justify-between pb-2 border-b border-white/8">
            <span className="font-display text-xs font-semibold text-white">Stage & Camera Layers</span>
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Close layers"
              className="p-0.5 text-slate-400 hover:text-white cursor-pointer"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>

          <HybridMapControl
            value={project.hybridMap}
            onChange={(hybridMap) => onUpdateProject((p) => ({ ...p, hybridMap }))}
          />
          <GlowingEdgeControl
            value={project.glowingEdge}
            onChange={(glowingEdge) => onUpdateProject((p) => ({ ...p, glowingEdge }))}
          />
          <MapDepthControl
            value={project.mapDepth}
            onChange={(mapDepth) => onUpdateProject((p) => ({ ...p, mapDepth }))}
          />
          <MapGridControl
            value={project.mapGrid}
            onChange={(mapGrid) => onUpdateProject((p) => ({ ...p, mapGrid }))}
          />

          {/* Camera Optics & Safe Zone */}
          <div className="pt-2 border-t border-white/8 space-y-2">
            <label className="flex items-center justify-between py-1 cursor-pointer text-slate-200">
              <span>Handheld Camera Motion</span>
              <input
                type="checkbox"
                checked={Boolean(project.handheldCamera?.enabled)}
                onChange={(e) =>
                  onUpdateProject((p) => ({
                    ...p,
                    handheldCamera: {
                      enabled: e.target.checked,
                      intensity: p.handheldCamera?.intensity ?? 0.55,
                      highActionOnly: p.handheldCamera?.highActionOnly ?? true,
                    },
                  }))
                }
                className="accent-amber-500"
              />
            </label>

            {project.handheldCamera?.enabled && (
              <div className="pl-2 space-y-2 pb-1">
                <div className="flex justify-between text-[11px] text-slate-400">
                  <span>Jitter Strength</span>
                  <span className="font-mono tabular-nums">
                    {Math.round((project.handheldCamera?.intensity ?? 0.55) * 100)}%
                  </span>
                </div>
                <input
                  type="range"
                  min={0.1}
                  max={1}
                  step={0.05}
                  value={project.handheldCamera?.intensity ?? 0.55}
                  onChange={(e) =>
                    onUpdateProject((p) => ({
                      ...p,
                      handheldCamera: {
                        enabled: true,
                        intensity: Number(e.target.value),
                        highActionOnly: p.handheldCamera?.highActionOnly ?? true,
                      },
                    }))
                  }
                  className="w-full accent-amber-500"
                />
              </div>
            )}

            <label className="flex items-center justify-between py-1 cursor-pointer text-slate-200">
              <span>Shutter Motion Blur</span>
              <input
                type="checkbox"
                checked={project.motionBlur ? project.motionBlur.enabled : true}
                onChange={(e) =>
                  onUpdateProject((p) => ({
                    ...p,
                    motionBlur: {
                      enabled: e.target.checked,
                      shutterAngle: p.motionBlur?.shutterAngle ?? 180,
                      samples: p.motionBlur?.samples ?? 4,
                    },
                  }))
                }
                className="accent-amber-500"
              />
            </label>

            {(project.motionBlur ? project.motionBlur.enabled : true) && (
              <div className="pl-2 space-y-1 pb-1">
                <div className="flex justify-between text-[11px] text-slate-400">
                  <span>Shutter Angle</span>
                  <span className="font-mono tabular-nums">
                    {project.motionBlur?.shutterAngle ?? 180}°
                  </span>
                </div>
                <input
                  type="range"
                  min={90}
                  max={360}
                  step={15}
                  value={project.motionBlur?.shutterAngle ?? 180}
                  onChange={(e) =>
                    onUpdateProject((p) => ({
                      ...p,
                      motionBlur: {
                        enabled: true,
                        shutterAngle: Number(e.target.value),
                        samples: p.motionBlur?.samples ?? 4,
                      },
                    }))
                  }
                  className="w-full accent-amber-500"
                />
              </div>
            )}

            <label className="flex items-center justify-between py-1 border-t border-white/8 pt-2.5 cursor-pointer text-slate-200">
              <span>9:16 Reels Safe Guides</span>
              <input
                type="checkbox"
                checked={project.showSafeZones}
                onChange={(e) => onUpdateProject((p) => ({ ...p, showSafeZones: e.target.checked }))}
                className="accent-amber-500"
              />
            </label>
          </div>
        </div>
      )}
    </div>
  );
}
