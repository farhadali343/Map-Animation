import { Satellite } from 'lucide-react';
import type { HybridMapSettings } from '../types/project';

interface HybridMapControlProps {
  value?: HybridMapSettings;
  onChange: (next: HybridMapSettings) => void;
}

export const DEFAULT_HYBRID_MAP: HybridMapSettings = {
  enabled: true,
  showBordersAndLabels: false,
  showHighways: false,
  satelliteOpacity: 0.94,
  labelOpacity: 0.85,
};

export function HybridMapControl({ value, onChange }: HybridMapControlProps) {
  const settings = value || DEFAULT_HYBRID_MAP;

  const update = (patch: Partial<HybridMapSettings>) => {
    onChange({ ...settings, ...patch });
  };

  return (
    <div className="py-1.5 space-y-2.5 border-b border-white/8">
      <label className="flex items-center justify-between cursor-pointer">
        <span className="inline-flex items-center gap-2 text-xs font-medium text-slate-200 whitespace-nowrap shrink-0">
          <Satellite className="h-3.5 w-3.5 text-amber-400" />
          Satellite Map Blend
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
          <div className="grid grid-cols-2 gap-2 text-[11px]">
            <label className="flex items-center justify-between rounded bg-[#070A10] px-2 py-1.5 cursor-pointer text-slate-300">
              <span className="truncate">Tile Labels</span>
              <input
                type="checkbox"
                checked={settings.showBordersAndLabels}
                onChange={(e) => update({ showBordersAndLabels: e.target.checked })}
                className="accent-amber-500 shrink-0"
              />
            </label>
            <label className="flex items-center justify-between rounded bg-[#070A10] px-2 py-1.5 cursor-pointer text-slate-300">
              <span className="truncate">Highways</span>
              <input
                type="checkbox"
                checked={settings.showHighways}
                onChange={(e) => update({ showHighways: e.target.checked })}
                className="accent-amber-500 shrink-0"
              />
            </label>
          </div>

          <div className="space-y-2">
            <div>
              <div className="flex justify-between text-[11px] text-slate-400 mb-1">
                <span>Satellite Brightness</span>
                <span className="font-mono tabular-nums">
                  {Math.round(settings.satelliteOpacity * 100)}%
                </span>
              </div>
              <input
                type="range"
                min={0.35}
                max={1}
                step={0.05}
                value={settings.satelliteOpacity}
                onChange={(e) => update({ satelliteOpacity: Number(e.target.value) })}
                className="w-full accent-amber-500"
              />
            </div>

            <div>
              <div className="flex justify-between text-[11px] text-slate-400 mb-1">
                <span>Labels &amp; Roads Opacity</span>
                <span className="font-mono tabular-nums">
                  {Math.round(settings.labelOpacity * 100)}%
                </span>
              </div>
              <input
                type="range"
                min={0.2}
                max={1}
                step={0.05}
                value={settings.labelOpacity}
                onChange={(e) => update({ labelOpacity: Number(e.target.value) })}
                className="w-full accent-amber-500"
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
