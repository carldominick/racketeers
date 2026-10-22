"use client";
import { useEffect, useRef, useState } from "react";
import { readReceiptBatch, type BatchProgress, type BatchReading, type ReceiptCandidate } from "../../lib/receipt-batch";
import { createReceiptReader } from "../../lib/receipt-ocr";
import { ReceiptReview } from "./receipt-review";
import { useReceiptNavigationGuard } from "./use-receipt-navigation-guard";

export function ReceiptBatchReview({ registrations, pin, locked = false }: { registrations: ReceiptCandidate[]; pin: string; locked?: boolean }) {
  const [results, setResults] = useState<BatchReading[]>([]);
  const [progress, setProgress] = useState<BatchProgress | null>(null);
  const [phase, setPhase] = useState("");
  const [issues, setIssues] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [includeReviewed, setIncludeReviewed] = useState(false);
  const mounted = useRef(false);
  const running = useRef<AbortController | null>(null);
  useReceiptNavigationGuard(busy);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; running.current?.abort(); }; }, [pin]);
  useEffect(() => { if (locked) running.current?.abort(); }, [locked]);
  const start = async () => {
    if (running.current || locked) return;
    const controller = new AbortController(); running.current = controller;
    setBusy(true); setIssues([]); setProgress(null); setPhase("Checking uploaded screenshots…");
    const reader = createReceiptReader(message => { if (mounted.current && !controller.signal.aborted) setPhase(message); });
    try {
      const summary = await readReceiptBatch({
        candidates: registrations.map(({ id, name }) => ({ id, name })), pin, reader, signal: controller.signal,
        excludeGroups: results.map(result => result.record.groupId), includeReviewed,
        onResult: result => { if (mounted.current) setResults(current => [...current, result]); },
        onProgress: value => { if (mounted.current) setProgress(value); },
        onIssue: message => { if (mounted.current) setIssues(current => [...current, message]); },
      });
      if (mounted.current) setProgress(summary);
    } catch { if (mounted.current) setIssues(current => [...current, "Reading stopped unexpectedly. Completed readings are retained; retry the remaining screenshots."]); }
    finally { running.current = null; if (mounted.current) { setBusy(false); setPhase(""); } }
  };
  const clear = () => {
    if (busy || !confirm("Clear these local OCR results? Any readings you have not saved will be discarded. Saved payment details will remain.")) return;
    setResults([]); setProgress(null); setIssues([]);
  };
  return <section className="card receipt-batch" aria-labelledby="receipt-batch-heading">
    <h2 id="receipt-batch-heading">Read payment screenshots together</h2>
    <p>Read uploads across all divisions, then open each result to check the screenshot and save reviewed details. Shared player and second-entry screenshots are read once.</p>
    <p>Uses Tesseract.js on this device. Keep this tab open. Readings stay here until you save them; no payment is confirmed automatically.</p>
    <label className="check-field"><input type="checkbox" checked={includeReviewed} disabled={busy || locked} onChange={event => setIncludeReviewed(event.target.checked)} /><span>Also read screenshots with saved details</span></label>
    <small>By default, saved reviews are skipped unless their screenshot has changed.</small>
    <div className="receipt-review-actions"><button type="button" className="primary" disabled={busy || locked || !registrations.length} onClick={() => void start()}>{busy ? "Reading screenshots…" : results.length ? "Read remaining payment screenshots" : "Read all payment screenshots"}</button>{busy && <button type="button" className="secondary" onClick={() => running.current?.abort()}>Stop reading</button>}{results.length > 0 && <button type="button" className="secondary" disabled={busy} onClick={clear}>Clear local results</button>}</div>
    {busy && <p aria-hidden="true">{phase}</p>}
    {progress && <><progress aria-label="Registrations checked for screenshots" value={progress.checked} max={progress.total || 1} /><p role="status">{busy ? "Checking" : progress.stopped ? "Stopped after checking" : "Checked"} {progress.checked} of {progress.total} registrations. Read {progress.read} screenshots; skipped {progress.missing} without uploads, {progress.reviewed} saved reviews and {progress.shared} shared or previously read entries. {progress.failed > 0 && `${progress.failed} could not be read.`}</p></>}
    {issues.length > 0 && <div role="alert"><strong>Some screenshots need attention</strong><ul>{issues.slice(0,10).map((issue,index) => <li key={index}>{issue}</li>)}</ul>{issues.length > 10 && <p>{issues.length - 10} more could not be read. Retry the remaining screenshots or review their player cards individually.</p>}</div>}
    {results.length > 0 && <div className="receipt-batch-results"><p><strong>{results.length} screenshot readings</strong> · Open Amount &amp; reference below each name to review and save.</p>{results.map(result => <article key={result.record.groupId}><h3>{result.label}</h3><ReceiptReview registrationId={result.registrationId} pin={pin} initialReading={result} /></article>)}</div>}
  </section>;
}
