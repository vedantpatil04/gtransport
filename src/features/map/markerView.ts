import { MOTION_HEX } from '@/components/status';
import type { MapMarker } from './provider';

/**
 * One vehicle's pin, as a DOM element MapLibre can place.
 *
 * It is built once per driver and repainted in place. Moving a vehicle changes its position (the
 * map's job) and, at most, a few styles here — never the element, so a poll that moves twenty
 * vehicles does not rebuild twenty pins.
 *
 * Two layout rules matter. The element MapLibre receives is exactly the pin's size, so the real
 * coordinate sits at the centre of the dot rather than somewhere between the dot and its label;
 * and it never sets `position` itself, because MapLibre positions markers with its own
 * `position: absolute` and an inline override would stack every pin after the first in normal flow.
 * The plate hangs below the pin as an absolutely positioned child and takes no part in the sizing.
 */

const SELECTED_BORDER = '#1B2B44';

/** The parts of a pin that depend on the screen rather than on the vehicle. */
export interface MarkerAppearance {
  selected: boolean;
  /** Plates are shown when zoomed in; at region scale they would overlap into noise. */
  showLabel: boolean;
  /** Accessible name and tooltip — the plate and the vehicle's state, already translated. */
  description: string;
}

export interface MarkerView {
  /** The element handed to MapLibre. */
  element: HTMLElement;
  update(marker: MapMarker, appearance: MarkerAppearance): void;
}

export function createMarkerView(id: string, onActivate: () => void): MarkerView {
  const root = document.createElement('div');
  root.className = 'size-6 cursor-pointer rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2';
  root.setAttribute('role', 'button');
  root.setAttribute('data-testid', `fleet-marker-${id}`);
  root.tabIndex = 0;

  // An active alert: a pulsing ring that cannot be mistaken for a colour change.
  const ring = document.createElement('div');
  ring.className = 'pointer-events-none absolute -inset-1.5 animate-ring-pulse rounded-full border-2';
  ring.style.borderColor = MOTION_HEX.offline;

  const pin = document.createElement('div');
  pin.className = 'relative flex size-full items-center justify-center rounded-full shadow-md transition-transform duration-150';

  // Direction of travel, drawn only for a moving vehicle that reported a heading.
  const arrow = document.createElement('div');
  arrow.className = 'size-0 border-x-4 border-b-8 border-x-transparent border-b-white';
  pin.append(arrow);

  const label = document.createElement('div');
  label.className =
    'pointer-events-none absolute left-1/2 top-full mt-0.5 -translate-x-1/2 whitespace-nowrap rounded-[3px] border border-[#1a1a1a] bg-plate px-1.5 text-[10px] font-extrabold leading-4 text-[#111] shadow-sm';

  root.append(ring, pin, label);

  root.addEventListener('click', onActivate);
  root.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      onActivate();
    }
  });

  let painted = '';

  return {
    element: root,
    update(marker, { selected, showLabel, description }) {
      const heading = marker.tone === 'moving' && marker.headingDeg !== null ? Math.round(marker.headingDeg) : null;
      const flagged = Boolean(marker.flagged);
      const text = marker.label ?? '';
      const labelShown = Boolean(text) && (showLabel || selected || flagged);

      // Nothing visible changed since the last poll: leave the DOM alone.
      const signature = [marker.tone, heading, flagged, text, labelShown, selected, description].join('|');
      if (signature === painted) return;
      painted = signature;

      pin.style.backgroundColor = MOTION_HEX[marker.tone];
      pin.style.border = selected ? `3px solid ${SELECTED_BORDER}` : '2px solid #fff';
      pin.style.transform = selected ? 'scale(1.2)' : '';
      root.style.zIndex = selected ? '100' : flagged ? '90' : '10';

      arrow.style.display = heading === null ? 'none' : '';
      if (heading !== null) arrow.style.transform = `rotate(${heading}deg)`;

      ring.style.display = flagged ? '' : 'none';

      label.textContent = text;
      label.style.display = labelShown ? '' : 'none';

      root.setAttribute('aria-label', description);
      root.title = description;
    },
  };
}
