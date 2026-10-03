/** Keep the 1080p presentation proportional at any display size or aspect ratio. */
export function projectorViewport(width: number, height: number) {
  const physicalWidth = Math.max(1, Number.isFinite(width) ? width : 1);
  const physicalHeight = Math.max(1, Number.isFinite(height) ? height : 1);
  // Small embedded previews retain their readable, responsive phone/tablet layout.
  const scaled = physicalWidth >= 1000;
  const scale = scaled ? Math.min(physicalWidth / 1920, physicalHeight / 1080) : 1;
  return { width: physicalWidth / scale, height: physicalHeight / scale, scale, scaled };
}
