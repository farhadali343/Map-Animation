import { THEME_PRESETS } from '../data/presets';
import { findRegionFeature, getWorldCountries, type GeoBbox } from '../data/worldGeo';
import {
  areViewportTilesReady,
  computeMercatorTileGrid,
  drawTileWithFallback,
  getGlobalGlobeAtlas,
  getTileCacheVersion,
  type MercatorTileGridInfo,
} from './hybridTileManager';

export type RenderQualityTier = 'full' | 'balanced' | 'fast';
type RenderCtx2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
type RenderSurface = OffscreenCanvas | HTMLCanvasElement;

function createOffscreenSurface(w: number, h: number): RenderSurface | null {
  const sw = Math.max(1, Math.round(w));
  const sh = Math.max(1, Math.round(h));
  if (typeof OffscreenCanvas !== 'undefined') {
    return new OffscreenCanvas(sw, sh);
  }
  if (typeof document !== 'undefined') {
    const c = document.createElement('canvas');
    c.width = sw;
    c.height = sh;
    return c;
  }
  return null;
}

function ensureSurfaceSize(surface: RenderSurface | null, w: number, h: number): RenderSurface | null {
  const sw = Math.max(1, Math.round(w));
  const sh = Math.max(1, Math.round(h));
  const target = surface || createOffscreenSurface(sw, sh);
  if (!target) return null;
  if (target.width !== sw || target.height !== sh) {
    target.width = sw;
    target.height = sh;
  }
  return target;
}

function getSurfaceCtx2D(surface: RenderSurface | null): RenderCtx2D | null {
  if (!surface) return null;
  return surface.getContext('2d') as RenderCtx2D | null;
}
import type {
  CameraKeyframe,
  EasingType,
  GeoRoute,
  GlowingEdgeSettings,
  HazardIconKind,
  LatLng,
  MapOverlay,
  MapProject,
  RegionMask,
  WordTiming,
} from '../types/project';

const DEG2RAD = Math.PI / 180;
const RAD2DEG = 180 / Math.PI;

export function getEasingCurvePoints(
  easing: EasingType,
  customPoints?: [number, number, number, number],
): [number, number, number, number] {
  if (easing === 'custom' && customPoints && customPoints.length === 4) {
    return customPoints;
  }
  if (easing === 'linear') return [0, 0, 1, 1];
  if (easing === 'expoOut') return [0.16, 1, 0.3, 1];
  return [0.65, 0, 0.35, 1]; // easeInOutCubic
}

export function solveCubicBezier(
  t: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
): number {
  const x = Math.max(0, Math.min(1, t));
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  if (Math.abs(x1 - y1) < 1e-4 && Math.abs(x2 - y2) < 1e-4) return x;

  // Exact Bernstein polynomial for P0=(0,0), P1=(x1,y1), P2=(x2,y2), P3=(1,1)
  const cx = 3 * x1;
  const bx = 3 * (x2 - x1) - cx;
  const ax = 1 - cx - bx;

  const cy = 3 * y1;
  const by = 3 * (y2 - y1) - cy;
  const ay = 1 - cy - by;

  const bezierX = (u: number) => ((ax * u + bx) * u + cx) * u;
  const bezierDX = (u: number) => (3 * ax * u + 2 * bx) * u + cx;
  const bezierY = (u: number) => ((ay * u + by) * u + cy) * u;

  let u = x;
  for (let i = 0; i < 6; i++) {
    const err = bezierX(u) - x;
    const d = bezierDX(u);
    if (Math.abs(err) < 1e-5) break;
    if (Math.abs(d) < 1e-5) break;
    u -= err / d;
  }

  if (u < 0 || u > 1 || Number.isNaN(u)) {
    let lo = 0;
    let hi = 1;
    u = x;
    for (let i = 0; i < 12; i++) {
      const val = bezierX(u);
      if (Math.abs(val - x) < 1e-5) break;
      if (x > val) lo = u;
      else hi = u;
      u = 0.5 * (lo + hi);
    }
  }
  return bezierY(Math.max(0, Math.min(1, u)));
}

function applyEasing(
  t: number,
  easing: EasingType,
  curvePoints?: [number, number, number, number],
): number {
  const x = Math.max(0, Math.min(1, t));
  if (easing === 'custom' && curvePoints) {
    return solveCubicBezier(x, curvePoints[0], curvePoints[1], curvePoints[2], curvePoints[3]);
  }
  if (easing === 'linear') return x;
  if (easing === 'expoOut') {
    return x === 1 ? 1 : 1 - Math.pow(2, -10 * x);
  }
  // easeInOutCubic
  return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
}

function springPop(elapsedMs: number, durationMs = 340): number {
  if (elapsedMs <= 0) return 0;
  if (elapsedMs >= durationMs) return 1;
  const t = elapsedMs / durationMs;
  const c4 = (2 * Math.PI) / 3;
  return Math.pow(2, -8 * t) * Math.sin((t * 10 - 0.75) * c4) + 1;
}

function elasticPop(elapsedMs: number, durationMs = 460): number {
  if (elapsedMs <= 0) return 0;
  if (elapsedMs >= durationMs) return 1;
  const t = elapsedMs / durationMs;
  const c4 = (2 * Math.PI) / 3.4;
  return Math.pow(2, -7.2 * t) * Math.sin((t * 10.5 - 0.75) * c4) + 1;
}

function mercatorY(lat: number): number {
  const clamped = Math.max(-85, Math.min(85, lat));
  const sin = Math.sin(clamped * DEG2RAD);
  return Math.log((1 + sin) / (1 - sin)) / 2;
}

function invMercatorY(my: number): number {
  const lat = (2 * Math.atan(Math.exp(my)) - Math.PI / 2) * RAD2DEG;
  return Math.max(-85, Math.min(85, lat));
}

function unwrapAngleDeg(refDeg: number, targetDeg: number): number {
  let diff = ((targetDeg - refDeg + 540) % 360) - 180;
  if (diff < -180) diff += 360;
  return refDeg + diff;
}

function evalCentripetalCatmullRomScalar(
  p0: number,
  p1: number,
  p2: number,
  p3: number,
  t0: number,
  t1: number,
  t2: number,
  t3: number,
  u: number,
): number {
  const t = t1 + u * (t2 - t1);
  const d10 = Math.max(1e-5, t1 - t0);
  const d21 = Math.max(1e-5, t2 - t1);
  const d32 = Math.max(1e-5, t3 - t2);
  const d20 = Math.max(1e-5, t2 - t0);
  const d31 = Math.max(1e-5, t3 - t1);

  const A1 = ((t1 - t) / d10) * p0 + ((t - t0) / d10) * p1;
  const A2 = ((t2 - t) / d21) * p1 + ((t - t1) / d21) * p2;
  const A3 = ((t3 - t) / d32) * p2 + ((t - t2) / d32) * p3;

  const B1 = ((t2 - t) / d20) * A1 + ((t - t0) / d20) * A2;
  const B2 = ((t3 - t) / d31) * A2 + ((t - t1) / d31) * A3;

  return ((t2 - t) / d21) * B1 + ((t - t1) / d21) * B2;
}

function evalCentripetalCatmullRom2D(
  p0x: number,
  p0y: number,
  p1x: number,
  p1y: number,
  p2x: number,
  p2y: number,
  p3x: number,
  p3y: number,
  u: number,
): { x: number; y: number } {
  const alpha = 0.5;
  const dt01 = Math.pow(Math.max(1e-4, Math.hypot(p1x - p0x, p1y - p0y)), alpha);
  const dt12 = Math.pow(Math.max(1e-4, Math.hypot(p2x - p1x, p2y - p1y)), alpha);
  const dt23 = Math.pow(Math.max(1e-4, Math.hypot(p3x - p2x, p3y - p2y)), alpha);

  const t0 = 0;
  const t1 = t0 + dt01;
  const t2 = t1 + dt12;
  const t3 = t2 + dt23;

  return {
    x: evalCentripetalCatmullRomScalar(p0x, p1x, p2x, p3x, t0, t1, t2, t3, u),
    y: evalCentripetalCatmullRomScalar(p0y, p1y, p2y, p3y, t0, t1, t2, t3, u),
  };
}

export interface InterpolatedCamera {
  lat: number;
  lng: number;
  zoom: number;
  pitch: number;
  bearing: number;
  globeMix: number; // 0 = mercator, 1 = spherical globe
  topoMix: number; // 0 = satellite, 1 = topographic paper sheet
}

const sortedKeyframesCache = new WeakMap<CameraKeyframe[], CameraKeyframe[]>();

function getSortedKeyframes(cameraKeyframes: CameraKeyframe[]): CameraKeyframe[] {
  let cached = sortedKeyframesCache.get(cameraKeyframes);
  if (!cached) {
    cached = [...cameraKeyframes].sort((a, b) => a.timeMs - b.timeMs);
    sortedKeyframesCache.set(cameraKeyframes, cached);
  }
  return cached;
}

export function interpolateCamera(project: MapProject, timeMs: number): InterpolatedCamera {
  const kfs = getSortedKeyframes(project.cameraKeyframes);
  if (kfs.length === 0) {
    return { lat: 25, lng: 0, zoom: 2.2, pitch: 0, bearing: 0, globeMix: 0, topoMix: 0 };
  }
  if (timeMs <= kfs[0].timeMs) {
    const k = kfs[0];
    return {
      lat: k.lat,
      lng: k.lng,
      zoom: k.zoom,
      pitch: k.pitch,
      bearing: k.bearing,
      globeMix: k.projectionMode === 'globe' ? 1 : 0,
      topoMix: k.mapStyle === 'topo-paper' ? 1 : 0,
    };
  }
  if (timeMs >= kfs[kfs.length - 1].timeMs) {
    const k = kfs[kfs.length - 1];
    return {
      lat: k.lat,
      lng: k.lng,
      zoom: k.zoom,
      pitch: k.pitch,
      bearing: k.bearing,
      globeMix: k.projectionMode === 'globe' ? 1 : 0,
      topoMix: k.mapStyle === 'topo-paper' ? 1 : 0,
    };
  }

  let segIdx = 0;
  for (let i = 0; i < kfs.length - 1; i++) {
    if (timeMs >= kfs[i].timeMs && timeMs <= kfs[i + 1].timeMs) {
      segIdx = i;
      break;
    }
  }

  const prev = kfs[segIdx];
  const next = kfs[segIdx + 1];
  const segEasing = next.easing || prev.easing;
  const span = Math.max(1, next.timeMs - prev.timeMs);
  const rawT = (timeMs - prev.timeMs) / span;
  const e = applyEasing(rawT, segEasing, next.curvePoints);

  const g0 = prev.projectionMode === 'globe' ? 1 : 0;
  const g1 = next.projectionMode === 'globe' ? 1 : 0;
  const t0 = prev.mapStyle === 'topo-paper' ? 1 : 0;
  const t1 = next.mapStyle === 'topo-paper' ? 1 : 0;

  let lat = prev.lat + (next.lat - prev.lat) * e;
  let lng = unwrapAngleDeg(prev.lng, next.lng);
  lng = prev.lng + (lng - prev.lng) * e;

  let zScale0 = Math.pow(2, prev.zoom);
  let zScale1 = Math.pow(2, next.zoom);
  let smoothZoom = Math.log2(Math.max(1, zScale0 + (zScale1 - zScale0) * e));
  let pitch = prev.pitch + (next.pitch - prev.pitch) * e;
  const nextBearing = unwrapAngleDeg(prev.bearing, next.bearing);
  let bearing = prev.bearing + (nextBearing - prev.bearing) * e;

  // Centripetal Catmull-Rom spline (alpha = 0.5) across lat/lng/log2-zoom/pitch/bearing for organic non-linear camera flights
  if (segEasing !== 'linear' && kfs.length >= 3) {
    const k0 = kfs[Math.max(0, segIdx - 1)];
    const k3 = kfs[Math.min(kfs.length - 1, segIdx + 2)];

    const l1 = prev.lng;
    const l2 = unwrapAngleDeg(l1, next.lng);
    const l0 = unwrapAngleDeg(l1, k0.lng);
    const l3 = unwrapAngleDeg(l2, k3.lng);

    const m0 = mercatorY(k0.lat);
    const m1 = mercatorY(prev.lat);
    const m2 = mercatorY(next.lat);
    const m3 = mercatorY(k3.lat);

    const z0 = Math.pow(2, k0.zoom);
    zScale0 = Math.pow(2, prev.zoom);
    zScale1 = Math.pow(2, next.zoom);
    const z3 = Math.pow(2, k3.zoom);

    const p0Val = k0.pitch;
    const p1Val = prev.pitch;
    const p2Val = next.pitch;
    const p3Val = k3.pitch;

    const b1Val = prev.bearing;
    const b2Val = unwrapAngleDeg(b1Val, next.bearing);
    const b0Val = unwrapAngleDeg(b1Val, k0.bearing);
    const b3Val = unwrapAngleDeg(b2Val, k3.bearing);

    // Centripetal knot distances over Mercator coordinates + normalized zoom change
    const alpha = 0.5;
    const dist = (la: number, ma: number, za: number, lb: number, mb: number, zb: number) => {
      const dx = (lb - la) * DEG2RAD;
      const dy = mb - ma;
      const dz = (Math.log2(Math.max(1, zb)) - Math.log2(Math.max(1, za))) * 0.14;
      return Math.pow(Math.max(1e-4, Math.hypot(dx, dy, dz)), alpha);
    };

    const kt0 = 0;
    const kt1 = kt0 + dist(l0, m0, z0, l1, m1, zScale0);
    const kt2 = kt1 + dist(l1, m1, zScale0, l2, m2, zScale1);
    const kt3 = kt2 + dist(l2, m2, zScale1, l3, m3, z3);

    const splLng = evalCentripetalCatmullRomScalar(l0, l1, l2, l3, kt0, kt1, kt2, kt3, e);
    const splMercY = evalCentripetalCatmullRomScalar(m0, m1, m2, m3, kt0, kt1, kt2, kt3, e);
    const splZScale = evalCentripetalCatmullRomScalar(z0, zScale0, zScale1, z3, kt0, kt1, kt2, kt3, e);
    const splPitch = evalCentripetalCatmullRomScalar(p0Val, p1Val, p2Val, p3Val, kt0, kt1, kt2, kt3, e);
    const splBearing = evalCentripetalCatmullRomScalar(b0Val, b1Val, b2Val, b3Val, kt0, kt1, kt2, kt3, e);

    lat = invMercatorY(splMercY);
    lng = ((splLng + 540) % 360) - 180;
    smoothZoom = Math.max(0.8, Math.log2(Math.max(1, splZScale)));
    pitch = Math.max(0, Math.min(60, splPitch));
    bearing = splBearing;
  }

  // Override lat/lng smoothly along the spline-smoothed path when followRouteId is active
  if (prev.followRouteId) {
    const route = project.routes.find((r) => r.id === prev.followRouteId);
    if (route && route.points.length >= 2) {
      const rawRp =
        route.dashAnimation === 'none'
          ? 1
          : Math.max(0, Math.min(1, (timeMs - route.startMs) / Math.max(1, route.endMs - route.startMs)));
      const rp = applyEasing(rawRp, route.easing || 'linear');
      const head = sampleSplineRoute(route.points, rp);
      lat = head.lat;
      lng = head.lng;
    }
  }

  return {
    lat,
    lng,
    zoom: smoothZoom,
    pitch,
    bearing,
    globeMix: g0 + (g1 - g0) * e,
    topoMix: t0 + (t1 - t0) * e,
  };
}

function projectPoint(
  pt: LatLng,
  cam: InterpolatedCamera,
  width: number,
  height: number,
): { x: number; y: number; visible: boolean } {
  const cx = width / 2;
  const cy = height / 2;
  const bearingRad = cam.bearing * DEG2RAD;
  const pitchScale = Math.cos(cam.pitch * 0.65 * DEG2RAD);

  // Mercator coordinates
  const scaleMerc = Math.pow(2, cam.zoom) * (width / 720) * 115;
  const dLng = ((pt.lng - cam.lng + 540) % 360) - 180;
  const mx = dLng * DEG2RAD * scaleMerc;
  const my = -(mercatorY(pt.lat) - mercatorY(cam.lat)) * scaleMerc;

  // Apply bearing + pitch
  const rotMx = mx * Math.cos(bearingRad) - my * Math.sin(bearingRad);
  const rotMy = (mx * Math.sin(bearingRad) + my * Math.cos(bearingRad)) * pitchScale;

  if (cam.globeMix <= 0.02) {
    return { x: cx + rotMx, y: cy + rotMy, visible: true };
  }

  // Orthographic 3D Globe coordinates
  const radius = Math.min(width, height) * 0.38 * Math.pow(1.28, cam.zoom - 1.7);
  const lat1 = cam.lat * DEG2RAD;
  const lng1 = cam.lng * DEG2RAD;
  const lat2 = pt.lat * DEG2RAD;
  const lng2 = pt.lng * DEG2RAD;

  const cosC = Math.sin(lat1) * Math.sin(lat2) + Math.cos(lat1) * Math.cos(lat2) * Math.cos(lng2 - lng1);
  const gx = radius * Math.cos(lat2) * Math.sin(lng2 - lng1);
  const gy = -radius * (Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(lng2 - lng1));

  const x = cx + rotMx * (1 - cam.globeMix) + gx * cam.globeMix;
  const y = cy + rotMy * (1 - cam.globeMix) + gy * cam.globeMix;
  const visible = cam.globeMix > 0.5 ? cosC > -0.05 : true;
  return { x, y, visible };
}

