import { describe, expect, it } from 'vitest';
import { isSafePrintSvgReference, pageSizeMm } from './print';

describe('print', () => {
  it('derives the paper size from the page SVG in CSS pixels', () => {
    // A4 at 96 dpi: 793.7 x 1122.5 px
    expect(pageSizeMm('<svg xmlns="http://www.w3.org/2000/svg" width="793.7" height="1122.5">'))
      .toEqual({ widthMm: 210, heightMm: 297 });
    expect(pageSizeMm('<svg viewBox="0 0 10 10">')).toBeNull();
  });

  it('allows only inline images and fragment references', () => {
    expect(isSafePrintSvgReference('#clip-1')).toBe(true);
    expect(isSafePrintSvgReference('data:image/png;base64,AAAA')).toBe(true);
    expect(isSafePrintSvgReference('https://example.com/a.png')).toBe(false);
    expect(isSafePrintSvgReference('data:text/html;base64,AAAA')).toBe(false);
  });
});
