"use client";

import { useState } from "react";
import { apiFetch } from "../../lib/client-request";
import { downloadJson } from "../../lib/download";
import { RESET_GAMES_CONFIRMATION } from "../../lib/organizer-safety";

type Props = {
  gameCount: number;
  revision: number;
  pin: string;
  managedUmpires: boolean;
  canReopenRegistration: boolean;
  disabled: boolean;
  onReset: (revision: number, digest: string, confirmation: string, reopenRegistration: boolean) => Promise<void>;
};

export function ResetGames({ gameCount, revision, pin, managedUmpires, canReopenRegistration, disabled, onReset }: Props) {
  const [backup, setBackup] = useState<{ revision: number; digest: string } | null>(null);
  const [confirmation, setConfirmation] = useState("");
  const [reopenRegistration, setReopenRegistration] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const validBackup = backup?.revision === revision;

  async function saveBackup() {
    setBusy(true);
    setBackup(null);
    setConfirmation("");
    setMessage("");
    try {
      const response = await apiFetch("/api/state?backup=1", {
        headers: { "x-organizer-pin": pin }, signal: AbortSignal.timeout(15000),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Backup could not be prepared.");
      downloadJson(data, `racketeers-before-game-reset-r${data.revision}.json`);
      setBackup({ revision: data.revision, digest: data.digest });
      setMessage("Check that the private backup file is saved before confirming.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Backup could not be prepared.");
    } finally {
      setBusy(false);
    }
  }

  async function reset(event: React.FormEvent) {
    event.preventDefault();
    if (!backup || !validBackup || busy || disabled || confirmation !== RESET_GAMES_CONFIRMATION) return;
    setBusy(true);
    setConfirmation("");
    setBackup(null);
    setMessage("");
    try {
      const reopen = canReopenRegistration && reopenRegistration;
      await onReset(backup.revision, backup.digest, confirmation, reopen);
      setReopenRegistration(false);
      setMessage(`Reset ${gameCount} ${gameCount === 1 ? "game" : "games"} and released all courts.${reopen ? " The tournament is now in Registration." : ""}`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not confirm the reset. Refresh and check Game Day Desk.");
    } finally {
      setBusy(false);
    }
  }

  return <details>
    <summary>Reset all games</summary>
    {gameCount === 0 ? <p>There are no games to reset.</p> : <form className="stack" onSubmit={event => void reset(event)}>
      <p>Clear scores, results, holds, forfeitures, and court assignments for all {gameCount} games. The group matchups, manual championship matchups, scheduled times, registrations, and payments are kept. Automatic championship places will be recalculated.</p>
      <p>{managedUmpires ? "Umpires return to waiting for an assignment." : "Each game gets a new PIN. Share it with the umpire after assigning the game."}</p>
      {canReopenRegistration && <label className="check-field">
        <input type="checkbox" checked={reopenRegistration} disabled={busy || disabled} onChange={event => setReopenRegistration(event.target.checked)} />
        Switch to Registration after resetting
      </label>}
      <div><button type="button" disabled={busy || disabled} onClick={() => void saveBackup()}>Download recovery backup</button></div>
      <label>After saving the backup, type {RESET_GAMES_CONFIRMATION} to confirm
        <input value={confirmation} disabled={!validBackup || busy || disabled} autoComplete="off" onChange={event => setConfirmation(event.target.value)} />
      </label>
      <div><button type="submit" className="danger" disabled={!validBackup || busy || disabled || confirmation !== RESET_GAMES_CONFIRMATION}>Reset all games</button></div>
    </form>}
    {backup && !validBackup ? <p role="status">The tournament changed. Download a new backup.</p> : message && <p role="status">{message}</p>}
  </details>;
}
