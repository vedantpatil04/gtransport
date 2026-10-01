import { describe, expect, it, vi } from 'vitest';
import { MOTION_HEX } from '@/components/status';
import { createMarkerView, type MarkerAppearance } from './markerView';
import type { MapMarker } from './provider';

const marker = (overrides: Partial<MapMarker> = {}): MapMarker => ({
  id: 'd1',
  latitude: 15.85,
  longitude: 74.498,
  headingDeg: null,
  tone: 'moving',
  label: 'KA 22 AB 1234',
  ...overrides,
});

const look = (overrides: Partial<MarkerAppearance> = {}): MarkerAppearance => ({
  selected: false,
  showLabel: true,
  description: 'KA 22 AB 1234 · Moving',
  ...overrides,
});

/** The three children of a pin: the alert ring, the dot, and the plate. */
function parts(element: HTMLElement) {
  const [ring, pin, label] = Array.from(element.children) as HTMLElement[];
  return { ring, pin, arrow: pin.firstElementChild as HTMLElement, label };
}

describe('marker view', () => {
  it('is exactly the size of its dot, so the coordinate is the dot’s centre', () => {
    const { element } = createMarkerView('d1', () => {});
    expect(element.className).toContain('size-6');
  });

  it('never sets `position` itself, which would break MapLibre’s own absolute placement', () => {
    const view = createMarkerView('d1', () => {});
    view.update(marker({ flagged: true }), look({ selected: true }));
    expect(view.element.style.position).toBe('');
    // The plate and ring hang off the dot as absolutely positioned children instead.
    const { label, ring } = parts(view.element);
    expect(label.className).toContain('absolute');
    expect(ring.className).toContain('absolute');
  });

  it('colours the dot by the vehicle’s motion', () => {
    const view = createMarkerView('d1', () => {});
    for (const tone of ['moving', 'stopped', 'offline'] as const) {
      view.update(marker({ tone }), look());
      expect(parts(view.element).pin.style.backgroundColor).toBe(hexToRgb(MOTION_HEX[tone]));
    }
  });

  it('draws a direction arrow only for a moving vehicle that reported a heading, rotated to it', () => {
    const view = createMarkerView('d1', () => {});

    view.update(marker({ tone: 'moving', headingDeg: 163.99 }), look());
    expect(parts(view.element).arrow.style.display).toBe('');
    expect(parts(view.element).arrow.style.transform).toBe('rotate(164deg)');

    view.update(marker({ tone: 'moving', headingDeg: null }), look());
    expect(parts(view.element).arrow.style.display).toBe('none');

    view.update(marker({ tone: 'stopped', headingDeg: 90 }), look({ description: 'stopped' }));
    expect(parts(view.element).arrow.style.display).toBe('none');
  });

  it('pulses a ring around a vehicle with an active alert, and only then', () => {
    const view = createMarkerView('d1', () => {});
    view.update(marker({ flagged: true }), look());
    expect(parts(view.element).ring.style.display).toBe('');
    expect(parts(view.element).ring.className).toContain('animate-ring-pulse');

    view.update(marker({ flagged: false }), look());
    expect(parts(view.element).ring.style.display).toBe('none');
  });

  it('shows the plate when zoomed in, or when selected, or when alerting — and hides it otherwise', () => {
    const view = createMarkerView('d1', () => {});
    const shown = () => parts(view.element).label.style.display !== 'none';

    view.update(marker(), look({ showLabel: true }));
    expect(shown()).toBe(true);
    expect(parts(view.element).label.textContent).toBe('KA 22 AB 1234');

    view.update(marker(), look({ showLabel: false }));
    expect(shown()).toBe(false);

    view.update(marker(), look({ showLabel: false, selected: true }));
    expect(shown()).toBe(true);

    view.update(marker({ flagged: true }), look({ showLabel: false }));
    expect(shown()).toBe(true);
  });

  it('draws no plate for a vehicle without a registration', () => {
    const view = createMarkerView('d1', () => {});
    view.update(marker({ label: null }), look({ showLabel: true }));
    expect(parts(view.element).label.style.display).toBe('none');
  });

  it('marks the selected pin and lifts it above the others', () => {
    const view = createMarkerView('d1', () => {});

    view.update(marker(), look({ selected: false }));
    expect(parts(view.element).pin.style.transform).toBe('');
    expect(view.element.style.zIndex).toBe('10');

    view.update(marker(), look({ selected: true }));
    expect(parts(view.element).pin.style.transform).toBe('scale(1.2)');
    expect(parts(view.element).pin.style.border).toContain('3px');
    expect(view.element.style.zIndex).toBe('100');

    view.update(marker({ flagged: true }), look({ selected: false }));
    expect(view.element.style.zIndex).toBe('90');
  });

  it('is findable and readable: a button with the plate and state as its name', () => {
    const view = createMarkerView('d1', () => {});
    view.update(marker(), look({ description: 'KA 22 AB 1234 · Moving' }));
    expect(view.element.getAttribute('role')).toBe('button');
    expect(view.element.getAttribute('data-testid')).toBe('fleet-marker-d1');
    expect(view.element.getAttribute('aria-label')).toBe('KA 22 AB 1234 · Moving');
    expect(view.element.title).toBe('KA 22 AB 1234 · Moving');
    expect(view.element.tabIndex).toBe(0);
  });

  it('activates on click and on Enter or Space, but not on other keys', () => {
    const onActivate = vi.fn();
    const { element } = createMarkerView('d1', onActivate);

    element.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(onActivate).toHaveBeenCalledTimes(1);

    for (const key of ['Enter', ' ']) element.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
    expect(onActivate).toHaveBeenCalledTimes(3);

    element.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }));
    element.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true, cancelable: true }));
    expect(onActivate).toHaveBeenCalledTimes(3);
  });

  it('leaves the DOM alone when nothing visible has changed since the last update', () => {
    const view = createMarkerView('d1', () => {});
    view.update(marker(), look());

    // If a repeat update repainted, it would overwrite this sentinel.
    parts(view.element).pin.style.backgroundColor = 'rgb(1, 2, 3)';
    view.update(marker(), look());
    expect(parts(view.element).pin.style.backgroundColor).toBe('rgb(1, 2, 3)');

    // A change that matters does repaint.
    view.update(marker({ tone: 'offline' }), look());
    expect(parts(view.element).pin.style.backgroundColor).toBe(hexToRgb(MOTION_HEX.offline));
  });

  it('does not repaint for sub-degree heading jitter, which would be invisible', () => {
    const view = createMarkerView('d1', () => {});
    view.update(marker({ headingDeg: 90.2 }), look());
    // A valid transform the view would never produce for a 90° heading: a repaint would overwrite it.
    parts(view.element).arrow.style.transform = 'rotate(45deg)';
    view.update(marker({ headingDeg: 89.8 }), look());
    expect(parts(view.element).arrow.style.transform).toBe('rotate(45deg)');

    view.update(marker({ headingDeg: 120 }), look());
    expect(parts(view.element).arrow.style.transform).toBe('rotate(120deg)');
  });
});

function hexToRgb(hex: string): string {
  const value = hex.replace('#', '');
  const [r, g, b] = [0, 2, 4].map((i) => Number.parseInt(value.slice(i, i + 2), 16));
  return `rgb(${r}, ${g}, ${b})`;
}
