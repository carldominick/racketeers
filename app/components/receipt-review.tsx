"use client";
/* eslint-disable @next/next/no-img-element -- Private receipts use authenticated blob previews, never image proxies. */
import { useEffect, useId, useRef, useState } from "react";
import { emptyReceipt, receiptAmount, type ReceiptDetails, type ReceiptRecord, type ReceiptReading } from "../../lib/receipt-details";
import { createReceiptReader, type ReceiptReader } from "../../lib/receipt-ocr";
import { readReceiptImage, readReceiptRecord } from "../../lib/receipt-batch";
import { useReceiptNavigationGuard } from "./use-receipt-navigation-guard";

export function ReceiptReview({ registrationId, pin, initialReading }: { registrationId: string; pin: string; initialReading?: ReceiptReading & { record: ReceiptRecord } }) {
  const instanceId = useId();
  const [record, setRecord] = useState<ReceiptRecord | null>(initialReading?.record || null);
  const [draft, setDraft] = useState<ReceiptDetails>(() => initialReading?.details || emptyReceipt());
  const [message, setMessage] = useState("");
  const [warnings, setWarnings] = useState<string[]>(initialReading?.warnings || []);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState("");
  const [dirty, setDirty] = useState(Boolean(initialReading));
  const [preview, setPreview] = useState("");
  const mounted = useRef(false);
  const active = useRef(false);
  const unsaved = useRef(Boolean(initialReading));
  const groupId = useRef(initialReading?.record.groupId || "");
  const worker = useRef<ReceiptReader | null>(null);
  const readingRequest = useRef<AbortController | null>(null);
  const auth = { "x-organizer-pin": pin };
  const endpoint = `/api/payment-details?registrationId=${encodeURIComponent(registrationId)}`;
  useReceiptNavigationGuard(dirty || busy);
  useEffect(() => { unsaved.current = dirty; }, [dirty]);
  useEffect(() => {
    mounted.current = true;
    const controller = new AbortController();
    const load = () => fetch(`/api/payment-details?registrationId=${encodeURIComponent(registrationId)}`, { headers: { "x-organizer-pin": pin }, signal: controller.signal }).then(async response => {
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Unable to load payment details.");
      if (!mounted.current || unsaved.current || active.current) return;
      groupId.current = data.groupId;
      setRecord(data); setDraft(data.details || emptyReceipt());
    }).catch(error => { if (!controller.signal.aborted) setMessage(error.message); });
    const changed = (event: Event) => {
      const detail = (event as CustomEvent).detail;
      if (detail?.groupId !== groupId.current || detail?.from === instanceId) return;
      if (unsaved.current) setMessage("Another linked review was saved. Your edits are retained; reload before saving.");
      else void load();
    };
    void load(); window.addEventListener("receipt-details-saved",changed);
    return () => { mounted.current = false; controller.abort(); readingRequest.current?.abort(); window.removeEventListener("receipt-details-saved",changed); void worker.current?.close(); worker.current = null; };
  }, [registrationId, pin, instanceId]);
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);
  const scan = async () => {
    if (active.current || !record) return;
    if (dirty && !confirm("Replace the unsaved fields with a fresh screenshot reading?")) return;
    active.current = true; setBusy(true); setMessage(""); setWarnings([]); setProgress("Loading OCR…");
    const controller = new AbortController(); readingRequest.current = controller;
    try {
      // Recheck the photo version before reading. A replaced image must never reuse old OCR.
      const current = await readReceiptRecord(registrationId, pin, controller.signal);
      const instance = createReceiptReader(update => { if (mounted.current) setProgress(update); });
      worker.current = instance;
      const parsed = await readReceiptImage({ registrationId, pin, record: current, signal: controller.signal, reader: instance, onImage: blob => { if (mounted.current) setPreview(URL.createObjectURL(blob)); } });
      if (!mounted.current) return;
      setRecord(parsed.record); unsaved.current = true;
      setDraft(parsed.details); setDirty(true);
      setWarnings(parsed.warnings);
      setMessage("Screenshot read. Review and correct the fields, then save. Payment is not confirmed.");
    } catch (error) { if (mounted.current) setMessage(error instanceof Error ? error.message : "The screenshot could not be read. Retry or enter the details manually."); }
    finally {
      if (worker.current) { await worker.current.close(); worker.current = null; }
      readingRequest.current = null;
      active.current = false;
      if (mounted.current) { setBusy(false); setProgress(""); }
    }
  };
  const viewImage = async () => {
    if (active.current) return;
    active.current = true; setBusy(true);
    try {
      const response = await fetch(`/api/payment-proof?registrationId=${encodeURIComponent(registrationId)}`, { headers: auth });
      if (!response.ok) throw new Error();
      const blob = await response.blob();
      if (mounted.current) setPreview(URL.createObjectURL(blob));
    } catch { if (mounted.current) setMessage("Unable to load the screenshot. Your fields are retained."); }
    finally { active.current = false; if (mounted.current) setBusy(false); }
  };
  const save = async () => {
    if (!record || active.current) return;
    const amount = draft.amount ? receiptAmount(draft.amount) : "";
    if (amount === null) { setMessage("Enter a valid amount with at most two decimal places."); return; }
    active.current = true; setBusy(true); setMessage("");
    try {
      const response = await fetch(endpoint, { method: "POST", headers: { ...auth, "content-type": "application/json" }, body: JSON.stringify({ details: { ...draft, amount }, expectedRevision: record.revision, proofVersion: record.proofVersion }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Unable to save payment details.");
      if (!mounted.current) return;
      setRecord(data); setDraft(data.details); unsaved.current = false; setDirty(false);
      setMessage("Reviewed payment details saved. Payment confirmation is unchanged.");
      window.dispatchEvent(new CustomEvent("receipt-details-saved", { detail: { groupId: data.groupId, from: instanceId } }));
    } catch (error) { if (mounted.current) setMessage(error instanceof Error ? error.message : "Save failed. Your fields are retained."); }
    finally { active.current = false; if (mounted.current) setBusy(false); }
  };
  const reload = async () => {
    if (active.current) return;
    if (dirty && !confirm("Discard the unsaved payment fields and reload?")) return;
    active.current = true;
    setBusy(true);
    try { const response=await fetch(endpoint,{headers:auth});const data=await response.json();if(!response.ok)throw new Error(data.error);if(!mounted.current)return;groupId.current=data.groupId;setRecord(data);setDraft(data.details||emptyReceipt());unsaved.current=false;setDirty(false);setPreview("");setMessage(""); }
    catch {if(mounted.current)setMessage("Unable to reload. Please retry.");}finally{active.current=false;if(mounted.current)setBusy(false);}
  };
  const summary = dirty ? "Unsaved changes" : record?.stale ? "Screenshot changed" : record?.reviewedAt ? [record.details?.amount ? `PHP ${record.details.amount}` : "Details saved",record.details?.reference ? `Ref ${record.details.reference}` : ""].filter(Boolean).join(" · ") : "Needs review";
  return <details className="receipt-review"><summary>Amount & reference · {summary}</summary><p>Read the screenshot locally, then review the fields. This does not verify that money arrived.</p>{record?.stale && <p role="status">The screenshot was replaced. Previous details need a fresh review.</p>}<div className="receipt-review-actions"><button type="button" className="secondary" disabled={busy || !record} onClick={()=>void scan()}>Read payment screenshot</button><button type="button" disabled={busy} onClick={()=>void reload()}>Reload saved details</button><button type="button" className="secondary" disabled={busy} onClick={()=>void viewImage()}>View screenshot for review</button></div>{preview && <div><img className="receipt-review-image" src={preview} alt="Payment screenshot for checking extracted amount and reference" /><button type="button" onClick={()=>setPreview("")}>Close screenshot</button></div>}<fieldset disabled={busy || !record}><legend>Payment details — review before saving</legend><div className="receipt-review-fields">{([ ["amount","Amount (PHP)"],["reference","Reference number"],["provider","Bank / provider"],["date","Payment date"] ] as const).map(([key,label])=><label key={key}>{label}<input type={key==="date"?"date":"text"} inputMode={key==="amount"?"decimal":undefined} maxLength={key==="reference"?80:key==="provider"?60:20} value={draft[key]} onChange={event=>{unsaved.current=true;setDraft(d=>({...d,[key]:event.target.value}));setDirty(true);}} /></label>)}</div><button type="button" className="primary" disabled={!dirty && !record?.stale} onClick={()=>void save()}>Save reviewed details</button></fieldset>{record?.duplicateReference&&<p role="alert">This reference is also saved for a different payment group. Check for a reused screenshot before confirming payment.</p>}{warnings.map(warning=><p key={warning} role="status">{warning}</p>)}{(message||progress)&&<p role="status">{progress||message}</p>}<small>Shared by the linked players and entries. Confirm payment received separately for each covered player.</small></details>;
}
