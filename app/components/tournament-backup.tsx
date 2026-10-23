"use client";
import { useState } from "react";
import { downloadJson } from "../../lib/download";
export function TournamentBackup({ pin, disabled }: { pin: string; disabled: boolean }) {
  const [busy, setBusy] = useState(false), [message, setMessage] = useState("");
  async function download() {
    setBusy(true); setMessage("");
    try {
      const response = await fetch("/api/state?backup=1", { headers: { "x-organizer-pin": pin }, signal: AbortSignal.timeout(15000) });
      const backup = await response.json();
      if (!response.ok) throw new Error(backup.error || "Unable to download backup.");
      downloadJson(backup, `racketeers-state-r${backup.revision}.json`);
      setMessage("Download started. Check the file is saved securely. This is the tournament state only; payment reviews, settings and images require separate backup.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Backup failed."); }
    finally { setBusy(false); }
  }
  return <section className="card"><h2>Tournament recovery copy</h2><p>Save registrations, pairings, game PINs, scores and settings. This private file includes access and registration recovery data; keep it in secure storage.</p><button type="button" disabled={busy || disabled} onClick={() => void download()}>{busy ? "Preparing backup…" : "Download tournament state backup"}</button><p>Also export reviewed payment details from Registration. A complete backup needs the separate payment settings, receipt-review table, sponsor list and uploaded files. Restoration requires a reviewed recovery procedure.</p>{message && <p role="status">{message}</p>}</section>;
}
