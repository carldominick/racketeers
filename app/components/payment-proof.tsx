"use client";
/* eslint-disable @next/next/no-img-element -- Authenticated blob previews must not pass through an image proxy. */
import { useEffect, useRef, useState } from "react";

const MAX_BYTES = 2 * 1024 * 1024;
export function PhotoUploadButton({ label, disabled = false, onSelect, selectedName = "" }: { label: string; disabled?: boolean; onSelect: (file: File) => void; selectedName?: string }) {
  const input = useRef<HTMLInputElement>(null);
  const [error, setError] = useState("");
  return <div className="photo-upload-control"><input ref={input} type="file" hidden accept="image/png,image/jpeg,image/webp" onChange={event => {
    const file = event.target.files?.[0]; event.target.value = "";
    if (!file) return;
    if (file.size > MAX_BYTES) { setError("Please choose a photo of 2 MB or less."); return; }
    if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) { setError("Please choose a PNG, JPG, or WebP photo."); return; }
    setError(""); onSelect(file);
  }} /><button type="button" className="primary upload-photo-button" disabled={disabled} onClick={() => input.current?.click()}>{label}</button><small>PNG, JPG, or WebP · maximum 2 MB</small>{selectedName && <span role="status">Selected: {selectedName}</span>}{error && <p role="alert" className="error">{error}</p>}</div>;
}

export async function preparePaymentImage(file: File): Promise<Blob> {
  if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) throw new Error("Choose a PNG, JPG, or WebP screenshot.");
  if (file.size > MAX_BYTES) throw new Error("Choose a screenshot smaller than 2 MB.");
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
  const removePhoto = async () => {
    if (!organizer || inFlight.current || !confirm(`Delete the payment photo for registration ${registrationId}? This cannot be undone. The registration and payment confirmation will remain unchanged.`)) return;
    inFlight.current = true; setBusy(true); setMessage("");
    try {
      const response = await fetch(`/api/payment-proof?registrationId=${encodeURIComponent(registrationId)}`, { method: "DELETE", headers: { "x-organizer-pin": pin } });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Unable to delete the payment photo.");
      setFilename(""); setPreview(""); setMessage("Payment photo deleted. Registration and payment confirmation are unchanged."); setRevision(n => n + 1);
    } catch (error) { setMessage(error instanceof Error ? error.message : "Unable to delete the payment photo."); }
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
  return <section className="payment-proof"><strong>Payment screenshot</strong><div className="registration-id-display"><span>Registration ID</span><code>{registrationId}</code></div>{filename ? <button type="button" className="secondary" disabled={busy} onClick={() => void view()}>View payment screenshot</button> : <span>{enabled ? "No screenshot uploaded." : "Screenshot uploads are not available yet."}</span>}{organizer && filename && <button type="button" className="danger" disabled={busy} onClick={() => void removePhoto()}>Delete payment photo</button>}{canUpload && enabled && <PhotoUploadButton label={filename ? "Replace payment photo" : "Upload payment photo"} disabled={busy} onSelect={file => void upload(file)} />}{busy && <p role="status">Processing screenshot…</p>}{message && <p role="status">{message}</p>}{preview && <div className="payment-proof-preview"><button type="button" className="ghost" onClick={() => setPreview("")}>Close screenshot</button><img src={preview} alt="Uploaded payment screenshot" /><a href={preview} download={filename}>Download {filename}</a></div>}</section>;
}
