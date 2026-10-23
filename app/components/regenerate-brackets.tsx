"use client";
import { useState } from "react";
import type { TournamentState } from "../../lib/tournament";
import { regenerationImpact, regenerationIssue } from "../../lib/organizer-safety";
import { downloadJson } from "../../lib/download";

export function RegenerateBrackets({ state, revision, pin, disabled, onSaved }: { state: TournamentState; revision: number; pin: string; disabled: boolean; onSaved: () => void }) {
  const [open, setOpen] = useState(false);
  const [backup, setBackup] = useState<{ revision: number; digest: string } | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [phrase, setPhrase] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const issue = regenerationIssue(state), impact = regenerationImpact(state);
  const validBackup = backup?.revision === revision;
  async function saveBackup() {
    setBusy(true); setMessage(""); setConfirmed(false);
    try {
      const response = await fetch("/api/state?backup=1", { headers: { "x-organizer-pin": pin } });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Backup could not be prepared.");
      downloadJson(data, `racketeers-before-regeneration-r${data.revision}.json`);
      setBackup({ revision: data.revision, digest: data.digest });
      setMessage("Backup download started. Check that the JSON file is saved before continuing.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Backup failed."); }
    finally { setBusy(false); }
  }
  async function regenerate() {
    if (!validBackup || !confirmed || phrase !== "REGENERATE" || issue || disabled) return;
    setBusy(true); setMessage("");
    try {
      const response = await fetch("/api/state", { method: "POST", headers: { "content-type": "application/json", "x-organizer-pin": pin }, body: JSON.stringify({ action: "regenerateBrackets", expectedRevision: revision, backupDigest: backup!.digest, confirmation: phrase }) });
      const data = await response.json();
      if (!response.ok) { setBackup(null); throw new Error(data.error || "Regeneration failed."); }
      setOpen(false); setBackup(null); setPhrase(""); setConfirmed(false); onSaved();
    } catch (error) { setMessage(error instanceof Error ? error.message : "Regeneration failed."); }
    finally { setBusy(false); }
  }
  return <section className="regeneration-review">
    <button type="button" className="secondary" disabled={busy || disabled} aria-expanded={open} onClick={() => setOpen(value => !value)}>Review bracket regeneration</button>
    {open && <div className="card"><h3>Replace entries & brackets</h3><p>{impact.entries} entries and {impact.games} games will be rebuilt, including {impact.scheduled} planned court / schedule assignments and {impact.reserved} reservations. Game IDs and umpire PINs will be replaced.</p><p>Registrations and payment records are retained. This backup contains private tournament data; store it securely. It does not contain uploaded images or separately stored payment settings/reviews.</p>
      {issue ? <p role="alert">{issue}</p> : <><button type="button" disabled={busy || disabled} onClick={() => void saveBackup()}>1. Download recovery backup</button>{backup && !validBackup && <p role="status">The tournament changed. Download a new backup.</p>}<label className="check-field"><input type="checkbox" checked={confirmed && validBackup} disabled={!validBackup || busy} onChange={event => setConfirmed(event.target.checked)} />I checked that this backup file is saved.</label><label>Type REGENERATE to confirm<input value={phrase} disabled={busy || !validBackup} autoComplete="off" onChange={event => setPhrase(event.target.value)} /></label><button className="danger" type="button" disabled={busy || disabled || !validBackup || !confirmed || phrase !== "REGENERATE"} onClick={() => void regenerate()}>2. Replace entries & brackets</button></>}
      <button type="button" disabled={busy} onClick={() => setOpen(false)}>Cancel</button>{message && <p role="status">{message}</p>}</div>}
  </section>;
}
