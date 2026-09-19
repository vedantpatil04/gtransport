import type { Driver, MotionState } from '@/types';

export const CITIES = {
  pune: { lat: 18.52, lng: 73.856 },
  satara: { lat: 17.68, lng: 74.018 },
  karad: { lat: 17.289, lng: 74.181 },
  kolhapur: { lat: 16.705, lng: 74.243 },
  sangli: { lat: 16.852, lng: 74.581 },
  nipani: { lat: 16.399, lng: 74.382 },
  chikkodi: { lat: 16.429, lng: 74.587 },
  gokak: { lat: 16.166, lng: 74.824 },
  belagavi: { lat: 15.85, lng: 74.498 },
  khanapur: { lat: 15.637, lng: 74.508 },
  panaji: { lat: 15.49, lng: 73.828 },
  dharwad: { lat: 15.458, lng: 75.008 },
  hubballi: { lat: 15.364, lng: 75.124 },
  gadag: { lat: 15.43, lng: 75.63 },
  haveri: { lat: 14.794, lng: 75.404 },
  davanagere: { lat: 14.464, lng: 75.922 },
  chitradurga: { lat: 14.226, lng: 76.4 },
  tumakuru: { lat: 13.34, lng: 77.101 },
  bengaluru: { lat: 12.972, lng: 77.594 },
  bagalkot: { lat: 16.181, lng: 75.696 },
  vijayapura: { lat: 16.83, lng: 75.71 },
  solapur: { lat: 17.66, lng: 75.906 },
  karwar: { lat: 14.814, lng: 74.129 },
  hosapete: { lat: 15.269, lng: 76.387 },
  ballari: { lat: 15.139, lng: 76.922 },
  sirsi: { lat: 14.62, lng: 74.835 },
} as const;

export type CityId = keyof typeof CITIES;
export const CITY_IDS = Object.keys(CITIES) as CityId[];
export const isCity = (id: string): id is CityId => id in CITIES;

type LatLng = { lat: number; lng: number };

export const HIGHWAYS: { id: string; label: string; major: boolean; path: (CityId | [number, number])[] }[] = [
  { id: 'nh48', label: 'NH 48', major: true, path: ['pune', 'satara', 'karad', 'kolhapur', 'nipani', 'belagavi', 'dharwad', 'hubballi', 'haveri', 'davanagere', 'chitradurga', 'tumakuru', 'bengaluru'] },
  { id: 'nh748', label: 'NH 748', major: true, path: ['belagavi', 'khanapur', [15.55, 74.2], 'panaji'] },
  { id: 'nh66', label: 'NH 66', major: true, path: [[16.4, 73.55], 'panaji', [15.05, 74.05], 'karwar', [14.3, 74.45], [13.35, 74.74], [12.87, 74.86]] },
  { id: 'nh52', label: 'NH 52', major: true, path: ['solapur', 'vijayapura', 'bagalkot', [15.75, 75.45], 'hubballi'] },
  { id: 'nh67', label: 'NH 67', major: false, path: ['hubballi', 'gadag', 'hosapete', 'ballari'] },
  { id: 'nh50', label: 'NH 50', major: false, path: ['vijayapura', [15.9, 76.1], 'hosapete', 'chitradurga'] },
  { id: 'sh1', label: '', major: false, path: ['belagavi', 'gokak', 'bagalkot'] },
  { id: 'sh2', label: '', major: false, path: ['kolhapur', 'sangli'] },
  { id: 'sh3', label: '', major: false, path: ['nipani', 'chikkodi', 'gokak'] },
  { id: 'sh4', label: '', major: false, path: ['karwar', 'sirsi', 'haveri'] },
];

/** West of this line is the Arabian Sea. */
export const COASTLINE: [number, number][] = [
  [19.8, 72.78], [19.0, 72.86], [18.4, 72.96], [17.9, 73.06], [17.3, 73.2], [16.8, 73.31], [16.3, 73.42],
  [15.85, 73.62], [15.5, 73.79], [15.2, 73.93], [14.85, 74.1], [14.5, 74.35], [14.1, 74.48], [13.7, 74.62],
  [13.3, 74.72], [12.9, 74.83], [12.5, 74.95], [11.9, 75.2], [11.2, 75.6],
];

export const BORDERS: [number, number][][] = [
  // Maharashtra – Karnataka
  [[15.72, 73.98], [15.9, 74.2], [16.1, 74.3], [16.35, 74.36], [16.55, 74.62], [16.72, 75.0], [17.0, 75.3], [17.25, 75.8], [17.45, 76.2], [17.7, 76.55], [18.0, 77.0], [18.35, 77.45], [18.5, 77.7]],
  // Goa – Karnataka
  [[15.72, 73.98], [15.5, 74.26], [15.2, 74.3], [14.95, 74.2], [14.88, 74.09]],
  // Goa – Maharashtra
  [[15.72, 73.98], [15.79, 73.67]],
  // Karnataka – Telangana / Andhra
  [[18.5, 77.7], [17.6, 77.62], [16.9, 77.45], [16.3, 77.35], [15.8, 77.05], [15.2, 77.1], [14.6, 77.25], [14.0, 77.5], [13.4, 78.1], [12.9, 78.35]],
  // Karnataka – Kerala / Tamil Nadu
  [[12.5, 74.95], [12.35, 75.4], [11.95, 75.95], [11.75, 76.5], [11.95, 76.95], [12.3, 77.4], [12.55, 77.75], [12.9, 78.35]],
];

