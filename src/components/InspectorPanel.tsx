import { Trash2, Volume2 } from 'lucide-react';
import { playLiveSfx } from '../engine/sfxEngine';
import type {
  DashAnimationMode,
  EasingType,
  HazardIconKind,
  MapProject,
  MapSurfaceStyle,
  OverlayType,
  SfxType,
  ThemePresetId,
  TimelineSelection,
} from '../types/project';

interface InspectorPanelProps {
  project: MapProject;
  selection: TimelineSelection;
  onUpdateProject: (updater: (prev: MapProject) => MapProject) => void;
  onClearSelection: () => void;
}

export function InspectorPanel({
  project,
  selection,
  onUpdateProject,
  onClearSelection,
}: InspectorPanelProps) {
  const selectedCam = selection?.kind === 'camera' ? project.cameraKeyframes.find((k) => k.id === selection.id) : null;
  const selectedRoute = selection?.kind === 'route' ? project.routes.find((r) => r.id === selection.id) : null;
  const selectedRegion = selection?.kind === 'region' ? project.regionMasks.find((m) => m.id === selection.id) : null;
  const selectedOverlay = selection?.kind === 'overlay' ? project.overlays.find((o) => o.id === selection.id) : null;
  const selectedSfx = selection?.kind === 'sfx' ? project.sfxCues.find((s) => s.id === selection.id) : null;

  return (
    <aside className="w-full xl:w-80 shrink-0 border-l border-white/8 bg-[#111722] flex flex-col overflow-hidden">
      <div className="px-4 py-3 border-b border-white/8 flex items-center justify-between">
        <h2 className="font-display text-xs font-semibold text-slate-200">
          {selectedCam
            ? 'Camera Keyframe'
            : selectedRoute
              ? 'Route Path'
              : selectedRegion
                ? 'Region Highlight'
                : selectedOverlay
                  ? 'Map Asset'
                  : selectedSfx
                    ? 'Sound Effect Cue'
                    : 'Story & Audio Mix'}
        </h2>
        {selection && (
          <button
            type="button"
            onClick={onClearSelection}
            className="text-[11px] text-slate-400 hover:text-white cursor-pointer"
          >
            Done
          </button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4 text-xs">
        {selectedCam && (
          <>
            <div>
              <label className="block text-slate-400 mb-1">Label</label>
              <input
                type="text"
                value={selectedCam.label}
                onChange={(e) =>
                  onUpdateProject((p) => ({
                    ...p,
                    cameraKeyframes: p.cameraKeyframes.map((k) =>
                      k.id === selectedCam.id ? { ...k, label: e.target.value } : k,
                    ),
                  }))
                }
                className="w-full rounded-md border border-white/10 bg-[#0B0F17] px-2.5 py-1.5 text-slate-100"
              />
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-slate-400 mb-1">Time (ms)</label>
                <input
                  type="number"
                  step={100}
                  value={selectedCam.timeMs}
                  onChange={(e) =>
                    onUpdateProject((p) => ({
                      ...p,
                      cameraKeyframes: p.cameraKeyframes.map((k) =>
                        k.id === selectedCam.id ? { ...k, timeMs: Math.max(0, Number(e.target.value)) } : k,
                      ),
                    }))
                  }
                  className="w-full rounded-md border border-white/10 bg-[#0B0F17] px-2.5 py-1.5 font-mono text-slate-100"
                />
              </div>
              <div>
                <label className="block text-slate-400 mb-1">Zoom ({selectedCam.zoom.toFixed(1)}x)</label>
                <input
                  type="range"
                  min={1.2}
                  max={12}
                  step={0.1}
                  value={selectedCam.zoom}
                  onChange={(e) =>
                    onUpdateProject((p) => ({
                      ...p,
                      cameraKeyframes: p.cameraKeyframes.map((k) =>
                        k.id === selectedCam.id ? { ...k, zoom: Number(e.target.value) } : k,
                      ),
                    }))
                  }
                  className="w-full accent-amber-500 mt-2"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-slate-400 mb-1">Latitude</label>
                <input
                  type="number"
                  step={0.1}
                  value={selectedCam.lat}
                  onChange={(e) =>
                    onUpdateProject((p) => ({
                      ...p,
                      cameraKeyframes: p.cameraKeyframes.map((k) =>
                        k.id === selectedCam.id ? { ...k, lat: Number(e.target.value) } : k,
                      ),
                    }))
                  }
                  className="w-full rounded-md border border-white/10 bg-[#0B0F17] px-2.5 py-1.5 font-mono text-slate-100"
                />
              </div>
              <div>
                <label className="block text-slate-400 mb-1">Longitude</label>
                <input
                  type="number"
                  step={0.1}
                  value={selectedCam.lng}
                  onChange={(e) =>
                    onUpdateProject((p) => ({
                      ...p,
                      cameraKeyframes: p.cameraKeyframes.map((k) =>
                        k.id === selectedCam.id ? { ...k, lng: Number(e.target.value) } : k,
                      ),
                    }))
                  }
                  className="w-full rounded-md border border-white/10 bg-[#0B0F17] px-2.5 py-1.5 font-mono text-slate-100"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-slate-400 mb-1">Projection</label>
                <select
                  value={selectedCam.projectionMode}
                  onChange={(e) =>
                    onUpdateProject((p) => ({
                      ...p,
                      cameraKeyframes: p.cameraKeyframes.map((k) =>
                        k.id === selectedCam.id
                          ? { ...k, projectionMode: e.target.value as 'mercator' | 'globe' }
                          : k,
                      ),
                    }))
                  }
                  className="w-full rounded-md border border-white/10 bg-[#0B0F17] px-2 py-1.5 text-slate-100"
                >
                  <option value="mercator">Flat Mercator</option>
                  <option value="globe">3D Globe</option>
                </select>
              </div>
              <div>
                <label className="block text-slate-400 mb-1">Easing</label>
                <select
                  value={selectedCam.easing}
                  onChange={(e) =>
                    onUpdateProject((p) => ({
                      ...p,
                      cameraKeyframes: p.cameraKeyframes.map((k) =>
                        k.id === selectedCam.id ? { ...k, easing: e.target.value as EasingType } : k,
                      ),
                    }))
                  }
                  className="w-full rounded-md border border-white/10 bg-[#0B0F17] px-2 py-1.5 text-slate-100"
                >
                  <option value="easeInOutCubic">Ease In/Out</option>
                  <option value="expoOut">Snappy Expo</option>
                  <option value="linear">Linear</option>
                  <option value="custom">Custom Speed Curve</option>
                </select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-slate-400 mb-1">Tilt ({selectedCam.pitch}°)</label>
                <input
                  type="range"
                  min={0}
                  max={50}
                  value={selectedCam.pitch}
                  onChange={(e) =>
                    onUpdateProject((p) => ({
                      ...p,
                      cameraKeyframes: p.cameraKeyframes.map((k) =>
                        k.id === selectedCam.id ? { ...k, pitch: Number(e.target.value) } : k,
                      ),
                    }))
                  }
                  className="w-full accent-amber-500"
                />
              </div>
              <div>
                <label className="block text-slate-400 mb-1">Rotate ({selectedCam.bearing}°)</label>
                <input
                  type="range"
                  min={-35}
                  max={35}
                  value={selectedCam.bearing}
                  onChange={(e) =>
                    onUpdateProject((p) => ({
                      ...p,
                      cameraKeyframes: p.cameraKeyframes.map((k) =>
                        k.id === selectedCam.id ? { ...k, bearing: Number(e.target.value) } : k,
                      ),
                    }))
                  }
                  className="w-full accent-amber-500"
                />
              </div>
            </div>

            <div>
              <label className="block text-slate-400 mb-1">Map Surface Style</label>
              <select
                value={selectedCam.mapStyle || 'satellite'}
                onChange={(e) =>
                  onUpdateProject((p) => ({
                    ...p,
                    cameraKeyframes: p.cameraKeyframes.map((k) =>
                      k.id === selectedCam.id
                        ? { ...k, mapStyle: e.target.value as MapSurfaceStyle }
                        : k,
                    ),
                  }))
                }
                className="w-full rounded-md border border-white/10 bg-[#0B0F17] px-2 py-1.5 text-slate-100"
              >
                <option value="satellite">Real Satellite Hybrid</option>
                <option value="topo-paper">Topographic Paper Map</option>
              </select>
            </div>

            {project.routes.length > 0 && (
              <div>
                <label className="block text-slate-400 mb-1">Auto-Follow Route</label>
                <select
                  value={selectedCam.followRouteId || ''}
                  onChange={(e) =>
                    onUpdateProject((p) => ({
                      ...p,
                      cameraKeyframes: p.cameraKeyframes.map((k) =>
                        k.id === selectedCam.id ? { ...k, followRouteId: e.target.value || undefined } : k,
                      ),
                    }))
                  }
                  className="w-full rounded-md border border-white/10 bg-[#0B0F17] px-2 py-1.5 text-slate-100"
                >
                  <option value="">Manual Lat/Lng</option>
                  {project.routes.map((r) => (
                    <option key={r.id} value={r.id}>
                      Follow: {r.name}
                    </option>
                  ))}
                </select>
              </div>
            )}

            <label className="flex items-center justify-between rounded-md border border-white/8 bg-[#0B0F17] px-3 py-2 cursor-pointer">
              <div>
                <div className="text-slate-200 font-medium">Handheld Documentary</div>
                <div className="text-[10px] text-slate-500">Micro-vibrations on high-action shot</div>
              </div>
              <input
                type="checkbox"
                checked={Boolean(selectedCam.handheldJitter)}
                onChange={(e) =>
                  onUpdateProject((p) => ({
                    ...p,
                    cameraKeyframes: p.cameraKeyframes.map((k) =>
                      k.id === selectedCam.id ? { ...k, handheldJitter: e.target.checked } : k,
                    ),
                  }))
                }
                className="accent-amber-500"
              />
            </label>

            {project.cameraKeyframes.length > 1 && (
              <button
                type="button"
                onClick={() => {
                  onUpdateProject((p) => ({
                    ...p,
                    cameraKeyframes: p.cameraKeyframes.filter((k) => k.id !== selectedCam.id),
                  }));
                  onClearSelection();
                }}
                className="w-full inline-flex items-center justify-center gap-1.5 rounded-md border border-red-500/30 bg-red-500/10 py-1.5 text-red-300 hover:bg-red-500/20 cursor-pointer"
              >
                <Trash2 className="h-3.5 w-3.5" />
                Delete Keyframe
              </button>
            )}
          </>
        )}

        {selectedRoute && (
          <>
            <div>
              <label className="block text-slate-400 mb-1">Route Name</label>
              <input
                type="text"
                value={selectedRoute.name}
                onChange={(e) =>
                  onUpdateProject((p) => ({
                    ...p,
                    routes: p.routes.map((r) => (r.id === selectedRoute.id ? { ...r, name: e.target.value } : r)),
                  }))
                }
                className="w-full rounded-md border border-white/10 bg-[#0B0F17] px-2.5 py-1.5 text-slate-100"
              />
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-slate-400 mb-1">Line Style</label>
                <select
                  value={selectedRoute.style}
                  onChange={(e) =>
                    onUpdateProject((p) => ({
                      ...p,
                      routes: p.routes.map((r) =>
                        r.id === selectedRoute.id ? { ...r, style: e.target.value as any } : r,
                      ),
                    }))
                  }
                  className="w-full rounded-md border border-white/10 bg-[#0B0F17] px-2 py-1.5 text-slate-100"
                >
                  <option value="solid">Solid Line</option>
                  <option value="dashed">Dashed Path</option>
                  <option value="dotted">Dotted Future</option>
                  <option value="arc">Flight Arc</option>
                </select>
              </div>
              <div>
                <label className="block text-slate-400 mb-1">Traveler Avatar</label>
                <select
                  value={selectedRoute.travelerType || 'none'}
                  onChange={(e) =>
                    onUpdateProject((p) => ({
                      ...p,
                      routes: p.routes.map((r) =>
                        r.id === selectedRoute.id ? { ...r, travelerType: e.target.value as any } : r,
                      ),
                    }))
                  }
                  className="w-full rounded-md border border-white/10 bg-[#0B0F17] px-2 py-1.5 text-slate-100"
                >
                  <option value="none">None</option>
                  <option value="walker">Walker</option>
                  <option value="car">Vehicle</option>
                  <option value="ship">Ship</option>
                  <option value="plane">Plane</option>
                </select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-slate-400 mb-1">Draw Animation</label>
                <select
                  value={selectedRoute.dashAnimation || 'draw'}
                  onChange={(e) =>
                    onUpdateProject((p) => ({
                      ...p,
                      routes: p.routes.map((r) =>
                        r.id === selectedRoute.id
                          ? { ...r, dashAnimation: e.target.value as DashAnimationMode }
                          : r,
                      ),
                    }))
                  }
                  className="w-full rounded-md border border-white/10 bg-[#0B0F17] px-2 py-1.5 text-slate-100"
                >
                  <option value="draw">Self-Draw Path</option>
                  <option value="grow-dashes">Variable Dash Length</option>
                  <option value="marching">Marching Flow</option>
                  <option value="none">Static Instant</option>
                </select>
              </div>
              <div>
                <label className="block text-slate-400 mb-1">Draw Easing</label>
                <select
                  value={selectedRoute.easing || 'linear'}
                  onChange={(e) =>
                    onUpdateProject((p) => ({
                      ...p,
                      routes: p.routes.map((r) =>
                        r.id === selectedRoute.id ? { ...r, easing: e.target.value as EasingType } : r,
                      ),
                    }))
                  }
                  className="w-full rounded-md border border-white/10 bg-[#0B0F17] px-2 py-1.5 text-slate-100"
                >
                  <option value="linear">Linear</option>
                  <option value="easeInOutCubic">Ease In/Out</option>
                  <option value="expoOut">Snappy Expo</option>
                </select>
              </div>
            </div>

            {(selectedRoute.style === 'dashed' ||
              selectedRoute.style === 'dotted' ||
              selectedRoute.dashAnimation === 'grow-dashes' ||
              selectedRoute.dashAnimation === 'marching' ||
              (selectedRoute.dashLength ?? 0) > 0) && (
              <div className="space-y-2 rounded-lg border border-white/8 bg-[#0B0F17] p-2.5">
                <div className="text-[11px] font-semibold text-slate-300">Dash Geometry</div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-slate-400 mb-1">
                      Dash Length ({selectedRoute.dashLength ?? (selectedRoute.style === 'dotted' ? 4 : 18)}px)
                    </label>
                    <input
                      type="range"
                      min={2}
                      max={80}
                      step={1}
                      value={selectedRoute.dashLength ?? (selectedRoute.style === 'dotted' ? 4 : 18)}
                      onChange={(e) =>
                        onUpdateProject((p) => ({
                          ...p,
                          routes: p.routes.map((r) =>
                            r.id === selectedRoute.id ? { ...r, dashLength: Number(e.target.value) } : r,
                          ),
                        }))
                      }
                      className="w-full accent-amber-500"
                    />
                  </div>
                  <div>
                    <label className="block text-slate-400 mb-1">
                      Dash Gap ({selectedRoute.dashGap ?? (selectedRoute.style === 'dotted' ? 10 : 12)}px)
                    </label>
                    <input
                      type="range"
                      min={2}
                      max={60}
                      step={1}
                      value={selectedRoute.dashGap ?? (selectedRoute.style === 'dotted' ? 10 : 12)}
                      onChange={(e) =>
                        onUpdateProject((p) => ({
                          ...p,
                          routes: p.routes.map((r) =>
                            r.id === selectedRoute.id ? { ...r, dashGap: Number(e.target.value) } : r,
                          ),
                        }))
                      }
                      className="w-full accent-amber-500"
                    />
                  </div>
                </div>

                {selectedRoute.dashAnimation === 'grow-dashes' && (
                  <div>
                    <label className="block text-slate-400 mb-1">
                      Start Dash Length ({selectedRoute.dashLengthStart ?? 4}px →{' '}
                      {selectedRoute.dashLength ?? 18}px)
                    </label>
                    <input
                      type="range"
                      min={2}
                      max={80}
                      step={1}
                      value={selectedRoute.dashLengthStart ?? 4}
                      onChange={(e) =>
                        onUpdateProject((p) => ({
                          ...p,
                          routes: p.routes.map((r) =>
                            r.id === selectedRoute.id ? { ...r, dashLengthStart: Number(e.target.value) } : r,
                          ),
                        }))
                      }
                      className="w-full accent-amber-500"
                    />
                  </div>
                )}

                {selectedRoute.dashAnimation === 'marching' && (
                  <div>
                    <label className="block text-slate-400 mb-1">
                      Flow Speed ({selectedRoute.dashSpeed ?? 48} px/s)
                    </label>
                    <input
                      type="range"
                      min={-140}
                      max={140}
                      step={4}
                      value={selectedRoute.dashSpeed ?? 48}
                      onChange={(e) =>
                        onUpdateProject((p) => ({
                          ...p,
                          routes: p.routes.map((r) =>
                            r.id === selectedRoute.id ? { ...r, dashSpeed: Number(e.target.value) } : r,
                          ),
                        }))
                      }
                      className="w-full accent-amber-500"
                    />
                  </div>
                )}
              </div>
            )}

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-slate-400 mb-1">Start (ms)</label>
                <input
                  type="number"
                  step={100}
                  value={selectedRoute.startMs}
                  onChange={(e) =>
                    onUpdateProject((p) => ({
                      ...p,
                      routes: p.routes.map((r) =>
                        r.id === selectedRoute.id ? { ...r, startMs: Math.max(0, Number(e.target.value)) } : r,
                      ),
                    }))
                  }
                  className="w-full rounded-md border border-white/10 bg-[#0B0F17] px-2.5 py-1.5 font-mono text-slate-100"
                />
              </div>
              <div>
                <label className="block text-slate-400 mb-1">End (ms)</label>
                <input
                  type="number"
                  step={100}
                  value={selectedRoute.endMs}
                  onChange={(e) =>
                    onUpdateProject((p) => ({
                      ...p,
                      routes: p.routes.map((r) =>
                        r.id === selectedRoute.id
                          ? { ...r, endMs: Math.max(r.startMs + 200, Number(e.target.value)) }
                          : r,
                      ),
                    }))
                  }
                  className="w-full rounded-md border border-white/10 bg-[#0B0F17] px-2.5 py-1.5 font-mono text-slate-100"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-slate-400 mb-1">Distance Badge</label>
                <input
                  type="text"
                  value={selectedRoute.distanceLabel || ''}
                  placeholder="e.g. 706 km"
                  onChange={(e) =>
                    onUpdateProject((p) => ({
                      ...p,
                      routes: p.routes.map((r) =>
                        r.id === selectedRoute.id ? { ...r, distanceLabel: e.target.value || undefined } : r,
                      ),
                    }))
                  }
                  className="w-full rounded-md border border-white/10 bg-[#0B0F17] px-2.5 py-1.5 text-slate-100"
                />
              </div>
              <div>
                <label className="block text-slate-400 mb-1">Color</label>
                <input
                  type="color"
                  value={selectedRoute.color}
                  onChange={(e) =>
                    onUpdateProject((p) => ({
                      ...p,
                      routes: p.routes.map((r) => (r.id === selectedRoute.id ? { ...r, color: e.target.value } : r)),
                    }))
                  }
                  className="h-8 w-full rounded border border-white/10 bg-[#0B0F17]"
                />
              </div>
            </div>

            <div>
              <label className="block text-slate-400 mb-1">Stroke Width ({selectedRoute.width}px)</label>
              <input
                type="range"
                min={2}
                max={14}
                step={0.5}
                value={selectedRoute.width}
                onChange={(e) =>
                  onUpdateProject((p) => ({
                    ...p,
                    routes: p.routes.map((r) =>
                      r.id === selectedRoute.id ? { ...r, width: Number(e.target.value) } : r,
                    ),
                  }))
                }
                className="w-full accent-amber-500"
              />
            </div>

            <label className="flex items-center justify-between rounded-md border border-white/8 bg-[#0B0F17] px-3 py-2 cursor-pointer">
              <span>Show Ghost Guide Path</span>
              <input
                type="checkbox"
                checked={Boolean(selectedRoute.showTrailGhost)}
                onChange={(e) =>
                  onUpdateProject((p) => ({
                    ...p,
                    routes: p.routes.map((r) =>
                      r.id === selectedRoute.id ? { ...r, showTrailGhost: e.target.checked } : r,
                    ),
                  }))
                }
                className="accent-amber-500"
              />
            </label>

            <label className="flex items-center justify-between rounded-md border border-white/8 bg-[#0B0F17] px-3 py-2 cursor-pointer">
              <span>Pulsing Red End Beacon</span>
              <input
                type="checkbox"
                checked={Boolean(selectedRoute.endBeaconPulse)}
                onChange={(e) =>
                  onUpdateProject((p) => ({
                    ...p,
                    routes: p.routes.map((r) =>
                      r.id === selectedRoute.id ? { ...r, endBeaconPulse: e.target.checked } : r,
                    ),
                  }))
                }
                className="accent-amber-500"
              />
            </label>

            <button
              type="button"
              onClick={() => {
                onUpdateProject((p) => ({
                  ...p,
                  routes: p.routes.filter((r) => r.id !== selectedRoute.id),
                }));
                onClearSelection();
              }}
              className="w-full inline-flex items-center justify-center gap-1.5 rounded-md border border-red-500/30 bg-red-500/10 py-1.5 text-red-300 hover:bg-red-500/20 cursor-pointer"
            >
              <Trash2 className="h-3.5 w-3.5" />
              Delete Route
            </button>
          </>
        )}

        {selectedRegion && (
          <>
            <div>
              <label className="block text-slate-400 mb-1">Country / Region Name</label>
              <input
                type="text"
                value={selectedRegion.regionName}
                onChange={(e) =>
                  onUpdateProject((p) => ({
                    ...p,
                    regionMasks: p.regionMasks.map((m) =>
                      m.id === selectedRegion.id ? { ...m, regionName: e.target.value } : m,
                    ),
                  }))
                }
                className="w-full rounded-md border border-white/10 bg-[#0B0F17] px-2.5 py-1.5 text-slate-100"
              />
            </div>

            <div>
              <label className="block text-slate-400 mb-1">Display Label</label>
              <input
                type="text"
                value={selectedRegion.label || ''}
                onChange={(e) =>
                  onUpdateProject((p) => ({
                    ...p,
                    regionMasks: p.regionMasks.map((m) =>
                      m.id === selectedRegion.id ? { ...m, label: e.target.value } : m,
                    ),
                  }))
                }
                placeholder={selectedRegion.regionName.toUpperCase()}
                className="w-full rounded-md border border-white/10 bg-[#0B0F17] px-2.5 py-1.5 text-slate-100"
              />
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-slate-400 mb-1">Fill Mode</label>
                <select
                  value={selectedRegion.fillMode}
                  onChange={(e) =>
                    onUpdateProject((p) => ({
                      ...p,
                      regionMasks: p.regionMasks.map((m) =>
                        m.id === selectedRegion.id ? { ...m, fillMode: e.target.value as any } : m,
                      ),
                    }))
                  }
                  className="w-full rounded-md border border-white/10 bg-[#0B0F17] px-2 py-1.5 text-slate-100"
                >
                  <option value="hatched">Diagonal Hatch</option>
                  <option value="solid-tint">Solid Tint</option>
                  <option value="hazard-pulse">Hazard Pulse</option>
                </select>
              </div>
              <div>
                <label className="block text-slate-400 mb-1">Fill Color</label>
                <input
                  type="color"
                  value={selectedRegion.color}
                  onChange={(e) =>
                    onUpdateProject((p) => ({
                      ...p,
                      regionMasks: p.regionMasks.map((m) =>
                        m.id === selectedRegion.id ? { ...m, color: e.target.value } : m,
                      ),
                    }))
                  }
                  className="h-8 w-full rounded border border-white/10 bg-[#0B0F17]"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <div className="flex justify-between text-slate-400 mb-1">
                  <span>Label Tilt</span>
                  <span className="font-mono tabular-nums">{selectedRegion.labelTiltDeg ?? 0}°</span>
                </div>
                <input
                  type="range"
                  min={-25}
                  max={25}
                  step={1}
                  value={selectedRegion.labelTiltDeg ?? 0}
                  onChange={(e) =>
                    onUpdateProject((p) => ({
                      ...p,
                      regionMasks: p.regionMasks.map((m) =>
                        m.id === selectedRegion.id ? { ...m, labelTiltDeg: Number(e.target.value) } : m,
                      ),
                    }))
                  }
                  className="w-full accent-amber-500"
                />
              </div>
              <div>
                <div className="flex justify-between text-slate-400 mb-1">
                  <span>Border Trace</span>
                  <span className="font-mono tabular-nums">{selectedRegion.drawBorderDurationMs ?? 650}ms</span>
                </div>
                <input
                  type="range"
                  min={200}
                  max={2000}
                  step={50}
                  value={selectedRegion.drawBorderDurationMs ?? 650}
                  onChange={(e) =>
                    onUpdateProject((p) => ({
                      ...p,
                      regionMasks: p.regionMasks.map((m) =>
                        m.id === selectedRegion.id ? { ...m, drawBorderDurationMs: Number(e.target.value) } : m,
                      ),
                    }))
                  }
                  className="w-full accent-amber-500"
                />
              </div>
            </div>

            <label className="flex items-center justify-between rounded-md border border-white/8 bg-[#0B0F17] px-3 py-2 cursor-pointer">
              <div>
                <div className="text-slate-200 font-medium">Soft Outer Focus Vignette</div>
                <div className="text-[10px] text-slate-500">Gentle corner lens fade without darkening neighbors</div>
              </div>
              <input
                type="checkbox"
                checked={selectedRegion.darkIsolationMask}
                onChange={(e) =>
                  onUpdateProject((p) => ({
                    ...p,
                    regionMasks: p.regionMasks.map((m) =>
                      m.id === selectedRegion.id ? { ...m, darkIsolationMask: e.target.checked } : m,
                    ),
                  }))
                }
                className="accent-amber-500"
              />
            </label>

            <button
              type="button"
              onClick={() => {
                onUpdateProject((p) => ({
                  ...p,
                  regionMasks: p.regionMasks.filter((m) => m.id !== selectedRegion.id),
                }));
                onClearSelection();
              }}
              className="w-full inline-flex items-center justify-center gap-1.5 rounded-md border border-red-500/30 bg-red-500/10 py-1.5 text-red-300 hover:bg-red-500/20 cursor-pointer"
            >
              <Trash2 className="h-3.5 w-3.5" />
              Delete Region
            </button>
          </>
        )}

        {selectedOverlay && (
          <>
            <div>
              <label className="block text-slate-400 mb-1">Overlay Type</label>
              <select
                value={selectedOverlay.type}
                onChange={(e) =>
                  onUpdateProject((p) => ({
                    ...p,
                    overlays: p.overlays.map((o) =>
                      o.id === selectedOverlay.id ? { ...o, type: e.target.value as OverlayType } : o,
                    ),
                  }))
                }
                className="w-full rounded-md border border-white/10 bg-[#0B0F17] px-2 py-1.5 text-slate-100"
              >
                <option value="pin-label">Place Pin & Vertical Stem</option>
                <option value="distance-call">Distance Bracket Callout</option>
                <option value="size-comparison">Territory Size Comparison</option>
                <option value="title-badge">Title Highlight Badge</option>
                <option value="stat-counter">Animated Stat Counter</option>
                <option value="question-pin">Bouncing Question Pin</option>
                <option value="flag-card">Country Flag Card</option>
                <option value="curved-arrow">Curved Pointer Arrow</option>
                <option value="hazard-icon">Hazard Icon Badge (Skull / Wildlife)</option>
                <option value="hazard-radar">Hazard Radar Cluster</option>
                <option value="flow-network">Converging Flow Network</option>
                <option value="data-diamonds">Glowing Data Diamonds</option>
                <option value="stamp">Rubber Stamp (FAILED)</option>
                <option value="speech-bubble">Speech Bubble</option>
                <option value="weather-rain">3D Rain Cloud Effect</option>
                <option value="cross-hazard">Red X Barrier</option>
              </select>
            </div>

            {selectedOverlay.type === 'hazard-icon' && (
              <div>
                <label className="block text-slate-400 mb-1">Hazard Vector Icon</label>
                <select
                  value={selectedOverlay.hazardIcon || 'skull'}
                  onChange={(e) =>
                    onUpdateProject((p) => ({
                      ...p,
                      overlays: p.overlays.map((o) =>
                        o.id === selectedOverlay.id ? { ...o, hazardIcon: e.target.value as HazardIconKind } : o,
                      ),
                    }))
                  }
                  className="w-full rounded-md border border-white/10 bg-[#0B0F17] px-2 py-1.5 text-slate-100"
                >
                  <option value="skull">Skull & Crossbones</option>
                  <option value="jaguar">Predator (Jaguar Pin)</option>
                  <option value="snake">Venomous Snake Pin</option>
                  <option value="mosquito">Tropical Disease (Mosquito Pin)</option>
                  <option value="no-police">No Government Control (No Police)</option>
                </select>
              </div>
            )}

            <div className="grid grid-cols-[1fr_auto] gap-2 items-end">
              <div>
                <label className="block text-slate-400 mb-1">Primary Label</label>
                <input
                  type="text"
                  value={selectedOverlay.text}
                  onChange={(e) =>
                    onUpdateProject((p) => ({
                      ...p,
                      overlays: p.overlays.map((o) =>
                        o.id === selectedOverlay.id ? { ...o, text: e.target.value } : o,
                      ),
                    }))
                  }
                  className="w-full rounded-md border border-white/10 bg-[#0B0F17] px-2.5 py-1.5 text-slate-100"
                />
              </div>
              <div>
                <label className="block text-slate-400 mb-1">Accent</label>
                <input
                  type="color"
                  value={selectedOverlay.accentColor}
                  onChange={(e) =>
                    onUpdateProject((p) => ({
                      ...p,
                      overlays: p.overlays.map((o) =>
                        o.id === selectedOverlay.id ? { ...o, accentColor: e.target.value } : o,
                      ),
                    }))
                  }
                  className="h-8 w-11 rounded border border-white/10 bg-[#0B0F17]"
                />
              </div>
            </div>

            <div>
              <label className="block text-slate-400 mb-1">Subtext (Optional)</label>
              <input
                type="text"
                value={selectedOverlay.subtext || ''}
                onChange={(e) =>
                  onUpdateProject((p) => ({
                    ...p,
                    overlays: p.overlays.map((o) =>
                      o.id === selectedOverlay.id ? { ...o, subtext: e.target.value } : o,
                    ),
                  }))
                }
                placeholder="Secondary readout or city caption..."
                className="w-full rounded-md border border-white/10 bg-[#0B0F17] px-2.5 py-1.5 text-slate-100"
              />
            </div>

            {selectedOverlay.type === 'size-comparison' && (
              <div>
                <label className="block text-slate-400 mb-1">Comparison Silhouette Region</label>
                <input
                  type="text"
                  value={selectedOverlay.compareRegionName || ''}
                  onChange={(e) =>
                    onUpdateProject((p) => ({
                      ...p,
                      overlays: p.overlays.map((o) =>
                        o.id === selectedOverlay.id ? { ...o, compareRegionName: e.target.value } : o,
                      ),
                    }))
                  }
                  placeholder="e.g. New York City, Spain, France"
                  className="w-full rounded-md border border-white/10 bg-[#0B0F17] px-2.5 py-1.5 text-slate-100"
                />
              </div>
            )}

            {selectedOverlay.type === 'flag-card' && (
              <div>
                <label className="block text-slate-400 mb-1">Country ISO Code (2-letter)</label>
                <input
                  type="text"
                  maxLength={2}
                  value={selectedOverlay.countryCode || ''}
                  onChange={(e) =>
                    onUpdateProject((p) => ({
                      ...p,
                      overlays: p.overlays.map((o) =>
                        o.id === selectedOverlay.id ? { ...o, countryCode: e.target.value.toUpperCase() } : o,
                      ),
                    }))
                  }
                  placeholder="ES, FR, GB, PA, CO, US..."
                  className="w-full rounded-md border border-white/10 bg-[#0B0F17] px-2.5 py-1.5 font-mono uppercase text-slate-100"
                />
              </div>
            )}

            {selectedOverlay.type === 'stat-counter' && (
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-slate-400 mb-1">Count From</label>
                  <input
                    type="number"
                    value={selectedOverlay.countFrom ?? 0}
                    onChange={(e) =>
                      onUpdateProject((p) => ({
                        ...p,
                        overlays: p.overlays.map((o) =>
                          o.id === selectedOverlay.id ? { ...o, countFrom: Number(e.target.value) } : o,
                        ),
                      }))
                    }
                    className="w-full rounded-md border border-white/10 bg-[#0B0F17] px-2.5 py-1.5 font-mono tabular-nums text-slate-100"
                  />
                </div>
                <div>
                  <label className="block text-slate-400 mb-1">Count To</label>
                  <input
                    type="number"
                    value={selectedOverlay.countTo ?? 5}
                    onChange={(e) =>
                      onUpdateProject((p) => ({
                        ...p,
                        overlays: p.overlays.map((o) =>
                          o.id === selectedOverlay.id ? { ...o, countTo: Number(e.target.value) } : o,
                        ),
                      }))
                    }
                    className="w-full rounded-md border border-white/10 bg-[#0B0F17] px-2.5 py-1.5 font-mono tabular-nums text-slate-100"
                  />
                </div>
              </div>
            )}

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-slate-400 mb-1">Anchor Lat</label>
                <input
                  type="number"
                  step={0.05}
                  value={selectedOverlay.lat}
                  onChange={(e) =>
                    onUpdateProject((p) => ({
                      ...p,
                      overlays: p.overlays.map((o) =>
                        o.id === selectedOverlay.id ? { ...o, lat: Number(e.target.value) } : o,
                      ),
                    }))
                  }
                  className="w-full rounded-md border border-white/10 bg-[#0B0F17] px-2.5 py-1.5 font-mono tabular-nums text-slate-100"
                />
              </div>
              <div>
                <label className="block text-slate-400 mb-1">Anchor Lng</label>
                <input
                  type="number"
                  step={0.05}
                  value={selectedOverlay.lng}
                  onChange={(e) =>
                    onUpdateProject((p) => ({
                      ...p,
                      overlays: p.overlays.map((o) =>
                        o.id === selectedOverlay.id ? { ...o, lng: Number(e.target.value) } : o,
                      ),
                    }))
                  }
                  className="w-full rounded-md border border-white/10 bg-[#0B0F17] px-2.5 py-1.5 font-mono tabular-nums text-slate-100"
                />
              </div>
            </div>

            {(selectedOverlay.type === 'distance-call' || selectedOverlay.type === 'curved-arrow') && (
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-slate-400 mb-1">Target Lat</label>
                  <input
                    type="number"
                    step={0.05}
                    value={selectedOverlay.targetLat ?? selectedOverlay.lat}
                    onChange={(e) =>
                      onUpdateProject((p) => ({
                        ...p,
                        overlays: p.overlays.map((o) =>
                          o.id === selectedOverlay.id ? { ...o, targetLat: Number(e.target.value) } : o,
                        ),
                      }))
                    }
                    className="w-full rounded-md border border-white/10 bg-[#0B0F17] px-2.5 py-1.5 font-mono tabular-nums text-slate-100"
                  />
                </div>
                <div>
                  <label className="block text-slate-400 mb-1">Target Lng</label>
                  <input
                    type="number"
                    step={0.05}
                    value={selectedOverlay.targetLng ?? selectedOverlay.lng}
                    onChange={(e) =>
                      onUpdateProject((p) => ({
                        ...p,
                        overlays: p.overlays.map((o) =>
                          o.id === selectedOverlay.id ? { ...o, targetLng: Number(e.target.value) } : o,
                        ),
                      }))
                    }
                    className="w-full rounded-md border border-white/10 bg-[#0B0F17] px-2.5 py-1.5 font-mono tabular-nums text-slate-100"
                  />
                </div>
              </div>
            )}

            {(selectedOverlay.type === 'title-badge' || selectedOverlay.type === 'stamp') && (
              <div>
                <div className="flex justify-between text-slate-400 mb-1">
                  <span>Rotation Angle</span>
                  <span className="font-mono tabular-nums">{selectedOverlay.rotationDeg ?? 0}°</span>
                </div>
                <input
                  type="range"
                  min={-25}
                  max={25}
                  step={1}
                  value={selectedOverlay.rotationDeg ?? 0}
                  onChange={(e) =>
                    onUpdateProject((p) => ({
                      ...p,
                      overlays: p.overlays.map((o) =>
                        o.id === selectedOverlay.id ? { ...o, rotationDeg: Number(e.target.value) } : o,
                      ),
                    }))
                  }
                  className="w-full accent-amber-500"
                />
              </div>
            )}

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-slate-400 mb-1">Start (ms)</label>
                <input
                  type="number"
                  step={100}
                  value={selectedOverlay.startMs}
                  onChange={(e) =>
                    onUpdateProject((p) => ({
                      ...p,
                      overlays: p.overlays.map((o) =>
                        o.id === selectedOverlay.id ? { ...o, startMs: Number(e.target.value) } : o,
                      ),
                    }))
                  }
                  className="w-full rounded-md border border-white/10 bg-[#0B0F17] px-2.5 py-1.5 font-mono tabular-nums text-slate-100"
                />
              </div>
              <div>
                <label className="block text-slate-400 mb-1">End (ms)</label>
                <input
                  type="number"
                  step={100}
                  value={selectedOverlay.endMs}
                  onChange={(e) =>
                    onUpdateProject((p) => ({
                      ...p,
                      overlays: p.overlays.map((o) =>
                        o.id === selectedOverlay.id ? { ...o, endMs: Number(e.target.value) } : o,
                      ),
                    }))
                  }
                  className="w-full rounded-md border border-white/10 bg-[#0B0F17] px-2.5 py-1.5 font-mono tabular-nums text-slate-100"
                />
              </div>
            </div>

            <button
              type="button"
              onClick={() => {
                onUpdateProject((p) => ({
                  ...p,
                  overlays: p.overlays.filter((o) => o.id !== selectedOverlay.id),
                }));
                onClearSelection();
              }}
              className="w-full inline-flex items-center justify-center gap-1.5 rounded-md border border-red-500/30 bg-red-500/10 py-1.5 text-red-300 hover:bg-red-500/20 cursor-pointer"
            >
              <Trash2 className="h-3.5 w-3.5" />
              Delete Overlay
            </button>
          </>
        )}

        {selectedSfx && (
          <>
            <div>
              <label className="block text-slate-400 mb-1">Sound Effect Type</label>
              <select
                value={selectedSfx.type}
                onChange={(e) =>
                  onUpdateProject((p) => ({
                    ...p,
                    sfxCues: p.sfxCues.map((s) =>
                      s.id === selectedSfx.id ? { ...s, type: e.target.value as SfxType } : s,
                    ),
                  }))
                }
                className="w-full rounded-md border border-white/10 bg-[#0B0F17] px-2.5 py-1.5 text-slate-100"
              >
                <option value="whoosh">Camera Whoosh</option>
                <option value="pop">Marker Pop</option>
                <option value="tick">Counter Ticks</option>
                <option value="stamp">Stamp Slam Thud</option>
                <option value="drone">Sub-Bass Drone</option>
              </select>
            </div>
            <div>
              <label className="block text-slate-400 mb-1">Timestamp (ms)</label>
              <input
                type="number"
                step={100}
                value={selectedSfx.timeMs}
                onChange={(e) =>
                  onUpdateProject((p) => ({
                    ...p,
                    sfxCues: p.sfxCues.map((s) =>
                      s.id === selectedSfx.id ? { ...s, timeMs: Math.max(0, Number(e.target.value)) } : s,
                    ),
                  }))
                }
                className="w-full rounded-md border border-white/10 bg-[#0B0F17] px-2.5 py-1.5 font-mono text-slate-100"
              />
            </div>
            <button
              type="button"
              onClick={() => playLiveSfx(selectedSfx.type, selectedSfx.volume)}
              className="w-full inline-flex items-center justify-center gap-1.5 rounded-md bg-emerald-500/20 border border-emerald-500/40 py-2 text-emerald-300 hover:bg-emerald-500/30 cursor-pointer"
            >
              <Volume2 className="h-3.5 w-3.5" />
              Audition Sound Effect
            </button>
            <button
              type="button"
              onClick={() => {
                onUpdateProject((p) => ({
                  ...p,
                  sfxCues: p.sfxCues.filter((s) => s.id !== selectedSfx.id),
                }));
                onClearSelection();
              }}
              className="w-full inline-flex items-center justify-center gap-1.5 rounded-md border border-red-500/30 bg-red-500/10 py-1.5 text-red-300 hover:bg-red-500/20 cursor-pointer"
            >
              <Trash2 className="h-3.5 w-3.5" />
              Delete SFX
            </button>
          </>
        )}

        {!selection && (
          <>
            <div>
              <label className="block text-slate-400 mb-1">Project Title</label>
              <input
                type="text"
                value={project.title}
                onChange={(e) => onUpdateProject((p) => ({ ...p, title: e.target.value }))}
                className="w-full rounded-md border border-white/10 bg-[#070A10] px-2.5 py-1.5 text-slate-100"
              />
            </div>

            <div>
              <label className="block text-slate-400 mb-1">Map Look</label>
              <select
                value={project.themePreset}
                onChange={(e) =>
                  onUpdateProject((p) => ({ ...p, themePreset: e.target.value as ThemePresetId }))
                }
                className="w-full rounded-md border border-white/10 bg-[#070A10] px-2.5 py-1.5 text-slate-100"
              >
                <option value="vox-tactical">Satellite Tactical</option>
                <option value="3d-globe">3D Terrain &amp; Globe Flyover</option>
                <option value="vintage-parchment">Editorial Paper &amp; Ink</option>
              </select>
            </div>

            <div className="space-y-3 pt-3 border-t border-white/8">
              <div className="text-[11px] font-semibold text-slate-300">Audio Mix</div>
              <div>
                <div className="flex justify-between text-slate-400 mb-1">
                  <span>Voiceover Level</span>
                  <span className="font-mono tabular-nums">{Math.round(project.audio.voiceVolume * 100)}%</span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.05}
                  value={project.audio.voiceVolume}
                  onChange={(e) =>
                    onUpdateProject((p) => ({
                      ...p,
                      audio: { ...p.audio, voiceVolume: Number(e.target.value) },
                    }))
                  }
                  className="w-full accent-amber-500"
                />
              </div>
              <div>
                <div className="flex justify-between text-slate-400 mb-1">
                  <span>Map SFX Level</span>
                  <span className="font-mono tabular-nums">{Math.round(project.audio.sfxVolume * 100)}%</span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.05}
                  value={project.audio.sfxVolume}
                  onChange={(e) =>
                    onUpdateProject((p) => ({
                      ...p,
                      audio: { ...p.audio, sfxVolume: Number(e.target.value) },
                    }))
                  }
                  className="w-full accent-amber-500"
                />
              </div>
              <div>
                <div className="flex justify-between text-slate-400 mb-1">
                  <span>Sub-Bass Ambience</span>
                  <span className="font-mono tabular-nums">{Math.round(project.audio.ambienceVolume * 100)}%</span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.05}
                  value={project.audio.ambienceVolume}
                  onChange={(e) =>
                    onUpdateProject((p) => ({
                      ...p,
                      audio: { ...p.audio, ambienceVolume: Number(e.target.value) },
                    }))
                  }
                  className="w-full accent-amber-500"
                />
              </div>
            </div>

            <div className="space-y-2.5 pt-3 border-t border-white/8">
              <div className="text-[11px] font-semibold text-slate-300">Captions</div>
              <label className="flex items-center justify-between py-1 cursor-pointer text-slate-200">
                <span>Show Burn-in Captions</span>
                <input
                  type="checkbox"
                  checked={project.showSubtitles}
                  onChange={(e) => onUpdateProject((p) => ({ ...p, showSubtitles: e.target.checked }))}
                  className="accent-amber-500"
                />
              </label>
              <p className="text-[11px] leading-relaxed text-slate-400 pt-1">
                Select any keyframe, route, region, or asset in the timeline below to fine-tune its position and timing.
              </p>
            </div>
          </>
        )}
      </div>
    </aside>
  );
}
