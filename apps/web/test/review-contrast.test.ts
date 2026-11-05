import { describe, expect, it } from 'vitest';

// Mirrors the token values in apps/web/src/app/globals.css. Kept as literal hex, like
// notebook-loading-palette.test.ts, so this fails loudly if a token value drifts.
const PAPER = '#fcfbf7';
const STUDENT_DEEP = '#0e8a73';
const MUTED_DEEP = '#57534e';
const INK = '#292524';

function luminance(hex: string): number {
  const channels = [1, 3, 5].map((offset) => {
    const value = Number.parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  const [red = 0, green = 0, blue = 0] = channels;
  return red * 0.2126 + green * 0.7152 + blue * 0.0722;
}

function contrast(hexA: string, hexB: string): number {
  const luminanceA = luminance(hexA);
  const luminanceB = luminance(hexB);
  const lighter = Math.max(luminanceA, luminanceB);
  const darker = Math.min(luminanceA, luminanceB);
  return (lighter + 0.05) / (darker + 0.05);
}

/** Mirrors color-mix(in srgb, <fromHex> <percent>%, <toHex>). */
function mix(fromHex: string, percent: number, toHex: string = PAPER): string {
  const a = Number.parseInt(fromHex.slice(1), 16);
  const b = Number.parseInt(toHex.slice(1), 16);
  const channel = (shift: number): number => {
    const from = (a >> shift) & 0xff;
    const to = (b >> shift) & 0xff;
    return Math.round(from * (percent / 100) + to * (1 - percent / 100));
  };
  return `#${[16, 8, 0].map((shift) => channel(shift).toString(16).padStart(2, '0')).join('')}`;
}

describe('review section muted-text contrast', () => {
  it('meets WCAG AA (4.5:1) against the plain section background', () => {
    expect(contrast(MUTED_DEEP, PAPER)).toBeGreaterThanOrEqual(4.5);
  });
});

describe('selected rating choice contrast', () => {
  // .ratingChoice:has(input:checked) fills with color-mix(review-accent 16%, paper); the numeral
  // uses notebook ink rather than the accent itself, per the contrast finding on PR #144.
  it('meets WCAG AA (4.5:1) for the ink numeral against the mint-filled selected background', () => {
    expect(contrast(INK, mix(STUDENT_DEEP, 16))).toBeGreaterThanOrEqual(4.5);
  });
});

describe('retry link contrast', () => {
  // .retry's resting text color is ink (the accent is kept only as the underline color), since
  // --review-accent alone measures ~4.14:1 on plain paper at 13px/700, below WCAG AA.
  it('meets WCAG AA (4.5:1) against the plain section background', () => {
    expect(contrast(INK, PAPER)).toBeGreaterThanOrEqual(4.5);
  });
});
