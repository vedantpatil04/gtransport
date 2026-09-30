import { useEffect, useRef, useState } from 'react';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import { MOTION_HEX } from '@/components/status';
import type { MapMarker } from './provider';

interface MapboxMapProps {
  markers: MapMarker[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  className?: string;
  onError?: () => void;
}

const DEFAULT_MAPBOX_TOKEN =
  'pk.eyJ1IjoiZ2FuZ2FtYXRhLXRyYW5zcG9ydCIsImEiOiJjbTdtOG12ZmswMDAwMm5weDR6cXF0MG96In0.placeholder';

export function MapboxMap({ markers, selectedId, onSelect, className, onError }: MapboxMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const markersMapRef = useRef<
    Map<
      string,
      {
        marker: mapboxgl.Marker;
        element: HTMLElement;
        arrow: HTMLElement | null;
        label: HTMLElement | null;
      }
    >
  >(new Map());
  const fittedRef = useRef(false);
  const [mapLoaded, setMapLoaded] = useState(false);

  // Initialize Mapbox map instance once
  useEffect(() => {
    if (!containerRef.current) return;

    const token =
      (import.meta.env.VITE_MAPBOX_ACCESS_TOKEN as string | undefined)?.trim() ||
      (import.meta.env.NEXT_PUBLIC_MAPBOX_TOKEN as string | undefined)?.trim() ||
      DEFAULT_MAPBOX_TOKEN;

    mapboxgl.accessToken = token;

    // Check WebGL support
    if (!mapboxgl.supported()) {
      console.warn('[MapboxMap] WebGL is not supported; falling back to vector map.');
      onError?.();
      return;
    }

    let map: mapboxgl.Map;
    try {
      map = new mapboxgl.Map({
        container: containerRef.current,
        style: 'mapbox://styles/mapbox/streets-v12',
        center: [74.5, 16.5], // Western Maharashtra / Belagavi operating hub
        zoom: 7,
        attributionControl: true,
      });
    } catch (err) {
      console.warn('[MapboxMap] Failed to initialize Mapbox GL:', err);
      onError?.();
      return;
    }

    map.addControl(new mapboxgl.NavigationControl({ showCompass: true, showZoom: true }), 'top-right');
    map.addControl(new mapboxgl.FullscreenControl(), 'top-right');

    map.on('load', () => {
      setMapLoaded(true);
    });

    map.on('error', (e) => {
      // If style or authentication fails and map can't render, degrade safely
      if (e.error && (e.error.message.includes('401') || e.error.message.includes('Unauthorized') || e.error.message.includes('Forbidden'))) {
        console.warn('[MapboxMap] Mapbox token error, falling back:', e.error);
        onError?.();
      }
    });

    mapRef.current = map;

    return () => {
      // Remove all markers
      markersMapRef.current.forEach(({ marker }) => marker.remove());
      markersMapRef.current.clear();
      map.remove();
      mapRef.current = null;
    };
  }, [onError]);

  // Update markers efficiently without re-initializing the map
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const currentIds = new Set<string>();

    markers.forEach((m) => {
      // Skip plottable points with invalid or 0 coordinates
      if (!m.latitude || !m.longitude || (m.latitude === 0 && m.longitude === 0)) return;
      currentIds.add(m.id);

      const isSelected = m.id === selectedId;
      const color = MOTION_HEX[m.tone] || MOTION_HEX.none;
      const existing = markersMapRef.current.get(m.id);

      if (existing) {
        // Smoothly update location
        existing.marker.setLngLat([m.longitude, m.latitude]);

        // Update selected state and colors
        existing.element.style.borderColor = isSelected ? '#1B2B44' : '#FFFFFF';
        existing.element.style.backgroundColor = color;
        existing.element.style.transform = isSelected ? 'scale(1.2)' : 'scale(1)';
        existing.element.style.zIndex = isSelected ? '100' : m.flagged ? '90' : '10';

        // Update direction arrow
        if (existing.arrow) {
          if (m.headingDeg !== null && m.tone === 'moving') {
            existing.arrow.style.display = 'block';
            existing.arrow.style.transform = `rotate(${m.headingDeg}deg)`;
          } else {
            existing.arrow.style.display = 'none';
          }
        }

        // Update label text
        if (existing.label && m.label) {
          existing.label.textContent = m.label;
        }
      } else {
        // Create new custom marker DOM element
        const root = document.createElement('div');
        root.className = 'gangamata-mapbox-marker';
        root.style.cursor = 'pointer';
        root.style.position = 'relative';
        root.style.display = 'flex';
        root.style.flexDirection = 'column';
        root.style.alignItems = 'center';
        root.setAttribute('data-testid', `mapbox-marker-${m.id}`);

        // Pulsing alert ring if flagged
        if (m.flagged) {
          const alertRing = document.createElement('div');
          alertRing.style.position = 'absolute';
          alertRing.style.inset = '-6px';
          alertRing.style.borderRadius = '50%';
          alertRing.style.border = '2px solid #EF4444';
          alertRing.style.animation = 'ping 1.5s cubic-bezier(0, 0, 0.2, 1) infinite';
          root.appendChild(alertRing);
        }

        // Marker pin dot
        const pin = document.createElement('div');
        pin.style.width = '24px';
        pin.style.height = '24px';
        pin.style.borderRadius = '50%';
        pin.style.backgroundColor = color;
        pin.style.border = isSelected ? '3px solid #1B2B44' : '2px solid #FFFFFF';
        pin.style.boxShadow = '0 2px 6px rgba(0,0,0,0.3)';
        pin.style.display = 'flex';
        pin.style.alignItems = 'center';
        pin.style.justifyContent = 'center';
        pin.style.transition = 'transform 0.15s ease, border-color 0.15s ease';

        // Arrow for heading
        let arrowEl: HTMLElement | null = null;
        if (m.headingDeg !== null && m.tone === 'moving') {
          arrowEl = document.createElement('div');
          arrowEl.style.width = '0';
          arrowEl.style.height = '0';
          arrowEl.style.borderLeft = '4px solid transparent';
          arrowEl.style.borderRight = '4px solid transparent';
          arrowEl.style.borderBottom = '8px solid #FFFFFF';
          arrowEl.style.transform = `rotate(${m.headingDeg}deg)`;
          pin.appendChild(arrowEl);
        }

        root.appendChild(pin);

        // Vehicle Plate Label
        let labelEl: HTMLElement | null = null;
        if (m.label) {
          labelEl = document.createElement('div');
          labelEl.textContent = m.label;
          labelEl.style.marginTop = '2px';
          labelEl.style.padding = '1px 5px';
          labelEl.style.fontSize = '10px';
          labelEl.style.fontWeight = 'bold';
          labelEl.style.fontFamily = 'monospace';
          labelEl.style.color = '#1E293B';
          labelEl.style.backgroundColor = 'rgba(255, 255, 255, 0.92)';
          labelEl.style.borderRadius = '3px';
          labelEl.style.border = '1px solid #CBD5E1';
          labelEl.style.boxShadow = '0 1px 3px rgba(0,0,0,0.15)';
          labelEl.style.whiteSpace = 'nowrap';
          labelEl.style.pointerEvents = 'none';
          root.appendChild(labelEl);
        }

        root.addEventListener('click', (e) => {
          e.stopPropagation();
          onSelect(m.id);
        });

        const marker = new mapboxgl.Marker({ element: root, anchor: 'center' })
          .setLngLat([m.longitude, m.latitude])
          .addTo(map);

        markersMapRef.current.set(m.id, {
          marker,
          element: pin,
          arrow: arrowEl,
          label: labelEl,
        });
      }
    });

    // Remove obsolete markers
    markersMapRef.current.forEach((val, id) => {
      if (!currentIds.has(id)) {
        val.marker.remove();
        markersMapRef.current.delete(id);
      }
    });

    // Fit bounds once on first load
    if (mapLoaded && !fittedRef.current && currentIds.size > 0) {
      fittedRef.current = true;
      const bounds = new mapboxgl.LngLatBounds();
      markers.forEach((m) => {
        if (m.latitude && m.longitude && (m.latitude !== 0 || m.longitude !== 0)) {
          bounds.extend([m.longitude, m.latitude]);
        }
      });
      if (!bounds.isEmpty()) {
        map.fitBounds(bounds, { padding: 60, maxZoom: 13, duration: 800 });
      }
    }
  }, [markers, selectedId, mapLoaded, onSelect]);

  // Pan smoothly to selected marker when selectedId changes
  useEffect(() => {
    if (!selectedId || !mapRef.current) return;
    const selected = markers.find((m) => m.id === selectedId);
    if (!selected || !selected.latitude || !selected.longitude) return;

    mapRef.current.flyTo({
      center: [selected.longitude, selected.latitude],
      zoom: Math.max(mapRef.current.getZoom(), 11),
      duration: 700,
    });
  }, [selectedId, markers]);

  return <div ref={containerRef} className={className} data-testid="fleet-mapbox-map" />;
}
