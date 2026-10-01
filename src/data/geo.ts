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

// Equirectangular projection tuned for ~15.5°N: 100 units ≈ 111 km on both axes. The demo simulation
// uses it to turn a route segment into a heading, so FleetPosition.heading is a screen-space angle
// (0° = east, clockwise), not a compass bearing; the demo Fleet screen converts it for the map.
const LNG0 = 71.5;
const LAT0 = 19.8;
const KX = 100 * Math.cos((15.5 * Math.PI) / 180);
const KY = 100;

export const project = (lat: number, lng: number) => ({ x: (lng - LNG0) * KX, y: (LAT0 - lat) * KY });

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
