"use client";
import { useState } from "react";
import { priceCents } from "../../lib/registration-pricing";
export function RegistrationPriceInput({ label, value, onCommit }: { label: string; value: string; onCommit: (value: string) => void }) {
  const [editor, setEditor] = useState({ source: value, text: value });
  const [error, setError] = useState("");
  const text = editor.source === value ? editor.text : value;
  function save() {
    const trimmed = text.trim();
    if (trimmed && priceCents(trimmed) === null) { setError("Enter a price with up to two decimal places, or leave blank."); return; }
    setError(""); onCommit(trimmed); setEditor({ source: trimmed, text: trimmed });
  }
  return <label>{label}<input type="text" inputMode="decimal" maxLength={9} value={text} placeholder="Not set" aria-invalid={Boolean(error)} onChange={event => setEditor({ source: value, text: event.target.value })} onBlur={save} onKeyDown={event => { if (event.key === "Enter") { event.preventDefault(); event.currentTarget.blur(); } }} />{error && <small role="alert">{error}</small>}</label>;
}
