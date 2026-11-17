import { Sun } from 'lucide-react';
import type { GlowingEdgeSettings } from '../types/project';

interface GlowingEdgeControlProps {
  value?: GlowingEdgeSettings;
  onChange: (next: GlowingEdgeSettings) => void;
}

export const DEFAULT_GLOWING_EDGE: GlowingEdgeSettings = {
  enabled: false,
  intensity: 1.5,
};

export function GlowingEdgeControl({ value, onChange }: GlowingEdgeControlProps) {
  const settings = value || DEFAULT_GLOWING_EDGE;

  const update = (patch: Partial<GlowingEdgeSettings>) => {
    onChange({ ...settings, ...patch });
  };

  return (
    <div className="py-1.5 space-y-2 border-b border-white/8">
      <label className="flex items-center justify-between cursor-pointer">
        <span className="inline-flex items-center gap-2 text-xs font-medium text-slate-200 whitespace-nowrap shrink-0">
          <Sun className="h-3.5 w-3.5 text-amber-400" />
          Border Light Bloom
        </span>
        <input
          type="checkbox"
          checked={settings.enabled}
          onChange={(e) => update({ enabled: e.target.checked })}
          className="accent-amber-500"
        />
      </label>

      {settings.enabled && (
        <div className="pl-5">
          <div className="flex justify-between text-[11px] text-slate-400 mb-1">
            <span>Bloom Strength</span>
            <span className="font-mono tabular-nums">{Math.round(settings.intensity * 100)}%</span>
          </div>
          <input
            type="range"
            min={0.6}
            max={2.5}
            step={0.1}
            value={settings.intensity}
            onChange={(e) => update({ intensity: Number(e.target.value) })}
            className="w-full accent-amber-500"
          />
        </div>
      )}
    </div>
  );
}
