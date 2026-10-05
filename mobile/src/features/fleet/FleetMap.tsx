/**
 * Universal platform export for FleetMap.
 *
 * Platform-specific implementations:
 * - Android / iOS: FleetMap.native.tsx (uses @maplibre/maplibre-react-native)
 * - Web: FleetMap.web.tsx (uses maplibre-gl WebGL DOM canvas)
 *
 * This base file provides TypeScript types and web fallback resolution without pulling
 * native modules into the web bundle.
 */

export type { FleetMapProps } from './FleetMap.web';
export { FleetMap } from './FleetMap.web';
