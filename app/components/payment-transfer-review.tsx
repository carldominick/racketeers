"use client";
/* eslint-disable @next/next/no-img-element -- Organizer-only images are fetched as private blobs. */
import { useEffect, useRef, useState } from "react";
import { apiFetch } from "../../lib/client-request";
import { emptyReceipt, receiptAmount, receiptReferenceKey, validReceipt, type ReceiptDetails } from "../../lib/receipt-details";
import { createReceiptReader } from "../../lib/receipt-ocr";
import { readReceiptRecord } from "../../lib/receipt-batch";
import { formatPesos } from "../../lib/registration-pricing";
import { groupPaymentTransfers, paymentTransferScopes, receiptCents, type PaymentPhoto, type PaymentTransfer, type ReceiptPaymentControls } from "../../lib/registration-payment";
import { useReceiptNavigationGuard } from "./use-receipt-navigation-guard";
import "./payment-transfer-review.css";

type ReviewProps = {
  registrationId: string;
  pin: string;
  ids: string[];
  photos: PaymentPhoto[];
  controls: ReceiptPaymentControls;
  onPendingChange?: (id: string, pending: boolean) => void;
};

function moneyInput(value: string) {
  const amount = receiptAmount(value);
  return amount === null ? null : receiptCents(amount);
}

export function PaymentTransferReview({ registrationId, pin, ids, photos, controls, onPendingChange }: ReviewProps) {
  const [selected, setSelected] = useState<number>(photos[0]?.slot ?? 1);
  const [pending, setPending] = useState(false);
  const transfers = groupPaymentTransfers(controls.state, ids);
  const list = [...new Set([...photos.map(photo => photo.slot), ...transfers.map(transfer => transfer.slot)])].sort((a, b) => a - b);
  const slot = list.includes(selected) ? selected : list[0];
  const photo = photos.find(item => item.slot === slot);
  const transfer = transfers.find(item => item.slot === slot);
  const scopes = paymentTransferScopes(controls.state, ids);
  const due = scopes.every(scope => scope.due !== null) && scopes.length ? scopes.reduce((total, scope) => total + scope.due!, 0) : null;
  const balance = due === null ? null : scopes.reduce((total, scope) => total + Math.max(0, scope.due! - scope.confirmed), 0);
  const unreconciled = scopes.some(scope => scope.previouslyPaid.length && (scope.due === null || scope.confirmed < scope.due));
  const total = transfers.reduce((sum, item) => sum + receiptCents(item.details.amount), 0);
  const excess = scopes.reduce((sum, scope) => sum + (scope.due === null ? 0 : Math.max(0, scope.confirmed - scope.due)), 0);
  useEffect(() => {
    onPendingChange?.(registrationId, pending);
    return () => onPendingChange?.(registrationId, false);
  }, [registrationId, pending, onPendingChange]);
  if (!list.length) return null;
  return <section className="payment-transfer-review" aria-label="Payment review">
    <h3>Payment review</h3>
    <dl className="payment-transfer-totals" aria-live="polite">
      <div><dt>Amount due</dt><dd>{due === null ? "Set amount due" : formatPesos(due)}</dd></div>
      <div><dt>Total confirmed</dt><dd>{formatPesos(total)}</dd></div>
      <div><dt>Balance due</dt><dd>{unreconciled ? "Needs reconciliation" : balance === null ? "Amount due needed" : formatPesos(balance)}</dd></div>
    </dl>
    {excess > 0 && <p>Received above the amount due: {formatPesos(excess)}</p>}
    {unreconciled && <p>Previously confirmed payments remain paid. The total above includes transfers validated here.</p>}
    <div className="payment-transfer-picker" aria-label="Payment screenshots">
      {list.map(number => <button type="button" key={number} aria-pressed={number === slot} onClick={() => {
        if (number !== slot && (!pending || window.confirm("Discard the unsaved payment review and switch screenshots?"))) setSelected(number);
      }}>
        Screenshot {number}<small>{transfers.some(item => item.slot === number) ? "Validated" : "Needs review"}</small>
      </button>)}
    </div>
    <ScreenshotTransfer key={`${slot}:${photo?.proofVersion ?? ""}:${transfer?.id ?? ""}`} registrationId={registrationId} pin={pin}
      photo={photo} transfer={transfer} scopes={scopes} controls={controls} setPending={setPending} />
  </section>;
}

