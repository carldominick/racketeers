"use client";
/* eslint-disable @next/next/no-img-element -- Authenticated blob previews must not pass through an image proxy. */
import { useEffect, useRef, useState } from "react";

const MAX_BYTES = 5 * 1024 * 1024;
export async function preparePaymentImage(file: File): Promise<Blob> {
  if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) throw new Error("Choose a PNG, JPG, or WebP screenshot.");
  if (file.size > MAX_BYTES) throw new Error("Choose a screenshot smaller than 5 MB.");
  const image = await createImageBitmap(file);
  try {
    const scale = Math.min(1, 2000 / Math.max(image.width, image.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(image.width * scale));
    canvas.height = Math.max(1, Math.round(image.height * scale));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Unable to prepare this screenshot.");
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error("Unable to read this screenshot.")), "image/png"));
    if (blob.size > MAX_BYTES) throw new Error("Screenshot is too large. Please crop it and try again.");
    return blob;
  } finally { image.close(); }
}
export async function uploadPaymentImage(id: string, pin: string, image: Blob) {
  const response = await fetch(`/api/payment-proof?registrationId=${encodeURIComponent(id)}`, { method: "POST", headers: { "content-type": "image/png", "x-registration-pin": pin }, body: image });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Upload failed. Please try again.");
  return data;
}
export function PaymentProof({ registrationId, pin, organizer = false, canUpload = false }: { registrationId: string; pin: string; organizer?: boolean; canUpload?: boolean }) {
  const [filename, setFilename] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState("");
  const [enabled, setEnabled] = useState(false);
  const [revision, setRevision] = useState(0);
  const inFlight = useRef(false);
  useEffect(() => {
    const abort = new AbortController();
    const auth = organizer ? { "x-organizer-pin": pin } : { "x-registration-pin": pin };
    fetch(`/api/payment-proof?registrationId=${encodeURIComponent(registrationId)}&metadata=1`, { headers: auth as Record<string,string>, signal: abort.signal }).then(async response => {
      if (response.status === 503) { setEnabled(false); return; }
      if (response.status === 404) { setEnabled(true); setFilename(""); return; }
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Unable to check payment screenshot.");
      setEnabled(true); setFilename(data.filename);
    }).catch(error => { if (!abort.signal.aborted) setMessage(error.message); });
    return () => abort.abort();
  }, [registrationId, pin, organizer, revision]);
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);
  const upload = async (file: File | undefined) => {
    if (!file || inFlight.current) return;
    inFlight.current = true; setBusy(true); setMessage("");
    try {
      const png = await preparePaymentImage(file);
      await uploadPaymentImage(registrationId, pin, png);
      setMessage("Screenshot uploaded. The organizer will verify the payment."); setPreview(""); setRevision(n => n + 1);
    } catch (error) { setMessage(error instanceof Error ? error.message : "Upload failed. Please try again."); }
    finally { setBusy(false); inFlight.current = false; }
  };
  const view = async () => {
    setBusy(true); setMessage("");
    try {
      const auth = organizer ? { "x-organizer-pin": pin } : { "x-registration-pin": pin };
      const response = await fetch(`/api/payment-proof?registrationId=${encodeURIComponent(registrationId)}`, { headers: auth as Record<string,string> });
      if (!response.ok) throw new Error("Unable to load the screenshot. Please try again.");
      setPreview(URL.createObjectURL(await response.blob()));
    } catch (error) { setMessage(error instanceof Error ? error.message : "Unable to load screenshot."); }
    finally { setBusy(false); }
  };
  return <section className="payment-proof"><strong>Payment screenshot</strong><small>Registration ID: {registrationId}</small>{filename ? <button type="button" className="secondary" disabled={busy} onClick={() => void view()}>View payment screenshot</button> : <span>{enabled ? "No screenshot uploaded." : "Screenshot uploads are not available yet."}</span>}{canUpload && enabled && <label>{filename ? "Replace screenshot" : "Upload screenshot"}<input type="file" accept="image/png,image/jpeg,image/webp" disabled={busy} onChange={event => { void upload(event.target.files?.[0]); event.target.value = ""; }} /><small>PNG, JPG, or WebP · up to 5 MB. Stored as {registrationId}.png.</small></label>}{busy && <p role="status">Processing screenshot…</p>}{message && <p role="status">{message}</p>}{preview && <div className="payment-proof-preview"><button type="button" className="ghost" onClick={() => setPreview("")}>Close screenshot</button><img src={preview} alt="Uploaded payment screenshot" /><a href={preview} download={filename}>Download {filename}</a></div>}</section>;
}
