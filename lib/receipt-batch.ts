import type { ReceiptReader } from "./receipt-ocr";
import { validReceipt, type ReceiptRecord, type ReceiptReading } from "./receipt-details";

export type ReceiptCandidate = { id: string; name: string };
export type BatchReading = ReceiptReading & { registrationId: string; label: string; record: ReceiptRecord };
export type BatchProgress = { total: number; checked: number; read: number; missing: number; reviewed: number; shared: number; failed: number; stopped: boolean };
export class ReceiptRequestError extends Error {
  constructor(message: string, public status: number) { super(message); }
}

/** Terminating Tesseract does not settle its active job promise; cancellation must. */
export function abortable<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const stop = () => reject(new DOMException("Reading stopped.", "AbortError"));
    if (signal.aborted) stop();
    else signal.addEventListener("abort", stop, { once: true });
    operation.then(resolve, reject).finally(() => signal.removeEventListener("abort", stop));
  });
}

export async function readReceiptRecord(registrationId: string, pin: string, signal: AbortSignal, request: typeof fetch = fetch): Promise<ReceiptRecord> {
  const response = await receiptRequest(`/api/payment-details?registrationId=${encodeURIComponent(registrationId)}`, pin, signal, request);
  const record = await response.json() as ReceiptRecord;
  if (!record?.groupId || !record.proofVersion || !Number.isInteger(record.revision) || record.revision < 0 || record.details !== null && !validReceipt(record.details)) throw new ReceiptRequestError("Invalid screenshot details. Please reload.", 503);
  return record;
}
async function receiptRequest(url: string, pin: string, signal: AbortSignal, request: typeof fetch) {
  const timeout = new AbortController();
  const timer = setTimeout(() => timeout.abort(), 15000);
  try {
    const response = await request(url, { headers: { "x-organizer-pin": pin }, signal: AbortSignal.any([signal, timeout.signal]) });
    if (!response.ok) throw new ReceiptRequestError(response.status === 401 || response.status === 403 ? "Organizer access expired. Sign in again before continuing." : response.status === 429 ? "Too many requests. Try again later." : "Unable to load the payment screenshot or its details.", response.status);
    return response;
  } catch (error) {
    if (signal.aborted || error instanceof ReceiptRequestError) throw error;
    throw new ReceiptRequestError("Connection interrupted. Retry the remaining screenshots when connected.", 0);
  } finally { clearTimeout(timer); }
}

/** Bind the reading to the same screenshot and review revision before and after OCR. */
export async function readReceiptImage(options: {
  registrationId: string; pin: string; record: ReceiptRecord; signal: AbortSignal;
  reader: ReceiptReader; request?: typeof fetch; onImage?: (image: Blob) => void;
}): Promise<ReceiptReading & { record: ReceiptRecord }> {
  const { registrationId, pin, record, signal, reader } = options;
  const request = options.request ?? fetch;
  const image = await abortable(receiptRequest(`/api/payment-proof?registrationId=${encodeURIComponent(registrationId)}`, pin, signal, request), signal);
  const blob = await abortable(image.blob(), signal);
  const reading = await abortable(reader.read(blob), signal);
  const current = await abortable(readReceiptRecord(registrationId, pin, signal, request), signal);
  if (record.proofVersion !== current.proofVersion || record.revision !== current.revision || record.groupId !== current.groupId) throw new Error("Screenshot or saved review changed during reading. Read it again before saving.");
  if (signal.aborted) throw new DOMException("Reading stopped.", "AbortError");
  options.onImage?.(blob);
  return { ...reading, record: current };
}

/** Read-only queue. Results stay in memory until an organizer explicitly reviews/saves. */
export async function readReceiptBatch(options: {
  candidates: ReceiptCandidate[]; pin: string; signal: AbortSignal; reader: ReceiptReader;
  excludeGroups?: string[]; includeReviewed?: boolean; request?: typeof fetch;
  onResult: (reading: BatchReading) => void; onProgress: (progress: BatchProgress) => void;
  onIssue: (message: string) => void;
}): Promise<BatchProgress> {
  const { candidates, pin, signal, reader, onResult, onProgress, onIssue } = options;
  const request = options.request ?? fetch;
  const progress: BatchProgress = { total: candidates.length, checked: 0, read: 0, missing: 0, reviewed: 0, shared: 0, failed: 0, stopped: false };
  const groups = new Set(options.excludeGroups);
  const linked = new Set<string>();
  try {
    for (const candidate of candidates) {
      if (signal.aborted) { progress.stopped = true; break; }
      try {
        if (linked.has(candidate.id)) { progress.shared++; continue; }
        const record = await abortable(readReceiptRecord(candidate.id, pin, signal, request), signal);
        for (const id of record.linkedRegistrationIds || []) linked.add(id);
        if (groups.has(record.groupId)) { progress.shared++; continue; }
        groups.add(record.groupId);
        if (!options.includeReviewed && record.reviewedAt && !record.stale) { progress.reviewed++; continue; }
        const reading = await readReceiptImage({ registrationId: candidate.id, pin, record, signal, request, reader });
        const ids = reading.record.linkedRegistrationIds || [candidate.id];
        const label = candidates.filter(item => ids.includes(item.id)).map(item => item.name).join(" / ") || candidate.name;
        onResult({ ...reading, registrationId: candidate.id, label });
        progress.read++;
      } catch (error) {
        if (signal.aborted) { progress.stopped = true; break; }
        if (error instanceof ReceiptRequestError && error.status === 404) { progress.missing++; continue; }
        progress.failed++;
        onIssue(`${candidate.name}: ${error instanceof Error ? error.message : "Screenshot could not be read. Retry or enter the details manually."}`);
        if (error instanceof Error && error.name === "ReceiptEngineError") { progress.stopped = true; break; }
        if (error instanceof ReceiptRequestError && [0,401,403,429,503].includes(error.status)) { progress.stopped = true; break; }
      } finally { progress.checked++; onProgress({ ...progress }); }
    }
  } finally { await reader.close(); }
  return { ...progress };
}
