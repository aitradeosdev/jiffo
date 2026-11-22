import { describe, expect, it, vi } from 'vitest';
import { TerraDrawExtend } from 'terra-draw';
import { startDrawing } from './drawing';

/** A map adapter that, as Mapbox's does, says it is ready while Terra Draw starts, not after. */
class ReadyAtOnce extends TerraDrawExtend.TerraDrawBaseAdapter {
  private readonly element = { addEventListener: () => {}, removeEventListener: () => {}, style: {} };
  constructor() {
    super({ coordinatePrecision: 6 });
  }
  register(callbacks: Parameters<TerraDrawExtend.TerraDrawBaseAdapter['register']>[0]) {
    super.register(callbacks);
    callbacks.onReady?.();
  }
  getMapEventElement() {
    return this.element as unknown as HTMLElement;
  }
  clear() {}
  project() {
    return { x: 0, y: 0 };
  }
  unproject() {
    return { lng: 0, lat: 0 };
  }
  setCursor() {}
  getLngLatFromEvent() {
    return null;
  }
  setDraggability() {}
  setDoubleClickToZoom() {}
  render() {}
}

/** Settings, Places draws on Google's map or Mapbox's with the same drawing tool. */
describe('the Places drawing tool', () => {
  it('is ready on a map that says so while it starts, as Mapbox does', () => {
    const ready = vi.fn();
    const terra = startDrawing(new ReadyAtOnce(), { current: () => {} }, { current: false }, ready);
    expect(ready).toHaveBeenCalledWith(terra);
    terra.stop();
  });
});
