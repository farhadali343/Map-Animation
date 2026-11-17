import { Check, Clapperboard, Palette } from 'lucide-react';
import { THEME_PRESETS } from '../data/presets';
import type { MapProject, ThemePresetId } from '../types/project';

interface ThemesViewProps {
  projects: MapProject[];
  activeProject: MapProject;
  onSelectProject: (projectId: string) => void;
  onApplyTheme: (themeId: ThemePresetId) => void;
}

export function ThemesView({
  projects,
  activeProject,
  onSelectProject,
  onApplyTheme,
}: ThemesViewProps) {
  const themeList = Object.values(THEME_PRESETS);

  return (
    <div className="h-full overflow-y-auto bg-[#070A10] p-6">
      <div className="mx-auto max-w-5xl space-y-8">
        {/* Visual Theme Presets */}
        <section className="space-y-4">
          <div className="border-b border-white/8 pb-3 flex items-center justify-between">
            <div>
              <h1 className="font-display text-xl font-bold text-white flex items-center gap-2">
                <Palette className="h-5 w-5 text-amber-400" />
                Map Styles
              </h1>
              <p className="text-xs text-slate-400 mt-1">
                Switch cartography aesthetics, projection behavior, and typography across your current timeline.
              </p>
            </div>
            <span className="font-mono text-xs text-slate-400">
              Active · {THEME_PRESETS[activeProject.themePreset].name}
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {themeList.map((theme) => {
              const isSelected = activeProject.themePreset === theme.id;
              return (
                <div
                  key={theme.id}
                  className={`rounded-xl border p-5 flex flex-col justify-between gap-4 transition-colors ${
                    isSelected
                      ? 'border-amber-500 bg-[#111722]'
                      : 'border-white/8 bg-[#111722] hover:border-white/20'
                  }`}
                >
                  <div className="space-y-3">
                    {/* Swatch Preview Bar */}
                    <div
                      className="h-24 w-full rounded-lg border border-white/10 p-3 flex flex-col justify-between relative overflow-hidden"
                      style={{
                        background: `linear-gradient(180deg, ${theme.oceanTop} 0%, ${theme.oceanBottom} 100%)`,
                      }}
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-[11px] font-semibold tracking-tight text-white/90">
                          {theme.defaultFont}
                        </span>
                        <div className="flex items-center gap-1.5">
                          <span
                            className="h-3.5 w-3.5 rounded-full border border-white/30"
                            style={{ backgroundColor: theme.landFill }}
                            title="Landmass"
                          />
                          <span
                            className="h-3.5 w-3.5 rounded-full border border-white/30"
                            style={{ backgroundColor: theme.accentColor }}
                            title="Accent"
                          />
                        </div>
                      </div>
                      <div
                        className="h-5 w-3/4 rounded border"
                        style={{
                          backgroundColor: theme.landFill,
                          borderColor: theme.landStroke,
                        }}
                      />
                    </div>

                    <div>
                      <h2 className="font-display text-sm font-bold text-white">{theme.name}</h2>
                      <p className="text-xs text-slate-400 mt-1 leading-relaxed">{theme.tagline}</p>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => onApplyTheme(theme.id)}
                    className={`w-full inline-flex items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold transition-colors cursor-pointer ${
                      isSelected
                        ? 'bg-amber-500 text-slate-950'
                        : 'border border-white/12 bg-[#0B0F17] text-slate-200 hover:border-amber-500/60'
                    }`}
                  >
                    {isSelected && <Check className="h-3.5 w-3.5" />}
                    {isSelected ? 'Applied to Story' : 'Apply Theme'}
                  </button>
                </div>
              );
            })}
          </div>
        </section>

        {/* Documentary Templates */}
        <section className="space-y-4">
          <div className="border-b border-white/8 pb-3">
            <h2 className="font-display text-lg font-bold text-white flex items-center gap-2">
              <Clapperboard className="h-4 w-4 text-amber-400" />
              Documentary Story Templates
            </h2>
            <p className="text-xs text-slate-400 mt-1">
              Load a pre-choreographed 9:16 map explainer with hatched enclaves, route tracking, SFX cues, and word-timed captions.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {projects.map((proj) => {
              const isActive = proj.id === activeProject.id;
              return (
                <div
                  key={proj.id}
                  className={`rounded-xl border p-5 flex flex-col justify-between gap-4 ${
                    isActive
                      ? 'border-amber-500/70 bg-[#131924]'
                      : 'border-white/8 bg-[#131924] hover:border-white/20'
                  }`}
                >
                  <div className="space-y-2">
                    <div className="font-mono text-[11px] text-amber-400">
                      {(proj.durationMs / 1000).toFixed(0)}s · {proj.cameraKeyframes.length} keyframes · {proj.routes.length} routes
                    </div>
                    <h3 className="font-display text-base font-bold text-white">{proj.title}</h3>
                    <p className="text-xs text-slate-400">{proj.topic}</p>
                    <p className="text-[11px] text-slate-500 line-clamp-3 leading-relaxed pt-1">
                      “{proj.scriptText}”
                    </p>
                  </div>

                  <button
                    type="button"
                    onClick={() => onSelectProject(proj.id)}
                    className={`w-full rounded-lg px-3 py-2 text-xs font-semibold transition-colors cursor-pointer ${
                      isActive
                        ? 'bg-amber-500 text-slate-950'
                        : 'border border-white/12 bg-[#070A10] text-slate-100 hover:border-amber-500'
                    }`}
                  >
                    {isActive ? 'Open in Editor' : 'Load Storyboard'}
                  </button>
                </div>
              );
            })}
          </div>
        </section>
      </div>
    </div>
  );
}
