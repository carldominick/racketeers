"use client";
import { useState } from "react";
import { registrationContactUrl } from "../../lib/tournament";

export function RegistrationContactInput({ value, onCommit }: { value: string; onCommit: (value: string) => void }) {
  const [editor, setEditor] = useState({ source: value, text: value });
  const [error, setError] = useState("");
  const text = editor.source === value ? editor.text : value;
  function save() {
    const trimmed = text.trim();
    if (trimmed && !registrationContactUrl(trimmed)) { setError("Enter a full https:// contact link, or leave blank."); return; }
    setError(""); onCommit(trimmed); setEditor({ source: trimmed, text: trimmed });
  }
  return <label>Public organizer contact link<input type="url" maxLength={500} placeholder="https://…" value={text} aria-invalid={Boolean(error)} onChange={event => setEditor({ source: value, text: event.target.value })} onBlur={save} onKeyDown={event => { if (event.key === "Enter") { event.preventDefault(); event.currentTarget.blur(); } }} /><small>Optional. Players can use this link to ask about eligibility or pricing.</small>{error && <small role="alert">{error}</small>}</label>;
}
