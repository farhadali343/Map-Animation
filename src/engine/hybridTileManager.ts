import type { MapProject } from '../types/project';

export type TileLayerKind = 'imagery' | 'labels' | 'roads' | 'hillshade' | 'topo';

interface TileEntry {
  status: 'loading' | 'ready' | 'error';
  img?: HTMLImageElement;
  promise?: Promise<void>;
}

export interface MercatorTileGridInfo {
  tileZ: number;
  numTiles: number;
  scaleMerc: number;
  tileScreenSize: number;
  camTx: number;
  camTy: number;
  minTx: number;
  maxTx: number;
  minTy: number;
  maxTy: number;
  bearingRad: number;
  pitchScale: number;
}

const DEG2RAD = Math.PI / 180;
const tileCache = new Map<string, TileEntry>();
const tileUpdateListeners = new Set<() => void>();
let pendingNotifyRaf = 0;
let tileCacheVersion = 1;

export function getTileCacheVersion(): number {
  return tileCacheVersion;
}

const atlasCache: Record<string, { canvas: HTMLCanvasElement; renderedCount: number }> = {};

function scheduleListenerNotify() {
  if (pendingNotifyRaf || typeof window === 'undefined') return;
  pendingNotifyRaf = window.requestAnimationFrame(() => {
    pendingNotifyRaf = 0;
    tileUpdateListeners.forEach((cb) => cb());
  });
}

export function subscribeHybridTileUpdates(cb: () => void): () => void {
  tileUpdateListeners.add(cb);
  return () => {
    tileUpdateListeners.delete(cb);
  };
}

function mercatorY(lat: number): number {
  const clamped = Math.max(-85.0511, Math.min(85.0511, lat));
  const sin = Math.sin(clamped * DEG2RAD);
  return Math.log((1 + sin) / (1 - sin)) / 2;
}

export function wrapTileX(x: number, n: number): number {
  return ((x % n) + n) % n;
}

export function requestTile(layer: TileLayerKind, z: number, y: number, x: number): TileEntry {
  const n = 1 << z;
  const wy = Math.max(0, Math.min(n - 1, y));
  const wx = wrapTileX(x, n);
  const key = `${layer}/${z}/${wy}/${wx}`;

  const existing = tileCache.get(key);
  if (existing) return existing;

  let resolvePromise!: () => void;
  const promise = new Promise<void>((resolve) => {
    resolvePromise = resolve;
  });

  const entry: TileEntry = { status: 'loading', promise };
  tileCache.set(key, entry);

  if (typeof Image === 'undefined') {
    entry.status = 'error';
    resolvePromise();
    return entry;
  }

  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.decoding = 'async';
  img.onload = () => {
    entry.status = 'ready';
    entry.img = img;
    tileCacheVersion += 1;
    scheduleListenerNotify();
    resolvePromise();
  };
  img.onerror = () => {
    entry.status = 'error';
    resolvePromise();
  };
  img.src = `/api/tiles/${layer}/${z}/${wy}/${wx}`;

  return entry;
}

export function drawTileWithFallback(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  layer: TileLayerKind,
  z: number,
  y: number,
  x: number,
  dx: number,
  dy: number,
  dw: number,
  dh: number,
): boolean {
  const n = 1 << z;
  if (y < 0 || y >= n) return false;
  const wx = wrapTileX(x, n);

  const entry = requestTile(layer, z, y, wx);
  if (entry.status === 'ready' && entry.img) {
    // Tiny overlap prevents hairline seams during fractional zoom/rotation
    ctx.drawImage(entry.img, dx, dy, dw + 0.65, dh + 0.65);
    return true;
  }

  // Fall back to parent imagery/hillshade/topo so base terrain never flashes empty during rapid zooms
  if (layer === 'imagery' || layer === 'hillshade' || layer === 'topo') {
    for (let pz = z - 1; pz >= 2; pz--) {
      const factor = 1 << (z - pz);
      const px = Math.floor(wx / factor);
      const py = Math.floor(y / factor);
      const parentKey = `${layer}/${pz}/${py}/${px}`;
      const pEntry = tileCache.get(parentKey);
      if (pEntry?.status === 'ready' && pEntry.img) {
        const subW = pEntry.img.width / factor;
        const subH = pEntry.img.height / factor;
        const sx = (wx - px * factor) * subW;
        const sy = (y - py * factor) * subH;
        ctx.drawImage(pEntry.img, sx, sy, subW, subH, dx, dy, dw + 0.65, dh + 0.65);
        return true;
      }
    }
  }

  return false;
}

