import { Grid3X3 } from 'lucide-react';
import type { MapGridSettings } from '../types/project';

interface MapGridControlProps {
  value?: MapGridSettings;
  onChange: (next: MapGridSettings) => void;
}

export const DEFAULT_MAP_GRID: MapGridSettings = {
  enabled: false,
  stepDegrees: 20,
  showLabels: false,
  highlightEquatorTropics: false,
  opacity: 0.55,
};

export function MapGridControl({ value, onChange }: MapGridControlProps) {
  const settings = value || DEFAULT_MAP_GRID;

  const update = (patch: Partial<MapGridSettings>) => {
    onChange({ ...settings, ...patch });
  };

  return (
    <div className="py-1.5 space-y-2.5">
      <label className="flex items-center justify-between cursor-pointer">
        <span className="inline-flex items-center gap-2 text-xs font-medium text-slate-200">
          <Grid3X3 className="h-3.5 w-3.5 text-amber-400" />
          Lat / Lng Grid
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
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-[11px] text-slate-400 mb-1">Spacing</label>
              <select
                value={settings.stepDegrees}
                onChange={(e) => update({ stepDegrees: Number(e.target.value) as 10 | 15 | 20 | 30 })}
                className="w-full rounded-md border border-white/10 bg-[#070A10] px-2 py-1 text-xs text-slate-100"
              >
                <option value={10}>10° Fine</option>
                <option value={15}>15° Medium</option>
                <option value={20}>20° Standard</option>
                <option value={30}>30° Wide</option>
              </select>
            </div>

            <div>
              <label className="block text-[11px] text-slate-400 mb-1">
                Opacity ({Math.round(settings.opacity * 100)}%)
              </label>
              <input
                type="range"
                min={0.2}
                max={1}
                step={0.05}
                value={settings.opacity}
                onChange={(e) => update({ opacity: Number(e.target.value) })}
                className="w-full accent-amber-500 mt-1.5"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2 text-[11px]">
            <label className="flex items-center justify-between rounded bg-[#070A10] px-2 py-1.5 cursor-pointer text-slate-300">
              <span>Coord Labels</span>
              <input
                type="checkbox"
                checked={settings.showLabels}
                onChange={(e) => update({ showLabels: e.target.checked })}
                className="accent-amber-500"
              />
            </label>
            <label className="flex items-center justify-between rounded bg-[#070A10] px-2 py-1.5 cursor-pointer text-slate-300">
              <span>Equator / Tropics</span>
              <input
                type="checkbox"
                checked={settings.highlightEquatorTropics}
                onChange={(e) => update({ highlightEquatorTropics: e.target.checked })}
                className="accent-amber-500"
              />
            </label>
          </div>
        </div>
      )}
    </div>
  );
}