function buildCentripetalGeoRoutePoints(points: LatLng[], samplesPerSeg = 10): LatLng[] {
  if (points.length < 3) return points;
  const out: LatLng[] = [points[0]];
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[Math.max(0, i - 1)];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[Math.min(points.length - 1, i + 2)];

    const l1 = p1.lng;
    const l2 = unwrapAngleDeg(l1, p2.lng);
    const l0 = unwrapAngleDeg(l1, p0.lng);
    const l3 = unwrapAngleDeg(l2, p3.lng);

    const m0 = mercatorY(p0.lat);
    const m1 = mercatorY(p1.lat);
    const m2 = mercatorY(p2.lat);
    const m3 = mercatorY(p3.lat);

    for (let s = 1; s <= samplesPerSeg; s++) {
      const u = s / samplesPerSeg;
      const pt = evalCentripetalCatmullRom2D(l0, m0, l1, m1, l2, m2, l3, m3, u);
      out.push({
        lat: invMercatorY(pt.y),
        lng: ((pt.x + 540) % 360) - 180,
      });
    }
  }
  return out;
}

function sampleSplineRoute(points: LatLng[], progress: number): LatLng {
  if (points.length === 0) return { lat: 0, lng: 0 };
  if (points.length === 1 || progress <= 0) return points[0];
  if (progress >= 1) return points[points.length - 1];

  const dense = points.length >= 3 ? buildCentripetalGeoRoutePoints(points, 12) : points;

  const segLengths: number[] = [];
  let total = 0;
  for (let i = 0; i < dense.length - 1; i++) {
    const dLat = dense[i + 1].lat - dense[i].lat;
    const dLng = dense[i + 1].lng - dense[i].lng;
    const len = Math.hypot(dLat, dLng);
    segLengths.push(len);
    total += len;
  }
  if (total === 0) return dense[0];

  const target = progress * total;
  let acc = 0;
  for (let i = 0; i < segLengths.length; i++) {
    const len = segLengths[i];
    if (acc + len >= target) {
      const localT = len > 0 ? (target - acc) / len : 0;
      return {
        lat: dense[i].lat + (dense[i + 1].lat - dense[i].lat) * localT,
        lng: dense[i].lng + (dense[i + 1].lng - dense[i].lng) * localT,
      };
    }
    acc += len;
  }
  return dense[dense.length - 1];
}

const hatchCanvasCache: Record<string, HTMLCanvasElement> = {};

function getHatchPattern(ctx: RenderCtx2D, color: string): CanvasPattern | null {
  if (typeof document === 'undefined') return null;
  let off = hatchCanvasCache[color];
  if (!off) {
    off = document.createElement('canvas');
    off.width = 14;
    off.height = 14;
    const octx = off.getContext('2d');
    if (!octx) return null;

    // Light translucent tint + crisp airy diagonal highlight stripes so satellite terrain stays clear underneath
    octx.fillStyle = color;
    octx.globalAlpha = 0.16;
    octx.fillRect(0, 0, 14, 14);

    octx.globalAlpha = 0.24;
    octx.strokeStyle = 'rgba(255, 255, 255, 0.72)';
    octx.lineWidth = 1.6;
    octx.beginPath();
    octx.moveTo(-3, 14);
    octx.lineTo(14, -3);
    octx.moveTo(0, 17);
    octx.lineTo(17, 0);
    octx.stroke();

    hatchCanvasCache[color] = off;
  }
  return ctx.createPattern(off, 'repeat');
}

function drawOutlinedText(
  ctx: RenderCtx2D,
  text: string,
  x: number,
  y: number,
  strokeWidth = 5,
  strokeColor = 'rgba(0, 0, 0, 0.86)',
) {
  ctx.save();
  ctx.lineJoin = 'round';
  ctx.miterLimit = 2;
  ctx.strokeStyle = strokeColor;
  ctx.lineWidth = strokeWidth;
  ctx.strokeText(text, x, y);
  ctx.fillText(text, x, y);
  ctx.restore();
}

function drawPolygonRings(
  ctx: RenderCtx2D,
  rings: LatLng[][],
  cam: InterpolatedCamera,
  width: number,
  height: number,
): { cx: number; cy: number; minX: number; maxX: number; minY: number; maxY: number; perimeterPx: number; drawn: boolean } {
  let sumX = 0;
  let sumY = 0;
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  let perimeterPx = 0;
  let count = 0;
  let anyDrawn = false;

  ctx.beginPath();
  for (const ring of rings) {
    if (ring.length < 3) continue;
    let started = false;
    let prevX = 0;
    let prevY = 0;
    let firstX = 0;
    let firstY = 0;
    for (let i = 0; i < ring.length; i++) {
      const p = projectPoint(ring[i], cam, width, height);
      if (!p.visible) {
        started = false;
        continue;
      }
      if (!started) {
        ctx.moveTo(p.x, p.y);
        firstX = p.x;
        firstY = p.y;
        started = true;
      } else {
        ctx.lineTo(p.x, p.y);
        perimeterPx += Math.hypot(p.x - prevX, p.y - prevY);
      }
      prevX = p.x;
      prevY = p.y;
      sumX += p.x;
      sumY += p.y;
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.y > maxY) maxY = p.y;
      count += 1;
      anyDrawn = true;
    }
    if (started) {
      perimeterPx += Math.hypot(prevX - firstX, prevY - firstY);
      ctx.closePath();
    }
  }
  return {
    cx: count > 0 ? sumX / count : width / 2,
    cy: count > 0 ? sumY / count : height / 2,
    minX: Number.isFinite(minX) ? minX : width / 2,
    maxX: Number.isFinite(maxX) ? maxX : width / 2,
    minY: Number.isFinite(minY) ? minY : height / 2,
    maxY: Number.isFinite(maxY) ? maxY : height / 2,
    perimeterPx,
    drawn: anyDrawn,
  };
}

function drawHazardIconBadge(
  ctx: RenderCtx2D,
  kind: HazardIconKind,
  accentColor: string,
  timeMs: number,
) {
  const pulse = 1 + 0.04 * Math.sin(timeMs * 0.008);
  const red = accentColor || '#EF4444';

  if (kind === 'skull') {
    ctx.save();
    ctx.scale(pulse, pulse);
    ctx.shadowColor = red;
    ctx.shadowBlur = 26;

    // Crossbones behind skull
    ctx.strokeStyle = '#FFFFFF';
    ctx.lineWidth = 10;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(-42, 42);
    ctx.lineTo(42, 4);
    ctx.moveTo(42, 42);
    ctx.lineTo(-42, 4);
    ctx.stroke();

    // Knobs at bone ends
    ctx.fillStyle = '#FFFFFF';
    for (const [bx, by] of [
      [-43, 43],
      [43, 3],
      [43, 43],
      [-43, 3],
    ]) {
      ctx.beginPath();
      ctx.arc(bx, by, 7, 0, Math.PI * 2);
      ctx.fill();
    }

    // Skull cranium + jaw
    ctx.beginPath();
    ctx.arc(0, -14, 34, Math.PI * 0.88, Math.PI * 0.12, false);
    ctx.lineTo(22, 16);
    ctx.lineTo(18, 30);
    ctx.lineTo(-18, 30);
    ctx.lineTo(-22, 16);
    ctx.closePath();
    ctx.fill();

    // Eye sockets + nasal triangle + teeth cutouts
    ctx.shadowBlur = 0;
    ctx.fillStyle = '#7F1D1D';
    ctx.beginPath();
    ctx.arc(-13, -10, 8.5, 0, Math.PI * 2);
    ctx.arc(13, -10, 8.5, 0, Math.PI * 2);
    ctx.fill();

    ctx.beginPath();
    ctx.moveTo(0, -2);
    ctx.lineTo(-5.5, 8);
    ctx.lineTo(5.5, 8);
    ctx.closePath();
    ctx.fill();

    ctx.strokeStyle = '#7F1D1D';
    ctx.lineWidth = 2.6;
    for (const tx of [-9, 0, 9]) {
      ctx.beginPath();
      ctx.moveTo(tx, 18);
      ctx.lineTo(tx, 30);
      ctx.stroke();
    }
    ctx.restore();
    return;
  }

  if (kind === 'no-police') {
    ctx.save();
    ctx.shadowColor = red;
    ctx.shadowBlur = 26;
    ctx.fillStyle = '#FFFFFF';
    ctx.beginPath();
    ctx.arc(0, 0, 56, 0, Math.PI * 2);
    ctx.fill();

    // Officer silhouette inside badge
    ctx.shadowBlur = 0;
    ctx.strokeStyle = '#991B1B';
    ctx.fillStyle = '#991B1B';
    ctx.lineWidth = 3.2;
    // Peaked cap
    ctx.beginPath();
    ctx.moveTo(-24, -14);
    ctx.lineTo(-18, -32);
    ctx.lineTo(18, -32);
    ctx.lineTo(24, -14);
    ctx.closePath();
    ctx.stroke();
    ctx.fillRect(-20, -16, 40, 5);
    // Cap badge star dot
    ctx.beginPath();
    ctx.arc(0, -24, 3.2, 0, Math.PI * 2);
    ctx.fill();
    // Jaw / shoulders
    ctx.beginPath();
    ctx.arc(0, 0, 15, 0, Math.PI, false);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(-26, 30);
    ctx.quadraticCurveTo(0, 10, 26, 30);
    ctx.stroke();

    // Crimson prohibition circle + slash
    ctx.strokeStyle = red;
    ctx.lineWidth = 11;
    ctx.beginPath();
    ctx.arc(0, 0, 52, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(-36, -36);
    ctx.lineTo(36, 36);
    ctx.stroke();
    ctx.restore();
    return;
  }

  // Circular white map-pin badge with crimson wildlife hazard glyph (jaguar | snake | mosquito)
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.72)';
  ctx.shadowBlur = 16;
  ctx.shadowOffsetY = 6;

  ctx.fillStyle = '#FFFFFF';
  ctx.beginPath();
  ctx.arc(0, -8, 36, 0, Math.PI * 2);
  ctx.moveTo(-12, 22);
  ctx.lineTo(0, 42);
  ctx.lineTo(12, 22);
  ctx.closePath();
  ctx.fill();

  ctx.shadowBlur = 0;
  ctx.strokeStyle = red;
  ctx.lineWidth = 3.5;
  ctx.beginPath();
  ctx.arc(0, -8, 32, 0, Math.PI * 2);
  ctx.stroke();

  ctx.fillStyle = red;
  ctx.strokeStyle = red;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  if (kind === 'jaguar') {
    // Big-cat head + pointed ears + eyes
    ctx.beginPath();
    ctx.moveTo(-18, -14);
    ctx.lineTo(-20, -28);
    ctx.lineTo(-8, -20);
    ctx.lineTo(8, -20);
    ctx.lineTo(20, -28);
    ctx.lineTo(18, -14);
    ctx.quadraticCurveTo(22, 6, 0, 14);
    ctx.quadraticCurveTo(-22, 6, -18, -14);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#FFFFFF';
    ctx.beginPath();
    ctx.arc(-7, -8, 3, 0, Math.PI * 2);
    ctx.arc(7, -8, 3, 0, Math.PI * 2);
    ctx.fill();
  } else if (kind === 'snake') {
    // Coiled cobra S-curve + flared hood
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.moveTo(-16, 12);
    ctx.bezierCurveTo(-18, 2, 18, 6, 12, -8);
    ctx.bezierCurveTo(6, -20, -8, -24, 0, -28);
    ctx.stroke();
    ctx.beginPath();
    ctx.ellipse(0, -22, 11, 8, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = red;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, -14);
    ctx.lineTo(-4, -8);
    ctx.moveTo(0, -14);
    ctx.lineTo(4, -8);
    ctx.stroke();
  } else {
    // Mosquito wings + thorax + needle proboscis
    ctx.beginPath();
    ctx.ellipse(-11, -14, 13, 6, -0.5, 0, Math.PI * 2);
    ctx.ellipse(11, -14, 13, 6, 0.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(0, -22);
    ctx.lineTo(0, 8);
    ctx.stroke();
    ctx.lineWidth = 2.2;
    ctx.beginPath();
    ctx.moveTo(0, 8);
    ctx.lineTo(0, 18);
    ctx.moveTo(-14, -4);
    ctx.lineTo(0, -6);
    ctx.lineTo(14, -4);
    ctx.moveTo(-12, 4);
    ctx.lineTo(0, 0);
    ctx.lineTo(12, 4);
    ctx.stroke();
  }
  ctx.restore();
}

function drawFlagGraphic(ctx: RenderCtx2D, code: string, x: number, y: number, w: number, h: number) {
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.65)';
  ctx.shadowBlur = 16;
  ctx.shadowOffsetY = 6;
  ctx.fillStyle = '#0F172A';
  ctx.beginPath();
  ctx.roundRect(x - w / 2, y - h / 2, w, h, 6);
  ctx.fill();
  ctx.restore();

  ctx.save();
  ctx.translate(x - w / 2, y - h / 2);
  ctx.beginPath();
  ctx.roundRect(0, 0, w, h, 6);
  ctx.clip();

  const c = code.toUpperCase();
  if (c === 'ES') {
    ctx.fillStyle = '#AA151B';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#F1BF00';
    ctx.fillRect(0, h * 0.25, w, h * 0.5);
  } else if (c === 'FR') {
    ctx.fillStyle = '#002654';
    ctx.fillRect(0, 0, w / 3, h);
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(w / 3, 0, w / 3, h);
    ctx.fillStyle = '#ED2939';
    ctx.fillRect((2 * w) / 3, 0, w / 3, h);
  } else if (c === 'GB' || c === 'UK') {
    ctx.fillStyle = '#012169';
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = '#FFFFFF';
    ctx.lineWidth = h * 0.22;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(w, h);
    ctx.moveTo(w, 0);
    ctx.lineTo(0, h);
    ctx.stroke();
    ctx.strokeStyle = '#C8102E';
    ctx.lineWidth = h * 0.1;
    ctx.stroke();
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(w * 0.4, 0, w * 0.2, h);
    ctx.fillRect(0, h * 0.35, w, h * 0.3);
    ctx.fillStyle = '#C8102E';
    ctx.fillRect(w * 0.44, 0, w * 0.12, h);
    ctx.fillRect(0, h * 0.41, w, h * 0.18);
  } else if (c === 'PT') {
    ctx.fillStyle = '#006600';
    ctx.fillRect(0, 0, w * 0.4, h);
    ctx.fillStyle = '#FF0000';
    ctx.fillRect(w * 0.4, 0, w * 0.6, h);
    ctx.fillStyle = '#FFCC00';
    ctx.beginPath();
    ctx.arc(w * 0.4, h * 0.5, h * 0.2, 0, Math.PI * 2);
    ctx.fill();
  } else if (c === 'AD') {
    ctx.fillStyle = '#0018A8';
    ctx.fillRect(0, 0, w * 0.33, h);
    ctx.fillStyle = '#FEDF00';
    ctx.fillRect(w * 0.33, 0, w * 0.34, h);
    ctx.fillStyle = '#D52B1E';
    ctx.fillRect(w * 0.67, 0, w * 0.33, h);
  } else if (c === 'MA') {
    ctx.fillStyle = '#C1272D';
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = '#006233';
    ctx.lineWidth = 3;
    ctx.beginPath();
    for (let k = 0; k < 5; k++) {
      const ang = ((k * 144 - 90) * Math.PI) / 180;
      const sx = w * 0.5 + Math.cos(ang) * h * 0.22;
      const sy = h * 0.5 + Math.sin(ang) * h * 0.22;
      if (k === 0) ctx.moveTo(sx, sy);
      else ctx.lineTo(sx, sy);
    }
    ctx.closePath();
    ctx.stroke();
  } else if (c === 'PA') {
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#D21034';
    ctx.fillRect(w * 0.5, 0, w * 0.5, h * 0.5);
    ctx.fillStyle = '#005293';
    ctx.fillRect(0, h * 0.5, w * 0.5, h * 0.5);
  } else if (c === 'CO') {
    ctx.fillStyle = '#FCD116';
    ctx.fillRect(0, 0, w, h * 0.5);
    ctx.fillStyle = '#003893';
    ctx.fillRect(0, h * 0.5, w, h * 0.25);
    ctx.fillStyle = '#CE1126';
    ctx.fillRect(0, h * 0.75, w, h * 0.25);
  } else if (c === 'KZ') {
    ctx.fillStyle = '#00AFCA';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#FEC50C';
    ctx.beginPath();
    ctx.arc(w * 0.52, h * 0.48, h * 0.18, 0, Math.PI * 2);
    ctx.fill();
  } else if (c === 'RU') {
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, w, h / 3);
    ctx.fillStyle = '#0039A6';
    ctx.fillRect(0, h / 3, w, h / 3);
    ctx.fillStyle = '#D52B1E';
    ctx.fillRect(0, (2 * h) / 3, w, h / 3);
  } else if (c === 'US') {
    for (let s = 0; s < 7; s++) {
      ctx.fillStyle = s % 2 === 0 ? '#B22234' : '#FFFFFF';
      ctx.fillRect(0, (s * h) / 7, w, h / 7 + 1);
    }
    ctx.fillStyle = '#3C3B6E';
    ctx.fillRect(0, 0, w * 0.45, h * 0.54);
  } else if (c === 'CL') {
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, w, h * 0.5);
    ctx.fillStyle = '#D52B1E';
    ctx.fillRect(0, h * 0.5, w, h * 0.5);
    ctx.fillStyle = '#0039A6';
    ctx.fillRect(0, 0, w * 0.38, h * 0.5);
  } else if (c === 'DE') {
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, w, h / 3);
    ctx.fillStyle = '#DD0000';
    ctx.fillRect(0, h / 3, w, h / 3);
    ctx.fillStyle = '#FFCE00';
    ctx.fillRect(0, (2 * h) / 3, w, h / 3);
  } else if (c === 'IT') {
    ctx.fillStyle = '#009246';
    ctx.fillRect(0, 0, w / 3, h);
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(w / 3, 0, w / 3, h);
    ctx.fillStyle = '#CE2B37';
    ctx.fillRect((2 * w) / 3, 0, w / 3, h);
  } else {
    ctx.fillStyle = '#1E293B';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#F59E0B';
    ctx.fillRect(0, h * 0.4, w, h * 0.2);
  }

  ctx.restore();
  ctx.strokeStyle = 'rgba(255,255,255,0.9)';
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.roundRect(x - w / 2, y - h / 2, w, h, 6);
  ctx.stroke();
}

