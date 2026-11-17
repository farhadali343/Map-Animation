import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AdvancedMarker,
  Map as GoogleMap,
  Pin,
  useMap,
  useMapsLibrary,
} from '@vis.gl/react-google-maps';
import { MapPin, Navigation, Plus, Search } from 'lucide-react';
import type { LatLng } from '../types/project';

interface GoogleMapsStageProps {
  center: LatLng;
  zoom: number;
  onAddKeyframeAt: (loc: LatLng, label: string) => void;
  onAddComputedRoute: (name: string, points: LatLng[], distanceLabel: string) => void;
}

function checkQuotaRejection(err: unknown) {
  const msg = String(err || '');
  if (
    msg.includes('RESOURCE_EXHAUSTED') ||
    msg.includes('OVER_QUERY_LIMIT') ||
    msg.includes('429') ||
    msg.includes('Quota')
  ) {
    window.dispatchEvent(new CustomEvent('gmp-quota-exceeded'));
  }
}

export function GoogleMapsStage({
  center,
  zoom,
  onAddKeyframeAt,
  onAddComputedRoute,
}: GoogleMapsStageProps) {
  const map = useMap();
  const placesLib = useMapsLibrary('places');
  const routesLib = useMapsLibrary('routes');

  const [query, setQuery] = useState('');
  const [suggestions, setSuggestions] = useState<google.maps.places.AutocompleteSuggestion[]>([]);
  const [pickedPoint, setPickedPoint] = useState<{ lat: number; lng: number; label: string } | null>(null);
  const [routeOrigin, setRouteOrigin] = useState<{ lat: number; lng: number; label: string } | null>(null);
  const [routeDest, setRouteDest] = useState<{ lat: number; lng: number; label: string } | null>(null);
  const [routeBusy, setRouteBusy] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [mapTypeId, setMapTypeId] = useState<'hybrid' | 'roadmap' | 'terrain'>('hybrid');

  const sessionTokenRef = useRef<google.maps.places.AutocompleteSessionToken | null>(null);
  const polylinesRef = useRef<google.maps.Polyline[]>([]);

  // Fetch Places API (New) autocomplete suggestions
  useEffect(() => {
    if (!placesLib || !query.trim()) {
      setSuggestions([]);
      return;
    }

    const timer = setTimeout(async () => {
      try {
        if (!sessionTokenRef.current) {
          sessionTokenRef.current = new placesLib.AutocompleteSessionToken();
        }
        const res = await placesLib.AutocompleteSuggestion.fetchAutocompleteSuggestions({
          input: query.trim(),
          sessionToken: sessionTokenRef.current,
        });
        setSuggestions(res.suggestions || []);
      } catch (err) {
        checkQuotaRejection(err);
      }
    }, 240);

    return () => clearTimeout(timer);
  }, [placesLib, query]);

  const handleSelectSuggestion = useCallback(
    async (suggestion: google.maps.places.AutocompleteSuggestion) => {
      if (!placesLib || !suggestion.placePrediction) return;
      try {
        const place = suggestion.placePrediction.toPlace();
        await place.fetchFields({
          fields: ['displayName', 'formattedAddress', 'location', 'viewport'],
        });
        const loc = place.location;
        if (loc && map) {
          const lat = loc.lat();
          const lng = loc.lng();
          const label = place.displayName || place.formattedAddress || query;
          setPickedPoint({ lat, lng, label });
          if (place.viewport) {
            map.fitBounds(place.viewport);
          } else {
            map.panTo({ lat, lng });
            map.setZoom(10);
          }
          setStatusMessage(`Focused on ${label}`);
        }
        setSuggestions([]);
        setQuery('');
        sessionTokenRef.current = null;
      } catch (err) {
        checkQuotaRejection(err);
        setStatusMessage('Unable to fetch place details.');
      }
    },
    [placesLib, map, query],
  );

  const handleMapClick = useCallback((ev: { detail: { latLng?: { lat: number; lng: number } | null } }) => {
    const ll = ev.detail?.latLng;
    if (!ll) return;
    const label = `${ll.lat.toFixed(3)}, ${ll.lng.toFixed(3)}`;
    setPickedPoint({ lat: ll.lat, lng: ll.lng, label });
    setStatusMessage(`Pin set at ${label}`);
  }, []);

  const handleComputeRealRoute = useCallback(async () => {
    if (!routesLib || !map || !routeOrigin || !routeDest) return;
    setRouteBusy(true);
    setStatusMessage(null);

    polylinesRef.current.forEach((p) => p.setMap(null));
    polylinesRef.current = [];

    try {
      const request = {
        origin: { lat: routeOrigin.lat, lng: routeOrigin.lng },
        destination: { lat: routeDest.lat, lng: routeDest.lng },
        travelMode: 'DRIVING',
        fields: ['path', 'distanceMeters', 'durationMillis', 'viewport'],
      };

      const { routes } = await (routesLib.Route as unknown as {
        computeRoutes: (req: unknown) => Promise<{ routes: any[] }>;
      }).computeRoutes(request);

      if (!routes || routes.length === 0) {
        setStatusMessage('No road route found between these two locations.');
        setRouteBusy(false);
        return;
      }

      const primary = routes[0];
      const newPolylines: google.maps.Polyline[] = primary.createPolylines();
      const extractedPoints: LatLng[] = [];

      newPolylines.forEach((pl: google.maps.Polyline) => {
        pl.setOptions({ strokeColor: '#F59E0B', strokeWeight: 5 });
        pl.setMap(map);
        const path = pl.getPath();
        for (let i = 0; i < path.getLength(); i++) {
          const pt = path.getAt(i);
          extractedPoints.push({ lat: pt.lat(), lng: pt.lng() });
        }
      });
      polylinesRef.current = newPolylines;

      if (primary.viewport) {
        map.fitBounds(primary.viewport);
      }

      // Downsample route cleanly for timeline animation smoothness
      const stride = Math.max(1, Math.floor(extractedPoints.length / 45));
      const sampled = extractedPoints.filter((_, i) => i % stride === 0 || i === extractedPoints.length - 1);
      const km = ((primary.distanceMeters || 0) / 1000).toFixed(1);
      onAddComputedRoute(`${routeOrigin.label} to ${routeDest.label}`, sampled, `${km} km`);
      setStatusMessage(`Added ${km} km Google Maps route to timeline!`);
    } catch (err) {
      checkQuotaRejection(err);
      setStatusMessage('Unable to compute route. Verify locations are connected by road.');
    } finally {
      setRouteBusy(false);
    }
  }, [routesLib, map, routeOrigin, routeDest, onAddComputedRoute]);

  useEffect(() => {
    return () => {
      polylinesRef.current.forEach((p) => p.setMap(null));
      polylinesRef.current = [];
    };
  }, []);

  return (
    <div className="relative h-full w-full flex flex-col bg-[#0B0F17]">
      {/* Top Location & Route Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/8 bg-[#131924] px-4 py-3">
        <div className="relative flex-1 min-w-[240px] max-w-md">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search any city, border, or landmark..."
            className="w-full rounded-lg border border-white/10 bg-[#0B0F17] py-2 pl-9 pr-3 text-sm text-slate-100 placeholder:text-slate-500 focus:border-amber-500 focus:outline-none"
          />
          {suggestions.length > 0 && (
            <ul className="absolute left-0 right-0 top-full z-30 mt-1 max-h-64 overflow-y-auto rounded-lg border border-white/10 bg-[#131924] py-1 shadow-xl">
              {suggestions.map((s, idx) => (
                <li key={idx}>
                  <button
                    type="button"
                    onClick={() => handleSelectSuggestion(s)}
                    className="w-full px-3 py-2 text-left text-xs text-slate-200 hover:bg-white/8 cursor-pointer"
                  >
                    {s.placePrediction?.text.text}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="flex items-center gap-2">
          <div className="flex items-center rounded-lg bg-[#0B0F17] p-1 border border-white/8">
            {(['hybrid', 'terrain', 'roadmap'] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                onClick={() => setMapTypeId(mode)}
                className={`px-2.5 py-1 text-xs font-medium rounded-md capitalize transition-colors cursor-pointer ${
                  mapTypeId === mode ? 'bg-slate-800 text-white' : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {mode}
              </button>
            ))}
          </div>

          {pickedPoint && (
            <>
              <button
                type="button"
                onClick={() => onAddKeyframeAt({ lat: pickedPoint.lat, lng: pickedPoint.lng }, pickedPoint.label)}
                className="inline-flex items-center gap-1.5 rounded-lg bg-amber-500 px-3 py-1.5 text-xs font-semibold text-slate-950 hover:bg-amber-400 cursor-pointer whitespace-nowrap"
              >
                <Plus className="h-3.5 w-3.5" />
                Add Camera Keyframe
              </button>
              <button
                type="button"
                onClick={() => setRouteOrigin(pickedPoint)}
                className="rounded-lg border border-white/12 bg-[#0B0F17] px-2.5 py-1.5 text-xs text-slate-200 hover:border-sky-400 cursor-pointer whitespace-nowrap"
              >
                Set Origin
              </button>
              <button
                type="button"
                onClick={() => setRouteDest(pickedPoint)}
                className="rounded-lg border border-white/12 bg-[#0B0F17] px-2.5 py-1.5 text-xs text-slate-200 hover:border-sky-400 cursor-pointer whitespace-nowrap"
              >
                Set Dest
              </button>
            </>
          )}

          {routeOrigin && routeDest && (
            <button
              type="button"
              disabled={routeBusy}
              onClick={handleComputeRealRoute}
              className="inline-flex items-center gap-1.5 rounded-lg bg-sky-500 px-3 py-1.5 text-xs font-semibold text-slate-950 hover:bg-sky-400 disabled:opacity-50 cursor-pointer whitespace-nowrap"
            >
              <Navigation className="h-3.5 w-3.5" />
              {routeBusy ? 'Computing...' : 'Compute Road Route'}
            </button>
          )}
        </div>
      </div>

      {/* Status strip */}
      <div className="flex items-center justify-between border-b border-white/6 bg-[#0E141F] px-4 py-1.5 text-xs text-slate-400">
        <span className="flex items-center gap-1.5">
          <MapPin className="h-3.5 w-3.5 text-amber-400" />
          {statusMessage || 'Click anywhere on Google Maps or search above to pick real coordinates & routes.'}
        </span>
        {(routeOrigin || routeDest) && (
          <span className="font-mono text-[11px] text-slate-300">
            {routeOrigin ? `A: ${routeOrigin.label}` : 'A: unset'} · {routeDest ? `B: ${routeDest.label}` : 'B: unset'}
          </span>
        )}
      </div>

      {/* Explicit sized Google Maps container (CF2) */}
      <div className="relative flex-1 min-h-[420px] w-full">
        <GoogleMap
          mapId="DEMO_MAP_ID"
          internalUsageAttributionIds={['gmp_mcp_codeassist_v1_aistudio']}
          defaultCenter={center}
          defaultZoom={Math.max(2, Math.min(16, Math.round(zoom)))}
          mapTypeId={mapTypeId}
          gestureHandling="greedy"
          disableDefaultUI={false}
          onClick={handleMapClick}
          style={{ width: '100%', height: '100%' }}
        >
          {pickedPoint && (
            <AdvancedMarker position={{ lat: pickedPoint.lat, lng: pickedPoint.lng }}>
              <Pin background="#F59E0B" borderColor="#0B0F17" glyphColor="#0B0F17" />
            </AdvancedMarker>
          )}
          {routeOrigin && (
            <AdvancedMarker position={{ lat: routeOrigin.lat, lng: routeOrigin.lng }}>
              <Pin background="#38BDF8" borderColor="#0B0F17" glyphColor="#0B0F17" glyphText="A" />
            </AdvancedMarker>
          )}
          {routeDest && (
            <AdvancedMarker position={{ lat: routeDest.lat, lng: routeDest.lng }}>
              <Pin background="#22C55E" borderColor="#0B0F17" glyphColor="#0B0F17" glyphText="B" />
            </AdvancedMarker>
          )}
        </GoogleMap>
      </div>
    </div>
  );
}
