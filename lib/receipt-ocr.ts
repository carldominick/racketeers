import type { Worker, Page } from "tesseract.js";
import { combineReceiptReadings, extractReceipt, receiptReferenceKey, type ReceiptReading, type ReceiptExtraction } from "./receipt-details";
import { prepareReceiptImage } from "./receipt-image";

export type ReceiptReader = { read(image: Blob): Promise<ReceiptReading>; close(): Promise<void> };

/** Overall page confidence can hide a badly read reference token. Never silently accept it. */
export function readReceiptPage(data: Pick<Page, "text" | "blocks">): ReceiptExtraction {
  const parsed = extractReceipt(data.text), key = receiptReferenceKey(parsed.details.reference);
  const words = data.blocks?.flatMap(block => block.paragraphs.flatMap(paragraph => paragraph.lines.flatMap(line => line.words)));
  if (!key || !words?.length) return parsed;
  const confidences: number[] = [];
  for (let start = 0; start < words.length; start++) {
    let value = "", confidence = 100;
    for (let end = start; end < words.length && end < start + 12; end++) {
      value += receiptReferenceKey(words[end].text.replace(/[^a-z\d -]/gi, ""));
      confidence = Math.min(confidence, words[end].confidence);
      if (!key.startsWith(value)) break;
      if (value === key) { confidences.push(confidence); break; }
    }
  }
  if (confidences.length && Math.max(...confidences) < 60) {
    parsed.details.reference = "";
    parsed.notices.push("Some reference characters had low OCR confidence in one pass. Check the final reference against the screenshot; digits and letters have not been guessed.");
  }
  return parsed;
}

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
      // UI receipts are not a single block of prose; reset mode for each batch image.
      await instance.setParameters({ tessedit_pageseg_mode: "3" as import("tesseract.js").PSM, preserve_interword_spaces: "1" });
      const result = await instance.recognize(image, {}, { text: true, blocks: true });
      if (closed) throw new DOMException("Reading stopped.", "AbortError");
      const parsed = readReceiptPage(result.data);
      const readings = [parsed];
      const confidences = [result.data.confidence];
      const retryWarnings: string[] = [];
      if (Object.values(parsed.details).some(value => !value) || result.data.confidence < 70) {
        progress("Checking small text and receipt layout…");
        try {
          const enhanced = await prepareReceiptImage(image);
          if (closed) throw new DOMException("Reading stopped.", "AbortError");
          await instance.setParameters({ tessedit_pageseg_mode: "11" as import("tesseract.js").PSM });
          const retry = await instance.recognize(enhanced, {}, { text: true, blocks: true });
          if (closed) throw new DOMException("Reading stopped.", "AbortError");
          readings.push(readReceiptPage(retry.data)); confidences.push(retry.data.confidence);
        } catch (error) {
          if (closed) throw error;
          retryWarnings.push("The additional OCR pass could not finish. Check the original reading or retry.");
        }
      }
      if (closed) throw new DOMException("Reading stopped.", "AbortError");
      const combined = combineReceiptReadings(readings);
      return { details: combined.details, warnings: [...combined.warnings, ...retryWarnings, ...(confidences.some(value => value < 70) ? ["The image reading has low confidence. Check every field."] : [])] };
    },
    close,
  };
}