function drawSubtitles(
  ctx: RenderCtx2D,
  project: MapProject,
  timeMs: number,
  width: number,
  height: number,
) {
  if (!project.showSubtitles) return;
  const track = project.subtitleTracks.find((t) => t.languageCode === project.activeLanguageCode) || project.subtitleTracks[0];
  if (!track || track.words.length === 0) return;

  // Resolve spoken word aligned directly with audio-locked currentTimeMs
  const words: WordTiming[] = track.words;
  let activeIdx = words.findIndex((w) => timeMs >= w.startMs && timeMs <= w.endMs);
  let inGap = false;
  if (activeIdx === -1) {
    inGap = true;
    const nextIdx = words.findIndex((w) => w.startMs > timeMs);
    if (nextIdx === -1) {
      if (timeMs > words[words.length - 1].endMs + 750) return;
      activeIdx = words.length - 1;
    } else if (nextIdx === 0) {
      if (timeMs < words[0].startMs - 180) return;
      activeIdx = 0;
    } else {
      // During short pauses inside a phrase, hold the just-spoken word index without jumping
      const prevEnd = words[nextIdx - 1].endMs;
      const nextStart = words[nextIdx].startMs;
      if (timeMs - prevEnd < 520 || nextStart - timeMs > 280) {
        activeIdx = nextIdx - 1;
      } else {
        activeIdx = nextIdx;
      }
    }
  }

  const chunkSize = 3;
  const chunkStart = Math.floor(activeIdx / chunkSize) * chunkSize;
  const chunk = words.slice(chunkStart, chunkStart + chunkSize);
  if (chunk.length === 0) return;

  const style = project.subtitleStyle;
  const scaleFactor = width / 1080;
  let fontSize = Math.round((style.fontSize || 46) * 1.1 * scaleFactor);
  const y = height * (style.positionY || 0.77);
  const chosenFont = style.fontFamily || 'Plus Jakarta Sans';
  const fontStack = `"${chosenFont}", "Plus Jakarta Sans", "Oswald", sans-serif`;

  ctx.save();
  ctx.textBaseline = 'middle';
  ctx.direction = track.rtl ? 'rtl' : 'ltr';

  const renderedWords = chunk.map((w, idx) => {
    const globalIdx = chunkStart + idx;
    const isActive = !inGap && timeMs >= w.startMs && timeMs <= w.endMs;
    return {
      ...w,
      label: style.uppercase ? w.word.toUpperCase() : w.word,
      isActive,
      isPast: globalIdx < activeIdx || (!isActive && timeMs > w.endMs),
    };
  });

  // Fit phrase safely inside 86% canvas width (zero background box)
  ctx.font = `800 ${fontSize}px ${fontStack}`;
  let spaceW = ctx.measureText(' ').width * 1.16;
  let wordWidths = renderedWords.map((rw) => ctx.measureText(rw.label).width);
  let totalWidth = wordWidths.reduce((acc, v) => acc + v, 0) + spaceW * Math.max(0, renderedWords.length - 1);
  const maxAllowedW = width * 0.86;
  if (totalWidth > maxAllowedW && totalWidth > 0) {
    const shrink = maxAllowedW / totalWidth;
    fontSize = Math.max(18, Math.floor(fontSize * shrink));
    ctx.font = `800 ${fontSize}px ${fontStack}`;
    spaceW = ctx.measureText(' ').width * 1.16;
    wordWidths = renderedWords.map((rw) => ctx.measureText(rw.label).width);
    totalWidth = wordWidths.reduce((acc, v) => acc + v, 0) + spaceW * Math.max(0, renderedWords.length - 1);
  }

  let cursorX = track.rtl ? width / 2 + totalWidth / 2 : width / 2 - totalWidth / 2;
  const baseTextColor = style.textColor || '#FFFFFF';
  const accentColor = style.highlightColor || '#FACC15';

  for (let i = 0; i < renderedWords.length; i++) {
    const rw = renderedWords[i];
    const wWidth = wordWidths[i];
    const wordCenterX = track.rtl ? cursorX - wWidth / 2 : cursorX + wWidth / 2;

    ctx.save();
    ctx.translate(wordCenterX, y);
    ctx.textAlign = 'center';

    if (rw.isActive) {
      // Highlight current spoken word sharply in bright accent color without scale jitter
      ctx.globalAlpha = 1;
      ctx.fillStyle = accentColor;
      ctx.shadowColor = 'rgba(0, 0, 0, 0.94)';
      ctx.shadowBlur = 16 * scaleFactor;
      ctx.shadowOffsetY = 3.5 * scaleFactor;
    } else if (rw.isPast) {
      ctx.globalAlpha = 0.96;
      ctx.fillStyle = baseTextColor;
      ctx.shadowColor = 'rgba(2, 6, 12, 0.9)';
      ctx.shadowBlur = 13 * scaleFactor;
      ctx.shadowOffsetY = 3 * scaleFactor;
    } else {
      ctx.globalAlpha = 0.78;
      ctx.fillStyle = baseTextColor;
      ctx.shadowColor = 'rgba(2, 6, 12, 0.88)';
      ctx.shadowBlur = 12 * scaleFactor;
      ctx.shadowOffsetY = 3 * scaleFactor;
    }

    drawOutlinedText(ctx, rw.label, 0, 0, Math.max(5.8 * scaleFactor, fontSize * 0.175), 'rgba(4, 8, 15, 0.96)');
    ctx.restore();

    if (track.rtl) {
      cursorX -= wWidth + spaceW;
    } else {
      cursorX += wWidth + spaceW;
    }
  }
  ctx.restore();
}

let motionAccumSurface: RenderSurface | null = null;
let motionSubSurface: RenderSurface | null = null;
let baseLayerSurface: RenderSurface | null = null;
let overlayLayerSurface: RenderSurface | null = null;
let bloomSurfaceCache: RenderSurface | null = null;
let lastBaseLayerKey = '';

function applyCinematicVignetteAndBloom(
  ctx: RenderCtx2D,
  project: MapProject,
  overlaySource: RenderSurface | null,
  width: number,
  height: number,
  tier: RenderQualityTier,
  applyBloomUnderStageTransform: boolean,
) {
  // 1. Soft Optical Bloom on high-contrast overlay elements (highlighted borders, glowing routes, beacons)
  if (applyBloomUnderStageTransform && overlaySource && tier !== 'fast') {
    const glowEnabled = project.glowingEdge?.enabled !== false;
    const glowIntensity = project.glowingEdge?.intensity ?? 1.4;
    if (glowEnabled && glowIntensity > 0.05) {
      const bloomScale = tier === 'full' ? 0.28 : 0.2;
      const bw = Math.max(120, Math.round(width * bloomScale));
      const bh = Math.max(210, Math.round(height * bloomScale));
      bloomSurfaceCache = ensureSurfaceSize(bloomSurfaceCache, bw, bh);
      const bctx = getSurfaceCtx2D(bloomSurfaceCache);

      if (bctx && bloomSurfaceCache) {
        bctx.clearRect(0, 0, bw, bh);
        bctx.save();
        const blurPx = (tier === 'full' ? 7.5 : 4.2) * (bw / 302);
        bctx.filter = `blur(${blurPx.toFixed(1)}px) brightness(1.18)`;
        bctx.drawImage(overlaySource, 0, 0, bw, bh);
        bctx.restore();

        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = Math.min(0.42, 0.14 + glowIntensity * 0.11);
        ctx.drawImage(bloomSurfaceCache, 0, 0, width, height);
        ctx.restore();
      }
    }
  }
}

function drawDirectionalLensVignette(
  ctx: RenderCtx2D,
  project: MapProject,
  width: number,
  height: number,
) {
  const theme = THEME_PRESETS[project.themePreset] || THEME_PRESETS['vox-tactical'];
  const strength = Math.max(0.25, Math.min(1, theme.vignetteStrength ?? 0.38));

  ctx.save();
  // Top subtle lens framing falloff
  const topGrad = ctx.createLinearGradient(0, 0, 0, height * 0.24);
  topGrad.addColorStop(0, `rgba(4, 8, 15, ${(0.34 * strength + 0.14).toFixed(3)})`);
  topGrad.addColorStop(0.55, `rgba(4, 8, 15, ${(0.12 * strength).toFixed(3)})`);
  topGrad.addColorStop(1, 'rgba(4, 8, 15, 0)');
  ctx.fillStyle = topGrad;
  ctx.fillRect(0, 0, width, height * 0.24);

  // Bottom subtle lens framing falloff (boosts unboxed caption legibility while leaving map center bright)
  const botGrad = ctx.createLinearGradient(0, height * 0.68, 0, height);
  botGrad.addColorStop(0, 'rgba(4, 8, 15, 0)');
  botGrad.addColorStop(0.52, `rgba(4, 8, 15, ${(0.18 * strength).toFixed(3)})`);
  botGrad.addColorStop(1, `rgba(4, 8, 15, ${(0.44 * strength + 0.18).toFixed(3)})`);
  ctx.fillStyle = botGrad;
  ctx.fillRect(0, height * 0.68, width, height * 0.32);

  // Vintage parchment paper warmth (when selected)
  if (project.themePreset === 'vintage-parchment') {
    ctx.fillStyle = 'rgba(120, 82, 34, 0.08)';
    ctx.fillRect(0, 0, width, height);
  }
  ctx.restore();
}

function hasSignificantShutterMotion(project: MapProject, timeMs: number, shutterSpanMs: number): boolean {
  const t0 = Math.max(0, timeMs - shutterSpanMs);
  const c0 = interpolateCamera(project, t0);
  const c1 = interpolateCamera(project, timeMs);

  const camDelta =
    Math.abs(c1.zoom - c0.zoom) * 18 +
    Math.hypot(c1.lat - c0.lat, c1.lng - c0.lng) * 0.9 +
    Math.abs(c1.pitch - c0.pitch) * 0.25 +
    Math.abs(c1.bearing - c0.bearing) * 0.35;

  if (camDelta > 0.12) return true;

  // Also trigger shutter blur for fast-moving routes, travelers, stamps, and pop-in pins
  for (const r of project.routes) {
    if (timeMs >= r.startMs && timeMs <= r.endMs && r.dashAnimation !== 'none') {
      return true;
    }
  }
  for (const ov of project.overlays) {
    if (timeMs >= ov.startMs && timeMs <= ov.endMs) {
      const elapsed = timeMs - ov.startMs;
      if (elapsed < 480 || ov.type === 'weather-rain' || ov.type === 'flow-network' || ov.type === 'data-diamonds') {
        return true;
      }
    }
  }
  return false;
}

function buildBaseLayerCacheKey(
  project: MapProject,
  cam: InterpolatedCamera,
  width: number,
  height: number,
  tier: RenderQualityTier,
): string {
  const hy = project.hybridMap;
  const dp = project.mapDepth;
  const gr = project.mapGrid;
  return [
    width,
    height,
    tier,
    project.themePreset,
    cam.lat.toFixed(4),
    cam.lng.toFixed(4),
    cam.zoom.toFixed(4),
    cam.pitch.toFixed(2),
    cam.bearing.toFixed(2),
    cam.globeMix.toFixed(3),
    cam.topoMix.toFixed(3),
    hy ? `${hy.enabled}:${hy.satelliteOpacity}:${hy.labelOpacity}:${hy.showBordersAndLabels}:${hy.showHighways}` : 'hy-def',
    dp ? `${dp.enabled}:${dp.exaggeration}:${dp.depthOfField}` : 'dp-off',
    gr ? `${gr.enabled}:${gr.stepDegrees}:${gr.showLabels}:${gr.highlightEquatorTropics}:${gr.opacity}` : 'gr-off',
    getTileCacheVersion(),
  ].join('|');
}