export function computeMercatorTileGrid(
  cam: { lat: number; lng: number; zoom: number; pitch: number; bearing: number },
  width: number,
  height: number,
): MercatorTileGridInfo {
  const scaleMerc = Math.pow(2, cam.zoom) * (width / 720) * 115;
  const worldPx = 2 * Math.PI * scaleMerc;
  const tileZ = Math.max(2, Math.min(14, Math.ceil(Math.log2(Math.max(256, worldPx) / 290))));
  const numTiles = 1 << tileZ;
  const tileScreenSize = worldPx / numTiles;

  const camTx = ((cam.lng + 180) / 360) * numTiles;
  const camTy = ((1 - mercatorY(cam.lat) / Math.PI) / 2) * numTiles;

  const bearingRad = cam.bearing * DEG2RAD;
  const pitchScale = Math.max(0.35, Math.cos(cam.pitch * 0.65 * DEG2RAD));
  const cosB = Math.cos(bearingRad);
  const sinB = Math.sin(bearingRad);

  const corners = [
    { x: 0, y: 0 },
    { x: width, y: 0 },
    { x: 0, y: height },
    { x: width, y: height },
  ];

  let minTx = Infinity;
  let maxTx = -Infinity;
  let minTy = Infinity;
  let maxTy = -Infinity;

  for (const c of corners) {
    const dx = c.x - width / 2;
    const dy = (c.y - height / 2) / pitchScale;
    const mx = dx * cosB + dy * sinB;
    const my = -dx * sinB + dy * cosB;
    const tx = camTx + mx / tileScreenSize;
    const ty = camTy + my / tileScreenSize;
    if (tx < minTx) minTx = tx;
    if (tx > maxTx) maxTx = tx;
    if (ty < minTy) minTy = ty;
    if (ty > maxTy) maxTy = ty;
  }

  return {
    tileZ,
    numTiles,
    scaleMerc,
    tileScreenSize,
    camTx,
    camTy,
    minTx: Math.floor(minTx) - 1,
    maxTx: Math.ceil(maxTx) + 1,
    minTy: Math.max(0, Math.floor(minTy) - 1),
    maxTy: Math.min(numTiles - 1, Math.ceil(maxTy) + 1),
    bearingRad,
    pitchScale,
  };
}

export function areViewportTilesReady(layer: TileLayerKind, grid: MercatorTileGridInfo): boolean {
  for (let ty = grid.minTy; ty <= grid.maxTy; ty++) {
    if (ty < 0 || ty >= grid.numTiles) continue;
    for (let tx = grid.minTx; tx <= grid.maxTx; tx++) {
      const wx = wrapTileX(tx, grid.numTiles);
      const entry = tileCache.get(`${layer}/${grid.tileZ}/${ty}/${wx}`);
      if (!entry || entry.status !== 'ready') return false;
    }
  }
  return true;
}

