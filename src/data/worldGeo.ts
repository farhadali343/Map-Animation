import * as topojson from 'topojson-client';
import countriesAtlas from 'world-atlas/countries-10m.json';
import type { LatLng } from '../types/project';

export interface GeoBbox {
  minLat: number;
  maxLat: number;
  minLng: number;
  maxLng: number;
}

export interface CountryFeature {
  id: string;
  name: string;
  rings: LatLng[][]; // all outer + hole rings for full mask rendering
  mainlandRing: LatLng[]; // largest-area contiguous mainland ring
  centroid: LatLng; // visual interior center of dominant mainland body
  bbox: GeoBbox;
}

const DEG2RAD = Math.PI / 180;

const CUSTOM_POLYGONS: Record<string, LatLng[][]> = {
  'darien gap': [
    [
      { lat: 9.04, lng: -77.96 },
      { lat: 8.95, lng: -77.72 },
      { lat: 8.85, lng: -77.48 },
      { lat: 8.68, lng: -77.32 },
      { lat: 8.46, lng: -77.22 },
      { lat: 8.22, lng: -77.08 },
      { lat: 7.98, lng: -76.98 },
      { lat: 7.72, lng: -76.96 },
      { lat: 7.46, lng: -77.04 },
      { lat: 7.24, lng: -77.22 },
      { lat: 7.11, lng: -77.46 },
      { lat: 7.16, lng: -77.72 },
      { lat: 7.26, lng: -77.94 },
      { lat: 7.48, lng: -78.16 },
      { lat: 7.76, lng: -78.28 },
      { lat: 8.04, lng: -78.32 },
      { lat: 8.34, lng: -78.28 },
      { lat: 8.62, lng: -78.19 },
      { lat: 8.86, lng: -78.08 },
    ],
  ],
  andorra: [
    [
      { lat: 42.655, lng: 1.545 },
      { lat: 42.636, lng: 1.618 },
      { lat: 42.618, lng: 1.692 },
      { lat: 42.582, lng: 1.786 },
      { lat: 42.544, lng: 1.766 },
      { lat: 42.506, lng: 1.735 },
      { lat: 42.472, lng: 1.702 },
      { lat: 42.442, lng: 1.648 },
      { lat: 42.428, lng: 1.564 },
      { lat: 42.433, lng: 1.495 },
      { lat: 42.456, lng: 1.438 },
      { lat: 42.498, lng: 1.418 },
      { lat: 42.546, lng: 1.412 },
      { lat: 42.592, lng: 1.434 },
      { lat: 42.632, lng: 1.482 },
    ],
  ],
  gibraltar: [
    [
      { lat: 36.155, lng: -5.358 },
      { lat: 36.155, lng: -5.341 },
      { lat: 36.144, lng: -5.336 },
      { lat: 36.132, lng: -5.335 },
      { lat: 36.119, lng: -5.341 },
      { lat: 36.109, lng: -5.346 },
      { lat: 36.113, lng: -5.354 },
      { lat: 36.128, lng: -5.358 },
      { lat: 36.143, lng: -5.359 },
    ],
  ],
  llivia: [
    [
      { lat: 42.482, lng: 1.968 },
      { lat: 42.48, lng: 1.984 },
      { lat: 42.476, lng: 1.996 },
      { lat: 42.464, lng: 2.008 },
      { lat: 42.454, lng: 1.998 },
      { lat: 42.446, lng: 1.978 },
      { lat: 42.452, lng: 1.962 },
      { lat: 42.466, lng: 1.951 },
    ],
  ],
  'pheasant island': [
    [
      { lat: 43.3435, lng: -1.7662 },
      { lat: 43.3438, lng: -1.7644 },
      { lat: 43.3433, lng: -1.7634 },
      { lat: 43.3428, lng: -1.7642 },
      { lat: 43.3429, lng: -1.766 },
    ],
  ],
  ceuta: [
    [
      { lat: 35.908, lng: -5.348 },
      { lat: 35.91, lng: -5.318 },
      { lat: 35.908, lng: -5.288 },
      { lat: 35.894, lng: -5.276 },
      { lat: 35.879, lng: -5.298 },
      { lat: 35.875, lng: -5.328 },
      { lat: 35.882, lng: -5.356 },
    ],
  ],
  melilla: [
    [
      { lat: 35.318, lng: -2.956 },
      { lat: 35.316, lng: -2.936 },
      { lat: 35.306, lng: -2.924 },
      { lat: 35.292, lng: -2.922 },
      { lat: 35.276, lng: -2.932 },
      { lat: 35.268, lng: -2.948 },
      { lat: 35.276, lng: -2.968 },
      { lat: 35.3, lng: -2.966 },
    ],
  ],
  'new york city': [
    [
      { lat: 40.915, lng: -73.91 },
      { lat: 40.895, lng: -73.79 },
      { lat: 40.82, lng: -73.76 },
      { lat: 40.755, lng: -73.7 },
      { lat: 40.66, lng: -73.74 },
      { lat: 40.57, lng: -73.85 },
      { lat: 40.575, lng: -74.01 },
      { lat: 40.505, lng: -74.24 },
      { lat: 40.64, lng: -74.19 },
      { lat: 40.71, lng: -74.02 },
      { lat: 40.81, lng: -73.96 },
    ],
  ],
};

