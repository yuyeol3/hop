import { describe, expect, it } from 'vitest';
import { clampToViewport } from './desktop-chrome';

describe('desktop chrome', () => {
  it('keeps the IME anchor inside the visible viewport', () => {
    expect(clampToViewport(120, 800)).toBe(120);
    expect(clampToViewport(-30, 800)).toBe(0);
    expect(clampToViewport(900, 800)).toBe(799);
    expect(clampToViewport(Number.NaN, 800)).toBe(0);
  });
});
