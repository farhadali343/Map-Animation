export type ThemePresetId = 'vox-tactical' | '3d-globe' | 'vintage-parchment';

export type EasingType = 'easeInOutCubic' | 'expoOut' | 'linear' | 'custom';

export type ProjectionMode = 'mercator' | 'globe';

export type SfxType = 'whoosh' | 'pop' | 'tick' | 'stamp' | 'drone';

export type VoicePersona = 'Charon' | 'Kore' | 'Puck' | 'Fenrir' | 'Zephyr';

export interface LatLng {
  lat: number;
  lng: number;
}

export interface WordTiming {
  id: string;
  word: string;
  startMs: number;
  endMs: number;
}

export interface SubtitleTrack {
  languageCode: string;
  languageName: string;
  rtl?: boolean;
  words: WordTiming[];
}

export interface SubtitleStyle {
  fontFamily: 'Plus Jakarta Sans' | 'Oswald' | 'Playfair Display';
  fontSize: number;
  textColor: string;
  highlightColor: string;
  positionY: number; // 0.65 to 0.88 of frame height
  uppercase: boolean;
  showBackdrop: boolean;
}

export type MapSurfaceStyle = 'satellite' | 'topo-paper';

export type HazardIconKind = 'skull' | 'jaguar' | 'snake' | 'mosquito' | 'no-police';

export interface CameraKeyframe {
  id: string;
  timeMs: number;
  label: string;
  lat: number;
  lng: number;
  zoom: number; // 1.2 (globe) to 14 (local enclave/island)
  pitch: number; // 0 to 55 deg
  bearing: number; // -45 to 45 deg
  projectionMode: ProjectionMode;
  mapStyle?: MapSurfaceStyle;
  easing: EasingType;
  curvePoints?: [number, number, number, number];
  handheldJitter?: boolean;
  followRouteId?: string;
}

export type DashAnimationMode = 'draw' | 'grow-dashes' | 'marching' | 'none';

export interface GeoRoute {
  id: string;
  name: string;
  startMs: number;
  endMs: number;
  points: LatLng[];
  style: 'solid' | 'dashed' | 'dotted' | 'arc';
  color: string;
  width: number;
  glow: boolean;
  easing?: EasingType;
  dashAnimation?: DashAnimationMode;
  dashLength?: number;
  dashLengthStart?: number;
  dashGap?: number;
  dashSpeed?: number;
  showTrailGhost?: boolean;
  endBeaconPulse?: boolean;
  distanceLabel?: string;
  travelerType?: 'none' | 'walker' | 'ship' | 'plane' | 'car';
  travelerLabel?: string;
}

export interface RegionMask {
  id: string;
  regionName: string;
  label?: string;
  labelTiltDeg?: number;
  drawBorderDurationMs?: number;
  startMs: number;
  endMs: number;
  fillMode: 'hatched' | 'solid-tint' | 'hazard-pulse';
  color: string;
  borderColor: string;
  borderGlow: boolean;
  darkIsolationMask: boolean;
  customPolygon?: LatLng[];
  centerOverride?: LatLng;
}

export type OverlayType =
  | 'title-badge'
  | 'pin-label'
  | 'distance-call'
  | 'curved-arrow'
  | 'question-pin'
  | 'flag-card'
  | 'hazard-radar'
  | 'hazard-icon'
  | 'flow-network'
  | 'data-diamonds'
  | 'stamp'
  | 'stat-counter'
  | 'speech-bubble'
  | 'weather-rain'
  | 'size-comparison'
  | 'cross-hazard';

export interface MapOverlay {
  id: string;
  type: OverlayType;
  startMs: number;
  endMs: number;
  lat: number;
  lng: number;
  targetLat?: number;
  targetLng?: number;
  text: string;
  subtext?: string;
  accentColor: string;
  hazardIcon?: HazardIconKind;
  countryCode?: string;
  compareRegionName?: string;
  countFrom?: number;
  countTo?: number;
  scale?: number;
  rotationDeg?: number;
}

export interface SfxCue {
  id: string;
  type: SfxType;
  timeMs: number;
  volume: number;
  label?: string;
}

export interface AudioState {
  sourceType: 'sample' | 'uploaded' | 'ai-tts';
  audioUrl: string | null;
  audioBase64?: string | null;
  mimeType?: string;
  voiceName: VoicePersona;
  voiceStyle: string;
  voiceVolume: number;
  sfxVolume: number;
  ambienceVolume: number;
  waveformPeaks: number[];
}

export interface MapGridSettings {
  enabled: boolean;
  stepDegrees: 10 | 15 | 20 | 30;
  showLabels: boolean;
  highlightEquatorTropics: boolean;
  opacity: number;
}

export interface HybridMapSettings {
  enabled: boolean;
  showBordersAndLabels: boolean;
  showHighways: boolean;
  satelliteOpacity: number;
  labelOpacity: number;
}

export interface MapDepthSettings {
  enabled: boolean;
  exaggeration: number; // 1.0 to 3.0 terrain relief multiplier
  depthOfField: number; // 0 to 1 documentary tilt-shift shallow DOF
}

export interface GlowingEdgeSettings {
  enabled: boolean;
  intensity: number; // 0.5 to 2.5 outer glow light-bleed strength
}

export interface HandheldCameraSettings {
  enabled: boolean;
  intensity: number; // 0.1 to 1.0 micro-vibration amplitude
  highActionOnly: boolean; // ramp intensity during fast moves & impacts
}

export interface MotionBlurSettings {
  enabled: boolean;
  shutterAngle: number; // 90 to 360 degrees (180° = cinematic film shutter)
  samples: number; // 3 to 7 temporal shutter sub-samples
}

export interface MapProject {
  id: string;
  title: string;
  topic: string;
  aspectRatio: '9:16';
  fps: 30 | 60;
  durationMs: number;
  themePreset: ThemePresetId;
  scriptText: string;
  showSafeZones: boolean;
  showSubtitles: boolean;
  mapGrid?: MapGridSettings;
  hybridMap?: HybridMapSettings;
  mapDepth?: MapDepthSettings;
  glowingEdge?: GlowingEdgeSettings;
  handheldCamera?: HandheldCameraSettings;
  motionBlur?: MotionBlurSettings;
  activeLanguageCode: string;
  subtitleStyle: SubtitleStyle;
  subtitleTracks: SubtitleTrack[];
  audio: AudioState;
  cameraKeyframes: CameraKeyframe[];
  routes: GeoRoute[];
  regionMasks: RegionMask[];
  overlays: MapOverlay[];
  sfxCues: SfxCue[];
}

export type TimelineSelection =
  | { kind: 'camera'; id: string }
  | { kind: 'route'; id: string }
  | { kind: 'region'; id: string }
  | { kind: 'overlay'; id: string }
  | { kind: 'sfx'; id: string }
  | null;