const ALIASES: Record<string, string> = {
  uk: 'united kingdom',
  britain: 'united kingdom',
  'great britain': 'united kingdom',
  usa: 'united states of america',
  us: 'united states of america',
  'united states': 'united states of america',
  'darién gap': 'darien gap',
  uae: 'united arab emirates',
  nyc: 'new york city',
  'new york': 'new york city',
};

let cachedCountries: CountryFeature[] | null = null;
const byNameLookup: Record<string, CountryFeature> = {};

function extractGeometryRings(geometry: any): { allRings: LatLng[][]; outerRings: LatLng[][] } {
  const allRings: LatLng[][] = [];
  const outerRings: LatLng[][] = [];
  if (!geometry) return { allRings, outerRings };

  if (geometry.type === 'Polygon') {
    geometry.coordinates.forEach((ringCoords: [number, number][], idx: number) => {
      const ring = ringCoords.map(([lng, lat]) => ({ lat, lng }));
      allRings.push(ring);
      if (idx === 0) outerRings.push(ring);
    });
  } else if (geometry.type === 'MultiPolygon') {
    for (const poly of geometry.coordinates) {
      poly.forEach((ringCoords: [number, number][], idx: number) => {
        const ring = ringCoords.map(([lng, lat]) => ({ lat, lng }));
        allRings.push(ring);
        if (idx === 0) outerRings.push(ring);
      });
    }
  }
  return { allRings, outerRings };
}

function computeRingShoelaceAreaAndCentroid(ring: LatLng[]): { area: number; centroid: LatLng } {
  if (ring.length < 3) {
    return { area: 0, centroid: ring[0] || { lat: 0, lng: 0 } };
  }
  let midLat = 0;
  for (const p of ring) midLat += p.lat;
  midLat /= ring.length;
  const cosLat = Math.max(0.15, Math.cos(midLat * DEG2RAD));

  let twiceArea = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < ring.length; i++) {
    const p1 = ring[i];
    const p2 = ring[(i + 1) % ring.length];
    const x1 = p1.lng * cosLat;
    const y1 = p1.lat;
    const x2 = p2.lng * cosLat;
    const y2 = p2.lat;
    const cross = x1 * y2 - x2 * y1;
    twiceArea += cross;
    cx += (x1 + x2) * cross;
    cy += (y1 + y2) * cross;
  }

  const area = Math.abs(twiceArea) * 0.5;
  if (area < 1e-8) {
    let sLat = 0;
    let sLng = 0;
    for (const p of ring) {
      sLat += p.lat;
      sLng += p.lng;
    }
    return { area: 0, centroid: { lat: sLat / ring.length, lng: sLng / ring.length } };
  }

  const invFactor = 1 / (3 * twiceArea);
  return {
    area,
    centroid: {
      lat: cy * invFactor,
      lng: (cx * invFactor) / cosLat,
    },
  };
}

export function isPointInRing(lat: number, lng: number, ring: LatLng[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i].lng;
    const yi = ring[i].lat;
    const xj = ring[j].lng;
    const yj = ring[j].lat;
    const intersect = yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi + 1e-12) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

