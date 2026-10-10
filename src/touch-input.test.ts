import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const css = readFileSync(resolve(__dirname, 'index.css'), 'utf8');
const html = readFileSync(resolve(__dirname, '..', 'index.html'), 'utf8');

/**
 * "The Admin site zooms when I tap a field on my phone." Browsers zoom the page when a text field
 * smaller than 16px is focused on a touch screen, and every Admin field is 12–14px. jsdom cannot
 * evaluate media queries, so this pins the rules that fix it rather than their computed effect
 * (which was checked in a phone-sized browser at 320, 360, 375 and 412px).
 */
describe('mobile zoom and fit', () => {
  it('declares the standard responsive viewport, and does not forbid pinch zoom (accessibility)', () => {
    const viewport = /<meta name="viewport" content="([^"]+)"/.exec(html)?.[1] ?? '';
    expect(viewport).toContain('width=device-width');
    expect(viewport).toContain('initial-scale=1');
    expect(viewport).not.toMatch(/user-scalable\s*=\s*(no|0)/);
    expect(viewport).not.toMatch(/maximum-scale/);
  });

  it('raises text fields to 16px on touch screens only', () => {
    const touchBlock = /@media \(pointer: coarse\)\s*\{([\s\S]*?)\n  \}/.exec(css)?.[1] ?? '';
    expect(touchBlock).toMatch(/input:not\(\[type='checkbox'\]\)/);
    expect(touchBlock).toMatch(/select,/);
    expect(touchBlock).toMatch(/textarea/);
    expect(touchBlock).toMatch(/font-size:\s*16px\s*!important/);
    // Nothing outside the touch block sets a blanket 16px on fields, which would change desktop forms.
    expect(css.replace(touchBlock, '')).not.toMatch(/(input|select|textarea)[^{]*\{[^}]*font-size:\s*16px/);
  });

  it('removes double-tap zoom but keeps pinch zoom', () => {
    expect(css).toMatch(/touch-action:\s*manipulation/);
    expect(css).not.toMatch(/touch-action:\s*none/);
  });
});
