import { Download } from 'lucide-react';

export type WorkspaceTab = 'director' | 'map-picker' | 'subtitles' | 'themes';

interface StudioHeaderProps {
  activeTab: WorkspaceTab;
  onSelectTab: (tab: WorkspaceTab) => void;
  onOpenExport: () => void;
}

export function StudioHeader({ activeTab, onSelectTab, onOpenExport }: StudioHeaderProps) {
  const navItems: Array<{ id: WorkspaceTab; label: string }> = [
    { id: 'director', label: 'Editor' },
    { id: 'map-picker', label: 'Locations' },
    { id: 'subtitles', label: 'Captions' },
    { id: 'themes', label: 'Styles' },
  ];

  return (
    <header className="h-13 shrink-0 border-b border-white/8 bg-[#0B0F17] px-4 sm:px-6 flex items-center justify-between gap-4 sm:gap-8">
      {/* Zone 1: Single-line Brand Wordmark */}
      <a
        href="#top"
        onClick={(e) => {
          e.preventDefault();
          onSelectTab('director');
        }}
        className="font-display text-base font-bold tracking-tight text-white whitespace-nowrap shrink-0"
      >
        CartoReel Studio
      </a>

      {/* Zone 2: Concise single-line navigation links */}
      <nav className="flex items-center gap-5 sm:gap-7 overflow-x-auto" aria-label="Workspace views">
        {navItems.map((item) => {
          const active = activeTab === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onSelectTab(item.id)}
              className={`relative py-1.5 text-[13px] font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-2 focus-visible:outline-amber-500 ${
                active ? 'text-white' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              {item.label}
              {active && <span className="absolute inset-x-0 -bottom-[13px] h-0.5 bg-amber-500" />}
            </button>
          );
        })}
      </nav>

      {/* Zone 3: Single Primary Action */}
      <div className="flex items-center shrink-0">
        <button
          type="button"
          onClick={onOpenExport}
          className="inline-flex items-center gap-2 rounded-lg bg-amber-500 px-4 py-1.5 text-xs font-semibold text-slate-950 transition-colors hover:bg-amber-400 whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-400"
        >
          <Download className="h-3.5 w-3.5" />
          Export MP4
        </button>
      </div>
    </header>
  );
}