export const REGION_LABELS: { key: string; lat: number; lng: number }[] = [
  { key: 'maharashtra', lat: 17.95, lng: 74.9 },
  { key: 'karnataka', lat: 14.95, lng: 76.45 },
  { key: 'goa', lat: 15.3, lng: 74.02 },
  { key: 'sea', lat: 15.6, lng: 72.75 },
];

// Equirectangular projection tuned for ~15.5°N: 100 map units ≈ 111 km on both axes.
const LNG0 = 71.5;
const LAT0 = 19.8;
const KX = 100 * Math.cos((15.5 * Math.PI) / 180);
const KY = 100;
export const KM_PER_UNIT = 1.11;

export const project = (lat: number, lng: number) => ({ x: (lng - LNG0) * KX, y: (LAT0 - lat) * KY });
export const MAP_BOUNDS = { minX: 0, minY: 0, maxX: (79 - LNG0) * KX, maxY: (LAT0 - 11.2) * KY };

export const toLatLng = (p: CityId | [number, number]): LatLng => (Array.isArray(p) ? { lat: p[0], lng: p[1] } : CITIES[p]);

export function haversineKm(a: LatLng, b: LatLng) {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

const ROAD_FACTOR = 1.22;

export function routeLengthKm(route: string[]) {
  let total = 0;
  for (let i = 1; i < route.length; i++) total += haversineKm(toLatLng(route[i - 1] as CityId), toLatLng(route[i] as CityId)) * ROAD_FACTOR;
  return total;
}

export function nearestCity(lat: number, lng: number): CityId {
  let best: CityId = 'belagavi';
  let bestD = Infinity;
  for (const id of CITY_IDS) {
    const d = haversineKm({ lat, lng }, CITIES[id]);
    if (d < bestD) {
      bestD = d;
      best = id;
    }
  }
  return best;
}

export interface FleetPosition {
  driverId: string;
  lat: number;
  lng: number;
  heading: number;
  speedKmh: number;
  motion: MotionState;
  updatedAt: string | null;
  near: CityId;
  /** index of the route city the vehicle is heading to */
  towards: CityId;
  direction: 1 | -1;
  kmFromStart: number;
}

/** Simulation clock runs faster than real time so movement is visible during a demo. */
const SIM_SPEEDUP = 40;
const EPOCH = Date.UTC(2026, 0, 1);

function hash(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return (h >>> 0) / 4294967296;
}

function pointAlong(route: string[], km: number) {
  const pts = route.map((r) => toLatLng(r as CityId));
  let remaining = km;
  for (let i = 1; i < pts.length; i++) {
    const seg = haversineKm(pts[i - 1], pts[i]) * ROAD_FACTOR;
    if (remaining <= seg || i === pts.length - 1) {
      const t = seg === 0 ? 0 : Math.min(1, Math.max(0, remaining / seg));
      const lat = pts[i - 1].lat + (pts[i].lat - pts[i - 1].lat) * t;
      const lng = pts[i - 1].lng + (pts[i].lng - pts[i - 1].lng) * t;
      const a = project(pts[i - 1].lat, pts[i - 1].lng);
      const b = project(pts[i].lat, pts[i].lng);
      const heading = (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI;
      return { lat, lng, heading, segIndex: i };
    }
    remaining -= seg;
  }
  const last = pts[pts.length - 1];
  return { lat: last.lat, lng: last.lng, heading: 0, segIndex: pts.length - 1 };
}

export function positionFor(driver: Driver, now: number): FleetPosition {
  const { sim } = driver;
  const len = Math.max(1, routeLengthKm(sim.route));
  const seed = hash(driver.id);
  let km = sim.offset * len;
  let direction: 1 | -1 = 1;
  let speed = 0;

  if (sim.mode === 'moving') {
    const hours = ((now - EPOCH) / 3_600_000) * SIM_SPEEDUP;
    const travelled = (km + hours * sim.speedKmh) % (2 * len);
    direction = travelled > len ? -1 : 1;
    km = travelled > len ? 2 * len - travelled : travelled;
    speed = Math.round(sim.speedKmh * (0.88 + 0.12 * Math.sin(now / 45_000 + seed * 10)));
  }
  const p = pointAlong(sim.route, km);
  const heading = direction === 1 ? p.heading : p.heading + 180;
  const towardsIdx = direction === 1 ? p.segIndex : p.segIndex - 1;
  const towards = sim.route[Math.max(0, Math.min(sim.route.length - 1, towardsIdx))] as CityId;

  let motion: MotionState = sim.mode;
  let updatedAt: string | null;
  if (!driver.locationSharing || driver.status === 'inactive') {
    motion = 'none';
    updatedAt = null;
  } else if (sim.mode === 'offline') {
    updatedAt = sim.lastSeen ?? new Date(now - 3 * 3_600_000).toISOString();
  } else {
    const interval = sim.mode === 'moving' ? 30_000 : 150_000;
    const lag = (now + seed * interval) % interval;
    updatedAt = new Date(now - lag).toISOString();
  }

  return {
    driverId: driver.id,
    lat: p.lat,
    lng: p.lng,
    heading,
    speedKmh: speed,
    motion,
    updatedAt,
    near: nearestCity(p.lat, p.lng),
    towards,
    direction,
    kmFromStart: km,
  };
}
