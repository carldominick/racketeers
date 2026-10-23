/** Local retry image only. The uploaded original is never replaced or sent elsewhere. */
export async function prepareReceiptImage(image: Blob): Promise<Blob> {
  if (typeof createImageBitmap === "undefined" || typeof document === "undefined") return image;
  const bitmap = await createImageBitmap(image);
  try {
    // Uploaded receipts are already bounded to 2000px. Bound intermediate canvas memory too.
    const scale = Math.min(2, 3000 / Math.max(bitmap.width, bitmap.height), Math.sqrt(6_000_000 / (bitmap.width * bitmap.height)));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.floor(bitmap.width * scale));
    canvas.height = Math.max(1, Math.floor(bitmap.height * scale));
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) return image;
    context.fillStyle = "#fff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
    enhanceReceiptPixels(pixels.data);
    context.putImageData(pixels, 0, 0);
    return await new Promise<Blob>(resolve => canvas.toBlob(blob => resolve(blob || image), "image/png"));
  } finally { bitmap.close(); }
}

/** Grayscale and mild contrast preserve antialiasing; predominantly dark receipts are inverted. */
export function enhanceReceiptPixels(data: Uint8ClampedArray): void {
  const samples: number[] = [];
  const step = Math.max(4, Math.floor(data.length / 400 / 4) * 4);
  for (let i = 0; i < data.length; i += step) samples.push((data[i] + data[i + 1] + data[i + 2]) / 3);
  samples.sort((a, b) => a - b);
  const invert = samples[Math.floor(samples.length / 2)] < 110;
  for (let i = 0; i < data.length; i += 4) {
    let gray = .299 * data[i] + .587 * data[i + 1] + .114 * data[i + 2];
    if (invert) gray = 255 - gray;
    gray = (gray - 128) * 1.15 + 128;
    data[i] = data[i + 1] = data[i + 2] = gray;
  }
}
