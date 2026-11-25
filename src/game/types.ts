export type TruckColorId = 'crimson' | 'tangerine' | 'emerald' | 'cobalt' | 'sunburst';

export interface TruckColorOption {
  id: TruckColorId;
  label: string;
  hex: string;
  accentHex: string;
}

export const TRUCK_COLORS: TruckColorOption[] = [
  { id: 'crimson', label: 'Trail Red', hex: '#d93829', accentHex: '#f59e0b' },
  { id: 'tangerine', label: 'Timber Orange', hex: '#ea580c', accentHex: '#fde047' },
  { id: 'emerald', label: 'Pine Green', hex: '#16a34a', accentHex: '#a3e635' },
  { id: 'cobalt', label: 'Alpine Blue', hex: '#2563eb', accentHex: '#38bdf8' },
  { id: 'sunburst', label: 'Sunburst Gold', hex: '#eab308', accentHex: '#f97316' },
];

export type TimeOfDay = 'morning' | 'sunset' | 'starlight';

export type CameraMode = 'chase' | 'wide' | 'hood';

export interface InputState {
  forward: boolean;
  backward: boolean;
  left: boolean;
  right: boolean;
  boost: boolean;
}

export interface HudSnapshot {
  speedKmh: number;
  rpm: number;
  gear: number;
  starsCollected: number;
  totalStars: number;
  zoneName: string;
  inWater: boolean;
  airborne: boolean;
  webglLost: boolean;
  truckX: number;
  truckZ: number;
  truckYaw: number;
  uncollectedStars: { x: number; z: number }[];
  celebrating: boolean;
  helperMode: boolean;
}

export interface RampSpec {
  x: number;
  z: number;
  yaw: number;
  width: number;
  length: number;
  height: number;
}

export interface BridgeSpec {
  x: number;
  z: number;
  yaw: number;
  width: number;
  length: number;
  deckHeight: number;
}

export interface ObstacleCircle {
  x: number;
  z: number;
  radius: number;
}