function ScreenshotTransfer({ registrationId, pin, photo, transfer, scopes, controls, setPending }: {
  registrationId: string; pin: string; photo?: PaymentPhoto; transfer?: PaymentTransfer;
  scopes: ReturnType<typeof paymentTransferScopes>; controls: ReceiptPaymentControls; setPending: (pending: boolean) => void;
}) {
  const [details, setDetails] = useState<ReceiptDetails>(() => transfer?.details ?? emptyReceipt());
  const [split, setSplit] = useState<Record<string, string>>({});
  const [prices, setPrices] = useState<Record<string, string>>({});
  const [image, setImage] = useState<{ url: string; blob: Blob }>();
  const [imageVisible, setImageVisible] = useState(false);
  const [message, setMessage] = useState("");
  const [imageError, setImageError] = useState("");
  const [warnings, setWarnings] = useState<string[]>([]);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const editing = useRef(false);
  const operation = useRef(false);
  const worker = useRef<ReturnType<typeof createReceiptReader> | null>(null);
  const slot = photo?.slot;
  const version = photo?.proofVersion;
  useReceiptNavigationGuard(dirty || busy);
  useEffect(() => { setPending(dirty || busy); return () => setPending(false); }, [dirty, busy, setPending]);
  useEffect(() => {
    if (!slot || !version) return;
    const controller = new AbortController();
    let blobUrl = "";
    void (async () => {
      try {
        const query = new URLSearchParams({ registrationId, slot: String(slot) });
        const response = await apiFetch(`/api/payment-proof?${query}`, { headers: { "x-organizer-pin": pin }, signal: controller.signal });
        if (!response.ok) throw new Error("Unable to load this screenshot. Refresh the payment photos to retry.");
        if (response.headers.get("X-Payment-Proof-Version") !== version) throw new Error("The screenshot changed. Refresh the payment photos before reviewing.");
        const blob = await response.blob();
        if (controller.signal.aborted) return;
        blobUrl = URL.createObjectURL(blob);
        setImage({ url: blobUrl, blob });
      } catch (error) { if (!controller.signal.aborted) setImageError((error as Error).message || "Unable to load this screenshot."); }
    })();
    if (slot === 1 && !transfer) void readReceiptRecord(registrationId, pin, controller.signal).then(record => {
      if (!controller.signal.aborted && !editing.current && !record.stale && record.details) setDetails(record.details);
    }).catch(() => { /* Manual entry remains available. */ });
    return () => { controller.abort(); if (blobUrl) URL.revokeObjectURL(blobUrl); void worker.current?.close(); };
  }, [registrationId, pin, slot, version, transfer]);

  const amount = receiptAmount(details.amount);
  const cents = amount === null ? 0 : receiptCents(amount);
  const draft = { ...details, amount: amount ?? "", provider: details.provider.trim(), reference: details.reference.trim() };
  const allocations = scopes.map(scope => ({
    scope: scope.key, cents: scopes.length === 1 ? cents : moneyInput(split[scope.key] ?? "") ?? 0,
    due: scope.due ?? moneyInput(prices[scope.key] ?? "") ?? undefined,
  })).filter(item => item.cents > 0);
  const allocationReady = allocations.length > 0 && allocations.every(item => item.due !== undefined) && allocations.reduce((sum, item) => sum + item.cents, 0) === cents;
  const duplicate = (controls.state.paymentTransfers ?? []).some(item => item.id !== transfer?.id
    && (draft.reference && receiptReferenceKey(item.details.reference) === receiptReferenceKey(draft.reference)
      || photo?.contentVersion && item.contentVersion === photo.contentVersion));
  const canConfirm = imageVisible && version && validReceipt(draft) && cents > 0 && draft.provider && draft.reference && draft.date
    && draft.transferStatus !== "pending" && !duplicate && allocationReady;
  const edit = () => { editing.current = true; setDirty(true); };

  async function scan() {
    if (!image || operation.current) return;
    operation.current = true; setBusy(true); edit(); setWarnings([]);
    const reader = createReceiptReader(setMessage);
    worker.current = reader;
    try {
      const result = await reader.read(image.blob);
      setDetails({ ...result.details, transferStatus: result.warnings.some(warning => /pending or processing/i.test(warning)) ? "pending" : "unknown" });
      setWarnings(result.warnings); setMessage("Review the suggested fields against the screenshot and your account.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Enter the details from the screenshot manually."); }
    finally { await reader.close(); worker.current = null; operation.current = false; setBusy(false); }
  }
  async function change() {
    if (operation.current || controls.disabled || !transfer && (!canConfirm || !photo)) return;
    operation.current = true; setBusy(true); setMessage("");
    try {
      if (transfer) await controls.change(registrationId, { action: "undoReceiptTransfer", transferId: transfer.id });
      else if (photo) await controls.change(registrationId, { action: "confirmReceiptTransfer", slot: photo.slot, proofVersion: photo.proofVersion, details: draft, allocations });
      setDirty(false);
    } catch (error) { setMessage((error as Error).message || "Payment could not be updated."); }
    finally { operation.current = false; setBusy(false); }
  }
  return <div className="payment-transfer-sheet">
    {transfer && <p role="status">{formatPesos(receiptCents(transfer.details.amount))} validated and included in the total.</p>}
    {transfer && transfer.proofVersion !== version && <p role="status">The original screenshot was replaced or removed after validation.</p>}
    <div className="payment-transfer-comparison">
      <figure>
        {image ? <><img src={image.url} alt={`Uploaded payment screenshot ${slot}`} onLoad={() => setImageVisible(true)} onError={() => setImageError("This screenshot could not be displayed.")} />
          <figcaption><a href={image.url} target="_blank" rel="noopener noreferrer">Open full-size screenshot</a></figcaption></> : <p role="status">{imageError || (photo ? "Loading the screenshot…" : "No screenshot stored for this slot.")}</p>}
        {!transfer && <button type="button" disabled={!imageVisible || busy || controls.disabled} onClick={() => void scan()}>Read this screenshot</button>}
      </figure>
      <div>
        <fieldset disabled={busy || controls.disabled || Boolean(transfer)}>
          <legend>Payment details</legend>
          {([["provider", "Payment source (bank or app)"], ["date", "Payment date"], ["reference", "Reference number"], ["amount", "Amount (PHP)"]] as const).map(([key, label]) =>
            <label key={key}>{label}<input type={key === "date" ? "date" : "text"} inputMode={key === "amount" ? "decimal" : undefined} maxLength={key === "provider" ? 60 : key === "reference" ? 80 : 24} value={details[key]} onChange={event => { edit(); setDetails(current => ({ ...current, [key]: event.target.value })); }} /></label>)}
          {!transfer && <label>Transfer status shown<select value={details.transferStatus || "unknown"} onChange={event => { edit(); setDetails(current => ({ ...current, transferStatus: event.target.value as ReceiptDetails["transferStatus"] })); }}>
            <option value="unknown">Unclear or not shown</option><option value="completed">Completed</option><option value="pending">Pending or processing</option>
          </select></label>}
          {!transfer && scopes.map(scope => (scopes.length > 1 || scope.due === null) && <div className="payment-transfer-allocation" key={scope.key}>
            <strong>{scope.entries.map(entry => entry.name).join(" and ")} · {scope.division?.name ?? "Entry"}</strong>
            {scopes.length > 1 && scope.due !== null && <small>{formatPesos(scope.confirmed)} confirmed of {formatPesos(scope.due)} due</small>}
            {scope.due === null && <label>Amount due (PHP)<input inputMode="decimal" value={prices[scope.key] ?? ""} onChange={event => { edit(); setPrices(current => ({ ...current, [scope.key]: event.target.value })); }} /></label>}
            {scopes.length > 1 && <label>Allocate to this entry (PHP)<input inputMode="decimal" value={split[scope.key] ?? ""} onChange={event => { edit(); setSplit(current => ({ ...current, [scope.key]: event.target.value })); }} /></label>}
          </div>)}
          {transfer && transfer.allocations.map(allocation => <small key={allocation.ids.join("/")}>{formatPesos(allocation.cents)} applied to {allocation.ids.map(id => controls.state.registrations.find(entry => entry.id === id)?.name ?? "previous entry").join(" and ")}</small>)}
        </fieldset>
        {!transfer && <p>{details.transferStatus === "pending" ? "Pending transfers cannot be confirmed." : duplicate ? "This reference or screenshot already belongs to a confirmed transfer." : "Check the screenshot and match the transfer in the receiving account before confirming."}</p>}
        <button type="button" className={transfer ? "secondary" : "primary"} disabled={busy || controls.disabled || (!transfer && !canConfirm)}
          onClick={() => { if (!transfer || window.confirm("Undo this transfer and recalculate the payment balance?")) void change(); }}>
          {busy ? "Working…" : transfer ? "Undo validation and confirmation" : `Validate screenshot and confirm${cents ? ` ${formatPesos(cents)}` : " payment"}`}
        </button>
        {warnings.map(warning => <p key={warning} role="status">{warning}</p>)}
        {message && <p role="status">{message}</p>}
        {image && imageError && <p role="status">{imageError}</p>}
      </div>
    </div>
  </div>;
}
