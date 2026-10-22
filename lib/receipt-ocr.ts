import type { Worker } from "tesseract.js";
import { extractReceipt, type ReceiptReading } from "./receipt-details";

export type ReceiptReader = { read(image: Blob): Promise<ReceiptReading>; close(): Promise<void> };

/** One lazy browser worker per scan session; shared by sequential batch images. */
export function createReceiptReader(progress: (message: string) => void): ReceiptReader {
  let worker: Worker | null = null;
  let loading: Promise<Worker> | null = null;
  let closed = false;
  const close = async () => { closed = true; const current = worker; worker = null; if (current) await current.terminate(); };
  return {
    async read(image) {
      if (closed) throw new DOMException("Reading stopped.", "AbortError");
      loading ??= (async () => {
        const { createWorker, OEM } = await import("tesseract.js");
        if (closed) throw new DOMException("Reading stopped.", "AbortError");
        const instance = await createWorker("eng", OEM.LSTM_ONLY, {
          workerPath: "/ocr/worker.min.js", corePath: "/ocr/core", langPath: "/ocr/lang", workerBlobURL: false,
          logger: update => { if (!closed) progress(`${update.status} ${Math.round((update.progress || 0) * 100)}%`); },
          errorHandler: () => {},
        });
        if (closed) { await instance.terminate(); throw new DOMException("Reading stopped.", "AbortError"); }
        worker = instance;
        return instance;
      })().catch(() => {
        if (closed) throw new DOMException("Reading stopped.", "AbortError");
        const error = new Error("The OCR engine could not load. Check your connection, retry, or enter payment details manually.");
        error.name = "ReceiptEngineError";
        throw error;
      });
      const instance = await loading;
      const result = await instance.recognize(image);
      if (closed) throw new DOMException("Reading stopped.", "AbortError");
      const parsed = extractReceipt(result.data.text);
      return { details: parsed.details, warnings: [...parsed.warnings, ...(result.data.confidence < 70 ? ["The image reading has low confidence. Check every field."] : [])] };
    },
    close,
  };
}
