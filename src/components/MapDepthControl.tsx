import { Mountain } from 'lucide-react';
import type { MapDepthSettings } from '../types/project';

interface MapDepthControlProps {
  value?: MapDepthSettings;
  onChange: (next: MapDepthSettings) => void;
}

export const DEFAULT_MAP_DEPTH: MapDepthSettings = {
  enabled: false,
  exaggeration: 1.8,
  depthOfField: 0.55,
};

export function MapDepthControl({ value, onChange }: MapDepthControlProps) {
  const settings = value || DEFAULT_MAP_DEPTH;

  const update = (patch: Partial<MapDepthSettings>) => {
    onChange({ ...settings, ...patch });
  };

  return (
    <div className="py-1.5 space-y-2 border-b border-white/8">
      <label className="flex items-center justify-between cursor-pointer">
        <span className="inline-flex items-center gap-2 text-xs font-medium text-slate-200 whitespace-nowrap shrink-0">
          <Mountain className="h-3.5 w-3.5 text-amber-400" />
          Terrain Relief &amp; Lens DOF
        </span>
        <input
          type="checkbox"
          checked={settings.enabled}
          onChange={(e) => update({ enabled: e.target.checked })}
          className="accent-amber-500"
        />
      </label>

      {settings.enabled && (
        <div className="space-y-2.5 pl-5">
          <div>
            <div className="flex justify-between text-[11px] text-slate-400 mb-1">
              <span>3D Terrain Relief</span>
              <span className="font-mono tabular-nums">{settings.exaggeration.toFixed(1)}x</span>
            </div>
            <input
              type="range"
              min={1.0}
              max={3.0}
              step={0.1}
              value={settings.exaggeration}
              onChange={(e) => update({ exaggeration: Number(e.target.value) })}
              className="w-full accent-amber-500"
            />
          </div>

          <div>
            <div className="flex justify-between text-[11px] text-slate-400 mb-1">
              <span>Documentary Depth of Field</span>
              <span className="font-mono tabular-nums">{Math.round(settings.depthOfField * 100)}%</span>
            </div>
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={settings.depthOfField}
              onChange={(e) => update({ depthOfField: Number(e.target.value) })}
              className="w-full accent-amber-500"
            />
          </div>
        </div>
      )}
    </div>
  );
}
