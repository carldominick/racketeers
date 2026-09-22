"use client";
/* eslint-disable @next/next/no-img-element -- Public QR and private blob previews must not pass through an image proxy. */
import { useEffect, useRef, useState } from "react";
import { preparePaymentImage } from "./payment-proof";
type Settings = { bankName: string; accountNumber: string; accountName: string; instructions: string; imageAvailable?: boolean; uploadsEnabled?: boolean };
const empty: Settings = { bankName: "", accountNumber: "", accountName: "", instructions: "" };
export function PaymentSettings({ organizerPin }: { organizerPin?: string }) {
  const [details, setDetails] = useState<Settings>(empty);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [image, setImage] = useState<File | null>(null);
  const [version, setVersion] = useState(0);
  const inFlight = useRef(false);
  useEffect(() => {
    const abort = new AbortController();
    fetch("/api/payment-settings", { signal: abort.signal }).then(async response => {
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Unable to load payment details.");
      setDetails(data);
    }).catch(error => { if (!abort.signal.aborted) setMessage(error.message); }).finally(() => { if (!abort.signal.aborted) setLoading(false); });
    return () => abort.abort();
  }, []);
  const save = async () => {
    if (inFlight.current || !organizerPin) return;
    inFlight.current = true; setBusy(true); setMessage("");
    let textSaved = false;
    try {
      const png = image ? await preparePaymentImage(image) : null;
      const response = await fetch("/api/payment-settings", { method: "POST", headers: { "content-type": "application/json", "x-organizer-pin": organizerPin }, body: JSON.stringify(details) });
      const data = await response.json(); if (!response.ok) throw new Error(data.error);
      textSaved = true;
      if (png) {
        const upload = await fetch("/api/payment-settings?image=1", { method: "POST", headers: { "content-type": "image/png", "x-organizer-pin": organizerPin }, body: png });
        const result = await upload.json(); if (!upload.ok) throw new Error(result.error);
        setImage(null); setDetails(current => ({ ...current, imageAvailable: true })); setVersion(n => n + 1);
      }
      setMessage("Payment details saved. Players can now see them during registration.");
    } catch (error) { setMessage(`${textSaved ? "Bank details saved, but the image was not uploaded. " : ""}${error instanceof Error ? error.message : "Please try again."}`); }
    finally { setBusy(false); inFlight.current = false; }
  };
  const removeImage = async () => {
    if (!organizerPin || inFlight.current) return;
    inFlight.current = true; setBusy(true); setMessage("");
    try {
      const response = await fetch("/api/payment-settings?image=1", { method: "DELETE", headers: { "x-organizer-pin": organizerPin } });
      if (!response.ok) throw new Error("Unable to remove the image.");
      setDetails(current => ({ ...current, imageAvailable: false })); setImage(null); setMessage("Payment image removed.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Please try again."); }
    finally { setBusy(false); inFlight.current = false; }
  };
  const configured = details.bankName || details.accountName || details.accountNumber || details.instructions || details.imageAvailable;
  return <section className="card payment-instructions"><h2>{organizerPin ? "Player payment details" : "How to pay"}</h2>{loading ? <p role="status">Loading payment details…</p> : organizerPin ? <><p>These details and the payment image will be visible to players on the registration page.</p><fieldset disabled={busy} className="payment-settings-fields"><div className="form-grid"><label>Bank or payment provider<input value={details.bankName} maxLength={120} onChange={event => setDetails(current => ({ ...current, bankName: event.target.value }))} placeholder="Bank, GCash, or Maya" /></label><label>Account number<input type="text" value={details.accountNumber} maxLength={100} onChange={event => setDetails(current => ({ ...current, accountNumber: event.target.value }))} /></label><label>Name on the account<input value={details.accountName} maxLength={150} onChange={event => setDetails(current => ({ ...current, accountName: event.target.value }))} /></label></div><label>Payment instructions<textarea value={details.instructions} maxLength={1500} onChange={event => setDetails(current => ({ ...current, instructions: event.target.value }))} placeholder="Amount due, reference to include, or other payment instructions" /></label><label>QR code or payment image<input type="file" accept="image/png,image/jpeg,image/webp" disabled={!details.uploadsEnabled} onChange={event => setImage(event.target.files?.[0] ?? null)} /></label><small>{details.uploadsEnabled ? "PNG, JPG, or WebP · up to 2 MB." : "Bank details can be saved now. Connect image storage to enable QR images and payment screenshots."}</small><button type="button" className="primary" disabled={busy} onClick={() => void save()}>{busy ? "Saving…" : "Save payment details"}</button></fieldset></> : configured ? <><dl className="payment-bank-details">{details.bankName && <><dt>Bank / provider</dt><dd>{details.bankName}</dd></>}{details.accountNumber && <><dt>Account number</dt><dd>{details.accountNumber}</dd></>}{details.accountName && <><dt>Name on account</dt><dd>{details.accountName}</dd></>}</dl>{details.instructions && <p className="payment-notes">{details.instructions}</p>}<p>After paying, upload the screenshot with your registration. Payment is confirmed only after the organizer reviews it.</p></> : <p>The organizer has not added payment details yet. Please check with them before sending payment.</p>}{details.imageAvailable && <div className="payment-qr"><img src={`/api/payment-settings?image=1&v=${version}`} alt="Organizer payment QR code or payment instructions" /><a href={`/api/payment-settings?image=1&v=${version}`} target="_blank" rel="noreferrer">Open full-size payment image</a>{organizerPin && <button type="button" className="ghost" disabled={busy} onClick={() => void removeImage()}>Remove payment image</button>}</div>}{message && <p role="status">{message}</p>}</section>;
}