export function getGlobalGlobeAtlas(layer: TileLayerKind): HTMLCanvasElement | null {
  if (typeof document === 'undefined') return null;

  // Use z=3 (8x8 = 64 tiles -> 2048x2048) layered over z=2 (4x4 = 16 tiles) fallback for fast, crisp globe renders
  const zHigh = 3;
  const nHigh = 1 << zHigh;
  const zLow = 2;
  const nLow = 1 << zLow;
  const atlasSize = 1024;

  let readyCount = 0;
  for (let y = 0; y < nLow; y++) {
    for (let x = 0; x < nLow; x++) {
      const e = requestTile(layer, zLow, y, x);
      if (e.status === 'ready') readyCount += 1;
    }
  }
  for (let y = 0; y < nHigh; y++) {
    for (let x = 0; x < nHigh; x++) {
      const e = requestTile(layer, zHigh, y, x);
      if (e.status === 'ready') readyCount += 1;
    }
  }

  const cached = atlasCache[layer];
  if (cached && cached.renderedCount === readyCount) {
    return cached.canvas;
  }

  const canvas = cached?.canvas || document.createElement('canvas');
  if (canvas.width !== atlasSize || canvas.height !== atlasSize) {
    canvas.width = atlasSize;
    canvas.height = atlasSize;
  }
  const actx = canvas.getContext('2d');
  if (!actx) return null;

  actx.clearRect(0, 0, atlasSize, atlasSize);

  // Base low-res z=2 tiles first
  const lowTilePx = atlasSize / nLow;
  for (let y = 0; y < nLow; y++) {
    for (let x = 0; x < nLow; x++) {
      const e = tileCache.get(`${layer}/${zLow}/${y}/${x}`);
      if (e?.status === 'ready' && e.img) {
        actx.drawImage(e.img, x * lowTilePx, y * lowTilePx, lowTilePx + 0.5, lowTilePx + 0.5);
      }
    }
  }

  // Crisp z=3 tiles on top
  const highTilePx = atlasSize / nHigh;
  for (let y = 0; y < nHigh; y++) {
    for (let x = 0; x < nHigh; x++) {
      const e = tileCache.get(`${layer}/${zHigh}/${y}/${x}`);
      if (e?.status === 'ready' && e.img) {
        actx.drawImage(e.img, x * highTilePx, y * highTilePx, highTilePx + 0.5, highTilePx + 0.5);
      }
    }
  }

  atlasCache[layer] = { canvas, renderedCount: readyCount };
  return canvas;
}

export interface TilePreloadResult {
  loaded: number;
  total: number;
  ready: boolean;
}