function findInteriorVisualCenter(ring: LatLng[], shoelaceCenter: LatLng): LatLng {
  // Scan horizontal & vertical chords across the middle bands of the polygon to guarantee label lies inside solid landmass
  let minLat = 90;
  let maxLat = -90;
  let minLng = 180;
  let maxLng = -180;
  for (const p of ring) {
    if (p.lat < minLat) minLat = p.lat;
    if (p.lat > maxLat) maxLat = p.lat;
    if (p.lng < minLng) minLng = p.lng;
    if (p.lng > maxLng) maxLng = p.lng;
  }

  // Test horizontal slices around the shoelace center + central band for widest interior span
  const probeLats = [
    shoelaceCenter.lat,
    minLat + (maxLat - minLat) * 0.5,
    minLat + (maxLat - minLat) * 0.44,
    minLat + (maxLat - minLat) * 0.56,
  ];

  let bestLat = shoelaceCenter.lat;
  let bestLng = shoelaceCenter.lng;
  let bestSpan = isPointInRing(shoelaceCenter.lat, shoelaceCenter.lng, ring) ? 0.001 : -1;

  for (const pLat of probeLats) {
    const xs: number[] = [];
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const yi = ring[i].lat;
      const yj = ring[j].lat;
      if ((yi <= pLat && yj > pLat) || (yj <= pLat && yi > pLat)) {
        const x = ring[i].lng + ((pLat - yi) * (ring[j].lng - ring[i].lng)) / (yj - yi);
        xs.push(x);
      }
    }
    xs.sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const span = xs[k + 1] - xs[k];
      // Prefer wide chord near the vertical middle of the country
      const centerBonus = 1 - Math.abs(pLat - shoelaceCenter.lat) / Math.max(0.1, maxLat - minLat) * 0.25;
      const score = span * centerBonus;
      if (score > bestSpan) {
        bestSpan = score;
        bestLat = pLat;
        bestLng = (xs[k] + xs[k + 1]) * 0.5;
      }
    }
  }

  if (bestSpan > 0) {
    return { lat: bestLat, lng: bestLng };
  }
  return shoelaceCenter;
}

function selectMainlandAndVisualCenter(outerRings: LatLng[][]): { mainlandRing: LatLng[]; centroid: LatLng } {
  if (outerRings.length === 0) {
    return { mainlandRing: [], centroid: { lat: 0, lng: 0 } };
  }
  let bestRing = outerRings[0];
  let bestInfo = computeRingShoelaceAreaAndCentroid(bestRing);

  for (let i = 1; i < outerRings.length; i++) {
    const info = computeRingShoelaceAreaAndCentroid(outerRings[i]);
    if (info.area > bestInfo.area) {
      bestRing = outerRings[i];
      bestInfo = info;
    }
  }

  return {
    mainlandRing: bestRing,
    centroid: findInteriorVisualCenter(bestRing, bestInfo.centroid),
  };
}

function computeBbox(rings: LatLng[][]): GeoBbox {
  let minLat = 90;
  let maxLat = -90;
  let minLng = 180;
  let maxLng = -180;
  for (const ring of rings) {
    for (const p of ring) {
      if (p.lat < minLat) minLat = p.lat;
      if (p.lat > maxLat) maxLat = p.lat;
      if (p.lng < minLng) minLng = p.lng;
      if (p.lng > maxLng) maxLng = p.lng;
    }
  }
  return { minLat, maxLat, minLng, maxLng };
}

export function getWorldCountries(): CountryFeature[] {
  if (cachedCountries) return cachedCountries;

  const atlas = countriesAtlas as any;
  const geo = topojson.feature(atlas, atlas.objects.countries) as any;

  const features: CountryFeature[] = [];
  for (const f of geo.features || []) {
    const name = String(f.properties?.name || f.id || 'Region');
    const { allRings, outerRings } = extractGeometryRings(f.geometry);
    if (allRings.length === 0) continue;
    const { mainlandRing, centroid } = selectMainlandAndVisualCenter(outerRings);
    const item: CountryFeature = {
      id: String(f.id || name),
      name,
      rings: allRings,
      mainlandRing,
      centroid,
      bbox: computeBbox(mainlandRing.length >= 3 ? [mainlandRing] : allRings),
    };
    features.push(item);
    byNameLookup[name.toLowerCase()] = item;
  }

  for (const [k, rings] of Object.entries(CUSTOM_POLYGONS)) {
    const { mainlandRing, centroid } = selectMainlandAndVisualCenter(rings);
    byNameLookup[k] = {
      id: `custom-${k}`,
      name: k,
      rings,
      mainlandRing,
      centroid,
      bbox: computeBbox(rings),
    };
  }

  cachedCountries = features;
  return features;
}

export function findRegionFeature(regionName: string): CountryFeature | null {
  getWorldCountries();
  const normalized = regionName.trim().toLowerCase();
  const aliased = ALIASES[normalized] || normalized;
  if (byNameLookup[aliased]) {
    return byNameLookup[aliased];
  }
  const match = Object.keys(byNameLookup).find((k) => k.includes(aliased) || aliased.includes(k));
  return match ? byNameLookup[match] : null;
}

export function findRegionRings(regionName: string): LatLng[][] | null {
  return findRegionFeature(regionName)?.rings || null;
}
