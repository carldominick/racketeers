"use client";

import { useRef, useState } from "react";

const chart = "/shirt-size-guide.webp";
const description = "Men’s shirt size chart. Size, length, width: XS 26, 36; S 27, 38; M 28, 40; L 29, 42; XL 30, 44; XXL 31, 47.";
export function ShirtSizeGuide() {
  const dialog = useRef<HTMLDialogElement>(null);
  const [zoom, setZoom] = useState(100);
  const open = () => { setZoom(100); dialog.current?.showModal(); };
  return <section className="shirt-size-guide" aria-label="Shirt size guide">
    <button type="button" className="shirt-guide-preview" onClick={open} aria-label="Open and enlarge shirt size chart">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={chart} alt={description} width={1627} height={967} loading="lazy" />
    </button>
    <div><h3>Check your shirt size</h3><p>View the size chart before choosing a size for each player.</p><button type="button" className="secondary" onClick={open}>View size chart & zoom</button><small>XXL on the chart is 2XL in the form. For 3XL measurements, please ask the organizer.</small></div>
    <dialog ref={dialog} className="shirt-guide-dialog" aria-labelledby="shirt-guide-title">
      <header><h2 id="shirt-guide-title">Shirt size guide</h2><button type="button" className="secondary" onClick={() => dialog.current?.close()} autoFocus>Close</button></header>
      <div className="shirt-guide-controls"><button type="button" className="secondary" disabled={zoom <= 100} onClick={() => setZoom(value => Math.max(100, value - 25))} aria-label="Zoom out">−</button><output aria-live="polite">{zoom}%</output><button type="button" className="secondary" disabled={zoom >= 300} onClick={() => setZoom(value => Math.min(300, value + 25))} aria-label="Zoom in">+</button><button type="button" className="secondary" onClick={() => setZoom(100)}>Fit to screen</button><a href={chart} target="_blank" rel="noopener noreferrer">Open full-size image ↗</a></div>
      <div className="shirt-guide-image"><div style={{ width: zoom + "%" }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={chart} alt={description} width={1627} height={967} />
      </div></div>
      <p>Use + / − to zoom, then scroll to inspect the chart. On mobile, you can also open the full-size image and pinch to zoom.</p><small>Measurements are reproduced from the supplied chart; units were not specified. XXL = 2XL. Contact the organizer for 3XL sizing.</small>
    </dialog>
  </section>;
}