function renderStaticBaseLayer(
  ctx: RenderCtx2D,
  project: MapProject,
  cam: InterpolatedCamera,
  width: number,
  height: number,
  tier: RenderQualityTier,
  skipDof: boolean,
) {
  const theme = THEME_PRESETS[project.themePreset] || THEME_PRESETS['vox-tactical'];
  const countries = getWorldCountries();
  const isGlobeView = cam.globeMix > 0.25;
  const fastPreview = tier !== 'full';

  ctx.clearRect(0, 0, width, height);

  // 1. Background (Space/Ocean/Parchment)
  if (isGlobeView) {
    const spaceGrad = ctx.createRadialGradient(width / 2, height * 0.42, width * 0.1, width / 2, height * 0.5, height * 0.85);
    spaceGrad.addColorStop(0, '#09233D');
    spaceGrad.addColorStop(0.55, '#040B14');
    spaceGrad.addColorStop(1, '#020408');
    ctx.fillStyle = spaceGrad;
    ctx.fillRect(0, 0, width, height);

    ctx.fillStyle = 'rgba(255,255,255,0.45)';
    for (let s = 0; s < 48; s++) {
      const sx = ((s * 239) % 1000) * (width / 1000);
      const sy = ((s * 617) % 1000) * (height / 1000);
      const sr = (s % 3) * 0.8 + 0.6;
      ctx.beginPath();
      ctx.arc(sx, sy, sr, 0, Math.PI * 2);
      ctx.fill();
    }

    const radius = Math.min(width, height) * 0.38 * Math.pow(1.28, cam.zoom - 1.7);
    ctx.save();
    ctx.shadowColor = 'rgba(56, 189, 248, 0.45)';
    ctx.shadowBlur = tier === 'fast' ? 20 : 45;
    const sphereGrad = ctx.createRadialGradient(
      width / 2 - radius * 0.25,
      height / 2 - radius * 0.25,
      radius * 0.15,
      width / 2,
      height / 2,
      radius,
    );
    sphereGrad.addColorStop(0, '#0F4C75');
    sphereGrad.addColorStop(0.7, theme.oceanTop);
    sphereGrad.addColorStop(1, '#030D1A');
    ctx.fillStyle = sphereGrad;
    ctx.beginPath();
    ctx.arc(width / 2, height / 2, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  } else {
    const bgGrad = ctx.createLinearGradient(0, 0, 0, height);
    bgGrad.addColorStop(0, theme.oceanTop);
    bgGrad.addColorStop(1, theme.oceanBottom);
    ctx.fillStyle = bgGrad;
    ctx.fillRect(0, 0, width, height);
  }

  // 2. Base World Landmasses (cull offscreen countries & skip vector fill when opaque satellite tiles already cover screen)
  const hybridEnabled = project.hybridMap?.enabled !== false;
  const mercGrid: MercatorTileGridInfo | null =
    hybridEnabled && cam.globeMix < 0.98 ? computeMercatorTileGrid(cam, width, height) : null;
  const imageryReady = mercGrid ? areViewportTilesReady(cam.topoMix > 0.5 ? 'topo' : 'imagery', mercGrid) : false;

  let viewBox: GeoBbox | null = null;
  if (cam.globeMix < 0.25 && cam.zoom >= 2.1) {
    const spanLng = Math.min(175, (360 / Math.pow(2, cam.zoom)) * 1.4);
    const spanLat = Math.min(82, spanLng * (height / Math.max(1, width)) * 0.98);
    viewBox = {
      minLat: cam.lat - spanLat,
      maxLat: cam.lat + spanLat,
      minLng: cam.lng - spanLng,
      maxLng: cam.lng + spanLng,
    };
  }

  if (!hybridEnabled || cam.globeMix > 0.05 || !imageryReady) {
    ctx.save();
    if (hybridEnabled) {
      ctx.globalAlpha = 0.22;
    }
    ctx.fillStyle = theme.landFill;
    ctx.strokeStyle = theme.landStroke;
    ctx.lineWidth = 1.1;
    for (const country of countries) {
      if (viewBox) {
        const b = country.bbox;
        const wrapsAnti = viewBox.minLng < -180 || viewBox.maxLng > 180;
        if (!wrapsAnti && (b.maxLat < viewBox.minLat || b.minLat > viewBox.maxLat || b.maxLng < viewBox.minLng || b.minLng > viewBox.maxLng)) {
          continue;
        }
      }
      const res = drawPolygonRings(ctx, country.rings, cam, width, height);
      if (!res.drawn) continue;
      ctx.fill();
      ctx.stroke();
    }
    ctx.restore();
  }

  // 2b. Clean Satellite Base (Satellite Imagery + Terrain Hillshade + Optional Opt-in Overlays)
  if (hybridEnabled) {
    if (mercGrid && cam.globeMix < 0.98) {
      renderMercatorHybridTiles(ctx, project, cam, mercGrid, width, height, 1 - cam.globeMix, tier);
    }
    if (cam.globeMix > 0.02) {
      renderGlobeHybridSurface(ctx, project, cam, width, height, cam.globeMix, tier);
    }
    applyThemeSatelliteGrade(ctx, project, cam, width, height);

    // Draw crisp 1:10m vector national borders cleanly over satellite without any noisy village/code clutter
    if (project.hybridMap?.showBordersAndLabels !== true && cam.topoMix < 0.72) {
      const scaleFactor = width / 1080;
      const isParchment = project.themePreset === 'vintage-parchment';
      const minStepPx = tier === 'fast' ? 2.4 : 1.15;
      ctx.save();
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      ctx.beginPath();

      for (const country of countries) {
        if (viewBox) {
          const b = country.bbox;
          const wrapsAnti = viewBox.minLng < -180 || viewBox.maxLng > 180;
          if (!wrapsAnti && (b.maxLat < viewBox.minLat || b.minLat > viewBox.maxLat || b.maxLng < viewBox.minLng || b.minLng > viewBox.maxLng)) {
            continue;
          }
        }
        for (const ring of country.rings) {
          if (ring.length < 3) continue;
          let started = false;
          let prevX = 0;
          let prevY = 0;
          for (let i = 0; i < ring.length; i++) {
            const p = projectPoint(ring[i], cam, width, height);
            if (!p.visible) {
              started = false;
              continue;
            }
            if (!started) {
              ctx.moveTo(p.x, p.y);
              prevX = p.x;
              prevY = p.y;
              started = true;
            } else if (Math.hypot(p.x - prevX, p.y - prevY) >= minStepPx) {
              ctx.lineTo(p.x, p.y);
              prevX = p.x;
              prevY = p.y;
            }
          }
          if (started) ctx.closePath();
        }
      }

      if (!isParchment && tier !== 'fast') {
        ctx.strokeStyle = 'rgba(2, 6, 14, 0.36)';
        ctx.lineWidth = Math.max(1.4, 2.2 * scaleFactor);
        ctx.stroke();
      }
      ctx.strokeStyle = isParchment ? 'rgba(72, 52, 34, 0.42)' : 'rgba(255, 255, 255, 0.34)';
      ctx.lineWidth = Math.max(0.85, 1.15 * scaleFactor);
      ctx.stroke();
      ctx.restore();
    }
  }

  // 2c. Documentary Depth of Field & Atmospheric Horizon Relief (Map Depth or Topo Paper Sheet)
  if ((project.mapDepth?.enabled || cam.topoMix > 0.2) && !isGlobeView && !skipDof) {
    applyDocumentaryMapDepth(ctx, project, cam, width, height, tier);
  }

  // Optional cartographic lat/lng graticule (only rendered when explicitly enabled)
  drawMapGrid(ctx, project, cam, width, height, theme.accentColor, fastPreview);
}

export function renderMapFrame(
  ctx: RenderCtx2D,
  project: MapProject,
  timeMs: number,
  width: number,
  height: number,
  options: {
    includeSafeZones?: boolean;
    previewPlayback?: boolean;
    useLayeredOffscreen?: boolean;
    qualityTier?: RenderQualityTier;
    _skipMotionBlur?: boolean;
    _skipSubtitles?: boolean;
    _fastShutterSample?: boolean;
  } = {},
) {
  const tier: RenderQualityTier = options.qualityTier ?? (options.previewPlayback ? 'balanced' : 'full');
  const blurCfg = project.motionBlur;
  const blurEnabled = blurCfg ? blurCfg.enabled : true;

  // Cinematic Shutter Motion Blur Post-Processing Pass (active on full quality paused/export frames; bypassed on live 60fps playback)
  if (!options._skipMotionBlur && tier === 'full' && blurEnabled) {
    const shutterAngle = Math.max(45, Math.min(360, blurCfg?.shutterAngle ?? 180));
    const sampleCount = Math.max(3, Math.min(7, blurCfg?.samples ?? 4));
    const shutterSpanMs = (1000 / Math.max(24, project.fps || 30)) * (shutterAngle / 180) * 1.45;

    if (hasSignificantShutterMotion(project, timeMs, shutterSpanMs)) {
      motionAccumSurface = ensureSurfaceSize(motionAccumSurface, width, height);
      motionSubSurface = ensureSurfaceSize(motionSubSurface, width, height);
      const accCtx = getSurfaceCtx2D(motionAccumSurface);
      const subCtx = getSurfaceCtx2D(motionSubSurface);

      if (accCtx && subCtx && motionAccumSurface && motionSubSurface) {
        accCtx.clearRect(0, 0, width, height);

        for (let s = 0; s < sampleCount; s++) {
          const isFinal = s === sampleCount - 1;
          const frac = s / (sampleCount - 1);
          const sampleTime = Math.max(0, timeMs - (1 - frac) * shutterSpanMs);

          renderMapFrame(subCtx, project, sampleTime, width, height, {
            includeSafeZones: false,
            useLayeredOffscreen: options.useLayeredOffscreen,
            qualityTier: 'full',
            _skipMotionBlur: true,
            _skipSubtitles: true,
            _fastShutterSample: !isFinal,
          });

          accCtx.save();
          accCtx.globalAlpha = s === 0 ? 1 : isFinal ? 0.56 : 1 / (s + 1.25);
          accCtx.drawImage(motionSubSurface, 0, 0);
          accCtx.restore();
        }

        ctx.clearRect(0, 0, width, height);
        ctx.drawImage(motionAccumSurface, 0, 0);

        if (!options._skipSubtitles) {
          drawSubtitles(ctx, project, timeMs, width, height);
        }
        if (options.includeSafeZones && project.showSafeZones) {
          ctx.save();
          ctx.strokeStyle = 'rgba(245, 158, 11, 0.55)';
          ctx.setLineDash([8, 8]);
          ctx.lineWidth = 2;
          ctx.strokeRect(width * 0.05, height * 0.12, width * 0.81, height * 0.68);
          ctx.restore();
        }
        return;
      }
    }
  }

  const theme = THEME_PRESETS[project.themePreset] || THEME_PRESETS['vox-tactical'];
  const cam = interpolateCamera(project, timeMs);
  const activeOverlays = project.overlays.filter((ov) => timeMs >= ov.startMs && timeMs <= ov.endMs);
  const useOffscreenLayers = Boolean(options.useLayeredOffscreen);

  // Layer 1: Cached OffscreenCanvas Static Map & Hybrid Tiles Base Layer
  let drawnFromBaseCache = false;
  if (useOffscreenLayers) {
    baseLayerSurface = ensureSurfaceSize(baseLayerSurface, width, height);
    const baseCtx = getSurfaceCtx2D(baseLayerSurface);
    if (baseLayerSurface && baseCtx) {
      const nextKey = buildBaseLayerCacheKey(project, cam, width, height, tier);
      if (lastBaseLayerKey !== nextKey) {
        renderStaticBaseLayer(baseCtx, project, cam, width, height, tier, Boolean(options._fastShutterSample));
        lastBaseLayerKey = nextKey;
      }
      drawnFromBaseCache = true;
    }
  }

  // Layer 2: Dynamic Overlays (rendered cleanly onto OffscreenCanvas surface or directly onto ctx)
  let overlayCtx: RenderCtx2D = ctx;
  let compositingOverlaySurface = false;
  if (useOffscreenLayers && drawnFromBaseCache) {
    overlayLayerSurface = ensureSurfaceSize(overlayLayerSurface, width, height);
    const candidateOverlayCtx = getSurfaceCtx2D(overlayLayerSurface);
    if (candidateOverlayCtx && overlayLayerSurface) {
      overlayCtx = candidateOverlayCtx;
      overlayCtx.clearRect(0, 0, width, height);
      compositingOverlaySurface = true;
    }
  }

  // If Layer 2 shares a separate OffscreenCanvas, draw Layer 2 contents into overlayCtx; otherwise base draws straight onto ctx
  if (!drawnFromBaseCache) {
    ctx.save();
    ctx.clearRect(0, 0, width, height);

    // Subtle impact micro-shake when stamps or red X barriers slam into the frame
    for (const ov of activeOverlays) {
      if (ov.type === 'stamp' || ov.type === 'cross-hazard') {
        const dt = timeMs - ov.startMs;
        if (dt >= 0 && dt < 220) {
          const decay = 1 - dt / 220;
          const amp = 7 * decay * (width / 1080);
          ctx.translate(Math.sin(dt * 0.14) * amp, Math.cos(dt * 0.19) * amp * 0.7);
          break;
        }
      }
    }

    // Handheld Documentary procedural micro-vibrations
    ctx.save();
    const handheldWeights = getHandheldMotionWeight(project, cam, timeMs, activeOverlays);
    if (handheldWeights > 0.005) {
      const tSec = timeMs * 0.001;
      const vibX =
        Math.sin(tSec * 17.3) * 0.55 + Math.sin(tSec * 31.7 + 1.2) * 0.3 + Math.cos(tSec * 53.1) * 0.15;
      const vibY =
        Math.cos(tSec * 19.1 + 0.7) * 0.55 + Math.sin(tSec * 37.3 + 2.1) * 0.3 + Math.sin(tSec * 47.9) * 0.15;
      const vibRot = Math.sin(tSec * 11.4 + 0.4) * 0.7 + Math.cos(tSec * 27.8) * 0.3;
      const scaleBias = 1 + 0.011 * handheldWeights;
      const pxAmp = 8.5 * handheldWeights * (width / 1080);
      const rotAmp = 0.0055 * handheldWeights;

      ctx.translate(width / 2 + vibX * pxAmp, height / 2 + vibY * pxAmp * 0.85);
      ctx.rotate(vibRot * rotAmp);
      ctx.scale(scaleBias, scaleBias);
      ctx.translate(-width / 2, -height / 2);
    }

    renderStaticBaseLayer(ctx, project, cam, width, height, tier, Boolean(options._fastShutterSample));
  }

  // 3. Gentle Optional Edge Focus Vignette (NEVER black out neighboring satellite countries or oceans)
  const activeMasks = project.regionMasks.filter((m) => timeMs >= m.startMs && timeMs <= m.endMs);
  const focusMasks = activeMasks.filter((m) => m.darkIsolationMask);
  if (focusMasks.length > 0) {
    const focusStart = Math.min(...focusMasks.map((m) => m.startMs));
    const focusFade = Math.min(1, (timeMs - focusStart) / 320);

    overlayCtx.save();
    const edgeFocus = overlayCtx.createRadialGradient(
      width * 0.5,
      height * 0.48,
      width * 0.34,
      width * 0.5,
      height * 0.5,
      height * 0.72,
    );
    edgeFocus.addColorStop(0, 'rgba(6, 9, 14, 0)');
    edgeFocus.addColorStop(1, `rgba(6, 9, 14, ${(0.22 * focusFade).toFixed(3)})`);
    overlayCtx.fillStyle = edgeFocus;
    overlayCtx.fillRect(0, 0, width, height);
    overlayCtx.restore();
  }

  // 4. Highlighted Region Masks (Light Translucent Tint so Satellite Terrain Shines Through + Exact-Perimeter Border Trace)
  const scaleFactor = width / 1080;
  for (const mask of activeMasks) {
    const feature = mask.customPolygon ? null : findRegionFeature(mask.regionName);
    const rings = mask.customPolygon ? [mask.customPolygon] : feature?.rings || null;
    if (!rings) continue;

    const fadeIn = Math.min(1, (timeMs - mask.startMs) / 280);
    const traceDur = mask.drawBorderDurationMs ?? 700;
    const borderProgress = Math.max(0.05, Math.min(1, (timeMs - mask.startMs) / traceDur));

    overlayCtx.save();
    overlayCtx.globalAlpha = fadeIn;

    const polyBounds = drawPolygonRings(overlayCtx, rings, cam, width, height);
    if (polyBounds.drawn) {
      if (mask.fillMode === 'hatched') {
        const pat = getHatchPattern(overlayCtx, mask.color);
        overlayCtx.fillStyle = pat || mask.color;
        overlayCtx.globalAlpha = pat ? fadeIn * 0.82 : fadeIn * 0.19;
      } else if (mask.fillMode === 'hazard-pulse') {
        const pulse = 0.16 + 0.11 * Math.sin(timeMs * 0.008);
        overlayCtx.fillStyle = mask.color;
        overlayCtx.globalAlpha = fadeIn * pulse;
      } else {
        overlayCtx.fillStyle = mask.color;
        overlayCtx.globalAlpha = fadeIn * 0.2;
      }
      overlayCtx.fill();

      // Exact-perimeter border trace so even jagged coastlines draw cleanly to 100% completion
      overlayCtx.globalAlpha = fadeIn;
      const exactPerimeter = Math.max(60, polyBounds.perimeterPx);
      if (borderProgress < 0.97) {
        overlayCtx.setLineDash([exactPerimeter * borderProgress, exactPerimeter * 2]);
      } else {
        overlayCtx.setLineDash([]);
      }

      const globalGlow = project.glowingEdge?.enabled ? Math.max(0.5, Math.min(2.5, project.glowingEdge.intensity ?? 1.5)) : 0;
      if (globalGlow > 0 || mask.borderGlow) {
        const glowStrength = globalGlow > 0 ? globalGlow : 0.85;
        overlayCtx.save();
        overlayCtx.globalCompositeOperation = 'lighter';
        overlayCtx.lineJoin = 'round';
        overlayCtx.lineCap = 'round';
        overlayCtx.strokeStyle = mask.borderColor || '#FFFFFF';
        if (tier !== 'fast') {
          overlayCtx.globalAlpha = fadeIn * Math.min(0.24, 0.1 + glowStrength * 0.08);
          overlayCtx.lineWidth = Math.max(8, (12 + glowStrength * 6) * scaleFactor);
          overlayCtx.stroke();
        }
        overlayCtx.globalAlpha = fadeIn * Math.min(0.42, 0.18 + glowStrength * 0.12);
        overlayCtx.lineWidth = Math.max(5, (6.5 + glowStrength * 2.4) * scaleFactor);
        overlayCtx.stroke();
        overlayCtx.restore();
      }

      overlayCtx.strokeStyle = mask.borderColor;
      overlayCtx.lineWidth = Math.max(2.2, 3.2 * scaleFactor);
      overlayCtx.stroke();
      overlayCtx.setLineDash([]);

      // Mainland Visual-Center Documentary Country Typography (never pushed off to distant islands or sides)
      if (mask.label) {
        let labelX = polyBounds.cx;
        let labelY = polyBounds.cy;
        let spanW = Math.max(70, polyBounds.maxX - polyBounds.minX);

        if (mask.centerOverride) {
          const ovPt = projectPoint(mask.centerOverride, cam, width, height);
          labelX = ovPt.x;
          labelY = ovPt.y;
        } else if (feature) {
          // Compute visible mainland span directly from mainlandRing so overseas islands never skew size or center
          let mlMinX = Infinity;
          let mlMaxX = -Infinity;
          let visSumX = 0;
          let visSumY = 0;
          let visCount = 0;
          for (const pt of feature.mainlandRing) {
            const sp = projectPoint(pt, cam, width, height);
            if (!sp.visible) continue;
            if (sp.x < mlMinX) mlMinX = sp.x;
            if (sp.x > mlMaxX) mlMaxX = sp.x;
            if (sp.x >= width * 0.04 && sp.x <= width * 0.96 && sp.y >= height * 0.06 && sp.y <= height * 0.9) {
              visSumX += sp.x;
              visSumY += sp.y;
              visCount += 1;
            }
          }
          if (Number.isFinite(mlMinX) && Number.isFinite(mlMaxX)) {
            spanW = Math.max(70, mlMaxX - mlMinX);
          }
          const anchor = projectPoint(feature.centroid, cam, width, height);
          const anchorOnScreen =
            anchor.visible &&
            anchor.x >= width * 0.06 &&
            anchor.x <= width * 0.94 &&
            anchor.y >= height * 0.08 &&
            anchor.y <= height * 0.88;
          if (anchorOnScreen) {
            labelX = anchor.x;
            labelY = anchor.y;
          } else if (visCount > 0) {
            labelX = Math.max(width * 0.14, Math.min(width * 0.86, visSumX / visCount));
            labelY = Math.max(height * 0.14, Math.min(height * 0.82, visSumY / visCount));
          } else if (anchor.visible) {
            labelX = anchor.x;
            labelY = anchor.y;
          }
        }

        const autoFontPx = Math.max(20, Math.min(50, spanW * 0.22)) * scaleFactor;
        const tilt = (mask.labelTiltDeg ?? -4) * DEG2RAD;

        overlayCtx.save();
        overlayCtx.translate(labelX, labelY);
        overlayCtx.rotate(tilt);
        overlayCtx.shadowColor = 'rgba(0,0,0,0.88)';
        overlayCtx.shadowBlur = tier === 'fast' ? 6 : 12;
        overlayCtx.shadowOffsetY = 3;
        overlayCtx.fillStyle = '#FFFFFF';
        overlayCtx.font = `800 ${Math.round(autoFontPx)}px "Plus Jakarta Sans", "${theme.defaultFont}", sans-serif`;
        overlayCtx.textAlign = 'center';
        overlayCtx.textBaseline = 'middle';
        drawOutlinedText(overlayCtx, mask.label, 0, 0, Math.max(3, autoFontPx * 0.12), 'rgba(0,0,0,0.72)');
        overlayCtx.restore();
      }
    }
    overlayCtx.restore();
  }

  // 5. Animated Routes & Vector Traveler Icons (Chaikin-smoothed + Variable Dash-Length Engine)
  for (const route of project.routes) {
    renderGeoRoute(overlayCtx, route, cam, timeMs, width, height, project.glowingEdge, tier);
  }

  // 6. Custom Overlays (Pin Stems, Distance Calls, Size Compare, Arrows, Stamps, Flags, Counters, Weather)
  for (const ov of activeOverlays) {
    const p = projectPoint({ lat: ov.lat, lng: ov.lng }, cam, width, height);
    if (!p.visible) continue;
    const pop = springPop(timeMs - ov.startMs);
    const scale = (ov.scale || 1) * pop * scaleFactor;
    const ctx = overlayCtx;

    if (ov.type === 'distance-call' && typeof ov.targetLat === 'number' && typeof ov.targetLng === 'number') {
      const tPt = projectPoint({ lat: ov.targetLat, lng: ov.targetLng }, cam, width, height);
      if (tPt.visible) {
        const drawT = Math.min(1, (timeMs - ov.startMs) / 480);
        const curX = p.x + (tPt.x - p.x) * drawT;
        const curY = p.y + (tPt.y - p.y) * drawT;
        const ang = Math.atan2(tPt.y - p.y, tPt.x - p.x);

        ctx.save();
        ctx.strokeStyle = ov.accentColor || '#FACC15';
        ctx.lineWidth = 4.5 * scaleFactor;
        ctx.setLineDash([12 * scaleFactor, 9 * scaleFactor]);
        ctx.shadowColor = 'rgba(0,0,0,0.85)';
        ctx.shadowBlur = 10;
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(curX, curY);
        ctx.stroke();
        ctx.setLineDash([]);

        // Double arrowheads at ends
        const drawHead = (hx: number, hy: number, theta: number) => {
          ctx.save();
          ctx.translate(hx, hy);
          ctx.rotate(theta);
          ctx.fillStyle = ov.accentColor || '#FACC15';
          ctx.beginPath();
          ctx.moveTo(0, 0);
          ctx.lineTo(-14 * scaleFactor, -8 * scaleFactor);
          ctx.lineTo(-14 * scaleFactor, 8 * scaleFactor);
          ctx.closePath();
          ctx.fill();
          ctx.restore();
        };
        drawHead(p.x, p.y, ang + Math.PI);
        if (drawT > 0.2) drawHead(curX, curY, ang);

        // Rotated crisp outlined readout centered along span
        const mx = (p.x + curX) / 2;
        const my = (p.y + curY) / 2;
        let textAng = ang;
        if (textAng > Math.PI / 2 || textAng < -Math.PI / 2) textAng += Math.PI;
        ctx.save();
        ctx.translate(mx, my);
        ctx.rotate(textAng);
        ctx.fillStyle = '#FFFFFF';
        ctx.font = `800 ${Math.round(32 * scaleFactor)}px "Plus Jakarta Sans", sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom';
        drawOutlinedText(ctx, ov.text, 0, -12 * scaleFactor, 6 * scaleFactor, 'rgba(0,0,0,0.88)');
        if (ov.subtext) {
          ctx.font = `700 ${Math.round(22 * scaleFactor)}px "Plus Jakarta Sans", sans-serif`;
          drawOutlinedText(ctx, ov.subtext, 0, 26 * scaleFactor, 4 * scaleFactor, 'rgba(0,0,0,0.88)');
        }
        ctx.restore();
        ctx.restore();
      }
      continue;
    }

    if (ov.type === 'size-comparison') {
      const feature = findRegionFeature(ov.compareRegionName || ov.text || 'New York City');
      if (feature) {
        const slideT = applyEasing(Math.min(1, (timeMs - ov.startMs) / 520), 'expoOut');
        const shiftDegLng = ((1 - slideT) * -0.45);
        const cosScale = Math.max(0.25, Math.cos(feature.centroid.lat * DEG2RAD) / Math.cos(ov.lat * DEG2RAD));
        const shiftedRings: LatLng[][] = feature.rings.map((ring) =>
          ring.map((pt) => ({
            lat: ov.lat + (pt.lat - feature.centroid.lat),
            lng: ov.lng + (pt.lng - feature.centroid.lng) * cosScale + shiftDegLng,
          })),
        );
        ctx.save();
        ctx.globalAlpha = Math.min(1, (timeMs - ov.startMs) / 260);
        const bounds = drawPolygonRings(ctx, shiftedRings, cam, width, height);
        if (bounds.drawn) {
          ctx.fillStyle = ov.accentColor || '#38BDF8';
          ctx.globalAlpha = 0.36;
          ctx.fill();
          ctx.globalAlpha = 0.95;
          ctx.shadowColor = ov.accentColor || '#38BDF8';
          ctx.shadowBlur = 14 * scaleFactor;
          ctx.strokeStyle = '#E0F2FE';
          ctx.lineWidth = 3 * scaleFactor;
          ctx.stroke();

          ctx.fillStyle = '#FFFFFF';
          ctx.font = `800 ${Math.round(34 * scaleFactor)}px "Plus Jakarta Sans", sans-serif`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'bottom';
          drawOutlinedText(ctx, ov.text || feature.name, bounds.cx, bounds.minY - 12 * scaleFactor, 5 * scaleFactor);
        }
        ctx.restore();
      }
      continue;
    }

    if (ov.type === 'curved-arrow' && typeof ov.targetLat === 'number' && typeof ov.targetLng === 'number') {
      const tPt = projectPoint({ lat: ov.targetLat, lng: ov.targetLng }, cam, width, height);
      if (tPt.visible) {
        ctx.save();
        ctx.strokeStyle = ov.accentColor || '#FFFFFF';
        ctx.lineWidth = 6 * scaleFactor;
        ctx.lineCap = 'round';
        ctx.shadowColor = 'rgba(0,0,0,0.8)';
        ctx.shadowBlur = 10;
        const cpx = (p.x + tPt.x) / 2 - 40 * scaleFactor;
        const cpy = Math.min(p.y, tPt.y) - 65 * scaleFactor;
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
        ctx.quadraticCurveTo(cpx, cpy, tPt.x, tPt.y);
        ctx.stroke();
        const ang = Math.atan2(tPt.y - cpy, tPt.x - cpx);
        ctx.translate(tPt.x, tPt.y);
        ctx.rotate(ang);
        ctx.fillStyle = ov.accentColor || '#FFFFFF';
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(-22 * scaleFactor, -12 * scaleFactor);
        ctx.lineTo(-22 * scaleFactor, 12 * scaleFactor);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
      }
      continue;
    }

    ctx.save();
    ctx.translate(p.x, p.y);
    if (ov.rotationDeg) ctx.rotate(ov.rotationDeg * DEG2RAD);
    const activeScale = ov.type === 'pin-label' ? (ov.scale || 1) * scaleFactor : scale;
    ctx.scale(activeScale, activeScale);

    if (ov.type === 'pin-label') {
      const elapsed = timeMs - ov.startMs;
      const tailRemain = ov.endMs - timeMs;
      const outAlpha = tailRemain < 180 ? Math.max(0, tailRemain / 180) : 1;
      const ePop = elasticPop(elapsed, 460);
      const dropProgress = Math.min(1, elapsed / 260);
      const dropOffsetY = (1 - dropProgress * dropProgress) * -28;

      ctx.globalAlpha = outAlpha;

      if (elapsed >= 0 && elapsed < 520) {
        const ringT = elapsed / 520;
        ctx.save();
        ctx.strokeStyle = ov.accentColor || '#FACC15';
        ctx.globalAlpha = outAlpha * (1 - ringT) * 0.72;
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.arc(0, 0, 8 + ringT * 36, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }

      // Soft shrinking shadow drop as pin settles onto map surface
      const shRadX = 20 - 8 * dropProgress;
      const shRadY = 7 - 2.5 * dropProgress;
      const shGrad = ctx.createRadialGradient(0, 2, 1, 0, 2, shRadX);
      shGrad.addColorStop(0, `rgba(0, 0, 0, ${(0.3 + 0.45 * dropProgress).toFixed(2)})`);
      shGrad.addColorStop(1, 'rgba(0, 0, 0, 0)');
      ctx.fillStyle = shGrad;
      ctx.beginPath();
      ctx.ellipse(0, 2, shRadX, shRadY, 0, 0, Math.PI * 2);
      ctx.fill();

      // Elastic scale-up pin stem + glowing dot + outlined city label
      ctx.translate(0, dropOffsetY);
      ctx.scale(ePop, ePop);

      const stemH = 54;
      ctx.shadowColor = 'rgba(0,0,0,0.9)';
      ctx.shadowBlur = 14;
      ctx.shadowOffsetY = 6;

      ctx.strokeStyle = '#FFFFFF';
      ctx.lineWidth = 2.8;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(0, -stemH);
      ctx.stroke();

      ctx.fillStyle = ov.accentColor || '#FACC15';
      ctx.beginPath();
      ctx.arc(0, 0, 8.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#FFFFFF';
      ctx.lineWidth = 2.2;
      ctx.stroke();

      ctx.fillStyle = '#FFFFFF';
      ctx.font = `800 32px "Plus Jakarta Sans", sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'bottom';
      drawOutlinedText(ctx, ov.text, 0, -stemH - 8, 6, 'rgba(0,0,0,0.88)');
      if (ov.subtext) {
        ctx.fillStyle = '#E2E8F0';
        ctx.font = `600 20px "Plus Jakarta Sans", sans-serif`;
        drawOutlinedText(ctx, ov.subtext, 0, -stemH - 42, 4.5, 'rgba(0,0,0,0.88)');
      }
    } else if (ov.type === 'title-badge') {
      // Crisp editorial ribbon (tilted crimson strip for milestone tags OR clean outlined two-tone title)
      const isHighlightStrip = ov.accentColor === '#DC2626' || ov.accentColor === '#EF4444';
      if (isHighlightStrip && ov.text.split(' ').length <= 4) {
        ctx.font = `800 40px "Plus Jakarta Sans", sans-serif`;
        const tw = ctx.measureText(ov.text).width;
        ctx.shadowColor = 'rgba(0,0,0,0.72)';
        ctx.shadowBlur = 18;
        ctx.fillStyle = '#DC2626';
        ctx.fillRect(-tw / 2 - 22, -30, tw + 44, 60);
        ctx.fillStyle = '#FFFFFF';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(ov.text, 0, 1);
      } else {
        ctx.font = `800 46px "${theme.defaultFont}", sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = '#FFFFFF';
        ctx.shadowColor = ov.accentColor || 'rgba(0,0,0,0.85)';
        ctx.shadowBlur = 18;
        drawOutlinedText(ctx, ov.text, 0, 0, 7, 'rgba(0,0,0,0.88)');
      }
    } else if (ov.type === 'stat-counter') {
      const span = Math.max(1, ov.endMs - ov.startMs);
      const ct = Math.min(1, (timeMs - ov.startMs) / Math.min(2000, span));
      const from = ov.countFrom ?? 0;
      const to = ov.countTo ?? 100;
      const currentVal = Math.round(from + (to - from) * ct).toLocaleString();

      ctx.shadowColor = 'rgba(0,0,0,0.88)';
      ctx.shadowBlur = 18;
      ctx.fillStyle = ov.accentColor || '#FACC15';
      ctx.font = '900 84px "Plus Jakarta Sans", sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      drawOutlinedText(ctx, currentVal, 0, -10, 8, 'rgba(0,0,0,0.85)');

      if (ov.text) {
        ctx.fillStyle = '#FFFFFF';
        ctx.font = '700 26px "Plus Jakarta Sans", sans-serif';
        drawOutlinedText(ctx, ov.text, 0, 44, 5, 'rgba(0,0,0,0.85)');
      }
    } else if (ov.type === 'question-pin') {
      const count = ov.text.includes('???') ? 3 : 1;
      for (let q = 0; q < count; q++) {
        const qx = count === 3 ? (q - 1) * 48 : 0;
        const bounce = Math.sin(timeMs * 0.01 + q * 0.9) * 8;
        ctx.save();
        ctx.translate(qx, bounce);
        ctx.shadowColor = 'rgba(0,0,0,0.85)';
        ctx.shadowBlur = 12;
        ctx.fillStyle = ov.accentColor || '#FACC15';
        ctx.font = '900 68px "Oswald", sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        drawOutlinedText(ctx, '?', 0, 0, 6, 'rgba(0,0,0,0.85)');
        ctx.restore();
      }
      if (ov.subtext) {
        ctx.fillStyle = '#FFFFFF';
        ctx.font = '700 24px "Plus Jakarta Sans", sans-serif';
        ctx.textAlign = 'center';
        drawOutlinedText(ctx, ov.subtext, 0, 46, 5, 'rgba(0,0,0,0.85)');
      }
    } else if (ov.type === 'flag-card') {
      const sway = Math.sin(timeMs * 0.004) * 0.04;
      ctx.rotate(sway);
      drawFlagGraphic(ctx, ov.countryCode || 'ES', 0, -12, 114, 74);
      if (ov.text) {
        ctx.fillStyle = '#FFFFFF';
        ctx.font = '700 25px "Plus Jakarta Sans", sans-serif';
        ctx.textAlign = 'center';
        drawOutlinedText(ctx, ov.text, 0, 46, 5, 'rgba(0,0,0,0.88)');
      }
    } else if (ov.type === 'hazard-radar') {
      // Multi-hotspot expanding crimson radar clusters (matching reference gang/danger zones)
      const offsets = [
        { dx: 0, dy: 0, rScale: 1, phase: 0 },
        { dx: 38, dy: -26, rScale: 0.72, phase: 0.28 },
        { dx: -28, dy: -54, rScale: 0.56, phase: 0.55 },
        { dx: -16, dy: 44, rScale: 0.68, phase: 0.76 },
      ];
      const baseCol = ov.accentColor || '#EF4444';
      for (const spot of offsets) {
        const wave = (((timeMs - ov.startMs) / 1400) + spot.phase) % 1;
        for (let r = 0; r < 2; r++) {
          const w = (wave + r * 0.5) % 1;
          ctx.save();
          ctx.strokeStyle = baseCol;
          ctx.fillStyle = baseCol;
          ctx.globalAlpha = (1 - w) * 0.65;
          ctx.lineWidth = 3.5;
          ctx.beginPath();
          ctx.arc(spot.dx, spot.dy, (16 + w * 78) * spot.rScale, 0, Math.PI * 2);
          ctx.stroke();
          ctx.globalAlpha = (1 - w) * 0.16;
          ctx.fill();
          ctx.restore();
        }
        ctx.save();
        ctx.shadowColor = baseCol;
        ctx.shadowBlur = 18;
        ctx.fillStyle = baseCol;
        ctx.beginPath();
        ctx.arc(spot.dx, spot.dy, 12 * spot.rScale, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
      if (ov.text) {
        ctx.fillStyle = '#FFFFFF';
        ctx.font = '800 32px "Plus Jakarta Sans", sans-serif';
        ctx.textAlign = 'center';
        drawOutlinedText(ctx, ov.text, 0, 86, 5, 'rgba(0,0,0,0.88)');
      }
    } else if (ov.type === 'hazard-icon') {
      const elapsed = timeMs - ov.startMs;
      const tailRemain = ov.endMs - timeMs;
      const outAlpha = tailRemain < 180 ? Math.max(0, tailRemain / 180) : 1;
      const ePop = elasticPop(elapsed, 460);
      const kind: HazardIconKind = ov.hazardIcon || 'skull';
      ctx.save();
      ctx.globalAlpha = outAlpha;
      ctx.scale(ePop, ePop);
      drawHazardIconBadge(ctx, kind, ov.accentColor || '#EF4444', timeMs);
      if (ov.text) {
        ctx.fillStyle = '#FFFFFF';
        ctx.font = '800 28px "Plus Jakarta Sans", sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        drawOutlinedText(ctx, ov.text, 0, kind === 'skull' ? 68 : 54, 5, 'rgba(0,0,0,0.88)');
      }
      ctx.restore();
    } else if (ov.type === 'flow-network') {
      // Multi-branch converging white/cyan migrant/trade flow trails funneling through choke point
      const drawT = Math.min(1, (timeMs - ov.startMs) / 1400);
      const targetPt =
        typeof ov.targetLat === 'number' && typeof ov.targetLng === 'number'
          ? projectPoint({ lat: ov.targetLat, lng: ov.targetLng }, cam, width, height)
          : projectPoint({ lat: ov.lat + 8, lng: ov.lng - 8 }, cam, width, height);

      if (targetPt.visible) {
        const branches = [
          { dLat: -7.5, dLng: -3.5, bend: -45 },
          { dLat: -6.8, dLng: 2.8, bend: 35 },
          { dLat: -4.2, dLng: 6.4, bend: 55 },
          { dLat: -9.5, dLng: 5.2, bend: 20 },
          { dLat: -5.4, dLng: -6.2, bend: -55 },
        ];
        const invS = 1 / Math.max(0.25, activeScale);
        ctx.save();
        ctx.scale(invS, invS);
        ctx.translate(-p.x, -p.y);

        // Luminous green/cyan funnel flare at choke point
        const flare = ctx.createRadialGradient(p.x, p.y, 4, p.x, p.y, 75 * scaleFactor);
        flare.addColorStop(0, ov.accentColor || 'rgba(74, 222, 128, 0.72)');
        flare.addColorStop(1, 'rgba(74, 222, 128, 0)');
        ctx.fillStyle = flare;
        ctx.beginPath();
        ctx.arc(p.x, p.y, 75 * scaleFactor, 0, Math.PI * 2);
        ctx.fill();

        for (let b = 0; b < branches.length; b++) {
          const br = branches[b];
          const srcPt = projectPoint({ lat: ov.lat + br.dLat, lng: ov.lng + br.dLng }, cam, width, height);
          if (!srcPt.visible) continue;

          const cp1x = (srcPt.x + p.x) * 0.5 + br.bend * scaleFactor;
          const cp1y = (srcPt.y + p.y) * 0.5;
          const outBend = (b - 2) * 26 * scaleFactor;
          const cp2x = (p.x + targetPt.x) * 0.5 + outBend;
          const cp2y = (p.y + targetPt.y) * 0.5 - 24 * scaleFactor;

          ctx.save();
          ctx.strokeStyle = 'rgba(255, 255, 255, 0.85)';
          ctx.shadowColor = ov.accentColor || '#4ADE80';
          ctx.shadowBlur = 10 * scaleFactor;
          ctx.lineWidth = (2.4 + (b % 2) * 0.9) * scaleFactor;
          ctx.lineCap = 'round';
          const pathLen = Math.hypot(p.x - srcPt.x, p.y - srcPt.y) + Math.hypot(targetPt.x - p.x, targetPt.y - p.y);
          if (drawT < 0.99) {
            ctx.setLineDash([pathLen * drawT, pathLen * 2]);
          }
          ctx.beginPath();
          ctx.moveTo(srcPt.x, srcPt.y);
          ctx.quadraticCurveTo(cp1x, cp1y, p.x, p.y);
          ctx.quadraticCurveTo(cp2x, cp2y, targetPt.x, targetPt.y);
          ctx.stroke();

          // Traveling pulse packet
          const pulseFrac = ((timeMs - ov.startMs) * 0.00055 + b * 0.19) % 1;
          const onFirstHalf = pulseFrac < 0.5;
          const lt = onFirstHalf ? pulseFrac * 2 : (pulseFrac - 0.5) * 2;
          const ax = onFirstHalf ? srcPt.x : p.x;
          const ay = onFirstHalf ? srcPt.y : p.y;
          const bx = onFirstHalf ? cp1x : cp2x;
          const by = onFirstHalf ? cp1y : cp2y;
          const cx2 = onFirstHalf ? p.x : targetPt.x;
          const cy2 = onFirstHalf ? p.y : targetPt.y;
          const qx = (1 - lt) * (1 - lt) * ax + 2 * (1 - lt) * lt * bx + lt * lt * cx2;
          const qy = (1 - lt) * (1 - lt) * ay + 2 * (1 - lt) * lt * by + lt * lt * cy2;
          ctx.fillStyle = '#FFFFFF';
          ctx.beginPath();
          ctx.arc(qx, qy, 4.2 * scaleFactor, 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();
        }
        ctx.restore();
      }
    } else if (ov.type === 'data-diamonds') {
      // Sequential glowing cyan & red diamond data points popping inside terrain
      const elapsed = timeMs - ov.startMs;
      const pts = 18;
      for (let i = 0; i < pts; i++) {
        const delay = i * 95;
        if (elapsed < delay) continue;
        const dPop = elasticPop(elapsed - delay, 320);
        const angle = i * 2.39996;
        const rad = 18 + Math.sqrt(i + 1) * 24;
        const dx = Math.cos(angle) * rad * 0.95;
        const dy = Math.sin(angle) * rad * 1.15;
        const isCrimson = i % 5 === 3 || (elapsed > 1400 && i % 4 === 1);
        const col = isCrimson ? '#EF4444' : ov.accentColor || '#38BDF8';

        ctx.save();
        ctx.translate(dx, dy);
        ctx.rotate(Math.PI / 4);
        ctx.scale(dPop, dPop);
        ctx.shadowColor = col;
        ctx.shadowBlur = 14;
        ctx.fillStyle = col;
        ctx.fillRect(-7, -7, 14, 14);
        ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
        ctx.fillRect(-3, -3, 6, 6);
        ctx.restore();
      }
      if (ov.text) {
        ctx.fillStyle = '#FFFFFF';
        ctx.font = '800 28px "Plus Jakarta Sans", sans-serif';
        ctx.textAlign = 'center';
        drawOutlinedText(ctx, ov.text, 0, 128, 5, 'rgba(0,0,0,0.88)');
      }
    } else if (ov.type === 'stamp') {
      const slam = timeMs - ov.startMs < 220 ? 1.55 - 0.55 * ((timeMs - ov.startMs) / 220) : 1;
      ctx.scale(slam, slam);
      ctx.strokeStyle = ov.accentColor || '#DC2626';
      ctx.lineWidth = 7;
      ctx.fillStyle = 'rgba(220, 38, 38, 0.14)';
      ctx.beginPath();
      ctx.roundRect(-152, -52, 304, 104, 8);
      ctx.fill();
      ctx.stroke();
      ctx.lineWidth = 2;
      ctx.strokeRect(-142, -43, 284, 86);
      ctx.fillStyle = ov.accentColor || '#DC2626';
      ctx.font = '900 58px "Oswald", sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(ov.text.toUpperCase(), 0, 1);
    } else if (ov.type === 'cross-hazard') {
      const slam = timeMs - ov.startMs < 180 ? 1.45 - 0.45 * ((timeMs - ov.startMs) / 180) : 1;
      ctx.scale(slam, slam);
      ctx.shadowColor = '#EF4444';
      ctx.shadowBlur = 24;
      ctx.strokeStyle = '#FFFFFF';
      ctx.lineWidth = 22;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(-40, -40);
      ctx.lineTo(40, 40);
      ctx.moveTo(40, -40);
      ctx.lineTo(-40, 40);
      ctx.stroke();
      ctx.strokeStyle = '#EF4444';
      ctx.lineWidth = 14;
      ctx.stroke();
    } else if (ov.type === 'speech-bubble') {
      ctx.font = '700 28px "Plus Jakarta Sans", sans-serif';
      const tw = Math.max(220, ctx.measureText(ov.text).width + 44);
      ctx.shadowColor = 'rgba(0,0,0,0.5)';
      ctx.shadowBlur = 16;
      ctx.fillStyle = '#FFFFFF';
      ctx.beginPath();
      ctx.roundRect(-tw / 2, -62, tw, 76, 18);
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(-14, 12);
      ctx.lineTo(0, 34);
      ctx.lineTo(14, 12);
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.fillStyle = '#0F172A';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(ov.text, 0, -24);
    } else if (ov.type === 'weather-rain') {
      // Volumetric sunlit 3D cumulus cloud cluster drifting smoothly with ground shadow + falling rain streaks
      const elapsed = timeMs - ov.startMs;
      const driftX = Math.sin(elapsed * 0.0007) * 24;
      const driftY = Math.cos(elapsed * 0.0005) * 6;
      ctx.save();
      ctx.translate(driftX, driftY);

      // Soft dark cloud shadow cast onto jungle terrain below
      const shGrad = ctx.createRadialGradient(6, 56, 8, 6, 56, 110);
      shGrad.addColorStop(0, 'rgba(0, 0, 0, 0.36)');
      shGrad.addColorStop(1, 'rgba(0, 0, 0, 0)');
      ctx.fillStyle = shGrad;
      ctx.beginPath();
      ctx.ellipse(6, 56, 108, 36, 0, 0, Math.PI * 2);
      ctx.fill();

      // Slanted glistening diagonal rain streaks below the clouds
      ctx.strokeStyle = 'rgba(186, 230, 253, 0.72)';
      ctx.lineWidth = 2.2;
      ctx.lineCap = 'round';
      for (let i = 0; i < 24; i++) {
        const lane = ((i % 8) - 3.5) * 24;
        const speedOffset = ((elapsed * 0.24) + i * 19) % 86;
        const rx = lane - speedOffset * 0.18;
        const ry = -6 + speedOffset;
        ctx.globalAlpha = Math.max(0.15, 0.85 - speedOffset / 96);
        ctx.beginPath();
        ctx.moveTo(rx, ry);
        ctx.lineTo(rx - 7, ry + 22);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;

      // Multi-puff sunlit cumulus clouds (two staggered clusters)
      const puffs = [
        { x: -46, y: -12, r: 30 },
        { x: -12, y: -28, r: 42 },
        { x: 28, y: -22, r: 36 },
        { x: 58, y: -6, r: 26 },
        { x: -16, y: -2, r: 28 },
        { x: 24, y: 2, r: 28 },
      ];
      ctx.save();
      ctx.shadowColor = 'rgba(0, 0, 0, 0.28)';
      ctx.shadowBlur = 16;
      ctx.shadowOffsetY = 8;
      for (const pf of puffs) {
        const cGrad = ctx.createRadialGradient(pf.x - pf.r * 0.25, pf.y - pf.r * 0.35, pf.r * 0.15, pf.x, pf.y, pf.r);
        cGrad.addColorStop(0, '#FFFFFF');
        cGrad.addColorStop(0.65, '#F1F5F9');
        cGrad.addColorStop(1, '#CBD5E1');
        ctx.fillStyle = cGrad;
        ctx.beginPath();
        ctx.arc(pf.x, pf.y, pf.r, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
      ctx.restore();
    }

    overlayCtx.restore();
  }

  // 7. Cinematic Post-Processing (Composite Layer 1 + Layer 2 -> Soft Border Bloom -> Subtle Top-Bottom Lens Vignette)
  if (compositingOverlaySurface && baseLayerSurface && overlayLayerSurface) {
    // Composite Layer 1 (Offscreen Static Map Tiles) + Layer 2 (Offscreen Overlays) under handheld/stamp stage transform
    ctx.save();
    ctx.clearRect(0, 0, width, height);

    for (const ov of activeOverlays) {
      if (ov.type === 'stamp' || ov.type === 'cross-hazard') {
        const dt = timeMs - ov.startMs;
        if (dt >= 0 && dt < 220) {
          const decay = 1 - dt / 220;
          const amp = 7 * decay * (width / 1080);
          ctx.translate(Math.sin(dt * 0.14) * amp, Math.cos(dt * 0.19) * amp * 0.7);
          break;
        }
      }
    }

    ctx.save();
    const handheldWeights = getHandheldMotionWeight(project, cam, timeMs, activeOverlays);
    if (handheldWeights > 0.005) {
      const tSec = timeMs * 0.001;
      const vibX =
        Math.sin(tSec * 17.3) * 0.55 + Math.sin(tSec * 31.7 + 1.2) * 0.3 + Math.cos(tSec * 53.1) * 0.15;
      const vibY =
        Math.cos(tSec * 19.1 + 0.7) * 0.55 + Math.sin(tSec * 37.3 + 2.1) * 0.3 + Math.sin(tSec * 47.9) * 0.15;
      const vibRot = Math.sin(tSec * 11.4 + 0.4) * 0.7 + Math.cos(tSec * 27.8) * 0.3;
      const scaleBias = 1 + 0.014 * handheldWeights;
      const pxAmp = 8.5 * handheldWeights * (width / 1080);
      const rotAmp = 0.0055 * handheldWeights;

      ctx.translate(width / 2 + vibX * pxAmp, height / 2 + vibY * pxAmp * 0.85);
      ctx.rotate(vibRot * rotAmp);
      ctx.scale(scaleBias, scaleBias);
      ctx.translate(-width / 2, -height / 2);
    }

    ctx.drawImage(baseLayerSurface, 0, 0, width, height);
    ctx.drawImage(overlayLayerSurface, 0, 0, width, height);
    applyCinematicVignetteAndBloom(ctx, project, overlayLayerSurface, width, height, tier, true);
    ctx.restore();
  } else {
    // End handheld camera transform opened on direct render path
    ctx.restore();
  }

  // Subtle top-bottom directional lens vignette across final framed stage
  drawDirectionalLensVignette(ctx, project, width, height);

  // 8. Word-by-Word Kinetic Documentary Subtitles (tack-sharp & unboxed)
  if (!options._skipSubtitles) {
    drawSubtitles(ctx, project, timeMs, width, height);
  }

  // 9. Optional Preview Safe-Zone Guide (clean frame box only, zero text labels)
  if (options.includeSafeZones && project.showSafeZones) {
    ctx.save();
    ctx.strokeStyle = 'rgba(245, 158, 11, 0.5)';
    ctx.setLineDash([8, 8]);
    ctx.lineWidth = 2;
    ctx.strokeRect(width * 0.05, height * 0.12, width * 0.81, height * 0.68);
    ctx.restore();
  }

  ctx.restore();
}

interface ScreenPoint {
  x: number;
  y: number;
}

interface ScreenSegment {
  pts: ScreenPoint[];
  cumLengths: number[];
  totalPx: number;
}

function subdivideCentripetalCatmullRom(pts: ScreenPoint[]): ScreenPoint[] {
  if (pts.length < 3) return pts;
  const out: ScreenPoint[] = [pts[0]];
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[Math.min(pts.length - 1, i + 2)];
    const segPx = Math.hypot(p2.x - p1.x, p2.y - p1.y);
    const steps = Math.max(5, Math.min(20, Math.ceil(segPx / 12)));
    for (let s = 1; s <= steps; s++) {
      const u = s / steps;
      out.push(evalCentripetalCatmullRom2D(p0.x, p0.y, p1.x, p1.y, p2.x, p2.y, p3.x, p3.y, u));
    }
  }
  return out;
}

function buildRouteScreenSegments(
  route: GeoRoute,
  cam: InterpolatedCamera,
  width: number,
  height: number,
): { segments: ScreenSegment[]; totalPx: number } {
  const rawRuns: ScreenPoint[][] = [];

  if (route.style === 'arc' && route.points.length === 2) {
    const p0 = projectPoint(route.points[0], cam, width, height);
    const p1 = projectPoint(route.points[1], cam, width, height);
    if (p0.visible || p1.visible) {
      const midX = (p0.x + p1.x) / 2 + (p1.y - p0.y) * 0.16;
      const midY = (p0.y + p1.y) / 2 - Math.abs(p1.x - p0.x) * 0.16 - 55 * (width / 1080);
      const steps = 64;
      const arcPts: ScreenPoint[] = [];
      for (let s = 0; s <= steps; s++) {
        const t = s / steps;
        arcPts.push({
          x: (1 - t) * (1 - t) * p0.x + 2 * (1 - t) * t * midX + t * t * p1.x,
          y: (1 - t) * (1 - t) * p0.y + 2 * (1 - t) * t * midY + t * t * p1.y,
        });
      }
      rawRuns.push(arcPts);
    }
  } else {
    let currentRun: ScreenPoint[] = [];
    for (const pt of route.points) {
      const p = projectPoint(pt, cam, width, height);
      if (!p.visible) {
        if (currentRun.length >= 2) rawRuns.push(subdivideCentripetalCatmullRom(currentRun));
        currentRun = [];
      } else {
        currentRun.push({ x: p.x, y: p.y });
      }
    }
    if (currentRun.length >= 2) rawRuns.push(subdivideCentripetalCatmullRom(currentRun));
  }

  const segments: ScreenSegment[] = [];
  let totalPx = 0;

  for (const pts of rawRuns) {
    if (pts.length < 2) continue;
    const cumLengths: number[] = [0];
    let acc = 0;
    for (let i = 1; i < pts.length; i++) {
      acc += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
      cumLengths.push(acc);
    }
    if (acc > 0.25) {
      segments.push({ pts, cumLengths, totalPx: acc });
      totalPx += acc;
    }
  }

  return { segments, totalPx };
}

function traceScreenSegments(ctx: RenderCtx2D, runs: ScreenPoint[][]) {
  ctx.beginPath();
  for (const pts of runs) {
    if (pts.length < 2) continue;
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) {
      ctx.lineTo(pts[i].x, pts[i].y);
    }
  }
}

function truncateScreenSegments(
  segments: ScreenSegment[],
  targetPx: number,
): { runs: ScreenPoint[][]; tip: ScreenPoint | null } {
  if (targetPx <= 0 || segments.length === 0) {
    return { runs: [], tip: segments[0]?.pts[0] || null };
  }

  const runs: ScreenPoint[][] = [];
  let remaining = targetPx;
  let tip: ScreenPoint | null = segments[0].pts[0];

  for (const seg of segments) {
    if (remaining <= 0) break;
    if (remaining >= seg.totalPx) {
      runs.push(seg.pts);
      tip = seg.pts[seg.pts.length - 1];
      remaining -= seg.totalPx;
      continue;
    }

    const partial: ScreenPoint[] = [seg.pts[0]];
    for (let i = 1; i < seg.pts.length; i++) {
      const prevLen = seg.cumLengths[i - 1];
      const nextLen = seg.cumLengths[i];
      if (nextLen <= remaining) {
        partial.push(seg.pts[i]);
      } else {
        const segSpan = Math.max(1e-6, nextLen - prevLen);
        const localT = (remaining - prevLen) / segSpan;
        const pt = {
          x: seg.pts[i - 1].x + (seg.pts[i].x - seg.pts[i - 1].x) * localT,
          y: seg.pts[i - 1].y + (seg.pts[i].y - seg.pts[i - 1].y) * localT,
        };
        partial.push(pt);
        tip = pt;
        break;
      }
    }
    if (partial.length >= 2) runs.push(partial);
    remaining = 0;
  }

  return { runs, tip };
}

export function renderGeoRoute(
  ctx: RenderCtx2D,
  route: GeoRoute,
  cam: InterpolatedCamera,
  timeMs: number,
  width: number,
  height: number,
  glowingEdge?: GlowingEdgeSettings,
  tier: RenderQualityTier = 'full',
) {
  if (timeMs < route.startMs || route.points.length < 2) return;

  const animMode = route.dashAnimation || 'draw';
  const rawProgress =
    animMode === 'none'
      ? 1
      : Math.max(0, Math.min(1, (timeMs - route.startMs) / Math.max(1, route.endMs - route.startMs)));
  const progress = applyEasing(rawProgress, route.easing || 'linear');

  const { segments, totalPx } = buildRouteScreenSegments(route, cam, width, height);
  if (segments.length === 0 || totalPx < 1) return;

  const scaleFactor = width / 1080;
  const strokeWidth = (route.width || 5) * scaleFactor;
  const drawnPx = totalPx * progress;
  const edgeGlowMul = glowingEdge?.enabled ? Math.max(0.5, Math.min(2.5, glowingEdge.intensity ?? 1.5)) : 0;

  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  // Optional faint ghost trail of the target path
  if (route.showTrailGhost) {
    ctx.save();
    traceScreenSegments(
      ctx,
      segments.map((s) => s.pts),
    );
    ctx.strokeStyle = route.color;
    ctx.globalAlpha = 0.2;
    ctx.lineWidth = Math.max(1.5, strokeWidth * 0.65);
    ctx.setLineDash([6 * scaleFactor, 8 * scaleFactor]);
    ctx.stroke();
    ctx.restore();
  }

  const usesPatternedDashes =
    route.style === 'dashed' ||
    route.style === 'dotted' ||
    animMode === 'grow-dashes' ||
    animMode === 'marching' ||
    (typeof route.dashLength === 'number' && route.dashLength > 0);

  let tipPoint: ScreenPoint | null = null;

  if (drawnPx >= 0.5) {
    const strokePass = (isBloomPass: boolean): ScreenPoint | null => {
      let localTip: ScreenPoint | null = null;
      ctx.save();
      if (isBloomPass) {
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = Math.min(0.45, 0.16 + edgeGlowMul * 0.12);
        ctx.strokeStyle = route.color;
        ctx.lineWidth = strokeWidth * (2.6 + edgeGlowMul * 0.75);
      } else {
        ctx.strokeStyle = route.color;
        ctx.lineWidth = strokeWidth;
      }

      if (!usesPatternedDashes) {
        traceScreenSegments(
          ctx,
          segments.map((s) => s.pts),
        );
        if (drawnPx < totalPx - 0.5) {
          ctx.setLineDash([drawnPx, totalPx + 100]);
          ctx.lineDashOffset = 0;
        } else {
          ctx.setLineDash([]);
        }
        ctx.stroke();
        localTip = truncateScreenSegments(segments, drawnPx).tip;
      } else {
        const defaultDash = route.style === 'dotted' ? 4 : 18;
        const defaultGap = route.style === 'dotted' ? 10 : 12;
        const targetDash = Math.max(2, (route.dashLength ?? defaultDash) * scaleFactor);
        const startDash = Math.max(
          2,
          (route.dashLengthStart ?? (animMode === 'grow-dashes' ? Math.max(3, targetDash * 0.22) : targetDash)) *
            scaleFactor,
        );
        const gap = Math.max(2, (route.dashGap ?? defaultGap) * scaleFactor);

        const effectiveDash =
          animMode === 'grow-dashes' ? startDash + (targetDash - startDash) * progress : targetDash;

        const { runs, tip } = truncateScreenSegments(segments, drawnPx);
        localTip = tip;

        if (runs.length > 0) {
          traceScreenSegments(ctx, runs);
          ctx.setLineDash([effectiveDash, gap]);
          ctx.lineDashOffset =
            animMode === 'marching'
              ? -((timeMs - route.startMs) / 1000) * (route.dashSpeed ?? 48) * scaleFactor
              : 0;
          ctx.stroke();
        }
      }
      ctx.setLineDash([]);
      ctx.restore();
      return localTip;
    };

    if ((edgeGlowMul > 0 || route.glow) && tier !== 'fast') {
      strokePass(true);
    }
    tipPoint = strokePass(false);
  }

  // Pulsing Red Terminal Beacon Dot (when route stops at blockade/gap like Pan-American Highway)
  if (route.endBeaconPulse && progress > 0.72) {
    const endPt = projectPoint(route.points[route.points.length - 1], cam, width, height);
    if (endPt.visible) {
      const wave = ((timeMs - route.startMs) * 0.0014) % 1;
      ctx.save();
      ctx.fillStyle = 'rgba(239, 68, 68, 0.38)';
      ctx.globalAlpha = 1 - wave;
      ctx.beginPath();
      ctx.arc(endPt.x, endPt.y, (14 + wave * 34) * scaleFactor, 0, Math.PI * 2);
      ctx.fill();

      ctx.globalAlpha = 1;
      ctx.shadowColor = '#EF4444';
      ctx.shadowBlur = 20 * scaleFactor;
      ctx.fillStyle = '#EF4444';
      ctx.beginPath();
      ctx.arc(endPt.x, endPt.y, 14 * scaleFactor, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = '#FFFFFF';
      ctx.beginPath();
      ctx.arc(endPt.x, endPt.y, 6.2 * scaleFactor, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  // Distance label at midpoint (clean outlined editorial style)
  if (route.distanceLabel && progress > 0.35) {
    const midPt = sampleSplineRoute(route.points, 0.5);
    const mp = projectPoint(midPt, cam, width, height);
    if (mp.visible) {
      const fs = Math.round(30 * scaleFactor);
      ctx.font = `800 ${fs}px "Plus Jakarta Sans", sans-serif`;
      ctx.fillStyle = '#FFFFFF';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.shadowColor = 'rgba(0,0,0,0.9)';
      ctx.shadowBlur = 12;
      drawOutlinedText(ctx, route.distanceLabel, mp.x, mp.y - 26 * scaleFactor, 6 * scaleFactor, 'rgba(0,0,0,0.85)');
    }
  }

  // Directional Vector Traveler Icon locked to drawing tip
  if (route.travelerType && route.travelerType !== 'none' && tipPoint) {
    const r = 24 * scaleFactor;
    const prevPt = truncateScreenSegments(segments, Math.max(0, drawnPx - 14)).tip || tipPoint;
    const heading =
      Math.hypot(tipPoint.x - prevPt.x, tipPoint.y - prevPt.y) > 0.5
        ? Math.atan2(tipPoint.y - prevPt.y, tipPoint.x - prevPt.x)
        : 0;

    if (route.travelerType === 'ship') {
      const ripple = (timeMs * 0.0025) % 1;
      ctx.save();
      ctx.strokeStyle = 'rgba(255,255,255,0.65)';
      ctx.globalAlpha = 1 - ripple;
      ctx.lineWidth = 2.4 * scaleFactor;
      ctx.beginPath();
      ctx.arc(tipPoint.x, tipPoint.y, r * (1.1 + ripple * 1.1), 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    ctx.save();
    ctx.translate(tipPoint.x, tipPoint.y);
    ctx.shadowColor = route.color;
    ctx.shadowBlur = 16;
    ctx.fillStyle = '#0B0F17';
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#FFFFFF';
    ctx.lineWidth = 3.5 * scaleFactor;
    ctx.stroke();
    ctx.shadowBlur = 0;

    ctx.fillStyle = '#FFFFFF';
    ctx.strokeStyle = '#FFFFFF';

    if (route.travelerType === 'plane') {
      ctx.rotate(heading);
      ctx.beginPath();
      ctx.moveTo(r * 0.58, 0);
      ctx.lineTo(-r * 0.15, -r * 0.56);
      ctx.lineTo(-r * 0.1, -r * 0.14);
      ctx.lineTo(-r * 0.48, -r * 0.16);
      ctx.lineTo(-r * 0.36, 0);
      ctx.lineTo(-r * 0.48, r * 0.16);
      ctx.lineTo(-r * 0.1, r * 0.14);
      ctx.lineTo(-r * 0.15, r * 0.56);
      ctx.closePath();
      ctx.fill();
    } else if (route.travelerType === 'ship') {
      ctx.beginPath();
      ctx.moveTo(-r * 0.55, r * 0.08);
      ctx.lineTo(r * 0.55, r * 0.08);
      ctx.lineTo(r * 0.36, r * 0.42);
      ctx.lineTo(-r * 0.36, r * 0.42);
      ctx.closePath();
      ctx.fill();
      ctx.fillRect(-r * 0.22, -r * 0.32, r * 0.44, r * 0.36);
    } else if (route.travelerType === 'car') {
      ctx.beginPath();
      ctx.roundRect(-r * 0.48, -r * 0.24, r * 0.96, r * 0.48, 4 * scaleFactor);
      ctx.fill();
      ctx.fillStyle = '#0B0F17';
      ctx.fillRect(-r * 0.26, -r * 0.14, r * 0.52, r * 0.18);
    } else {
      // Walker figure silhouette
      ctx.beginPath();
      ctx.arc(0, -r * 0.4, r * 0.18, 0, Math.PI * 2);
      ctx.fill();
      ctx.lineWidth = 3.2 * scaleFactor;
      ctx.beginPath();
      ctx.moveTo(0, -r * 0.2);
      ctx.lineTo(0, r * 0.2);
      ctx.moveTo(-r * 0.28, r * 0.05);
      ctx.lineTo(r * 0.28, -r * 0.06);
      ctx.moveTo(0, r * 0.2);
      ctx.lineTo(-r * 0.26, r * 0.52);
      ctx.moveTo(0, r * 0.2);
      ctx.lineTo(r * 0.26, r * 0.52);
      ctx.stroke();
    }
    ctx.restore();

    if (route.travelerLabel) {
      ctx.font = `700 ${Math.round(23 * scaleFactor)}px "Plus Jakarta Sans", sans-serif`;
      ctx.fillStyle = '#FFFFFF';
      ctx.textAlign = 'center';
      drawOutlinedText(ctx, route.travelerLabel, tipPoint.x, tipPoint.y - r - 20 * scaleFactor, 5 * scaleFactor);
    }
  }

  ctx.restore();
}

function formatCoordLabel(deg: number, axis: 'lat' | 'lng'): string {
  if (deg === 0) return axis === 'lat' ? '0° EQ' : '0° PM';
  const abs = Math.abs(Math.round(deg * 10) / 10);
  if (axis === 'lat') return `${abs}°${deg > 0 ? 'N' : 'S'}`;
  return `${abs}°${deg > 0 ? 'E' : 'W'}`;
}

function drawMapGrid(
  ctx: RenderCtx2D,
  project: MapProject,
  cam: InterpolatedCamera,
  width: number,
  height: number,
  accentColor: string,
  fastPreview = false,
) {
  const settings = project.mapGrid;
  if (!settings?.enabled) return;

  const step = settings.stepDegrees ?? 20;
  const opacity = settings.opacity ?? 0.55;
  const showLabels = settings.showLabels ?? false;
  const highlightEquatorTropics = settings.highlightEquatorTropics ?? false;
  const isParchment = project.themePreset === 'vintage-parchment';
  const scaleFactor = width / 1080;
  const latStep = fastPreview ? 14 : 8;
  const lngSampleStep = fastPreview ? 16 : 10;

  const baseLineColor = isParchment
    ? `rgba(72, 52, 34, ${(0.22 * opacity).toFixed(3)})`
    : `rgba(226, 232, 240, ${(0.14 * opacity).toFixed(3)})`;
  const labelColor = isParchment
    ? `rgba(72, 52, 34, ${(0.72 * opacity).toFixed(3)})`
    : `rgba(203, 213, 225, ${(0.55 * opacity).toFixed(3)})`;

  ctx.save();
  ctx.strokeStyle = baseLineColor;
  ctx.lineWidth = Math.max(0.8, 1.1 * scaleFactor);

  // Meridians (Longitude)
  for (let lng = -180 + step; lng <= 180; lng += step) {
    if (highlightEquatorTropics && lng === 0) continue;
    ctx.beginPath();
    let started = false;
    for (let lat = -80; lat <= 80; lat += latStep) {
      const p = projectPoint({ lat, lng }, cam, width, height);
      if (!p.visible) {
        started = false;
        continue;
      }
      if (!started) {
        ctx.moveTo(p.x, p.y);
        started = true;
      } else {
        ctx.lineTo(p.x, p.y);
      }
    }
    ctx.stroke();
  }

  // Parallels (Latitude) aligned symmetrically around 0° Equator
  const startLat = -Math.floor(80 / step) * step;
  for (let lat = startLat; lat <= 80; lat += step) {
    if (highlightEquatorTropics && lat === 0) continue;
    ctx.beginPath();
    let started = false;
    for (let lng = -180; lng <= 180; lng += lngSampleStep) {
      const p = projectPoint({ lat, lng }, cam, width, height);
      if (!p.visible) {
        started = false;
        continue;
      }
      if (!started) {
        ctx.moveTo(p.x, p.y);
        started = true;
      } else {
        ctx.lineTo(p.x, p.y);
      }
    }
    ctx.stroke();
  }

  // Highlight Equator (0°), Prime Meridian (0°), and Tropics (±23.4°)
  if (highlightEquatorTropics) {
    ctx.save();
    ctx.strokeStyle = isParchment
      ? `rgba(180, 60, 40, ${(0.34 * opacity).toFixed(3)})`
      : accentColor;
    ctx.globalAlpha = isParchment ? 1 : 0.28 * opacity;
    ctx.lineWidth = Math.max(1.2, 1.6 * scaleFactor);
    ctx.setLineDash([8 * scaleFactor, 6 * scaleFactor]);

    for (const lat of [0, 23.4, -23.4]) {
      ctx.beginPath();
      let started = false;
      for (let lng = -180; lng <= 180; lng += lngSampleStep) {
        const p = projectPoint({ lat, lng }, cam, width, height);
        if (!p.visible) {
          started = false;
          continue;
        }
        if (!started) {
          ctx.moveTo(p.x, p.y);
          started = true;
        } else {
          ctx.lineTo(p.x, p.y);
        }
      }
      ctx.stroke();
    }

    // Prime Meridian (0° lng)
    ctx.beginPath();
    let pmStarted = false;
    for (let lat = -80; lat <= 80; lat += latStep) {
      const p = projectPoint({ lat, lng: 0 }, cam, width, height);
      if (!p.visible) {
        pmStarted = false;
        continue;
      }
      if (!pmStarted) {
        ctx.moveTo(p.x, p.y);
        pmStarted = true;
      } else {
        ctx.lineTo(p.x, p.y);
      }
    }
    ctx.stroke();
    ctx.restore();
  }

  // Coordinate Axis Labels
  if (showLabels) {
    ctx.save();
    ctx.font = `600 ${Math.round(18 * scaleFactor)}px "JetBrains Mono", monospace`;
    ctx.fillStyle = labelColor;

    // Longitude labels near top edge
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    for (let lng = -180 + step; lng <= 180; lng += step) {
      const p = projectPoint({ lat: cam.lat, lng }, cam, width, height);
      if (!p.visible) continue;
      if (p.x >= width * 0.1 && p.x <= width * 0.9) {
        ctx.fillText(formatCoordLabel(lng, 'lng'), p.x, height * 0.032);
      }
    }

    // Latitude labels near left edge
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    for (let lat = startLat; lat <= 80; lat += step) {
      const p = projectPoint({ lat, lng: cam.lng }, cam, width, height);
      if (!p.visible) continue;
      if (p.y >= height * 0.12 && p.y <= height * 0.86) {
        ctx.fillText(formatCoordLabel(lat, 'lat'), width * 0.03, p.y);
      }
    }
    ctx.restore();
  }

  ctx.restore();
}

function renderMercatorHybridTiles(
  ctx: RenderCtx2D,
  project: MapProject,
  cam: InterpolatedCamera,
  grid: MercatorTileGridInfo,
  width: number,
  height: number,
  opacityScale: number,
  tier: RenderQualityTier = 'full',
) {
  const fastPreview = tier !== 'full';
  const hybrid = project.hybridMap;
  const satOpacity = (hybrid?.satelliteOpacity ?? 0.94) * opacityScale;
  const labelOpacity = (hybrid?.labelOpacity ?? 0.85) * opacityScale;
  // Hide third-party small-area labels and road-number codes by default; only show if user explicitly opts in
  const showBordersAndLabels = hybrid?.showBordersAndLabels === true;
  const showHighways = hybrid?.showHighways === true && (!fastPreview || cam.zoom >= 4.2);

  ctx.save();
  ctx.translate(width / 2, height / 2);
  ctx.scale(1, grid.pitchScale);
  ctx.rotate(grid.bearingRad);

  // Layer 1: Real Satellite Imagery (blended out smoothly during Topographic Paper Map cutaways)
  if (cam.topoMix < 0.98) {
    ctx.globalAlpha = Math.max(0, Math.min(1, satOpacity * (1 - cam.topoMix)));
    for (let ty = grid.minTy; ty <= grid.maxTy; ty++) {
      for (let tx = grid.minTx; tx <= grid.maxTx; tx++) {
        const dx = (tx - grid.camTx) * grid.tileScreenSize;
        const dy = (ty - grid.camTy) * grid.tileScreenSize;
        drawTileWithFallback(ctx, 'imagery', grid.tileZ, ty, tx, dx, dy, grid.tileScreenSize, grid.tileScreenSize);
      }
    }
  }

  // Layer 1a: Real Topographic Paper Map Sheet Cutaway
  if (cam.topoMix > 0.02) {
    ctx.save();
    ctx.globalAlpha = Math.max(0, Math.min(1, cam.topoMix * opacityScale));
    for (let ty = grid.minTy; ty <= grid.maxTy; ty++) {
      for (let tx = grid.minTx; tx <= grid.maxTx; tx++) {
        const dx = (tx - grid.camTx) * grid.tileScreenSize;
        const dy = (ty - grid.camTy) * grid.tileScreenSize;
        drawTileWithFallback(ctx, 'topo', grid.tileZ, ty, tx, dx, dy, grid.tileScreenSize, grid.tileScreenSize);
      }
    }
    ctx.restore();
  }

  // Layer 1b: 3D Terrain Elevation Exaggeration
  if (project.mapDepth?.enabled && cam.topoMix < 0.75) {
    const exag = Math.max(1, Math.min(3, project.mapDepth.exaggeration ?? 1.8));
    const reliefAlpha = Math.min(0.88, (0.34 + (exag - 1) * 0.24) * opacityScale * (1 - cam.topoMix));
    ctx.save();
    ctx.globalCompositeOperation = 'multiply';
    ctx.globalAlpha = Math.max(0, Math.min(1, reliefAlpha));
    for (let ty = grid.minTy; ty <= grid.maxTy; ty++) {
      for (let tx = grid.minTx; tx <= grid.maxTx; tx++) {
        const dx = (tx - grid.camTx) * grid.tileScreenSize;
        const dy = (ty - grid.camTy) * grid.tileScreenSize;
        drawTileWithFallback(ctx, 'hillshade', grid.tileZ, ty, tx, dx, dy, grid.tileScreenSize, grid.tileScreenSize);
      }
    }
    if (tier === 'full' && exag > 1.35) {
      ctx.globalCompositeOperation = 'soft-light';
      ctx.globalAlpha = Math.min(0.55, (exag - 1.2) * 0.28 * opacityScale * (1 - cam.topoMix));
      for (let ty = grid.minTy; ty <= grid.maxTy; ty++) {
        for (let tx = grid.minTx; tx <= grid.maxTx; tx++) {
          const dx = (tx - grid.camTx) * grid.tileScreenSize;
          const dy = (ty - grid.camTy) * grid.tileScreenSize;
          drawTileWithFallback(ctx, 'hillshade', grid.tileZ, ty, tx, dx, dy, grid.tileScreenSize, grid.tileScreenSize);
        }
      }
    }
    ctx.restore();
  }

  // Layer 2: Real Major Highways Overlay
  if (showHighways && labelOpacity > 0.02 && cam.topoMix < 0.85) {
    ctx.globalAlpha = Math.max(0, Math.min(1, labelOpacity * 0.85 * (1 - cam.topoMix)));
    for (let ty = grid.minTy; ty <= grid.maxTy; ty++) {
      for (let tx = grid.minTx; tx <= grid.maxTx; tx++) {
        const dx = (tx - grid.camTx) * grid.tileScreenSize;
        const dy = (ty - grid.camTy) * grid.tileScreenSize;
        drawTileWithFallback(ctx, 'roads', grid.tileZ, ty, tx, dx, dy, grid.tileScreenSize, grid.tileScreenSize);
      }
    }
  }

  // Layer 3: Country Borders & City Names Overlay
  if (showBordersAndLabels && labelOpacity > 0.02 && cam.topoMix < 0.85) {
    ctx.globalAlpha = Math.max(0, Math.min(1, labelOpacity * (1 - cam.topoMix)));
    for (let ty = grid.minTy; ty <= grid.maxTy; ty++) {
      for (let tx = grid.minTx; tx <= grid.maxTx; tx++) {
        const dx = (tx - grid.camTx) * grid.tileScreenSize;
        const dy = (ty - grid.camTy) * grid.tileScreenSize;
        drawTileWithFallback(ctx, 'labels', grid.tileZ, ty, tx, dx, dy, grid.tileScreenSize, grid.tileScreenSize);
      }
    }
  }

  ctx.restore();
}

function drawTexturedTriangle(
  ctx: RenderCtx2D,
  img: HTMLCanvasElement,
  x0: number,
  y0: number,
  u0: number,
  v0: number,
  x1: number,
  y1: number,
  u1: number,
  v1: number,
  x2: number,
  y2: number,
  u2: number,
  v2: number,
) {
  const su0 = u0 * img.width;
  const sv0 = v0 * img.height;
  const su1 = u1 * img.width;
  const sv1 = v1 * img.height;
  const su2 = u2 * img.width;
  const sv2 = v2 * img.height;

  const du1 = su1 - su0;
  const dv1 = sv1 - sv0;
  const du2 = su2 - su0;
  const dv2 = sv2 - sv0;
  const det = du1 * dv2 - du2 * dv1;
  if (Math.abs(det) < 1e-4) return;

  const dx1 = x1 - x0;
  const dy1 = y1 - y0;
  const dx2 = x2 - x0;
  const dy2 = y2 - y0;

  const a = (dx1 * dv2 - dx2 * dv1) / det;
  const b = (dy1 * dv2 - dy2 * dv1) / det;
  const c = (dx2 * du1 - dx1 * du2) / det;
  const d = (dy2 * du1 - dy1 * du2) / det;
  const e = x0 - a * su0 - c * sv0;
  const f = y0 - b * su0 - d * sv0;

  // Slightly expand clip triangle outward from centroid to avoid subpixel seams
  const mcx = (x0 + x1 + x2) / 3;
  const mcy = (y0 + y1 + y2) / 3;
  const ex = (px: number, py: number) => {
    const vx = px - mcx;
    const vy = py - mcy;
    const len = Math.hypot(vx, vy) || 1;
    return [px + (vx / len) * 0.65, py + (vy / len) * 0.65] as const;
  };
  const [ex0, ey0] = ex(x0, y0);
  const [ex1, ey1] = ex(x1, y1);
  const [ex2, ey2] = ex(x2, y2);

  ctx.save();
  ctx.beginPath();
  ctx.moveTo(ex0, ey0);
  ctx.lineTo(ex1, ey1);
  ctx.lineTo(ex2, ey2);
  ctx.closePath();
  ctx.clip();
  ctx.transform(a, b, c, d, e, f);
  const srcMinX = Math.max(0, Math.floor(Math.min(su0, su1, su2)) - 2);
  const srcMinY = Math.max(0, Math.floor(Math.min(sv0, sv1, sv2)) - 2);
  const srcMaxX = Math.min(img.width, Math.ceil(Math.max(su0, su1, su2)) + 2);
  const srcMaxY = Math.min(img.height, Math.ceil(Math.max(sv0, sv1, sv2)) + 2);
  const sw = Math.max(1, srcMaxX - srcMinX);
  const sh = Math.max(1, srcMaxY - srcMinY);
  ctx.drawImage(img, srcMinX, srcMinY, sw, sh, srcMinX, srcMinY, sw, sh);
  ctx.restore();
}

function renderGlobeHybridSurface(
  ctx: RenderCtx2D,
  project: MapProject,
  cam: InterpolatedCamera,
  width: number,
  height: number,
  opacityScale: number,
  tier: RenderQualityTier = 'full',
) {
  const imageryAtlas = getGlobalGlobeAtlas('imagery');
  if (!imageryAtlas) return;

  const fastPreview = tier !== 'full';
  const hybrid = project.hybridMap;
  const satOpacity = (hybrid?.satelliteOpacity ?? 0.94) * opacityScale;
  const labelOpacity = (hybrid?.labelOpacity ?? 0.85) * opacityScale;
  const labelsAtlas = hybrid?.showBordersAndLabels === true ? getGlobalGlobeAtlas('labels') : null;

  const radius = Math.min(width, height) * 0.38 * Math.pow(1.28, cam.zoom - 1.7);
  const lat1 = cam.lat * DEG2RAD;
  const lng1 = cam.lng * DEG2RAD;

  const drawAtlasSphere = (atlas: HTMLCanvasElement, alpha: number) => {
    if (alpha <= 0.02) return;
    ctx.save();
    if (cam.globeMix >= 0.85) {
      ctx.beginPath();
      ctx.arc(width / 2, height / 2, radius, 0, Math.PI * 2);
      ctx.clip();
    }
    ctx.globalAlpha = Math.max(0, Math.min(1, alpha));

    const latSteps =
      tier === 'fast'
        ? [-84, -62, -40, -18, 4, 26, 48, 70, 84]
        : fastPreview
          ? [-84, -66, -48, -30, -12, 6, 24, 42, 60, 80]
          : [-84, -72, -60, -48, -36, -24, -12, 0, 12, 24, 36, 48, 60, 72, 84];
    const lngStep = tier === 'fast' ? 22 : fastPreview ? 18 : 12;

    for (let i = 0; i < latSteps.length - 1; i++) {
      const la = latSteps[i];
      const lb = latSteps[i + 1];
      const va = (1 - mercatorY(la) / Math.PI) / 2;
      const vb = (1 - mercatorY(lb) / Math.PI) / 2;

      for (let lng = -180; lng < 180; lng += lngStep) {
        const lngA = lng;
        const lngB = lng + lngStep;
        const ua = (lngA + 180) / 360;
        const ub = (lngB + 180) / 360;

        // Quick hemisphere visibility cull using cell center
        const midLat = (la + lb) * 0.5 * DEG2RAD;
        const midLng = (lngA + lngB) * 0.5 * DEG2RAD;
        const midCosC =
          Math.sin(lat1) * Math.sin(midLat) + Math.cos(lat1) * Math.cos(midLat) * Math.cos(midLng - lng1);
        if (cam.globeMix > 0.5 && midCosC < -0.25) continue;

        const p00 = projectPoint({ lat: la, lng: lngA }, cam, width, height);
        const p10 = projectPoint({ lat: la, lng: lngB }, cam, width, height);
        const p11 = projectPoint({ lat: lb, lng: lngB }, cam, width, height);
        const p01 = projectPoint({ lat: lb, lng: lngA }, cam, width, height);

        if (p00.visible && p10.visible && p11.visible) {
          drawTexturedTriangle(ctx, atlas, p00.x, p00.y, ua, va, p10.x, p10.y, ub, va, p11.x, p11.y, ub, vb);
        }
        if (p00.visible && p11.visible && p01.visible) {
          drawTexturedTriangle(ctx, atlas, p00.x, p00.y, ua, va, p11.x, p11.y, ub, vb, p01.x, p01.y, ua, vb);
        }
      }
    }
    ctx.restore();
  };

  drawAtlasSphere(imageryAtlas, satOpacity);
  if (tier === 'full' && project.mapDepth?.enabled) {
    const hillAtlas = getGlobalGlobeAtlas('hillshade');
    if (hillAtlas) {
      const exag = Math.max(1, Math.min(3, project.mapDepth.exaggeration ?? 1.8));
      ctx.save();
      ctx.globalCompositeOperation = 'multiply';
      drawAtlasSphere(hillAtlas, Math.min(0.75, (0.3 + (exag - 1) * 0.2) * opacityScale));
      ctx.restore();
    }
  }
  if (labelsAtlas) {
    drawAtlasSphere(labelsAtlas, labelOpacity);
  }
}

function applyThemeSatelliteGrade(
  ctx: RenderCtx2D,
  project: MapProject,
  cam: InterpolatedCamera,
  width: number,
  height: number,
) {
  ctx.save();

  if (cam.topoMix > 0.05) {
    // Warm editorial paper-map tint when zoomed into topographic paper sheet
    ctx.fillStyle = `rgba(235, 224, 198, ${(0.16 * cam.topoMix).toFixed(3)})`;
    ctx.fillRect(0, 0, width, height);
  } else if (project.themePreset === 'vox-tactical') {
    // Keep real satellite terrain bright & readable while adding subtle corner lens depth
    const vig = ctx.createRadialGradient(
      width * 0.5,
      height * 0.48,
      width * 0.34,
      width * 0.5,
      height * 0.5,
      height * 0.76,
    );
    vig.addColorStop(0, 'rgba(7, 13, 26, 0)');
    vig.addColorStop(1, 'rgba(4, 8, 16, 0.20)');
    ctx.fillStyle = vig;
    ctx.fillRect(0, 0, width, height);
  } else if (project.themePreset === 'vintage-parchment') {
    // Warm archival sepia color grade over satellite imagery
    ctx.globalCompositeOperation = 'color';
    ctx.fillStyle = 'rgba(186, 152, 98, 0.55)';
    ctx.fillRect(0, 0, width, height);

    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = 'rgba(226, 204, 162, 0.24)';
    ctx.fillRect(0, 0, width, height);

    const paperVig = ctx.createRadialGradient(
      width * 0.5,
      height * 0.5,
      width * 0.25,
      width * 0.5,
      height * 0.5,
      height * 0.75,
    );
    paperVig.addColorStop(0, 'rgba(65, 42, 18, 0)');
    paperVig.addColorStop(1, 'rgba(46, 28, 12, 0.42)');
    ctx.fillStyle = paperVig;
    ctx.fillRect(0, 0, width, height);
  } else {
    // 3D Terrain & Globe: natural vivid satellite with subtle atmospheric edge shading
    if (cam.globeMix > 0.25) {
      const radius = Math.min(width, height) * 0.38 * Math.pow(1.28, cam.zoom - 1.7);
      const limb = ctx.createRadialGradient(
        width / 2 - radius * 0.22,
        height / 2 - radius * 0.22,
        radius * 0.35,
        width / 2,
        height / 2,
        radius,
      );
      limb.addColorStop(0, 'rgba(255,255,255,0)');
      limb.addColorStop(0.78, 'rgba(12, 32, 62, 0.14)');
      limb.addColorStop(1, 'rgba(56, 189, 248, 0.28)');
      ctx.beginPath();
      ctx.arc(width / 2, height / 2, radius, 0, Math.PI * 2);
      ctx.fillStyle = limb;
      ctx.fill();
    } else {
      const vig = ctx.createRadialGradient(
        width * 0.5,
        height * 0.5,
        width * 0.28,
        width * 0.5,
        height * 0.5,
        height * 0.74,
      );
      vig.addColorStop(0, 'rgba(5, 12, 24, 0)');
      vig.addColorStop(1, 'rgba(4, 10, 20, 0.30)');
      ctx.fillStyle = vig;
      ctx.fillRect(0, 0, width, height);
    }
  }

  ctx.restore();
}

let dofSurfaceCache: RenderSurface | null = null;
let dofMaskSurfaceCache: RenderSurface | null = null;
let dofMaskSizeKey = '';

function applyDocumentaryMapDepth(
  ctx: RenderCtx2D,
  project: MapProject,
  cam: InterpolatedCamera,
  width: number,
  height: number,
  tier: RenderQualityTier = 'full',
) {
  const depthCfg = project.mapDepth;
  const dofActive = depthCfg?.enabled || cam.topoMix > 0.2;
  if (!dofActive) return;

  const fastPreview = tier !== 'full';
  const exag = Math.max(1, Math.min(3, depthCfg?.exaggeration ?? 1.8));
  const dof = Math.max(0, Math.min(1, depthCfg?.depthOfField ?? (cam.topoMix > 0.2 ? 0.45 : 0.55)));

  // 1. Atmospheric ridge/horizon haze when tilted or exaggerated terrain relief is active
  const pitchFactor = Math.min(1, cam.pitch / 32);
  if (pitchFactor > 0.05 || exag > 1.15) {
    ctx.save();
    const horizonAlpha = Math.min(0.42, (0.12 + pitchFactor * 0.22) * (0.7 + (exag - 1) * 0.25));
    const haze = ctx.createLinearGradient(0, 0, 0, height * 0.42);
    haze.addColorStop(0, `rgba(186, 214, 244, ${horizonAlpha.toFixed(3)})`);
    haze.addColorStop(0.55, `rgba(148, 184, 224, ${(horizonAlpha * 0.35).toFixed(3)})`);
    haze.addColorStop(1, 'rgba(148, 184, 224, 0)');
    ctx.fillStyle = haze;
    ctx.fillRect(0, 0, width, height * 0.42);
    ctx.restore();
  }

  // 2. Shallow Tilt-Shift Documentary Depth of Field (skipped in fast throttle tier to keep 60fps lock)
  if (dof > 0.03 && tier !== 'fast') {
    const scale = fastPreview ? 0.14 : 0.22;
    const bw = Math.max(90, Math.round(width * scale));
    const bh = Math.max(160, Math.round(height * scale));

    dofSurfaceCache = ensureSurfaceSize(dofSurfaceCache, bw, bh);
    if (!dofMaskSurfaceCache || dofMaskSurfaceCache.width !== bw || dofMaskSurfaceCache.height !== bh) {
      dofMaskSurfaceCache = ensureSurfaceSize(dofMaskSurfaceCache, bw, bh);
      dofMaskSizeKey = '';
    }

    const bctx = getSurfaceCtx2D(dofSurfaceCache);
    const mctx = getSurfaceCtx2D(dofMaskSurfaceCache);
    if (bctx && mctx && dofSurfaceCache && dofMaskSurfaceCache) {
      const blurRadius = Math.max(1.2, (1.2 + dof * 3.0) * (bw / 240));
      bctx.clearRect(0, 0, bw, bh);
      bctx.save();
      if (tier === 'full') {
        bctx.filter = `blur(${blurRadius.toFixed(1)}px)`;
      }
      bctx.drawImage(ctx.canvas, 0, 0, bw, bh);
      bctx.restore();

      const sizeKey = `${bw}x${bh}`;
      if (dofMaskSizeKey !== sizeKey) {
        mctx.clearRect(0, 0, bw, bh);
        const focalGrad = mctx.createLinearGradient(0, 0, 0, bh);
        focalGrad.addColorStop(0, 'rgba(0,0,0,0.92)');
        focalGrad.addColorStop(0.24, 'rgba(0,0,0,0.28)');
        focalGrad.addColorStop(0.38, 'rgba(0,0,0,0)');
        focalGrad.addColorStop(0.64, 'rgba(0,0,0,0)');
        focalGrad.addColorStop(0.8, 'rgba(0,0,0,0.32)');
        focalGrad.addColorStop(1, 'rgba(0,0,0,0.95)');
        mctx.fillStyle = focalGrad;
        mctx.fillRect(0, 0, bw, bh);
        dofMaskSizeKey = sizeKey;
      }

      bctx.save();
      bctx.globalCompositeOperation = 'destination-in';
      bctx.drawImage(dofMaskSurfaceCache, 0, 0);
      bctx.restore();

      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalAlpha = Math.min(0.95, 0.45 + dof * 0.5);
      ctx.drawImage(dofSurfaceCache, 0, 0, width, height);
      ctx.restore();
    }
  }
}

function getHandheldMotionWeight(
  project: MapProject,
  cam: InterpolatedCamera,
  timeMs: number,
  activeOverlays: MapOverlay[],
): number {
  const kfs = getSortedKeyframes(project.cameraKeyframes);
  let shotHandheld = false;
  for (let i = 0; i < kfs.length - 1; i++) {
    if (timeMs >= kfs[i].timeMs && timeMs <= kfs[i + 1].timeMs) {
      if (kfs[i].handheldJitter || kfs[i + 1].handheldJitter) shotHandheld = true;
      break;
    }
  }

  const globalCfg = project.handheldCamera;
  if (!globalCfg?.enabled && !shotHandheld) return 0;

  const baseIntensity = globalCfg?.enabled ? Math.max(0.1, Math.min(1, globalCfg.intensity ?? 0.55)) : 0.6;
  const highActionOnly = globalCfg?.enabled ? globalCfg.highActionOnly : true;

  // Measure real-time camera motion velocity (zooming, fast pans, pitch sweeps)
  const camPrev = interpolateCamera(project, Math.max(0, timeMs - 55));
  const camNext = interpolateCamera(project, Math.min(project.durationMs, timeMs + 55));
  const dZoom = Math.abs(camNext.zoom - camPrev.zoom);
  const dPos = Math.hypot(camNext.lat - camPrev.lat, camNext.lng - camPrev.lng);
  const dTilt = Math.abs(camNext.pitch - camPrev.pitch) + Math.abs(camNext.bearing - camPrev.bearing);
  const motionEnergy = Math.min(1, dZoom * 7.5 + dPos * 0.35 + dTilt * 0.14 + Math.max(0, cam.pitch - 15) * 0.01);

  // Boost during high-action dramatic overlays (stamps, red X, hazard radar, fast counters)
  let dramaticEnergy = 0;
  for (const ov of activeOverlays) {
    if (ov.type === 'stamp' || ov.type === 'cross-hazard' || ov.type === 'hazard-radar') {
      const dt = timeMs - ov.startMs;
      dramaticEnergy = Math.max(dramaticEnergy, dt < 1200 ? 0.95 : 0.45);
    }
  }

  if (shotHandheld && !globalCfg?.enabled) {
    return baseIntensity * Math.max(0.45, Math.min(1, motionEnergy * 1.1 + dramaticEnergy));
  }

  const actionMultiplier = highActionOnly
    ? Math.max(0.14, Math.min(1, motionEnergy * 1.2 + dramaticEnergy + (shotHandheld ? 0.45 : 0)))
    : Math.max(0.75, Math.min(1.15, 0.75 + motionEnergy * 0.25 + dramaticEnergy * 0.25));

  return baseIntensity * actionMultiplier;
}




