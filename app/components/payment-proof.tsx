"use client";
/* eslint-disable @next/next/no-img-element -- Authenticated blob previews must not pass through an image proxy. */
import { useEffect, useRef, useState } from "react";
import { ReceiptReview } from "./receipt-review";

const MAX_BYTES = 2 * 1024 * 1024;
export function PaymentPhotoPicker({ files, disabled, onChange }: { files: File[]; disabled?: boolean; onChange: (files: File[]) => void }) {
  const [error, setError] = useState("");
  return <div className="payment-photo-picker"><label>Add payment screenshots<input type="file" multiple accept="image/png,image/jpeg,image/webp" disabled={disabled || files.length >= 4} onChange={event => {
    const selected = Array.from(event.target.files || []); event.target.value = "";
    if (files.length + selected.length > 4) { setError("Choose up to 4 photos in total."); return; }
    if (selected.some(file => file.size > MAX_BYTES || !["image/png", "image/jpeg", "image/webp"].includes(file.type))) { setError("Each photo must be PNG, JPG, or WebP and 2 MB or less."); return; }
    setError(""); onChange([...files, ...selected]);
  }} /></label><small>{files.length} of 4 selected · PNG, JPG, or WebP · 2 MB per photo</small>{files.map((file, index) => <div key={index}><span>{file.name}</span><button type="button" className="secondary" disabled={disabled} onClick={() => { setError(""); onChange(files.filter((_, i) => i !== index)); }}>Remove photo {index + 1}</button></div>)}{error && <p role="alert" className="error">{error}</p>}</div>;
}
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
export async function uploadPaymentImage(id: string, pin: string, image: Blob, organizer = false, slot = 1) {
  const response = await fetch(`/api/payment-proof?registrationId=${encodeURIComponent(id)}&slot=${slot}`, { method: "POST", headers: { "content-type": "image/png", [organizer ? "x-organizer-pin" : "x-registration-pin"]: pin }, body: image });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Upload failed. Please try again.");
  return data;
}
export async function uploadPaymentImages(id: string, pin: string, images: Blob[], organizer = false) {
  const response = await fetch(`/api/payment-proof?registrationId=${encodeURIComponent(id)}&metadata=1`, { headers: { [organizer ? "x-organizer-pin" : "x-registration-pin"]: pin } });
  const data = await response.json();
  if (!response.ok && response.status !== 404) throw new Error(data.error || "Unable to check existing photos.");
  const used = (data.photos || []).map((photo: { slot: number }) => photo.slot);
  const slots = [1,2,3,4].filter(slot => !used.includes(slot));
  if (images.length > slots.length) throw new Error(`Only ${slots.length} photo slots remain. Maximum 4 photos per payment group.`);
  let uploaded = 0;
  try { for (const image of images) { await uploadPaymentImage(id, pin, image, organizer, slots[uploaded]); uploaded++; } }
  catch (error) { throw new Error(`${uploaded} of ${images.length} photos uploaded. ${error instanceof Error ? error.message : "Upload failed."} Check the saved photos before retrying.`); }
}
export function PaymentProof({ registrationId, pin, organizer = false, canUpload = false }: { registrationId: string; pin: string; organizer?: boolean; canUpload?: boolean }) {
  const [linkedIds, setLinkedIds] = useState<string[]>([]);
  const [filename, setFilename] = useState("");
  const [photos, setPhotos] = useState<{ slot: number; filename: string }[]>([]);
  const [files, setFiles] = useState<File[]>([]);
  const [previewName, setPreviewName] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState("");
  const [enabled, setEnabled] = useState(false);
  const [revision, setRevision] = useState(0);
  const inFlight = useRef(false);
  useEffect(() => {
    const abort = new AbortController();
    const refresh = () => { setPreview(""); setRevision(n => n + 1); };
    window.addEventListener("payment-proof-updated", refresh);
    const auth: Record<string, string> = organizer ? { "x-organizer-pin": pin } : { "x-registration-pin": pin };
    fetch(`/api/payment-proof?registrationId=${encodeURIComponent(registrationId)}&metadata=1`, { headers: auth, signal: abort.signal }).then(async response => {
      if (response.status === 503) { setEnabled(false); return; }
      if (response.status === 404) { setEnabled(true); setFilename(""); setPhotos([]); setLinkedIds([]); return; }
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Unable to check payment screenshot.");
      setEnabled(true); setFilename(data.filename); setLinkedIds(data.linkedRegistrationIds || []);
      setPhotos(data.photos || [{ slot: 1, filename: data.filename }]);
    }).catch(error => { if (!abort.signal.aborted) setMessage(error.message); });
    return () => { abort.abort(); window.removeEventListener("payment-proof-updated", refresh); };
  }, [registrationId, pin, organizer, revision]);
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);
  const upload = async () => {
    if (!files.length || inFlight.current) return;
    inFlight.current = true; setBusy(true); setMessage("");
    try {
      const images = await Promise.all(files.map(preparePaymentImage));
      await uploadPaymentImages(registrationId, pin, images, organizer);
      setFiles([]);
      window.dispatchEvent(new Event("payment-proof-updated"));
      setMessage("Screenshot uploaded. The organizer will verify the payment."); setPreview(""); setRevision(n => n + 1);
    } catch (error) { window.dispatchEvent(new Event("payment-proof-updated")); setMessage(error instanceof Error ? error.message : "Upload failed. Please try again."); }
    finally { setBusy(false); inFlight.current = false; }
  };
  const removePhoto = async () => {
    if (!organizer || inFlight.current || !confirm(`Delete all payment photos for registration ${registrationId}? This removes all shared photos from every linked player and entry. This cannot be undone. The registration and payment confirmation will remain unchanged.`)) return;
    inFlight.current = true; setBusy(true); setMessage("");
    try {
      const response = await fetch(`/api/payment-proof?registrationId=${encodeURIComponent(registrationId)}`, { method: "DELETE", headers: { "x-organizer-pin": pin } });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Unable to delete the payment photo.");
      window.dispatchEvent(new Event("payment-proof-updated"));
      setFilename(""); setPreview(""); setMessage("Payment photo deleted. Registration and payment confirmation are unchanged."); setRevision(n => n + 1);
    } catch (error) { setMessage(error instanceof Error ? error.message : "Unable to delete the payment photo."); }
    finally { setBusy(false); inFlight.current = false; }
  };
  const view = async (slot: number, name: string) => {
    setBusy(true); setMessage("");
    try {
      const auth: Record<string, string> = organizer ? { "x-organizer-pin": pin } : { "x-registration-pin": pin };
      const response = await fetch(`/api/payment-proof?registrationId=${encodeURIComponent(registrationId)}&slot=${slot}`, { headers: auth });
      if (!response.ok) throw new Error("Unable to load the screenshot. Please try again.");
      setPreview(URL.createObjectURL(await response.blob()));
      setPreviewName(name);
    } catch (error) { setMessage(error instanceof Error ? error.message : "Unable to load screenshot."); }
    finally { setBusy(false); }
  };
  return <section className="payment-proof"><strong>Payment screenshots · {photos.length} of 4</strong><div className="registration-id-display"><span>Registration ID</span><code>{registrationId}</code></div>{linkedIds.length > 1 && <small>Shared by linked players and entries</small>}{photos.map(photo => <div className="payment-photo-row" key={photo.slot}><button type="button" className="secondary" disabled={busy} onClick={() => void view(photo.slot, photo.filename)}>View photo {photo.slot}</button>{canUpload && enabled && <PhotoUploadButton label={`Replace photo ${photo.slot}`} disabled={busy} onSelect={file => { if (inFlight.current) return; inFlight.current = true; setBusy(true); void preparePaymentImage(file).then(image => uploadPaymentImage(registrationId, pin, image, organizer, photo.slot)).then(() => { setMessage("Photo replaced. Payment confirmation is unchanged."); }).catch(error => setMessage(error.message)).finally(() => { window.dispatchEvent(new Event("payment-proof-updated")); setBusy(false); inFlight.current = false; }); }} />}</div>)}{!filename && <span>{enabled ? "No screenshots uploaded" : "Screenshot uploads are not available yet"}</span>}{organizer && filename && <button type="button" className="danger" disabled={busy} onClick={() => void removePhoto()}>Delete all payment photos</button>}{canUpload && enabled && photos.length < 4 && <><PaymentPhotoPicker files={files} disabled={busy} onChange={setFiles} /><button type="button" className="primary" disabled={busy || !files.length || files.length + photos.length > 4} onClick={() => void upload()}>Upload selected photos</button><small>{4 - photos.length} photo slots available</small></>}{busy && <p role="status">Processing screenshots…</p>}{message && <p role="status">{message}</p>}{organizer && filename && <><p>OCR reads the primary screenshot only. Review every photo above before confirming payment.</p><ReceiptReview key={revision} registrationId={registrationId} pin={pin} /></>}{preview && <div className="payment-proof-preview"><button type="button" className="ghost" onClick={() => setPreview("")}>Close screenshot</button><img src={preview} alt="Uploaded payment screenshot" /><a href={preview} download={previewName}>Download {previewName}</a></div>}</section>;
}
