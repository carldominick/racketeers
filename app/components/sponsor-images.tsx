"use client";
/* eslint-disable @next/next/no-img-element -- Sponsor images are served directly from the public sponsor API. */
import { useCallback, useEffect, useRef, useState } from "react";
import { MAX_SPONSOR_BYTES, type SponsorLibrary } from "../../lib/sponsors";

export function useSponsorImages(enabled = true) {
  const [library, setLibrary] = useState<SponsorLibrary>({ images: [], enabled: false });
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState("");
  const generation = useRef(0);
  const reload = useCallback(async () => {
    const current = ++generation.current;
    try {
      const response = await fetch("/api/sponsors", { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Unable to load sponsor images.");
      if (current === generation.current) { setLibrary(data); setError(""); }
    } catch (failure) { if (current === generation.current) setError(failure instanceof Error ? failure.message : "Unable to load sponsor images."); }
    finally { if (current === generation.current) setLoading(false); }
  }, []);
  useEffect(() => {
    if (!enabled) return;
    let active = true;
    const requests = generation;
    queueMicrotask(() => { if (active) void reload(); });
    const timer = setInterval(() => void reload(), 15_000);
    return () => { active = false; clearInterval(timer); requests.current++; };
  }, [enabled, reload]);
  return { library, loading, error, reload };
}

async function prepareSponsorImage(file: File): Promise<Blob> {
  if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) throw new Error("Choose a PNG, JPG, or WebP image.");
  if (file.size > MAX_SPONSOR_BYTES) throw new Error("Choose an image of 2 MB or less.");
  const image = await createImageBitmap(file);
  try {
    const scale = Math.min(1, 2000 / Math.max(image.width, image.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(image.width * scale)); canvas.height = Math.max(1, Math.round(image.height * scale));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Unable to prepare this image.");
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const png = await new Promise<Blob>((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error("Unable to read this image.")), "image/png"));
    if (png.size > MAX_SPONSOR_BYTES) throw new Error("Image is too large after preparation. Resize it and try again.");
    return png;
  } finally { image.close(); }
}

type PendingImage = { id: string; file: File; name: string };
export function SponsorImages({ organizerPin, data }: { organizerPin: string; data: ReturnType<typeof useSponsorImages> }) {
  const [pending, setPending] = useState<PendingImage[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [failure, setFailure] = useState("");
  const inFlight = useRef(false);
  const upload = async () => {
    if (inFlight.current || !pending.length) return;
    inFlight.current = true; setBusy(true); setMessage(""); setFailure("");
    let count = 0;
    try {
      for (const item of pending) {
        const png = await prepareSponsorImage(item.file);
        const response = await fetch("/api/sponsors", { method: "POST", headers: { "content-type": "image/png", "x-organizer-pin": organizerPin, "x-sponsor-name": encodeURIComponent(item.name.trim()) }, body: png });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || "Upload failed. Please try again.");
        count++; setPending(current => current.filter(image => image.id !== item.id));
      }
    } catch (error) { setFailure(error instanceof Error ? error.message : "Upload failed. Please try again."); }
    finally {
      await data.reload(); setMessage(count ? `${count} sponsor image${count === 1 ? "" : "s"} uploaded.` : "");
      inFlight.current = false; setBusy(false);
    }
  };
  const remove = async (id: string, name: string) => {
    if (inFlight.current || !confirm(`Remove ${name} from the projector?`)) return;
    inFlight.current = true; setBusy(true); setFailure(""); setMessage("");
    try {
      const response = await fetch(`/api/sponsors?image=${encodeURIComponent(id)}`, { method: "DELETE", headers: { "x-organizer-pin": organizerPin } });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Unable to remove this image.");
      setMessage("Sponsor image removed from the projector."); await data.reload();
    } catch (error) { setFailure(error instanceof Error ? error.message : "Unable to remove this image."); }
    finally { inFlight.current = false; setBusy(false); }
  };
  return <section className="sponsor-library" aria-labelledby="sponsor-library-title"><h3 id="sponsor-library-title">Sponsor images</h3><p>Each image appears on its own Sponsors page. Images and names are public. Add more whenever you need; the slide is skipped until an image is uploaded.</p>
    {data.loading ? <p role="status">Loading sponsor images…</p> : <>
      {data.error && <p className="error" role="alert">{data.error} <button type="button" className="ghost" onClick={() => void data.reload()}>Retry</button></p>}
      {!data.library.enabled && !data.error && <p>Image storage is unavailable. Please try again later.</p>}
      <fieldset disabled={busy || !data.library.enabled}><legend className="sr-only">Upload sponsor images</legend>
        <label className="sponsor-file-input">Add sponsor images<input type="file" multiple accept="image/png,image/jpeg,image/webp" onChange={event => {
          const files = Array.from(event.target.files || []); event.target.value = ""; setFailure("");
          const valid = files.filter(file => file.size <= MAX_SPONSOR_BYTES && ["image/png", "image/jpeg", "image/webp"].includes(file.type));
          if (valid.length !== files.length) setFailure("Some files were skipped. Choose PNG, JPG, or WebP images of 2 MB or less.");
          setPending(current => [...current, ...valid.map(file => ({ id: crypto.randomUUID(), file, name: file.name.replace(/\.[^.]+$/, "").slice(0, 100) || "Sponsor" }))]);
        }} /></label><small>PNG, JPG, or WebP · up to 2 MB each · select several files at once</small>
        {pending.length > 0 && <><ul className="sponsor-pending">{pending.map(item => <li key={item.id}><label>Public sponsor name<input value={item.name} maxLength={100} onChange={event => setPending(current => current.map(image => image.id === item.id ? { ...image, name: event.target.value } : image))} /></label><span>{item.file.name}</span><button type="button" className="ghost" onClick={() => setPending(current => current.filter(image => image.id !== item.id))}>Cancel selection</button></li>)}</ul><button type="button" className="primary" disabled={pending.some(item => !item.name.trim())} onClick={() => void upload()}>{busy ? "Uploading…" : `Upload ${pending.length} image${pending.length === 1 ? "" : "s"}`}</button></>}
        <div className="sponsor-library-grid">{data.library.images.map(image => <article key={image.id}><img src={image.url} alt={image.name} /><strong>{image.name}</strong><button type="button" className="ghost" onClick={() => void remove(image.id, image.name)}>Remove image</button></article>)}</div>
      </fieldset>
    </>}{message && <p role="status">{message}</p>}{failure && <p className="error" role="alert">{failure}</p>}
  </section>;
}
