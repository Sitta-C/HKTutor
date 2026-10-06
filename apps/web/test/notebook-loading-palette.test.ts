import { describe, expect, it } from 'vitest';

import { notebookLoadingPalette } from '@/components/ui/notebook-loading-palette';

function luminance(hex: string): number {
  const channels = [1, 3, 5].map((offset) => {
    const value = Number.parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  const [red = 0, green = 0, blue = 0] = channels;
  return red * 0.2126 + green * 0.7152 + blue * 0.0722;
}

describe('sticky-note loading colors', () => {
  it('reserves a different color for every loading context', () => {
    const colors = Object.values(notebookLoadingPalette).map((palette) => palette.background);
    expect(new Set(colors).size).toBe(colors.length);
  });

  it.each(Object.entries(notebookLoadingPalette))(
    'keeps %s readable with the note text',
    (_, palette) => {
      const contrast = (luminance(palette.background) + 0.05) / (luminance('#292524') + 0.05);
      expect(contrast).toBeGreaterThanOrEqual(4.5);
    },
  );
});
