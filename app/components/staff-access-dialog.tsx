"use client";

import { CaretRight } from "@phosphor-icons/react/dist/csr/CaretRight";
import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { OrganizerLogin } from "./organizer-accounts";

type StaffRole = "organizer" | "umpire";

type Props = {
  accountsEnabled: boolean;
  renewingOrganizer: boolean;
  onClose: () => void;
  onOrganizerLogin: () => Promise<void>;
  onPinLogin: (role: StaffRole, pin: string) => Promise<void>;
};

export function StaffAccessDialog({ accountsEnabled, renewingOrganizer, onClose, onOrganizerLogin, onPinLogin }: Props) {
  const [role, setRole] = useState<StaffRole | null>(renewingOrganizer ? "organizer" : null);
  const [legacy, setLegacy] = useState(false);
  const [pin, setPin] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const titleId = useId();
  const errorId = useId();
  const usesPin = role === "umpire" || (role === "organizer" && legacy && !accountsEnabled);

  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    return () => element?.close();
  }, []);

  useEffect(() => {
    heading.current?.focus();
  }, [role, usesPin]);

  function closeDialog() {
    dialog.current?.close();
    onClose();
  }

  function goBack() {
    setPin("");
    setError("");
    if (legacy) setLegacy(false);
    else setRole(null);
  }

  async function submitPin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!role || busy) return;
    setBusy(true);
    setError("");
    try {
      await onPinLogin(role, pin);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Sign-in failed. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <dialog ref={dialog} className="staff-access-dialog" aria-labelledby={titleId} onCancel={event => {
      event.preventDefault();
      if (!busy) closeDialog();
    }}>
      <div className="staff-access-content">
        <header>
          <h2 id={titleId} ref={heading} tabIndex={-1}>
            {role === "organizer" ? "Organizer sign-in" : role === "umpire" ? "Umpire sign-in" : "Staff access"}
          </h2>
          {!role && <p>Choose your role for this tournament.</p>}
          {role === "umpire" && <p>Use your staff PIN. You’ll enter the match PIN at the scorecard.</p>}
        </header>
        {!role && (
          <div className="staff-role-list">
            <button type="button" className="staff-role-choice" onClick={() => setRole("organizer")}>
              <span><strong>Organizer</strong><small>Registration, courts and results</small></span>
              <CaretRight size={18} aria-hidden="true" />
            </button>
            <button type="button" className="staff-role-choice" onClick={() => setRole("umpire")}>
              <span><strong>Umpire</strong><small>Match scorecards and court help</small></span>
              <CaretRight size={18} aria-hidden="true" />
            </button>
          </div>
        )}
        {role === "organizer" && !usesPin && (
          <>
            <OrganizerLogin onLogin={onOrganizerLogin} onBusyChange={setBusy} />
            {!accountsEnabled && <button type="button" className="staff-access-link" disabled={busy} onClick={() => setLegacy(true)}>Use existing organizer PIN</button>}
          </>
        )}
        {usesPin && (
          <form className="staff-pin-form" onSubmit={submitPin} aria-busy={busy}>
            <label>{role === "umpire" ? "Umpire staff PIN" : "Organizer PIN"}
              <input type="password" inputMode="numeric" autoComplete="off" required minLength={4} maxLength={10}
                pattern="[0-9]{4,10}" value={pin} disabled={busy} aria-invalid={Boolean(error)}
                aria-describedby={error ? errorId : undefined} onChange={event => {
                  setPin(event.target.value.replace(/\D/g, "").slice(0, 10));
                  setError("");
                }} />
            </label>
            {error && <p id={errorId} className="staff-access-error" role="alert">{error}</p>}
            <button type="submit" className="primary" disabled={busy}>{busy ? "Signing in…" : "Sign in"}</button>
          </form>
        )}
        <footer className="staff-access-actions">
          {role && (legacy || !renewingOrganizer) && <button type="button" className="staff-access-link" disabled={busy} onClick={goBack}>{legacy ? "Back to password sign-in" : "Back to roles"}</button>}
          <button type="button" className="staff-access-link" disabled={busy} onClick={closeDialog}>Cancel</button>
        </footer>
      </div>
    </dialog>
  );
}
