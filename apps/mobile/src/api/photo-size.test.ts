import { describe, expect, it } from 'vitest';
import { MAX_PHOTO_SIDE, photoResize } from './photo-size';

describe('photos sent from the phone (C1)', () => {
  it('brings a big photo down to the size the server keeps, on its longest side', () => {
    expect(photoResize(4032, 3024)).toEqual({ width: MAX_PHOTO_SIDE });
    expect(photoResize(3024, 4032)).toEqual({ height: MAX_PHOTO_SIDE });
    expect(photoResize(8000, 8000)).toEqual({ width: MAX_PHOTO_SIDE });
  });

  it('leaves a small one, or one whose size the phone did not give, as it is', () => {
    expect(photoResize(1600, 1200)).toBeNull();
    expect(photoResize(MAX_PHOTO_SIDE, 100)).toBeNull();
    expect(photoResize(0, 0)).toBeNull();
    expect(photoResize(Number.NaN, 4000)).toBeNull();
  });
});
