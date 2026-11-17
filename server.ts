import 'dotenv/config';
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { GoogleGenAI, Type, ThinkingLevel } from '@google/genai';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT || 3000);

function getGeminiClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY is not configured in the environment.');
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

function getMapsApiKey(): string {
  return process.env.GOOGLE_MAPS_API_KEY || process.env.VITE_GOOGLE_MAPS_API_KEY || '';
}

async function geocodePlaceServer(query: string): Promise<{ lat: number; lng: number; formattedAddress: string } | null> {
  const apiKey = getMapsApiKey();
  if (!apiKey || !query.trim()) return null;
  try {
    const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(query)}&key=${encodeURIComponent(apiKey)}`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = (await res.json()) as {
      status?: string;
      results?: Array<{
        formatted_address?: string;
        geometry?: { location?: { lat: number; lng: number } };
      }>;
    };
    const first = data.results?.[0];
    if (first?.geometry?.location) {
      return {
        lat: first.geometry.location.lat,
        lng: first.geometry.location.lng,
        formattedAddress: first.formatted_address || query,
      };
    }
    return null;
  } catch {
    return null;
  }
}

function parseWavDurationMs(wavBuffer: Buffer): number {
  if (wavBuffer.length <= 44) return 0;
  // Standard Gemini 3.8 TTS WAV output: 24kHz, mono, 16-bit PCM = 48,000 bytes/sec
  const sampleRate = wavBuffer.readUInt32LE(24) || 24000;
  const byteRate = wavBuffer.readUInt32LE(28) || sampleRate * 2;
  const dataBytes = wavBuffer.length - 44;
  return Math.max(500, Math.round((dataBytes / byteRate) * 1000));
}

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '50mb' }));

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, hasGemini: Boolean(process.env.GEMINI_API_KEY), hasMaps: Boolean(getMapsApiKey()) });
  });

  // Google Maps Platform Geocoding Server Proxy (avoids browser CORS restriction)
  app.get('/api/maps/geocode', async (req, res) => {
    const address = String(req.query.address || '').trim();
    if (!address) {
      res.status(400).json({ error: 'Missing address query parameter.' });
      return;
    }
    const apiKey = getMapsApiKey();
    if (!apiKey) {
      res.status(500).json({ error: 'Google Maps API key is not configured.' });
      return;
    }
    try {
      const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(address)}&key=${encodeURIComponent(apiKey)}`;
      const upstream = await fetch(url);
      if (upstream.status === 429) {
        res.status(429).json({ error: 'Google Maps quota exceeded.', status: 'RESOURCE_EXHAUSTED' });
        return;
      }
      const data = await upstream.json();
      res.json(data);
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : 'Geocoding failed.' });
    }
  });

  // Same-origin Hybrid Satellite & Reference Tile Proxy with LRU Cache (keeps Canvas2D untainted for MP4 export)
  const tileCache = new Map<string, { buf: Buffer; contentType: string }>();
  const MAX_TILE_CACHE = 1600;
  const TRANSPARENT_PNG = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
    'base64',
  );

  app.get('/api/tiles/:layer/:z/:y/:x', async (req, res) => {
    const { layer, z: zStr, y: yStr, x: xStr } = req.params;
    const z = Number.parseInt(zStr, 10);
    const y = Number.parseInt(yStr, 10);
    const x = Number.parseInt(xStr, 10);

    if (
      !['imagery', 'labels', 'roads', 'hillshade', 'topo'].includes(layer) ||
      !Number.isFinite(z) ||
      !Number.isFinite(y) ||
      !Number.isFinite(x) ||
      z < 0 ||
      z > 16
    ) {
      res.status(400).send('Invalid tile parameters.');
      return;
    }

    const maxIdx = 1 << z;
    if (y < 0 || y >= maxIdx || x < 0 || x >= maxIdx) {
      res.status(400).send('Tile coordinates out of bounds.');
      return;
    }

    const cacheKey = `${layer}/${z}/${y}/${x}`;
    const cached = tileCache.get(cacheKey);
    if (cached) {
      // Refresh LRU position
      tileCache.delete(cacheKey);
      tileCache.set(cacheKey, cached);
      res.setHeader('Content-Type', cached.contentType);
      res.setHeader('Cache-Control', 'public, max-age=86400');
      res.send(cached.buf);
      return;
    }

    const upstreamUrl =
      layer === 'imagery'
        ? `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${y}/${x}`
        : layer === 'hillshade'
          ? `https://services.arcgisonline.com/ArcGIS/rest/services/Elevation/World_Hillshade/MapServer/tile/${z}/${y}/${x}`
          : layer === 'topo'
            ? `https://services.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/${z}/${y}/${x}`
            : layer === 'labels'
              ? `https://services.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/${z}/${y}/${x}`
              : `https://services.arcgisonline.com/ArcGIS/rest/services/Reference/World_Transportation/MapServer/tile/${z}/${y}/${x}`;

    try {
      const upstream = await fetch(upstreamUrl, {
        headers: { 'User-Agent': 'CartoReelStudio/1.0' },
      });

      if (!upstream.ok) {
        // Missing overlay tiles (e.g. open ocean labels) resolve cleanly to transparent PNG
        const fallbackType = 'image/png';
        tileCache.set(cacheKey, { buf: TRANSPARENT_PNG, contentType: fallbackType });
        res.setHeader('Content-Type', fallbackType);
        res.setHeader('Cache-Control', 'public, max-age=3600');
        res.send(TRANSPARENT_PNG);
        return;
      }

      const arr = await upstream.arrayBuffer();
      const buf = Buffer.from(arr);
      const contentType = upstream.headers.get('content-type') || (layer === 'imagery' ? 'image/jpeg' : 'image/png');

      if (tileCache.size >= MAX_TILE_CACHE) {
        const oldest = tileCache.keys().next().value;
        if (oldest) tileCache.delete(oldest);
      }
      tileCache.set(cacheKey, { buf, contentType });

      res.setHeader('Content-Type', contentType);
      res.setHeader('Cache-Control', 'public, max-age=86400');
      res.send(buf);
    } catch {
      res.setHeader('Content-Type', 'image/png');
      res.send(TRANSPARENT_PNG);
    }
  });

  // Transcribe uploaded voiceover and extract word-by-word timestamps
  app.post('/api/ai/transcribe', async (req, res) => {
    try {
      const { audioBase64, mimeType, providedTranscript, durationMs } = req.body as {
        audioBase64?: string;
        mimeType?: string;
        providedTranscript?: string;
        durationMs?: number;
      };

      if (!audioBase64 || !mimeType) {
        res.status(400).json({ error: 'Audio data and mimeType are required.' });
        return;
      }

      const ai = getGeminiClient();

      // Step 1: Transcribe audio using gemini-3.5-transcribe
      let transcriptText = (providedTranscript || '').trim();
      if (!transcriptText) {
        const transcribeResp = await ai.models.generateContent({
          model: 'gemini-3.5-transcribe',
          contents: {
            parts: [
              { inlineData: { mimeType, data: audioBase64 } },
              { text: 'Transcribe this voiceover accurately word for word.' },
            ],
          },
        });
        transcriptText = (transcribeResp.text || '').trim();
      }

      if (!transcriptText) {
        res.status(422).json({ error: 'Could not transcribe any speech from the uploaded audio.' });
        return;
      }

      // Step 2: Produce word-level millisecond timings aligned to the audio
      const targetDuration = Math.max(2000, Number(durationMs) || 15000);
      const alignResp = await ai.models.generateContent({
        model: 'gemini-4-hydrogen',
        contents: {
          parts: [
            { inlineData: { mimeType, data: audioBase64 } },
            {
              text:
                `Listen closely to this voiceover audio (total duration ~${targetDuration} ms) and align the exact transcript below into word-by-word millisecond timestamps.\n` +
                `Transcript:\n"""${transcriptText}"""\n\n` +
                `Return every word in order with accurate startMs and endMs matching when the speaker says it. Ensure startMs < endMs and all timestamps stay within 0..${targetDuration}.`,
            },
          ],
        },
        config: {
          thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              words: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    word: { type: Type.STRING },
                    startMs: { type: Type.INTEGER },
                    endMs: { type: Type.INTEGER },
                  },
                  required: ['word', 'startMs', 'endMs'],
                },
              },
            },
            required: ['words'],
          },
        },
      });

      const parsed = JSON.parse((alignResp.text || '{"words":[]}').trim()) as {
        words: Array<{ word: string; startMs: number; endMs: number }>;
      };

      let cursorMs = 0;
      const words = (parsed.words || [])
        .map((w, idx) => {
          const cleanWord = String(w.word || '').trim();
          const rawStart = Math.max(cursorMs, Math.min(targetDuration - 80, Number(w.startMs) || cursorMs));
          const rawEnd = Math.max(rawStart + 80, Math.min(targetDuration, Number(w.endMs) || rawStart + 240));
          cursorMs = rawEnd;
          return {
            id: `w-${idx + 1}`,
            word: cleanWord,
            startMs: Math.round(rawStart),
            endMs: Math.round(rawEnd),
          };
        })
        .filter((w) => w.word.length > 0);

      res.json({ fullText: transcriptText, words });
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : 'Transcription failed.' });
    }
  });

  // Generate AI Voiceover WAV using Gemini 3.8 TTS
  app.post('/api/ai/tts', async (req, res) => {
    try {
      const { text, voiceName = 'Charon', style = 'Engaging, crisp documentary narrator with clear pacing' } = req.body as {
        text?: string;
        voiceName?: string;
        style?: string;
      };

      if (!text || !text.trim()) {
        res.status(400).json({ error: 'Script text is required for voiceover generation.' });
        return;
      }

      const ai = getGeminiClient();
      const response = await ai.models.generateContent({
        model: 'gemini-3.8-flash-lite-tts',
        contents: [
          {
            role: 'user',
            parts: [
              {
                text: text.trim(),
                speechMetadata: {
                  style,
                },
              },
            ],
          },
        ],
        config: {
          responseModalities: ['AUDIO'],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: { voiceName },
            },
          },
        },
      });

      const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
      if (!base64Audio) {
        res.status(500).json({ error: 'No audio returned from Gemini TTS.' });
        return;
      }

      const wavBuffer = Buffer.from(base64Audio, 'base64');
      const durationMs = parseWavDurationMs(wavBuffer);

      res.json({
        audioBase64: base64Audio,
        mimeType: 'audio/wav',
        durationMs,
      });
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : 'AI voiceover generation failed.' });
    }
  });

  // Auto-Direct: Convert script + optional word timings into a complete choreographed map animation storyboard
  app.post('/api/ai/direct-storyboard', async (req, res) => {
    try {
      const {
        topicOrScript,
        words,
        durationMs,
        themePreset = 'vox-tactical',
        generateScriptIfTopic = false,
      } = req.body as {
        topicOrScript?: string;
        words?: Array<{ word: string; startMs: number; endMs: number }>;
        durationMs?: number;
        themePreset?: string;
        generateScriptIfTopic?: boolean;
      };

      if (!topicOrScript || !topicOrScript.trim()) {
        res.status(400).json({ error: 'Provide a narration script or topic prompt.' });
        return;
      }

      const ai = getGeminiClient();
      const targetDuration = Math.max(8000, Math.min(180000, Number(durationMs) || 28000));

      const timingContext =
        words && words.length > 0
          ? `Word timings (ms): ${words.map((w) => `${w.word}[${w.startMs}-${w.endMs}]`).join(' ')}`
          : `Target total video duration: ${targetDuration} ms. Distribute beats naturally across 0..${targetDuration} ms.`;

      const prompt = `You are an elite documentary map video director (Vox, Johnny Harris, RealLifeLore, Zack D. Films 9:16 Reels style).
${generateScriptIfTopic ? 'If the user input is a short topic/prompt rather than a full narration script, first write a punchy, high-retention 25-second documentary script (60-85 words) for it; if it is already a full script, preserve it verbatim.' : 'Preserve the provided narration script verbatim.'}
Theme preset: ${themePreset}.
${timingContext}

Design a complete, richly animated map storyboard timed tightly to EVERY sentence and word timestamp of the voiceover:
1. "title": short documentary title (3-6 words).
2. "scriptText": the exact narration script.
3. "cameraKeyframes": 5 to 8 keyframes spanning 0ms to ${targetDuration}ms. Use wide globe pullbacks ("projectionMode": "globe", zoom 1.5-2.3) when crossing continents/oceans, and deep high-impact zoom-ins ("projectionMode": "mercator", zoom 5.0-11.0 for enclaves, cities, borders, straits; pitch 0-35, bearing -15..15). MANDATORY CLIMAX FINALE: The final 3,500ms must end on a dramatic "expoOut" zoom-out or orbital pullback (never a static slow hold) framing all highlighted territories together for maximum viewer retention. Optionally set "mapStyle": "topo-paper" on dramatic failed-project or historical road-map zoom-in beats, otherwise "satellite". Always provide "placeQuery" (real city, landmark, strait, or country name) so coordinates are geocoded cleanly.
4. "regionMasks": 2 to 5 highlighted countries, enclaves, or territories named or implied in the voiceover (use standard English names like "Spain", "France", "Portugal", "Morocco", "United Kingdom", "Andorra", "Gibraltar", "Llivia", "Ceuta", "Melilla", "Darien Gap", "Colombia", "Panama", "Kazakhstan", "Russia", "United States of America", "New York City", "Chile", "India", "Pakistan", "China", "Japan", "Brazil", "Turkey", "Germany", "Italy", "Egypt", etc.). Choose translucent fillMode ("solid-tint", "hazard-pulse", or airy "hatched") with luminous glowing borders, labelTiltDeg (-10..10), drawBorderDurationMs (500-900), and ALWAYS keep "darkIsolationMask": false so neighboring satellite countries and oceans remain fully visible! Ensure highlighted regionMasks re-appear or stay active during the final climax pullback so viewers see the whole map payoff. NEVER output synthetic labels like "HIGHLIGHT", "SCENE", "AI", or raw latitude/longitude coordinate text — use ONLY real country/place names explicitly discussed in the script.
5. "routes": 1 to 3 animated paths or curved arcs ("solid", "dashed", "dotted", "arc") with 2-6 waypoints (set "placeQuery" on key start/end waypoints so they geocode accurately), dashAnimation ("draw", "grow-dashes", "marching"), endBeaconPulse (true if the route ends at a blockade/border break), distanceLabel (e.g. "706 km"), and travelerType ("walker", "ship", "plane", "car", "none").
6. "overlays": 8 to 14 supporting visual assets tightly synchronized to exact VO word timestamps (attach supporting assets whenever the narrator mentions a country, city, number, distance, danger, weather, conflict, or comparison—zero clutter or filler):
   - "flag-card": rounded country flag card whenever a nation/country is introduced (set countryCode like "ES", "FR", "GB", "US", "PA", "CO", "MA", "KZ", "RU", "CL", "DE", "IT", "PK", "IN", "CN", "JP", "BR", "TR", "EG", plus "placeQuery")
   - "pin-label": crisp white dot + vertical stem + place name (cities, enclaves, straits, peaks, ports named in VO; provide "placeQuery" for exact pin placement; never include "AI" or coordinates)
   - "distance-call": dashed bidirectional distance bracket whenever distance/length/gap is spoken (always provide both "placeQuery" and "targetPlaceQuery" plus lat/lng & targetLat/targetLng)
   - "size-comparison": geographic silhouette comparison when scale/area is compared (provide compareRegionName e.g. "New York City", "Spain", "United Kingdom", "France")
   - "title-badge": clean luminous geographic title over a major feature or milestone banner
   - "stat-counter": giant outlined animated number countFrom -> countTo whenever numbers, years, altitudes, costs, populations, or finale totals are spoken
   - "question-pin": bouncing yellow question mark pin for mystery/anomalous spots
   - "hazard-icon": circular glowing prop icon badge (set "hazardIcon": "skull", "jaguar", "snake", "mosquito", or "no-police") matched to wildlife, jungle, danger, crime, or no-go zones
   - "weather-rain": 3D rainclouds + streaks when monsoon, storms, flood, or jungle weather is mentioned
   - "flow-network": glowing converging flow lines for trade, migration, smuggling, rivers, or transport corridors (provide targetLat/targetLng)
   - "data-diamonds": sequentially popping cyan & red scatter points for hotspots or multi-site patterns
   - "stamp": archival double-bordered rubber stamp with rotationDeg (e.g. -14) for bans, treaties, failures, or climax finale ("CLOSED", "FAILED", "5 BORDERS")
   - "cross-hazard", "hazard-radar", "curved-arrow", "speech-bubble"
7. "sfxCues": auto-placed sound effects ("drone" at start, "whoosh" at every camera move and final climax pullback, "pop" at every flag/pin/icon reveal, "tick" at stat counters, "stamp" at stamp/cross-hazard impacts and finale punch).

Return strictly JSON matching the schema.`;

      const response = await ai.models.generateContent({
        model: 'gemini-4-hydrogen',
        contents: prompt,
        config: {
          thinkingConfig: { thinkingLevel: ThinkingLevel.MEDIUM },
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              title: { type: Type.STRING },
              scriptText: { type: Type.STRING },
              cameraKeyframes: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    timeMs: { type: Type.INTEGER },
                    label: { type: Type.STRING },
                    placeQuery: { type: Type.STRING },
                    lat: { type: Type.NUMBER },
                    lng: { type: Type.NUMBER },
                    zoom: { type: Type.NUMBER },
                    pitch: { type: Type.NUMBER },
                    bearing: { type: Type.NUMBER },
                    projectionMode: { type: Type.STRING },
                    mapStyle: { type: Type.STRING },
                    easing: { type: Type.STRING },
                  },
                  required: ['timeMs', 'label', 'lat', 'lng', 'zoom', 'projectionMode', 'easing'],
                },
              },
              regionMasks: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    regionName: { type: Type.STRING },
                    label: { type: Type.STRING },
                    labelTiltDeg: { type: Type.NUMBER },
                    drawBorderDurationMs: { type: Type.INTEGER },
                    startMs: { type: Type.INTEGER },
                    endMs: { type: Type.INTEGER },
                    fillMode: { type: Type.STRING },
                    color: { type: Type.STRING },
                    borderColor: { type: Type.STRING },
                    darkIsolationMask: { type: Type.BOOLEAN },
                  },
                  required: ['regionName', 'startMs', 'endMs', 'fillMode', 'color', 'borderColor'],
                },
              },
              routes: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    name: { type: Type.STRING },
                    startMs: { type: Type.INTEGER },
                    endMs: { type: Type.INTEGER },
                    style: { type: Type.STRING },
                    color: { type: Type.STRING },
                    distanceLabel: { type: Type.STRING },
                    travelerType: { type: Type.STRING },
                    dashAnimation: { type: Type.STRING },
                    dashLength: { type: Type.NUMBER },
                    dashGap: { type: Type.NUMBER },
                    easing: { type: Type.STRING },
                    showTrailGhost: { type: Type.BOOLEAN },
                    endBeaconPulse: { type: Type.BOOLEAN },
                    points: {
                      type: Type.ARRAY,
                      items: {
                        type: Type.OBJECT,
                        properties: {
                          lat: { type: Type.NUMBER },
                          lng: { type: Type.NUMBER },
                          placeQuery: { type: Type.STRING },
                        },
                        required: ['lat', 'lng'],
                      },
                    },
                  },
                  required: ['name', 'startMs', 'endMs', 'style', 'color', 'points'],
                },
              },
              overlays: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    type: { type: Type.STRING },
                    startMs: { type: Type.INTEGER },
                    endMs: { type: Type.INTEGER },
                    placeQuery: { type: Type.STRING },
                    targetPlaceQuery: { type: Type.STRING },
                    lat: { type: Type.NUMBER },
                    lng: { type: Type.NUMBER },
                    targetLat: { type: Type.NUMBER },
                    targetLng: { type: Type.NUMBER },
                    text: { type: Type.STRING },
                    subtext: { type: Type.STRING },
                    accentColor: { type: Type.STRING },
                    hazardIcon: { type: Type.STRING },
                    countryCode: { type: Type.STRING },
                    compareRegionName: { type: Type.STRING },
                    rotationDeg: { type: Type.NUMBER },
                    countFrom: { type: Type.NUMBER },
                    countTo: { type: Type.NUMBER },
                  },
                  required: ['type', 'startMs', 'endMs', 'lat', 'lng', 'text', 'accentColor'],
                },
              },
              sfxCues: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    type: { type: Type.STRING },
                    timeMs: { type: Type.INTEGER },
                    volume: { type: Type.NUMBER },
                    label: { type: Type.STRING },
                  },
                  required: ['type', 'timeMs'],
                },
              },
            },
            required: ['title', 'scriptText', 'cameraKeyframes', 'regionMasks', 'routes', 'overlays', 'sfxCues'],
          },
        },
      });

      const raw = JSON.parse((response.text || '{}').trim()) as any;

      // Ground keyframe coordinates with Google Maps Geocoding API when placeQuery is provided
      const keyframes = await Promise.all(
        (raw.cameraKeyframes || []).map(async (kf: any, i: number) => {
          let lat = Number(kf.lat) || 0;
          let lng = Number(kf.lng) || 0;
          if (kf.placeQuery && kf.zoom >= 3.2) {
            const geo = await geocodePlaceServer(kf.placeQuery);
            if (geo) {
              lat = geo.lat;
              lng = geo.lng;
            }
          }
          return {
            id: `cam-${i + 1}`,
            timeMs: Math.max(0, Number(kf.timeMs) || 0),
            label: String(kf.label || `Scene ${i + 1}`),
            lat,
            lng,
            zoom: Math.max(1.2, Math.min(14, Number(kf.zoom) || 4)),
            pitch: Math.max(0, Math.min(55, Number(kf.pitch) || 0)),
            bearing: Math.max(-45, Math.min(45, Number(kf.bearing) || 0)),
            projectionMode: kf.projectionMode === 'globe' ? 'globe' : 'mercator',
            mapStyle: kf.mapStyle === 'topo-paper' ? 'topo-paper' : 'satellite',
            easing: ['easeInOutCubic', 'expoOut', 'linear'].includes(kf.easing) ? kf.easing : 'easeInOutCubic',
          };
        }),
      );

      keyframes.sort((a: any, b: any) => a.timeMs - b.timeMs);

      const routes = await Promise.all(
        (raw.routes || []).map(async (r: any, i: number) => {
          const pts = await Promise.all(
            (r.points || []).map(async (p: any) => {
              let lat = Number(p.lat) || 0;
              let lng = Number(p.lng) || 0;
              if (p.placeQuery) {
                const geo = await geocodePlaceServer(String(p.placeQuery));
                if (geo) {
                  lat = geo.lat;
                  lng = geo.lng;
                }
              }
              return { lat, lng };
            }),
          );
          return {
            id: `route-${i + 1}`,
            name: String(r.name || `Route ${i + 1}`),
            startMs: Math.max(0, Number(r.startMs) || 0),
            endMs: Math.max(1000, Number(r.endMs) || targetDuration),
            style: ['solid', 'dashed', 'dotted', 'arc'].includes(r.style) ? r.style : 'solid',
            color: String(r.color || '#FACC15'),
            width: 5,
            glow: true,
            distanceLabel: r.distanceLabel || undefined,
            travelerType: ['none', 'walker', 'ship', 'plane', 'car'].includes(r.travelerType) ? r.travelerType : 'none',
            dashAnimation: ['draw', 'grow-dashes', 'marching', 'none'].includes(r.dashAnimation)
              ? r.dashAnimation
              : 'draw',
            dashLength: typeof r.dashLength === 'number' ? Math.max(2, Math.min(100, r.dashLength)) : undefined,
            dashGap: typeof r.dashGap === 'number' ? Math.max(2, Math.min(80, r.dashGap)) : undefined,
            easing: ['easeInOutCubic', 'expoOut', 'linear'].includes(r.easing) ? r.easing : 'easeInOutCubic',
            showTrailGhost: Boolean(r.showTrailGhost),
            endBeaconPulse: Boolean(r.endBeaconPulse),
            points: pts,
          };
        }),
      );

      const regionMasks = (raw.regionMasks || []).map((m: any, i: number) => {
        const regionName = String(m.regionName || 'Spain');
        const rawLabel = typeof m.label === 'string' ? m.label.trim() : '';
        const cleanLabel = /^(highlight|scene|ai|region)$/i.test(rawLabel) ? regionName : (rawLabel || regionName);
        return {
          id: `mask-${i + 1}`,
          regionName,
          label: cleanLabel,
          labelTiltDeg: typeof m.labelTiltDeg === 'number' ? Math.max(-25, Math.min(25, m.labelTiltDeg)) : -4,
          drawBorderDurationMs: typeof m.drawBorderDurationMs === 'number' ? Math.max(250, Math.min(2000, m.drawBorderDurationMs)) : 650,
          startMs: Math.max(0, Number(m.startMs) || 0),
          endMs: Math.max(1000, Number(m.endMs) || targetDuration),
          fillMode: ['hatched', 'solid-tint', 'hazard-pulse'].includes(m.fillMode) ? m.fillMode : 'solid-tint',
          color: String(m.color || '#16A34A'),
          borderColor: String(m.borderColor || '#FFFFFF'),
          borderGlow: true,
          darkIsolationMask: false,
        };
      });

      const overlays = await Promise.all(
        (raw.overlays || []).map(async (o: any, i: number) => {
          let lat = Number(o.lat) || 0;
          let lng = Number(o.lng) || 0;
          let targetLat = typeof o.targetLat === 'number' ? o.targetLat : undefined;
          let targetLng = typeof o.targetLng === 'number' ? o.targetLng : undefined;

          if (o.placeQuery) {
            const geo = await geocodePlaceServer(String(o.placeQuery));
            if (geo) {
              lat = geo.lat;
              lng = geo.lng;
            }
          }
          if (o.targetPlaceQuery) {
            const targetGeo = await geocodePlaceServer(String(o.targetPlaceQuery));
            if (targetGeo) {
              targetLat = targetGeo.lat;
              targetLng = targetGeo.lng;
            }
          }

          return {
            id: `ov-${i + 1}`,
            type: [
              'title-badge',
              'curved-arrow',
              'question-pin',
              'flag-card',
              'hazard-radar',
              'hazard-icon',
              'flow-network',
              'data-diamonds',
              'stamp',
              'stat-counter',
              'speech-bubble',
              'weather-rain',
              'size-comparison',
              'cross-hazard',
              'pin-label',
              'distance-call',
            ].includes(o.type)
              ? o.type
              : 'title-badge',
            startMs: Math.max(0, Number(o.startMs) || 0),
            endMs: Math.max(1000, Number(o.endMs) || targetDuration),
            lat,
            lng,
            targetLat,
            targetLng,
            text: String(o.text || '').replace(/\bAI\b/gi, '').trim(),
            subtext: o.subtext ? String(o.subtext) : undefined,
            accentColor: String(o.accentColor || '#F59E0B'),
            hazardIcon: ['skull', 'jaguar', 'snake', 'mosquito', 'no-police'].includes(o.hazardIcon)
              ? o.hazardIcon
              : undefined,
            countryCode: o.countryCode ? String(o.countryCode).toUpperCase().slice(0, 2) : undefined,
            compareRegionName: o.compareRegionName ? String(o.compareRegionName) : undefined,
            rotationDeg: typeof o.rotationDeg === 'number' ? o.rotationDeg : undefined,
            countFrom: typeof o.countFrom === 'number' ? o.countFrom : undefined,
            countTo: typeof o.countTo === 'number' ? o.countTo : undefined,
          };
        }),
      );

      const sfxCues = (raw.sfxCues || []).map((s: any, i: number) => ({
        id: `sfx-${i + 1}`,
        type: ['whoosh', 'pop', 'tick', 'stamp', 'drone'].includes(s.type) ? s.type : 'whoosh',
        timeMs: Math.max(0, Number(s.timeMs) || 0),
        volume: typeof s.volume === 'number' ? Math.max(0.1, Math.min(1, s.volume)) : 0.7,
        label: s.label || s.type,
      }));

      res.json({
        title: String(raw.title || 'Untitled Map Reel'),
        scriptText: String(raw.scriptText || topicOrScript),
        cameraKeyframes: keyframes,
        regionMasks,
        routes,
        overlays,
        sfxCues,
      });
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : 'Storyboard direction failed.' });
    }
  });

  // Auto-generate timed animated pop-in city markers grounded with real coordinates
  app.post('/api/ai/generate-city-pins', async (req, res) => {
    try {
      const {
        title,
        scriptText,
        durationMs = 24000,
        regionMasks = [],
        cameraKeyframes = [],
        routes = [],
      } = req.body as {
        title?: string;
        scriptText?: string;
        durationMs?: number;
        regionMasks?: Array<{ regionName: string; startMs: number; endMs: number }>;
        cameraKeyframes?: Array<{ timeMs: number; label: string; lat: number; lng: number; zoom: number }>;
        routes?: Array<{ name: string; startMs: number; endMs: number; points: Array<{ lat: number; lng: number }> }>;
      };

      const ai = getGeminiClient();
      const targetDuration = Math.max(6000, Math.min(180000, Number(durationMs) || 24000));

      const contextSummary = [
        title ? `Title: ${title}` : '',
        scriptText ? `Script: ${scriptText}` : '',
        regionMasks.length > 0
          ? `Regions: ${regionMasks.map((r) => `${r.regionName} [${r.startMs}-${r.endMs}ms]`).join(', ')}`
          : '',
        cameraKeyframes.length > 0
          ? `Camera Shots: ${cameraKeyframes.map((k) => `${k.label}@${k.timeMs}ms (${k.lat.toFixed(2)},${k.lng.toFixed(2)} z${k.zoom.toFixed(1)})`).join(' | ')}`
          : '',
        routes.length > 0
          ? `Routes: ${routes.map((rt) => `${rt.name} [${rt.startMs}-${rt.endMs}ms]`).join(', ')}`
          : '',
      ]
        .filter(Boolean)
        .join('\n');

      const prompt = `You are a documentary cartographer picking key real-world cities/towns for animated pop-in map pins.
Total video duration: ${targetDuration} ms.
Context:
${contextSummary}

Select 4 to 6 important, geographically distinct key cities or settlements visible during the camera shots above (e.g., capital cities, border towns, route waypoints, or major nearby cities).
For each city, return:
- "city": concise city name (e.g. "Madrid", "Barcelona", "Gibraltar", "Tangier", "Panama City", "Bogota", "Punta Arenas", "Hull")
- "countryHint": country or full query for accurate geocoding (e.g. "Madrid, Spain")
- "subtext": short 1-3 word documentary role (e.g. "Spanish Capital", "Border Gateway", "1998 Start")
- "startMs": timestamp aligned to when that region is in camera view (0 to ${Math.max(2000, targetDuration - 2500)})
- "endMs": startMs + 2800 to 5000 ms (capped at ${targetDuration})
- "accentColor": crisp hex color (#FACC15, #38BDF8, #EF4444, #4ADE80, or #FFFFFF)
- "lat" and "lng": approximate coordinates

Return strictly JSON.`;

      const response = await ai.models.generateContent({
        model: 'gemini-4-hydrogen',
        contents: prompt,
        config: {
          thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              cities: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    city: { type: Type.STRING },
                    countryHint: { type: Type.STRING },
                    subtext: { type: Type.STRING },
                    startMs: { type: Type.INTEGER },
                    endMs: { type: Type.INTEGER },
                    accentColor: { type: Type.STRING },
                    lat: { type: Type.NUMBER },
                    lng: { type: Type.NUMBER },
                  },
                  required: ['city', 'countryHint', 'startMs', 'endMs', 'lat', 'lng'],
                },
              },
            },
            required: ['cities'],
          },
        },
      });

      const raw = JSON.parse((response.text || '{"cities":[]}').trim()) as {
        cities?: Array<{
          city: string;
          countryHint?: string;
          subtext?: string;
          startMs: number;
          endMs: number;
          accentColor?: string;
          lat: number;
          lng: number;
        }>;
      };

      const grounded = await Promise.all(
        (raw.cities || []).slice(0, 6).map(async (c, idx) => {
          let lat = Number(c.lat) || 0;
          let lng = Number(c.lng) || 0;
          const geo = await geocodePlaceServer(c.countryHint || c.city);
          if (geo) {
            lat = geo.lat;
            lng = geo.lng;
          }
          const startMs = Math.max(0, Math.min(targetDuration - 1200, Math.round(Number(c.startMs) || idx * 2500)));
          const endMs = Math.max(startMs + 1800, Math.min(targetDuration, Math.round(Number(c.endMs) || startMs + 3600)));
          return {
            id: `city-pop-${Date.now()}-${idx + 1}`,
            type: 'pin-label' as const,
            startMs,
            endMs,
            lat,
            lng,
            text: String(c.city || 'City'),
            subtext: c.subtext ? String(c.subtext) : undefined,
            accentColor: String(c.accentColor || '#FACC15'),
          };
        }),
      );

      res.json({ markers: grounded });
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to generate city markers.' });
    }
  });

  // Translate word-timed subtitles into multiple languages
  app.post('/api/ai/translate-subtitles', async (req, res) => {
    try {
      const { words, targetLanguages } = req.body as {
        words?: Array<{ word: string; startMs: number; endMs: number }>;
        targetLanguages?: Array<{ code: string; name: string; rtl?: boolean }>;
      };

      if (!words || words.length === 0 || !targetLanguages || targetLanguages.length === 0) {
        res.status(400).json({ error: 'Words and targetLanguages are required.' });
        return;
      }

      // Group words into natural 3-5 word caption phrases for clean multi-language translation
      const phrases: Array<{ startMs: number; endMs: number; text: string }> = [];
      for (let i = 0; i < words.length; i += 4) {
        const chunk = words.slice(i, i + 4);
        phrases.push({
          startMs: chunk[0].startMs,
          endMs: chunk[chunk.length - 1].endMs,
          text: chunk.map((c) => c.word).join(' '),
        });
      }

      const ai = getGeminiClient();
      const response = await ai.models.generateContent({
        model: 'gemini-4-hydrogen',
        contents:
          `Translate each timed caption phrase below into these target languages: ${targetLanguages.map((l) => `${l.name} (${l.code})`).join(', ')}.\n` +
          `Keep each translated phrase concise and natural for vertical Reels/Shorts captions.\n\n` +
          `Input phrases:\n${phrases.map((p, idx) => `${idx}: [${p.startMs}-${p.endMs}] "${p.text}"`).join('\n')}`,
        config: {
          thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              tracks: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    languageCode: { type: Type.STRING },
                    languageName: { type: Type.STRING },
                    translatedPhrases: {
                      type: Type.ARRAY,
                      items: {
                        type: Type.OBJECT,
                        properties: {
                          index: { type: Type.INTEGER },
                          text: { type: Type.STRING },
                        },
                        required: ['index', 'text'],
                      },
                    },
                  },
                  required: ['languageCode', 'languageName', 'translatedPhrases'],
                },
              },
            },
            required: ['tracks'],
          },
        },
      });

      const parsed = JSON.parse((response.text || '{"tracks":[]}').trim()) as {
        tracks: Array<{
          languageCode: string;
          languageName: string;
          translatedPhrases: Array<{ index: number; text: string }>;
        }>;
      };

      // Expand translated phrases back into word-timed tokens evenly distributed across each phrase window
      const tracks = (parsed.tracks || []).map((t) => {
        const langMeta = targetLanguages.find((l) => l.code === t.languageCode);
        const outWords: Array<{ id: string; word: string; startMs: number; endMs: number }> = [];
        let wCounter = 0;
        for (const item of t.translatedPhrases || []) {
          const src = phrases[item.index];
          if (!src) continue;
          const tokens = item.text.trim().split(/\s+/).filter(Boolean);
          const span = Math.max(200, src.endMs - src.startMs);
          const step = span / Math.max(1, tokens.length);
          tokens.forEach((tok, ti) => {
            wCounter += 1;
            outWords.push({
              id: `${t.languageCode}-w-${wCounter}`,
              word: tok,
              startMs: Math.round(src.startMs + ti * step),
              endMs: Math.round(src.startMs + (ti + 1) * step),
            });
          });
        }
        return {
          languageCode: t.languageCode,
          languageName: langMeta?.name || t.languageName,
          rtl: Boolean(langMeta?.rtl),
          words: outWords,
        };
      });

      res.json({ tracks });
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : 'Subtitle translation failed.' });
    }
  });

  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`CartoReel Studio server running on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