export async function preloadHybridTilesForProject(
  project: MapProject,
  width: number,
  height: number,
  interpolateCamFn: (
    proj: MapProject,
    timeMs: number,
  ) => { lat: number; lng: number; zoom: number; pitch: number; bearing: number; globeMix: number },
  onProgress?: (pct: number, message: string, loaded?: number, total?: number) => void,
  signal?: AbortSignal,
): Promise<TilePreloadResult> {
  const hybrid = project.hybridMap;
  if (hybrid && !hybrid.enabled) {
    onProgress?.(100, 'Map ready', 0, 0);
    return { loaded: 0, total: 0, ready: true };
  }

  const hasTopoShots = project.cameraKeyframes.some((k) => k.mapStyle === 'topo-paper');
  const layers: TileLayerKind[] = ['imagery'];
  if (hasTopoShots) layers.push('topo');
  if (project.mapDepth?.enabled) layers.push('hillshade');
  // Keep small-area & road clutter hidden unless user explicitly enables them
  if (hybrid?.showBordersAndLabels === true) layers.push('labels');
  if (hybrid?.showHighways === true) layers.push('roads');

  const uniqueKeys = new Map<string, { layer: TileLayerKind; z: number; y: number; x: number }>();

  const queueTile = (layer: TileLayerKind, z: number, y: number, x: number) => {
    const n = 1 << z;
    if (y < 0 || y >= n) return;
    const wx = wrapTileX(x, n);
    const key = `${layer}/${z}/${y}/${wx}`;
    if (!uniqueKeys.has(key)) {
      uniqueKeys.set(key, { layer, z, y, x: wx });
    }
  };

  // Dense sampling (125ms) + keyframes so steep zoom sweeps cache every intermediate tileZ pyramid tier
  const sampleTimes = new Set<number>([0, project.durationMs]);
  for (let t = 0; t <= project.durationMs; t += 125) {
    sampleTimes.add(t);
  }
  for (const kf of project.cameraKeyframes) {
    sampleTimes.add(Math.max(0, Math.min(project.durationMs, kf.timeMs)));
  }

  const orderedTimes = Array.from(sampleTimes).sort((a, b) => a - b);
  const resScales = [
    { w: width, h: height },
    ...(width < 900 ? [{ w: 1080, h: 1920 }] : []),
  ];

  let needsGlobeAtlas = false;
  for (const t of orderedTimes) {
    const cam = interpolateCamFn(project, t);
    if (cam.globeMix > 0.1) needsGlobeAtlas = true;
    if (cam.globeMix < 0.94) {
      for (const dim of resScales) {
        const grid = computeMercatorTileGrid(cam, dim.w, dim.h);
        // Queue exact target zoom tiles (plus immediate parent tier on imagery so rapid zooms never upscale blurry pixels)
        for (const layer of layers) {
          for (let ty = grid.minTy; ty <= grid.maxTy; ty++) {
            for (let tx = grid.minTx; tx <= grid.maxTx; tx++) {
              queueTile(layer, grid.tileZ, ty, tx);
            }
          }
          if (layer === 'imagery' && grid.tileZ > 3) {
            const pZ = grid.tileZ - 1;
            const pMinTx = Math.floor(grid.minTx / 2);
            const pMaxTx = Math.floor(grid.maxTx / 2);
            const pMinTy = Math.floor(grid.minTy / 2);
            const pMaxTy = Math.floor(grid.maxTy / 2);
            for (let pty = pMinTy; pty <= pMaxTy; pty++) {
              for (let ptx = pMinTx; ptx <= pMaxTx; ptx++) {
                queueTile('imagery', pZ, pty, ptx);
              }
            }
          }
        }
      }
    }
  }

  if (needsGlobeAtlas) {
    const globeLayers = layers.filter((l) => l === 'imagery' || l === 'labels' || l === 'hillshade');
    for (const layer of globeLayers) {
      for (const z of [2, 3]) {
        const n = 1 << z;
        for (let y = 0; y < n; y++) {
          for (let x = 0; x < n; x++) {
            queueTile(layer, z, y, x);
          }
        }
      }
    }
  }

  const jobs = Array.from(uniqueKeys.values());
  if (jobs.length === 0) {
    onProgress?.(100, 'Map ready', 0, 0);
    return { loaded: 0, total: 0, ready: true };
  }

  let alreadyReady = 0;
  const pendingJobs: typeof jobs = [];
  for (const item of jobs) {
    const key = `${item.layer}/${item.z}/${item.y}/${item.x}`;
    const cached = tileCache.get(key);
    if (cached?.status === 'ready') {
      alreadyReady += 1;
    } else {
      pendingJobs.push(item);
    }
  }

  let done = alreadyReady;
  const total = jobs.length;
  onProgress?.(Math.min(100, Math.round((done / total) * 100)), `Pre-loading ${total} zoom tiles...`, done, total);

  if (pendingJobs.length === 0) {
    return { loaded: total, total, ready: true };
  }

  const batchSize = 14;
  for (let i = 0; i < pendingJobs.length; i += batchSize) {
    if (signal?.aborted) {
      return { loaded: done, total, ready: false };
    }
    const slice = pendingJobs.slice(i, i + batchSize);
    await Promise.all(
      slice.map((item) => {
        const entry = requestTile(item.layer, item.z, item.y, item.x);
        return entry.promise || Promise.resolve();
      }),
    );
    done += slice.length;
    const pct = Math.min(100, Math.round((done / total) * 100));
    onProgress?.(pct, `Pre-loading zoom tiles (${done}/${total})`, done, total);
  }

  return { loaded: done, total, ready: !signal?.aborted };
}
