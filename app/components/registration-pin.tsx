"use client";
import { useState } from "react";

export function RegistrationPin({ registrationId, organizerPin, disabled, onChanged }: { registrationId: string; organizerPin: string; disabled: boolean; onChanged: () => void }) {
  const [pin, setPin] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const requestPin = async (replace = false) => {
    if (replace && !confirm("Issue a replacement registration PIN? The old PIN will stop working for every entry that shares it. Give the new PIN to the player.")) return;
    setBusy(true); setMessage(""); setPin(null);
    try {
      const response = await fetch("/api/state", { method: "POST", headers: { "content-type": "application/json", "x-organizer-pin": organizerPin }, body: JSON.stringify({ action: replace ? "replaceRegistrationPin" : "viewRegistrationPin", registrationId }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Unable to retrieve the registration PIN.");
      setPin(data.pin || null);
      if (!data.pin) setMessage("This older PIN cannot be recovered. Issue a replacement if the player has lost it.");
      if (replace) { setMessage("Replacement PIN issued. The old PIN no longer works."); onChanged(); }
    } catch (error) { setMessage(error instanceof Error ? error.message : "Unable to retrieve the PIN."); }
    finally { setBusy(false); }
  };
  return <section className="organizer-registration-pin"><strong>Private registration PIN</strong><small>Organizer-only recovery. Share privately with the registered player.</small>{pin ? <div><code>{pin}</code><button type="button" className="ghost" onClick={() => setPin(null)}>Hide PIN</button></div> : <button type="button" className="secondary" disabled={disabled || busy} onClick={() => void requestPin()}>Show registration PIN</button>}<button type="button" className="ghost" disabled={disabled || busy} onClick={() => void requestPin(true)}>Issue replacement PIN</button>{message && <p role="status">{message}</p>}</section>;
}
