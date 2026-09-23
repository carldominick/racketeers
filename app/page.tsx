"use client";

import { PaymentSettings } from "./components/payment-settings";
import { Projector } from "./components/projector";
import { RegistrationPin } from "./components/registration-pin";
import { PhotoUploadButton, PaymentProof, preparePaymentImage, uploadPaymentImage } from "./components/payment-proof";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  addDivision,
  adjustMatchScore,
  assignSchedule,
  completeMatchSet,
  displayName,
  distributeEntriesToPools,
  duplicateDivision,
  initialTournament,
  isCourtAvailable,
  isSetWon,
  matchWinner,
  regenerateMatchPin,
  regenerateMatches,
  removeDivision,
  standingsFor,
  stageLabel,
  subBracketName,
  syncRegistrationsToEntries,
  uncompleteMatchSet,
  unvalidateTournamentMatch,
  validateTournamentMatch,
  type Division,
  type Entry,
  type Match,
  type PlayerRegistration,
  type TournamentState,
} from "../lib/tournament";

type View = "organizer" | "register" | "umpire" | "spectator" | "projector";
type Tab = "setup" | "registration" | "players" | "brackets" | "draw" | "scores" | "schedule" | "standings";
type PrintMode = { type: "schedule" } | { type: "scorecard"; matchId: string } | { type: "scorecards" } | null;

const LEVELS = ["Beginner", "Intermediate", "Advanced", "Open"];

const organizerTabs: { id: Tab; label: string }[] = [
  { id: "setup", label: "Setup" }, { id: "registration", label: "Registration" }, { id: "players", label: "Players" },
  { id: "brackets", label: "Matchups" }, { id: "draw", label: "Bracket Draw" }, { id: "scores", label: "Group Scores & PINs" },
  { id: "schedule", label: "Schedule" }, { id: "standings", label: "Tournament Progress" },
];

function fmtDate(value: string | null) {
  if (!value) return "Unscheduled";
  return new Intl.DateTimeFormat("en-PH", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(value));
}

function inputDateTime(value: string | null) {
  if (!value) return "";
  const date = new Date(value);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

function Status({ match }: { match: Match }) {
  const text = match.validated ? "Validated" : match.status === "finished" ? "Completed" : match.status === "live" ? "Live" : "Ready";
  return <span className={`status status-${text.toLowerCase()}`}>{text}</span>;
}

function DraftNumberInput({ value, min, max, ariaLabel, onCommit }: { value: number; min?: number; max?: number; ariaLabel?: string; onCommit: (value: number) => void }) {
  const [editor, setEditor] = useState({ source: value, text: String(value) });
  const draft = editor.source === value ? editor.text : String(value);
  const setDraft = (text: string) => setEditor({ source: value, text });
  const commitDraft = () => {
    if (draft.trim() === "") { setDraft(String(value)); return; }
    const parsed = Math.trunc(Number(draft));
    if (!Number.isFinite(parsed)) { setDraft(String(value)); return; }
    const next = Math.max(min ?? Number.MIN_SAFE_INTEGER, Math.min(max ?? Number.MAX_SAFE_INTEGER, parsed));
    setDraft(String(next));
    if (next !== value) onCommit(next);
  };
  return <input aria-label={ariaLabel} type="number" inputMode="numeric" min={min} max={max} value={draft} onFocus={(event) => event.currentTarget.select()} onChange={(event) => setDraft(event.target.value)} onBlur={commitDraft} onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); if (event.key === "Escape") { setDraft(String(value)); event.currentTarget.blur(); } }} />;
}

function PinGate({ onUnlock, title = "Organizer access" }: { onUnlock: (pin: string) => Promise<boolean>; title?: string }) {
  const [pin, setPin] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  return <section className="gate card">
    <div className="gate-icon">✦</div><p className="eyebrow">Protected area</p><h2>{title}</h2>
    <p>Enter the organizer PIN to view and manage tournament controls.</p>
    <form onSubmit={async (event) => { event.preventDefault(); setBusy(true); const ok = await onUnlock(pin); setBusy(false); setError(ok ? "" : "That PIN did not match."); }}>
      <input aria-label="Organizer PIN" type="password" inputMode="numeric" value={pin} onChange={(event) => setPin(event.target.value)} placeholder="Enter PIN" />
      <button className="primary" disabled={busy || !pin}>{busy ? "Checking…" : "Unlock"}</button>
    </form>{error && <p className="error">{error}</p>}
  </section>;
}

type RegistrationDraft = { partnerId?: string | null; partnerEntryCount?: number; club?: string; partnerClub?: string; sourceRegistrationId?: string; samePartner?: boolean; secondShirt?: "black" | "tournament"; partnerSecondShirt?: "black" | "tournament"; entryCount?: number; id?: string; name: string; divisionId: string; partnerName: string; partnerShirtSize: string; partnerDesiredLevel: string; teamName: string; shirtSize: string; playerLevel: string; desiredLevel: string };

const PHASES = [
  { id: "setup", label: "Setup", note: "Configure the tournament" },
  { id: "registration", label: "Registration", note: "Players can register and edit" },
  { id: "live", label: "Live", note: "Registration is locked" },
  { id: "completed", label: "Completed", note: "Tournament finished" },
] as const;

function PhaseTracker({ state, onChange }: { state: TournamentState; onChange?: (status: TournamentState["status"]) => void }) {
  const current = PHASES.findIndex((phase) => phase.id === state.status);
  return <section className="phase-tracker" aria-label="Tournament status">{PHASES.map((phase, index) => <button type="button" key={phase.id} className={`${index < current ? "done" : ""} ${index === current ? "active" : ""}`} disabled={!onChange} onClick={() => onChange?.(phase.id)}><b>{index < current ? "✓" : index + 1}</b><span><strong>{phase.label}</strong><small>{phase.note}</small></span></button>)}</section>;
}

function PublicRegistration({ state, onSaved, organizerPin = "", initialDivisionId, initialRegistration }: { state: TournamentState; onSaved: () => void; organizerPin?: string; initialDivisionId?: string; initialRegistration?: PlayerRegistration }) {
  const makeDraft = (): RegistrationDraft => ({ name: "", divisionId: initialDivisionId || state.divisions[0]?.id || "", partnerName: "", partnerShirtSize: "M", partnerDesiredLevel: "Beginner", teamName: "", shirtSize: "M", playerLevel: "Beginner", desiredLevel: "Beginner" });
  const [mode, setMode] = useState<"landing" | "new" | "edit" | "success">(organizerPin ? "new" : "landing");
  const [step, setStep] = useState(0);
  const stepHeading = useRef<HTMLHeadingElement>(null);
  const goToStep = (next: number) => { setStep(next); setMessage(""); requestAnimationFrame(() => stepHeading.current?.focus({ preventScroll: true })); };
  useEffect(() => {
    if (mode === "new" || mode === "edit") {
      stepHeading.current?.focus({ preventScroll: true });
      stepHeading.current?.closest(".guided-registration")?.scrollIntoView({ block: "start" });
    }
  }, [mode, step]);
  const [pin, setPin] = useState("");
  const [draft, setDraft] = useState<RegistrationDraft>(() => initialRegistration ? { ...makeDraft(), ...initialRegistration, id: undefined, sourceRegistrationId: initialRegistration.id, samePartner: Boolean(initialRegistration.partnerId), secondShirt: "tournament", partnerSecondShirt: "tournament", partnerName: state.registrations.find(r => r.id === initialRegistration.partnerId)?.name || "", partnerClub: state.registrations.find(r => r.id === initialRegistration.partnerId)?.club || "", partnerShirtSize: state.registrations.find(r => r.id === initialRegistration.partnerId)?.shirtSize || "M", partnerDesiredLevel: state.registrations.find(r => r.id === initialRegistration.partnerId)?.desiredLevel || "Beginner" } : makeDraft());
  const [secondEntry, setSecondEntry] = useState<RegistrationDraft | null>(null);
  const [savedEntries, setSavedEntries] = useState<RegistrationDraft[]>([]);
  const [originalPartnerName, setOriginalPartnerName] = useState(initialRegistration ? state.registrations.find(r => r.id === initialRegistration.partnerId)?.name || "" : "");
  const [message, setMessage] = useState("");
  const [submittedPin, setSubmittedPin] = useState("");
  const [busy, setBusy] = useState(false);
  const submissionInFlight = useRef(false);
  const [paymentFile, setPaymentFile] = useState<File | null>(null);
  const [paymentEnabled, setPaymentEnabled] = useState(false);
  const [savedRegistrationId, setSavedRegistrationId] = useState("");
  useEffect(() => {
    fetch("/api/payment-proof?capabilities=1").then(r => r.json()).then(data => setPaymentEnabled(Boolean(data.enabled))).catch(() => setPaymentEnabled(false));
  }, []);
  const division = state.divisions.find((item) => item.id === draft.divisionId);
  const update = (patch: Partial<RegistrationDraft>) => {
    if (patch.partnerName === "" || (patch.divisionId && state.divisions.find(d => d.id === patch.divisionId)?.mode === "singles")) setSecondEntry(current => current ? { ...current, samePartner: false } : null);
    setDraft((current) => ({ ...current, ...patch }));
  };
  const lookup = async (registrationId?: string) => {
    setBusy(true); setMessage("");
    const response = await fetch("/api/state", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "lookupRegistration", pin, registrationId }) });
    const data = await response.json(); setBusy(false);
    if (!response.ok || !data.registration) return setMessage(data.error || "Registration PIN did not match an entry.");
    setSecondEntry(null); setSavedEntries(data.registrations || [data.registration]);
    setDraft({ ...makeDraft(), ...data.registration }); setSubmittedPin(""); setSavedRegistrationId(data.registration.id); setPaymentFile(null); setMode("edit"); setStep(0);
  };
  const beginSecondEntry = (partner = false) => {
    const sourceId = partner ? draft.partnerId : savedRegistrationId;
    if (!sourceId) return;
    setSecondEntry(null); setSavedEntries([]);
    setOriginalPartnerName(partner ? draft.name : draft.partnerName);
    setDraft({ ...draft, id: undefined, sourceRegistrationId: sourceId, samePartner: Boolean(partner ? draft.name : draft.partnerName),
      name: partner ? draft.partnerName : draft.name, partnerName: partner ? draft.name : draft.partnerName,
      club: partner ? draft.partnerClub : draft.club, partnerClub: partner ? draft.club : draft.partnerClub,
      shirtSize: partner ? draft.partnerShirtSize : draft.shirtSize, partnerShirtSize: partner ? draft.shirtSize : draft.partnerShirtSize,
      desiredLevel: partner ? draft.partnerDesiredLevel : draft.desiredLevel, partnerDesiredLevel: partner ? draft.desiredLevel : draft.partnerDesiredLevel,
      secondShirt: "tournament", partnerSecondShirt: "tournament" });
    setPin(submittedPin || pin); setPaymentFile(null); setMode("new"); setStep(0); setMessage("");
  };
  const submit = async () => {
    if (submissionInFlight.current || busy || mode === "success") return;
    submissionInFlight.current = true;
    setBusy(true); setMessage("");
    const action = mode === "edit" ? "updateRegistration" : "registerPlayer";
    try {
      const preparedImage = paymentFile ? await preparePaymentImage(paymentFile) : null;
      const response = await fetch("/api/state", { method: "POST", headers: { "content-type": "application/json", ...(organizerPin ? { "x-organizer-pin": organizerPin } : {}) }, body: JSON.stringify({ action, pin: mode === "edit" || draft.sourceRegistrationId ? pin : undefined, registrationId: mode === "edit" ? savedRegistrationId : undefined, registration: { ...draft, ...(mode === "new" && !draft.sourceRegistrationId && secondEntry ? { secondEntry } : {}) } }) });
      const data = await response.json();
      if (!response.ok) return setMessage(data.error || "The registration could not be saved.");
      setDraft({ ...makeDraft(), ...data.registration });
      setSavedEntries(data.registrations || [data.registration]); setSecondEntry(null);
      setSubmittedPin(data.editPin || pin);
      setSavedRegistrationId(data.registration.id);
      setMessage(data.editPin ? "Your registration has been submitted." : "Your registration changes have been saved.");
      setMode("success");
      if (preparedImage) {
        try {
          await uploadPaymentImage(data.registration.id, organizerPin || data.editPin || pin, preparedImage, Boolean(organizerPin));
          setMessage("Your registration and payment screenshot are saved. The organizer will verify the payment.");
          setPaymentFile(null);
        } catch (error) {
          setMessage(`Your registration is saved, but the screenshot was not uploaded. ${error instanceof Error ? error.message : "Please try again."} Use the upload option below; do not register again.`);
        }
      }
      onSaved();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to save registration. Please try again.");
    } finally {
      submissionInFlight.current = false;
      setBusy(false);
    }
  };
  if (!organizerPin && state.status !== "registration") return <section className="registration-portal"><div className="portal-hero"><p className="eyebrow">Tournament status · {state.status}</p><h2>Player registration is locked</h2><p>{state.status === "setup" ? "The organizer is still preparing the tournament. Registration will open when the tournament moves to the Registration phase." : state.status === "live" ? "The tournament is live, so new registrations and PIN-based edits are closed." : "This tournament has been completed and registration is closed."}</p></div><PhaseTracker state={state} /><section className="card locked-registration"><strong>Registration is read-only outside the Registration phase.</strong><span>Contact the organizer if a correction is required.</span></section></section>;
  if (mode === "landing") return <section className="registration-portal"><div className="portal-hero"><p className="eyebrow">Player registration</p><h2>Join the Racketeers tournament</h2><p>Register a new entry or use the private PIN provided after registration to edit an existing entry.</p></div><PaymentSettings /><div className="portal-options"><article className="card"><h3>Edit my registration</h3><p>Enter your 8–10 digit registration PIN to edit or add a second entry.</p><input aria-label="Registration PIN" inputMode="numeric" value={pin} onChange={(event) => setPin(event.target.value.replace(/\D/g, "").slice(0, 10))} placeholder="8–10 digit PIN" /><button type="button" className="secondary" disabled={busy || pin.length < 8 || pin.length > 10} onClick={() => void lookup()}>{busy ? "Checking…" : "Open Entry"}</button></article><article className="card accent-card"><h3>Register for the tournament</h3><p>Add both players, their individual shirt sizes, and the registered playing level.</p><button type="button" className="primary" onClick={() => { setDraft(makeDraft()); setSecondEntry(null); setSavedEntries([]); setPaymentFile(null); setSavedRegistrationId(""); setPin(""); setSubmittedPin(""); setMessage(""); setStep(0); setMode("new"); }}>Start Registration</button></article></div>{message && <p className="portal-message error">{message}</p>}</section>;
  if (mode === "success") return <section className="registration-portal registration-success"><div className="portal-hero"><p className="eyebrow">Registration complete</p><h2>Your entry is saved</h2><p>The submit action is now locked so this entry cannot be accidentally registered twice.</p></div><article className="card registration-receipt"><span className="receipt-check">✓</span><h3>{message}</h3><div className="registration-save-warning" role="note"><strong>Save your registration ID and private PIN before leaving.</strong><p>Take a screenshot of this confirmation or store both details somewhere safe. The organizer uses your registration ID to find your entry. You need your private PIN to open or edit it; the ID alone does not grant access. Keep the PIN and any screenshot private.</p></div><strong className="receipt-pin">{submittedPin}</strong><p>Registration ID: <strong>{savedRegistrationId}</strong></p>{savedEntries.length > 1 && <div className="combined-receipt"><strong>Both entries share this PIN and payment proof</strong>{savedEntries.map(entry => <p key={entry.id}>{state.divisions.find(d => d.id === entry.divisionId)?.name} · {entry.name}{entry.partnerName ? ` / ${entry.partnerName}` : ""}<br /><code>{entry.id}</code></p>)}</div>}{!busy && <PaymentProof registrationId={savedRegistrationId} pin={organizerPin || submittedPin} organizer={Boolean(organizerPin)} canUpload />}<div className="receipt-actions">{(draft.entryCount || 1) < 2 && <button type="button" className="secondary" disabled={busy} onClick={() => beginSecondEntry()}>Add second entry for {draft.name}</button>}{draft.partnerId && (draft.partnerEntryCount || 1) < 2 && <button type="button" className="secondary" disabled={busy} onClick={() => beginSecondEntry(true)}>Add second entry for {draft.partnerName}</button>}<button type="button" className="secondary" onClick={() => { setPin(submittedPin); setMessage(""); setMode("landing"); }}>Edit Entry by PIN</button><button type="button" className="primary" onClick={() => { setDraft(makeDraft()); setSecondEntry(null); setSavedEntries([]); setPaymentFile(null); setSavedRegistrationId(""); setPin(""); setSubmittedPin(""); setMessage(""); setMode("landing"); }}>Back to Registration Page</button></div></article></section>;
  const sizes = ["XS", "S", "M", "L", "XL", "2XL", "3XL"];
  const secondDivision = state.divisions.find(d => d.id === secondEntry?.divisionId);
  const secondValid = !secondEntry || Boolean(secondDivision && (secondDivision.mode !== "doubles" || (secondEntry.samePartner ? draft.partnerName.trim() : secondEntry.partnerName.trim())));
  const playersValid = Boolean(draft.name.trim() && division && (division.mode !== "doubles" || draft.partnerName.trim()));
  return <section className="public-registration-form guided-registration">
    <div className="guided-workspace">
      <div className="guided-main">
        <header className="guided-heading"><p className="eyebrow">Tournament registration</p><h2 ref={stepHeading} tabIndex={-1}>{mode === "edit" ? "Update your registration" : draft.sourceRegistrationId ? "Register your second entry" : "Register your pair"}</h2><p>Enter each player separately so shirt sizes and playing levels stay accurate.</p></header>
        <ol className="registration-steps" aria-label="Registration progress">{["Players", "Entries & shirts", "Payment & review"].map((label, index) => <li key={label} aria-current={step === index ? "step" : undefined}><button type="button" disabled={busy || (index > step && (!playersValid || (index === 2 && !secondValid)))} onClick={() => goToStep(index)}><span>{index + 1}</span>{label}</button></li>)}</ol>
        {mode === "edit" && savedEntries.length > 1 && <label className="entry-switch">Entry to edit<select disabled={busy} value={savedRegistrationId} onChange={event => void lookup(event.target.value)}>{savedEntries.map(entry => <option key={entry.id} value={entry.id}>{state.divisions.find(d => d.id === entry.divisionId)?.name} · {entry.id}</option>)}</select><small>These entries share one PIN and payment proof.</small></label>}
        <div hidden={step !== 0}><div className="registration-entry-basics">{draft.sourceRegistrationId && <p>Second entry linked to <strong>{draft.sourceRegistrationId}</strong>. Choose the same or a different division.</p>}<label>Division<select value={draft.divisionId} onChange={(event) => update({ divisionId: event.target.value, ...(draft.sourceRegistrationId ? {} : { partnerName: "" }), teamName: "" })}>{state.divisions.map((item) => <option key={item.id} value={item.id}>{item.name} · {item.mode}</option>)}</select></label>{division?.mode === "team" && <label>Team name<input value={draft.teamName} onChange={(event) => update({ teamName: event.target.value })} placeholder="Team name" /></label>}</div><div className="registration-player-grid"><fieldset className="person-fields"><legend><span>1</span> Player 1</legend><label className="player-name-field">Player name<input readOnly={Boolean(draft.sourceRegistrationId)} value={draft.name} onChange={(event) => update({ name: event.target.value })} placeholder="Full name" /></label><label>Club / group (optional)<input maxLength={80} value={draft.club || ""} onChange={event => update({ club: event.target.value })} /></label>{draft.secondShirt && <label>Second-entry shirt<select value={draft.secondShirt} onChange={event => update({ secondShirt: event.target.value as "black" | "tournament" })}><option value="tournament">Second tournament shirt</option><option value="black">Black shirt</option></select></label>}<label>Shirt size<select value={draft.shirtSize} onChange={(event) => update({ shirtSize: event.target.value })}>{sizes.map((size) => <option key={size}>{size}</option>)}</select></label><label>Registered level<select value={draft.desiredLevel} onChange={(event) => update({ desiredLevel: event.target.value })}>{LEVELS.map((level) => <option key={level}>{level}</option>)}</select></label></fieldset>{division?.mode !== "singles" && <fieldset className="person-fields"><legend><span>2</span> Player 2 / Partner</legend><label className="player-name-field">Partner name<input readOnly={Boolean(draft.sourceRegistrationId && draft.samePartner)} value={draft.partnerName} onChange={(event) => update({ partnerName: event.target.value })} placeholder="Partner's full name" /></label><label>Club / group (optional)<input maxLength={80} value={draft.partnerClub || ""} onChange={event => update({ partnerClub: event.target.value })} /></label>{draft.sourceRegistrationId && <label className="check-field"><input type="checkbox" disabled={!originalPartnerName} checked={Boolean(draft.samePartner)} onChange={event => update({ samePartner: event.target.checked, partnerName: event.target.checked ? originalPartnerName : "" })} />Same partner as the first entry</label>}{(draft.partnerSecondShirt && (!draft.sourceRegistrationId || draft.samePartner)) && <label>Partner second-entry shirt<select value={draft.partnerSecondShirt} onChange={event => update({ partnerSecondShirt: event.target.value as "black" | "tournament" })}><option value="tournament">Second tournament shirt</option><option value="black">Black shirt</option></select></label>}<label>Shirt size<select value={draft.partnerShirtSize} onChange={(event) => update({ partnerShirtSize: event.target.value })}>{sizes.map((size) => <option key={size}>{size}</option>)}</select></label><label>Registered level<select value={draft.partnerDesiredLevel} onChange={(event) => update({ partnerDesiredLevel: event.target.value })}>{LEVELS.map((level) => <option key={level}>{level}</option>)}</select></label></fieldset>}</div></div>
        <section hidden={step !== 1} className="guided-entry-review"><h3>Entries & shirts</h3><p>{draft.sourceRegistrationId ? "This entry is linked to your first registration. You can use the same or a different division." : "Check your division and shirt sizes before continuing."}</p><dl><div><dt>Division</dt><dd>{division?.name || "Choose a division"}</dd></div><div><dt>{draft.name || "Player 1"}</dt><dd>{draft.shirtSize}{draft.secondShirt ? ` · ${draft.secondShirt === "black" ? "Black shirt" : "Second tournament shirt"}` : " · Tournament shirt"}</dd></div>{division?.mode !== "singles" && <div><dt>{draft.partnerName || "Partner"}</dt><dd>{draft.partnerShirtSize}{draft.partnerSecondShirt && (!draft.sourceRegistrationId || draft.samePartner) ? ` · ${draft.partnerSecondShirt === "black" ? "Black shirt" : "Second tournament shirt"}` : " · Tournament shirt"}</dd></div>}</dl><button type="button" className="guided-text-button" onClick={() => goToStep(0)}>Edit players, division or shirts</button>{mode === "new" && !draft.sourceRegistrationId && <section className="combined-entry"><label className="combined-toggle"><input type="checkbox" checked={Boolean(secondEntry)} onChange={event => setSecondEntry(event.target.checked ? { ...makeDraft(), divisionId: draft.divisionId, samePartner: Boolean(draft.partnerName && division?.mode !== "singles"), secondShirt: "tournament", partnerSecondShirt: "tournament", shirtSize: draft.shirtSize, partnerShirtSize: draft.partnerShirtSize } : null)} /><span><strong>Add a second entry now</strong><small>Submit both entries together with one PIN and one payment photo.</small></span></label>{secondEntry && <div className="second-entry-fields"><label>Second entry division<select value={secondEntry.divisionId} onChange={event => setSecondEntry({ ...secondEntry, divisionId: event.target.value, teamName: "", samePartner: state.divisions.find(d => d.id === event.target.value)?.mode === "singles" ? false : secondEntry.samePartner })}>{state.divisions.map(d => <option key={d.id} value={d.id}>{d.name} · {d.mode}</option>)}</select><small>Choose the same or a different division.</small></label><p>Player: <strong>{draft.name}</strong></p>{secondDivision?.mode === "team" && <label>Second entry team name<input value={secondEntry.teamName} onChange={event => setSecondEntry({ ...secondEntry, teamName: event.target.value })} /></label>}<label>Second shirt<select value={secondEntry.secondShirt} onChange={event => setSecondEntry({ ...secondEntry, secondShirt: event.target.value as "black" | "tournament" })}><option value="tournament">Second tournament shirt</option><option value="black">Black shirt</option></select></label><label>Second shirt size<select value={secondEntry.shirtSize} onChange={event => setSecondEntry({ ...secondEntry, shirtSize: event.target.value })}>{sizes.map(size => <option key={size}>{size}</option>)}</select></label>{secondDivision?.mode !== "singles" && <><label className="combined-toggle"><input type="checkbox" disabled={!draft.partnerName || division?.mode === "singles"} checked={Boolean(secondEntry.samePartner && draft.partnerName && division?.mode !== "singles")} onChange={event => setSecondEntry({ ...secondEntry, samePartner: event.target.checked })} /><span>Same partner as the first entry</span></label>{secondEntry.samePartner && draft.partnerName && division?.mode !== "singles" ? <p>Partner: <strong>{draft.partnerName}</strong></p> : <><label>Second entry partner name<input value={secondEntry.partnerName} onChange={event => setSecondEntry({ ...secondEntry, samePartner: false, partnerName: event.target.value })} placeholder="Partner’s full name" /></label><label>Second entry partner club / group (optional)<input maxLength={80} value={secondEntry.partnerClub || ""} onChange={event => setSecondEntry({ ...secondEntry, partnerClub: event.target.value })} /></label><label>Second entry partner registered level<select value={secondEntry.partnerDesiredLevel} onChange={event => setSecondEntry({ ...secondEntry, partnerDesiredLevel: event.target.value })}>{LEVELS.map(level => <option key={level}>{level}</option>)}</select></label></>}{secondEntry.samePartner && <label>Partner second shirt<select value={secondEntry.partnerSecondShirt} onChange={event => setSecondEntry({ ...secondEntry, partnerSecondShirt: event.target.value as "black" | "tournament" })}><option value="tournament">Second tournament shirt</option><option value="black">Black shirt</option></select></label>}<label>Second entry partner shirt size<select value={secondEntry.partnerShirtSize} onChange={event => setSecondEntry({ ...secondEntry, partnerShirtSize: event.target.value })}>{sizes.map(size => <option key={size}>{size}</option>)}</select></label></>}</div>}</section>}{!draft.sourceRegistrationId && !secondEntry && (draft.entryCount || 1) < 2 && <p className="guided-note">You can also add a second entry later by reopening your registration with its private PIN.</p>}{mode === "edit" && (draft.entryCount || 1) < 2 && <button type="button" className="secondary" onClick={() => beginSecondEntry()}>Add a second entry for this player / pair</button>}{mode === "edit" && draft.partnerId && (draft.partnerEntryCount || 1) < 2 && <button type="button" className="secondary" onClick={() => beginSecondEntry(true)}>Add second entry for {draft.partnerName}</button>}</section>
        <section hidden={step !== 2} className="guided-payment"><h3>Payment & review</h3>{secondEntry && <p className="guided-note">One payment photo will cover both entries. Please pay the total for all selected entries; the organizer will verify the amount.</p>}{draft.sourceRegistrationId && <p className="guided-note">This entry shares the payment proof from your first registration. Upload an updated photo only if you need to replace it.</p>}<PaymentSettings />{mode === "new" ? <section className="payment-proof"><strong>Payment photo (optional)</strong><PhotoUploadButton label={paymentFile ? "Change selected payment photo" : "Upload payment photo"} disabled={!paymentEnabled || busy} selectedName={paymentFile?.name} onSelect={file => setPaymentFile(file)} /><p>The photo will upload when you click <strong>Submit Registration</strong>.</p><small>{paymentEnabled ? "PNG, JPG, or WebP · up to 2 MB. Saved using your registration ID after submission. Uploading proof does not automatically confirm payment." : "Screenshot uploads are not available yet. You can register now and add proof later using your PIN."}</small>{paymentFile && <span>Selected: {paymentFile.name}</span>}</section> : <PaymentProof registrationId={savedRegistrationId} pin={pin} canUpload /> }<div className="guided-note"><strong>Review before submitting</strong><p>After submitting, save your registration ID and private PIN or take a screenshot of the confirmation.</p></div></section>
      </div>
      <aside className="guided-summary" aria-label="Registration summary"><h3>Your registration</h3><div className="guided-summary-entry"><strong>Entry {draft.sourceRegistrationId || draft.secondShirt ? "2" : "1"} · {division?.name || "Select division"}</strong><span>{division?.mode === "singles" ? "Singles · 1 player" : division?.mode === "team" ? "Team entry" : "Doubles · 2 players"}</span></div>{secondEntry && <div className="guided-summary-entry"><strong>Entry 2 · {secondDivision?.name || "Select division"}</strong><span>{secondDivision?.mode === "singles" ? draft.name : `${draft.name} / ${secondEntry.samePartner ? draft.partnerName : secondEntry.partnerName || "Choose partner"}`}</span><span>{secondEntry.secondShirt === "black" ? "Black shirt" : "Second tournament shirt"} · {secondEntry.shirtSize}</span></div>}{draft.name && <p className="guided-summary-names">{draft.name}{division?.mode !== "singles" && draft.partnerName ? ` / ${draft.partnerName}` : ""}</p>}<p>{draft.sourceRegistrationId ? "Your second entry stays linked to your original registration." : secondEntry ? "Both entries will share one PIN and one payment proof." : savedEntries.length > 1 ? "Use Entry to edit to switch between your entries. Both share one PIN and payment proof." : (draft.entryCount || 1) >= 2 ? "This player has two linked entries." : "Add a second entry in Entries & shirts, or later using your registration PIN."}</p><button type="button" className="guided-text-button" disabled={busy} onClick={() => { setMode("landing"); setMessage(""); }}>Already registered? Open your entry</button></aside>
    </div>
    {message && <p role="alert" className="error">{message}</p>}
    <footer className="guided-footer"><button type="button" className="guided-text-button" disabled={busy} onClick={() => step > 0 ? goToStep(step - 1) : (setMode("landing"), setMessage(""))}>Back</button>{step < 2 ? <button type="button" className="primary" disabled={!playersValid || (step > 0 && !secondValid) || busy} onClick={() => goToStep(step + 1)}>Continue</button> : <button type="button" className="primary" disabled={!playersValid || (step > 0 && !secondValid) || busy} onClick={() => void submit()}>{busy ? "Saving…" : mode === "new" ? "Submit Registration" : "Save Changes"}</button>}</footer>
  </section>;
}

function StandingsTable({ state, division }: { state: TournamentState; division: Division }) {
  const rows = standingsFor(state, division.id);
  return <div className="table-wrap"><table><thead><tr><th>#</th><th>Entry</th><th>P</th><th>W</th><th>L</th><th>PF</th><th>PA</th><th>Diff</th></tr></thead>
    <tbody>{rows.map((row, index) => <tr key={row.entryId}><td>{index + 1}</td><td><strong>{row.name}</strong></td><td>{row.played}</td><td>{row.wins}</td><td>{row.losses}</td><td>{row.pointsFor}</td><td>{row.pointsAgainst}</td><td className={row.difference >= 0 ? "positive" : "negative"}>{row.difference > 0 ? "+" : ""}{row.difference}</td></tr>)}</tbody></table></div>;
}

function BracketDraw({ state }: { state: TournamentState }) {
  return <div className="stack bracket-draws">{state.divisions.map((division) => {
    const entries = new Map(division.entries.map((entry) => [entry.id, entry]));
    const divisionMatches = state.matches.filter((match) => match.divisionId === division.id);
    const pools = distributeEntriesToPools(division);
    const stages = ["round_64", "round_32", "round_16", "quarterfinal", "semifinal", "gold", "bronze"] as Match["stage"][];
    return <section className="card draw-section" key={division.id}><div className="section-head"><div><p className="eyebrow">Tournament draw</p><h2>{division.name}</h2></div><span className="rule-pill">{pools.length} pool{pools.length === 1 ? "" : "s"} → {division.championshipFormat === "ladderized" ? `Top ${division.knockoutSize}` : "Championship"}</span></div><div className="sub-bracket-rosters">{pools.map((poolEntries, poolIndex) => <article key={poolIndex}><div><h3>{subBracketName(poolIndex)}</h3><span>Top {division.qualifiersPerSubBracket} advance</span></div>{poolEntries.map((entry, index) => <p key={entry.id}><b>{index + 1}</b><span>{displayName(entry)}</span><em>{entry.levelOverride || entry.desiredLevels?.filter(Boolean)[0] || entry.playerLevels?.filter(Boolean)[0] || "Unrated"}</em></p>)}</article>)}</div><div className="bracket-scroll"><div className={`bracket-board ${division.championshipFormat === "ladderized" ? "ladderized" : ""}`}>{stages.filter((stage) => divisionMatches.some((match) => match.stage === stage)).map((stage) => <div className={`bracket-column stage-${stage}`} key={stage}><h3>{stageLabel(stage)}</h3><div className="bracket-column-matches">{divisionMatches.filter((match) => match.stage === stage).map((match) => <article className="draw-match" key={match.id}><small>{match.label}</small><p className={matchWinner(match) === match.entryAId ? "winner" : ""}>{displayName(entries.get(match.entryAId ?? ""))}<b>{match.sets.map((set) => set.a).join(" · ")}</b></p><p className={matchWinner(match) === match.entryBId ? "winner" : ""}>{displayName(entries.get(match.entryBId ?? ""))}<b>{match.sets.map((set) => set.b).join(" · ")}</b></p></article>)}</div></div>)}</div></div></section>;
  })}</div>;
}

function TournamentProgress({ state, onPrintAll }: { state: TournamentState; onPrintAll?: () => void }) {
  const stageOrder: Match["stage"][] = ["round_64", "round_32", "round_16", "quarterfinal", "semifinal", "bronze", "gold"];
  return <div className="stack tournament-progress"><section className="scoreboard-hero progress-hero"><div><p className="eyebrow">Live tournament tracker</p><h2>Group stage to championship</h2><p>See every pool, possible qualifier, knockout matchup, and advancing winner in one stage-by-stage view.</p></div>{onPrintAll && <button className="ghost" onClick={onPrintAll}>Print All Umpire Scorecards</button>}</section>{state.divisions.map((division) => {
    const entryMap = new Map(division.entries.map((entry) => [entry.id, entry]));
    const divisionMatches = state.matches.filter((match) => match.divisionId === division.id);
    const groupMatches = divisionMatches.filter((match) => match.stage === "regular");
    const championship = divisionMatches.filter((match) => match.stage !== "regular");
    const pools = distributeEntriesToPools(division);
    const stages = stageOrder.filter((stage) => championship.some((match) => match.stage === stage));
    const groupComplete = groupMatches.length > 0 && groupMatches.every((match) => match.validated);
    return <section className="card progress-summary" key={division.id}><div className="section-head"><div><p className="eyebrow">{division.entries.length} entries · {division.championshipFormat === "ladderized" ? "Ladderized knockout" : "Medal rounds"}</p><h2>{division.name}</h2></div><span className="rule-pill">{divisionMatches.filter((match) => match.validated).length} / {divisionMatches.length} games complete</span></div><div className="stage-flow-scroll"><div className="stage-flow-board"><section className="stage-panel group-stage-panel"><header><span>Stage 1</span><h3>Group Stage</h3><small>{groupMatches.filter((match) => match.validated).length} / {groupMatches.length} games validated</small></header><div className="pool-progress-list">{pools.map((poolEntries, poolIndex) => { const rows = standingsFor(state, division.id, pools.length > 1 ? poolIndex : undefined); const poolGames = groupMatches.filter((match) => (match.subBracket ?? 0) === poolIndex); return <article className="pool-progress" key={poolIndex}><div><strong>{subBracketName(poolIndex)}</strong><small>{poolGames.filter((match) => match.validated).length}/{poolGames.length} complete · top {division.qualifiersPerSubBracket} advance</small></div>{poolEntries.map((entry) => { const position = rows.findIndex((row) => row.entryId === entry.id); const qualifier = position >= 0 && position < division.qualifiersPerSubBracket; return <p className={qualifier ? "possible-qualifier" : ""} key={entry.id}><b>{position >= 0 ? position + 1 : "–"}</b><span>{displayName(entry)}</span>{qualifier && <em>{groupComplete ? "Qualified" : "Possible"}</em>}</p>; })}</article>; })}</div></section>{stages.map((stage, stageIndex) => { const matches = championship.filter((match) => match.stage === stage); const previousStage = stageIndex > 0 ? stages[stageIndex - 1] : null; const previousMatches = previousStage ? championship.filter((match) => match.stage === previousStage) : []; const possibleIds = [...new Set(matches.flatMap((match) => [match.entryAId, match.entryBId]).filter((id): id is string => Boolean(id)))]; return <section className={`stage-panel knockout-stage ${stage === "gold" ? "championship-stage" : ""}`} key={stage}><header><span>Stage {stageIndex + 2}</span><h3>{stage === "gold" ? "Championship Final" : stageLabel(stage)}</h3><small>{matches.filter((match) => match.validated).length} / {matches.length} games validated</small></header><div className="possible-entrants"><b>Possible entrants</b>{possibleIds.length ? possibleIds.map((id) => <span key={id}>{displayName(entryMap.get(id))}</span>) : previousMatches.length ? previousMatches.map((match) => <span key={match.id}>Winner of {match.label}</span>) : <span>Pool qualifiers pending</span>}</div><div className="stage-match-list">{matches.map((match, matchIndex) => { const winnerId = match.validated ? matchWinner(match) : null; const sourceA = previousMatches[matchIndex * 2]?.label; const sourceB = previousMatches[matchIndex * 2 + 1]?.label; return <article className={winnerId ? "stage-match-complete" : ""} key={match.id}><small>{match.label}</small><p className={winnerId === match.entryAId ? "winner" : ""}><span>{match.entryAId ? displayName(entryMap.get(match.entryAId)) : sourceA ? `Winner of ${sourceA}` : "Qualifier / TBD"}</span><b>{match.sets.map((set) => set.a).join(" · ") || "–"}</b></p><p className={winnerId === match.entryBId ? "winner" : ""}><span>{match.entryBId ? displayName(entryMap.get(match.entryBId)) : sourceB ? `Winner of ${sourceB}` : "Qualifier / TBD"}</span><b>{match.sets.map((set) => set.b).join(" · ") || "–"}</b></p><em>{winnerId ? `${displayName(entryMap.get(winnerId))} advances` : match.entryAId && match.entryBId ? "Match ready" : "Awaiting prior stage"}</em></article>; })}</div></section>; })}</div></div>{championship.length === 0 && <div className="empty-state"><strong>Championship path not generated yet</strong><span>Use Setup to generate the selected ladderized or medal-round format.</span></div>}</section>;
  })}</div>;
}

function PrintSheet({ state, mode }: { state: TournamentState; mode: Exclude<PrintMode, null> }) {
  const entries = new Map(state.divisions.flatMap((division) => division.entries).map((entry) => [entry.id, entry]));
  if (mode.type === "schedule") return <section className="print-sheet print-schedule"><header><p>RACKETEERS</p><h1>{state.tournamentName}</h1><span>Tournament Match Schedule</span></header><table><thead><tr><th>Date & time</th><th>Court</th><th>Division / Round</th><th>Matchup</th><th>Umpire</th></tr></thead><tbody>{[...state.matches].sort((a, b) => (a.scheduledAt ?? "z").localeCompare(b.scheduledAt ?? "z")).map((match) => <tr key={match.id}><td>{fmtDate(match.scheduledAt)}</td><td>{match.court ? `Court ${match.court}` : "TBD"}</td><td>{state.divisions.find((division) => division.id === match.divisionId)?.name}<br />{match.label}</td><td>{displayName(entries.get(match.entryAId ?? ""))}<br /><b>vs</b><br />{displayName(entries.get(match.entryBId ?? ""))}</td><td></td></tr>)}</tbody></table></section>;
  const scorecard = (match: Match, printable = false) => {
    const division = state.divisions.find((item) => item.id === match.divisionId);
    const sets = match.format === "best_of_3_21" ? 3 : 1;
    const target = match.format === "single_31" ? 31 : 21;
    return <section className={`${printable ? "print-scorecard" : "print-sheet"} manual-scorecard set-count-${sets}`} key={match.id}><header><p>RACKETEERS · MANUAL UMPIRE SCORECARD</p><h1>{state.tournamentName}</h1><span>{division?.name} · {match.label}</span></header><div className="scorecard-meta"><p><b>Scheduled:</b> {fmtDate(match.scheduledAt)}</p><p><b>Court:</b> {match.court ?? "_____"}</p></div><div className="scorecard-players"><article><small>PLAYER / PAIR A</small><h2>{displayName(entries.get(match.entryAId ?? ""))}</h2></article><b>VS</b><article><small>PLAYER / PAIR B</small><h2>{displayName(entries.get(match.entryBId ?? ""))}</h2></article></div><div className="manual-set-grid" data-set-count={sets}>{Array.from({ length: sets }, (_, setIndex) => <article key={setIndex}><h3>Set {setIndex + 1} · First to {target}, win by 2</h3><div className="tally-side"><b>A</b>{Array.from({ length: target }, (_, point) => <span key={point}>{point + 1}</span>)}</div><div className="tally-side"><b>B</b>{Array.from({ length: target }, (_, point) => <span key={point}>{point + 1}</span>)}</div><p>Final: A ________ &nbsp;&nbsp; B ________</p></article>)}</div><footer><p>Winner: ____________________________________</p><p>Umpire name/signature: ____________________________________</p><p>Organizer validation: ____________________________________</p></footer></section>;
  };
  if (mode.type === "scorecards") return <div className="print-sheet scorecard-batch">{[...state.matches].sort((a, b) => (a.scheduledAt ?? "z").localeCompare(b.scheduledAt ?? "z")).map((match) => scorecard(match, true))}</div>;
  const match = state.matches.find((item) => item.id === mode.matchId);
  return match ? scorecard(match) : null;
}

function MatchCard({ match, state, organizer = false, scoreEditable = false, onChange, onScoreStep, onCompleteSet, onUncompleteSet, onValidate, onUnvalidate, onReset, onPrint }: { match: Match; state: TournamentState; organizer?: boolean; scoreEditable?: boolean; onChange?: (match: Match) => void; onScoreStep?: (setIndex: number, side: "a" | "b", delta: number) => void; onCompleteSet?: (setIndex: number) => void; onUncompleteSet?: (setIndex: number) => void; onValidate?: () => void; onUnvalidate?: () => void; onReset?: () => void; onPrint?: () => void }) {
  const division = state.divisions.find((item) => item.id === match.divisionId);
  const entries = new Map(division?.entries.map((entry) => [entry.id, entry]) ?? []);
  const a = match.entryAId ? entries.get(match.entryAId) : null;
  const b = match.entryBId ? entries.get(match.entryBId) : null;
  const editable = (organizer || scoreEditable) && !match.validated;
  const setCount = match.format === "best_of_3_21" ? 3 : 1;
  const sets = Array.from({ length: setCount }, (_, index) => match.sets[index] ?? { a: 0, b: 0, complete: false });
  const updateSet = (index: number, side: "a" | "b", value: number) => {
    if (!onChange) return;
    const nextSets = sets.map((set, setIndex) => {
      if (setIndex !== index) return set;
      const nextSet = { ...set, [side]: Math.max(0, Math.min(match.format === "single_31" ? 35 : 30, value)) };
      return { ...nextSet, complete: nextSet.complete && isSetWon(nextSet, match.stage, match.format) };
    });
    onChange({ ...match, sets: nextSets, status: "live" });
  };
  const scoreControl = (side: "a" | "b", set: typeof sets[number], index: number, name: string) => scoreEditable ? <div className="score-stepper" key={`${side}-${index}`}>
    <button type="button" disabled={set.complete} aria-label={`Subtract one point from ${name}, set ${index + 1}`} onClick={() => onScoreStep?.(index, side, -1)}>−</button>
    <strong aria-label={`${name} set ${index + 1} score`}>{set[side]}</strong>
    <button type="button" disabled={set.complete} aria-label={`Add one point to ${name}, set ${index + 1}`} onClick={() => onScoreStep?.(index, side, 1)}>+</button>
  </div> : organizer && !match.validated ? <DraftNumberInput key={`${side}-${index}`} ariaLabel={`${name} set ${index + 1}`} min={0} max={match.format === "single_31" ? 35 : 30} value={set[side]} onCommit={(value) => updateSet(index, side, value)} /> : <b key={`${side}-${index}`}>{set[side]}</b>;
  return <article className={`match-card ${match.status === "live" ? "live-card" : ""}`}>
    <div className="match-head"><div><span className="stage">{division?.name}</span><h3>{match.label}</h3></div><Status match={match} /></div>
    <div className="match-meta"><span>{match.court ? `Court ${match.court}` : "Court TBD"}</span><span>{fmtDate(match.scheduledAt)}</span></div>
    <div className="score-lines">
      <div className="entry-name"><strong>{displayName(a)}</strong>{a?.teamName && <small>{a.players.filter(Boolean).join(" · ")}</small>}</div>
      <div className="sets">{sets.map((set, index) => scoreControl("a", set, index, displayName(a)))}</div>
      <div className="entry-name"><strong>{displayName(b)}</strong>{b?.teamName && <small>{b.players.filter(Boolean).join(" · ")}</small>}</div>
      <div className="sets">{sets.map((set, index) => scoreControl("b", set, index, displayName(b)))}</div>
    </div>
    {editable && <div className="set-actions">{sets.map((set, index) => set.complete ? scoreEditable ? <button className="unlock-set" type="button" key={index} onClick={() => onUncompleteSet?.(index)}>Unlock Set {index + 1} to Edit</button> : <span className="set-complete" key={index}>✓ Set {index + 1} complete</span> : isSetWon(set, match.stage, match.format) ? <button className="secondary" type="button" key={index} onClick={() => onCompleteSet ? onCompleteSet(index) : onChange?.(completeMatchSet(match, index))}>Complete Set {index + 1}</button> : null)}</div>}
    {organizer && <div className="card-actions">
      {!match.validated && <><select aria-label="Court assignment" value={match.court ?? ""} disabled={match.status === "finished"} onChange={(event) => { const court = Number(event.target.value) || null; if (!court || isCourtAvailable(state, court, match.id)) onChange?.({ ...match, court }); else alert(`Court ${court} is reserved by another unfinished game.`); }}><option value="">Court TBD</option>{Array.from({ length: state.courts }, (_, index) => { const court = index + 1; const available = isCourtAvailable(state, court, match.id); return <option key={court} value={court} disabled={!available}>Court {court}{available ? "" : " · In use"}</option>; })}</select>
        <button className="primary" onClick={onValidate} disabled={!matchWinner(match)}>Validate Result</button>
        <button className="ghost danger" onClick={onReset}>Reset This Game</button></>}
      <button className="ghost" onClick={onPrint}>Print Scorecard</button>
      {match.validated && <><p className="lock-note">Result locked by organizer validation</p><button className="secondary" onClick={onUnvalidate}>Un-validate Result</button></>}
    </div>}
  </article>;
}

export default function Home() {
  const [state, setState] = useState<TournamentState>(() => initialTournament());
  const [revision, setRevision] = useState(1);
  const [view, setView] = useState<View>("register");
  const [accessOpen, setAccessOpen] = useState(false);
  const [accessPin, setAccessPin] = useState("");
  const [accessMessage, setAccessMessage] = useState("");
  const [accessBusy, setAccessBusy] = useState(false);
  const [umpireAccessPin, setUmpireAccessPin] = useState("");
  const [newUmpirePin, setNewUmpirePin] = useState("");
  const [confirmUmpirePin, setConfirmUmpirePin] = useState("");
  const [umpirePinMessage, setUmpirePinMessage] = useState("");
  const [registrationDialog, setRegistrationDialog] = useState<{ divisionId: string; player?: PlayerRegistration } | null>(null);
  const [tab, setTab] = useState<Tab>("setup");
  const [organizerPin, setOrganizerPin] = useState("");
  const [newOrganizerPin, setNewOrganizerPin] = useState("");
  const [confirmOrganizerPin, setConfirmOrganizerPin] = useState("");
  const [pinChangeMessage, setPinChangeMessage] = useState("");
  const [pinChangeBusy, setPinChangeBusy] = useState(false);
  const [unlocked, setUnlocked] = useState(false);
  const [sync, setSync] = useState<"saved" | "saving" | "offline">("saved");
  const [dirty, setDirty] = useState(false);
  const [selectedMatch, setSelectedMatch] = useState("");
  const [umpirePin, setUmpirePin] = useState("");
  const [umpireUnlocked, setUmpireUnlocked] = useState(false);
  const [printMode, setPrintMode] = useState<PrintMode>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const umpireTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const umpirePending = useRef<Match | null>(null);
  const umpireSaveQueue = useRef<Promise<void>>(Promise.resolve());
  const umpireSaveVersion = useRef(0);
  const stateRef = useRef(state);
  const revisionRef = useRef(revision);
  const dirtyRef = useRef(false);
  const localVersionRef = useRef(0);
  const saveInFlight = useRef(false);
  const saveLatestRef = useRef<() => Promise<void>>(async () => undefined);
  const touchedMatchIds = useRef(new Set<string>());

  const fetchState = useCallback(async (pin = organizerPin) => {
    try {
      const response = await fetch("/api/state", { headers: pin ? { "x-organizer-pin": pin } : {} });
      const data = await response.json();
      if (response.ok) {
        if (!dirtyRef.current && !saveInFlight.current) { stateRef.current = data.state; setState(data.state); revisionRef.current = data.revision; setRevision(data.revision); setSync("saved"); }
        return data.organizer as boolean;
      }
    } catch { setSync("offline"); }
    return false;
  }, [organizerPin]);

  useEffect(() => { const timer = setTimeout(() => void fetchState(""), 0); return () => clearTimeout(timer); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (view === "umpire" && umpireUnlocked) return;
    const ms = view === "spectator" || view === "projector" ? 2000 : 60000;
    const timer = setInterval(() => { if (!dirty) void fetchState(); }, ms);
    return () => clearInterval(timer);
  }, [view, dirty, fetchState, state.updatedAt, umpireUnlocked]);
  useEffect(() => {
    if (!printMode) return;
    const finish = () => setPrintMode(null);
    window.addEventListener("afterprint", finish, { once: true });
    const timer = setTimeout(() => window.print(), 120);
    return () => { clearTimeout(timer); window.removeEventListener("afterprint", finish); };
  }, [printMode]);

  const saveLatest = useCallback(async () => {
    if (!organizerPin || saveInFlight.current || !dirtyRef.current) return;
    saveInFlight.current = true;
    const next = stateRef.current;
    const saveVersion = localVersionRef.current;
    setSync("saving");
    try {
      const response = await fetch("/api/state", { method: "PUT", headers: { "content-type": "application/json", "x-organizer-pin": organizerPin }, body: JSON.stringify({ state: next, expectedRevision: revisionRef.current }) });
      const data = await response.json();
      if (response.status === 409) {
        const local = stateRef.current;
        const remoteMatches = new Map<string, Match>((data.state?.matches ?? []).map((match: Match) => [match.id, match]));
        const merged = { ...local, matches: local.matches.map((match) => touchedMatchIds.current.has(match.id) ? match : remoteMatches.get(match.id) ?? match) };
        stateRef.current = merged; setState(merged); revisionRef.current = data.revision; setRevision(data.revision); setSync("saving"); return;
      }
      if (!response.ok) throw new Error();
      revisionRef.current = data.revision; setRevision(data.revision);
      if (localVersionRef.current === saveVersion) { stateRef.current = data.state; setState(data.state); touchedMatchIds.current.clear(); dirtyRef.current = false; setDirty(false); setSync("saved"); }
    } catch { setSync("offline"); }
    finally {
      saveInFlight.current = false;
      if (dirtyRef.current) {
        if (saveTimer.current) clearTimeout(saveTimer.current);
        saveTimer.current = setTimeout(() => void saveLatestRef.current(), 2500);
      }
    }
  }, [organizerPin]);
  useEffect(() => { saveLatestRef.current = saveLatest; }, [saveLatest]);

  useEffect(() => {
    if (!dirty || !organizerPin) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => void saveLatest(), 2500);
    return () => { if (saveTimer.current) clearTimeout(saveTimer.current); };
  }, [dirty, organizerPin, saveLatest, state]);

  const changeOrganizerPin = async () => {
    setPinChangeMessage("");
    if (!/^\d{8,10}$/.test(newOrganizerPin)) return setPinChangeMessage("Use 8–10 numbers for the new organizer PIN.");
    if (newOrganizerPin !== confirmOrganizerPin) return setPinChangeMessage("The new PIN entries do not match.");
    setPinChangeBusy(true);
    if (dirtyRef.current) await saveLatest();
    if (dirtyRef.current) { setPinChangeBusy(false); return setPinChangeMessage("Please wait for the current tournament changes to finish saving, then try again."); }
    try {
      const response = await fetch("/api/state", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "changeOrganizerPin", pin: organizerPin, newPin: newOrganizerPin }) });
      const data = await response.json();
      if (!response.ok) return setPinChangeMessage(data.error || "The organizer PIN could not be changed.");
      setOrganizerPin(newOrganizerPin);
      revisionRef.current = data.revision;
      setRevision(data.revision);
      setNewOrganizerPin("");
      setConfirmOrganizerPin("");
      setPinChangeMessage("Organizer PIN changed successfully.");
    } catch { setPinChangeMessage("The organizer PIN could not be changed while the site is offline."); }
    finally { setPinChangeBusy(false); }
  };

  const commit = (next: TournamentState | ((current: TournamentState) => TournamentState)) => {
    localVersionRef.current += 1;
    dirtyRef.current = true;
    setState((current) => { const updated = typeof next === "function" ? next(current) : next; stateRef.current = updated; return updated; });
    setDirty(true);
  };
  const unlock = async (pin: string) => {
    const response = await fetch("/api/state", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "verifyOrganizer", pin }) });
    if (!response.ok) return false;
    setOrganizerPin(pin); setUnlocked(true); await fetchState(pin); return true;
  };
  const enterAccess = async () => {
    setAccessBusy(true); setAccessMessage("");
    try {
      const response = await fetch("/api/state", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "verifyAccess", pin: accessPin }) });
      const data = await response.json();
      if (!response.ok) { setAccessMessage(data.error || "PIN did not match."); return; }
      if (data.role === "organizer") { if (!await unlock(accessPin)) throw new Error("Unable to open organizer access."); setView("organizer"); }
      else { setUmpireAccessPin(accessPin); setView("umpire"); }
      setAccessOpen(false); setAccessPin("");
    } catch { setAccessMessage("Unable to check access. Please try again."); }
    finally { setAccessBusy(false); }
  };
  const changeUmpireAccessPin = async () => {
    if (!/^\d{8,10}$/.test(newUmpirePin) || newUmpirePin !== confirmUmpirePin) return setUmpirePinMessage("Enter matching 8–10 digit PINs.");
    setPinChangeBusy(true); setUmpirePinMessage("");
    try {
      if (dirtyRef.current) await saveLatest();
      if (dirtyRef.current) { setUmpirePinMessage("Wait for tournament changes to save, then try again."); return; }
      const response = await fetch("/api/state", { method: "POST", headers: { "content-type": "application/json", "x-organizer-pin": organizerPin }, body: JSON.stringify({ action: "changeUmpirePin", newPin: newUmpirePin }) });
      const data = await response.json();
      if (!response.ok) return setUmpirePinMessage(data.error || "Unable to save PIN.");
      revisionRef.current = data.revision; setRevision(data.revision);
      setNewUmpirePin(""); setConfirmUmpirePin(""); setUmpirePinMessage("Umpire access PIN saved. Previous PINs no longer work.");
    } catch { setUmpirePinMessage("Unable to save PIN. Please try again."); }
    finally { setPinChangeBusy(false); }
  };
  const updateDivision = (divisionId: string, patch: Partial<Division>) => commit((current) => ({ ...current, divisions: current.divisions.map((division) => division.id === divisionId ? { ...division, ...patch } : division) }));
  const updateMatch = (nextMatch: Match) => { touchedMatchIds.current.add(nextMatch.id); commit((current) => ({ ...current, matches: current.matches.map((match) => match.id === nextMatch.id ? nextMatch : match) })); };
  const validateMatch = (matchId: string) => { touchedMatchIds.current.add(matchId); commit((current) => validateTournamentMatch(current, matchId)); };
  const unvalidateMatch = (matchId: string) => { touchedMatchIds.current.add(matchId); commit((current) => unvalidateTournamentMatch(current, matchId)); };
  const resetMatch = (matchId: string) => { touchedMatchIds.current.add(matchId); commit((current) => ({ ...current, matches: current.matches.map((match) => match.id === matchId ? { ...match, sets: [{ a: 0, b: 0, complete: false }], status: "ready" as const, validated: false } : match) })); };
  const renewMatchPin = (matchId: string) => commit((current) => regenerateMatchPin(current, matchId));
  const resetAll = async () => {
    const entered = prompt("Re-enter the organizer PIN to reset every game score.");
    if (!entered || entered !== organizerPin) return alert("PIN did not match. No scores were reset.");
    if (!confirm("Reset all game scores? Players, match PINs, courts, and settings will be kept.")) return;
    state.matches.forEach((match) => touchedMatchIds.current.add(match.id));
    commit((current) => ({ ...current, matches: current.matches.map((match) => ({ ...match, sets: [{ a: 0, b: 0, complete: false }], status: "ready" as const, validated: false })) }));
  };
  const updateRegistration = (registrationId: string, patch: Partial<PlayerRegistration>) => commit((current) => {
    let registrations = current.registrations.map((registration) => registration.id === registrationId ? { ...registration, ...patch } : registration);
    if (Object.prototype.hasOwnProperty.call(patch, "partnerId")) {
      registrations = registrations.map((registration) => registration.id !== registrationId && registration.partnerId === registrationId ? { ...registration, partnerId: null } : registration);
      if (patch.partnerId) registrations = registrations.map((registration) => registration.id === patch.partnerId ? { ...registration, partnerId: registrationId } : registration);
    }
    if (Object.prototype.hasOwnProperty.call(patch, "poolOverride")) {
      const linked = registrations.find((registration) => registration.id === registrationId)?.partnerId;
      if (linked) registrations = registrations.map((registration) => registration.id === linked ? { ...registration, poolOverride: patch.poolOverride } : registration);
    }
    return syncRegistrationsToEntries({ ...current, registrations });
  });

  const removeRegistration = (registrationId: string) => commit((current) => syncRegistrationsToEntries({ ...current, registrations: current.registrations.filter((item) => item.id !== registrationId).map((item) => item.partnerId === registrationId ? { ...item, partnerId: null } : item) }));
  const updateChampionshipMatchup = (matchId: string, side: "entryAId" | "entryBId", entryId: string) => commit((current) => ({ ...current, matches: current.matches.map((match) => match.id === matchId ? { ...match, [side]: entryId || null } : match) }));
  const addNewDivision = () => commit((current) => addDivision(current));
  const copyDivision = (divisionId: string) => commit((current) => duplicateDivision(current, divisionId));
  const deleteDivision = (divisionId: string) => commit((current) => removeDivision(current, divisionId));
  const updateEntry = (divisionId: string, entryId: string, patch: Partial<Entry>) => updateDivision(divisionId, { entries: state.divisions.find((division) => division.id === divisionId)?.entries.map((entry) => entry.id === entryId ? { ...entry, ...patch } : entry) ?? [] });

  const queueUmpireSave = (match: Match) => {
    umpirePending.current = match;
    const saveVersion = ++umpireSaveVersion.current;
    setSync("saving");
    if (umpireTimer.current) clearTimeout(umpireTimer.current);
    umpireTimer.current = setTimeout(() => {
      const snapshot = umpirePending.current;
      if (!snapshot) return;
      umpirePending.current = null;
      umpireSaveQueue.current = umpireSaveQueue.current.then(async () => {
        const response = await fetch("/api/state", { method: "PATCH", headers: { "content-type": "application/json", ...(unlocked ? { "x-organizer-pin": organizerPin } : { "x-umpire-pin": umpireAccessPin }) }, body: JSON.stringify({ matchId: snapshot.id, pin: umpirePin, sets: snapshot.sets, status: snapshot.status }) });
        const data = await response.json();
        if (!response.ok) {
          if (response.status === 409) {
            setUmpireUnlocked(false);
            await fetchState("");
            alert(data.error || "This game was locked by the organizer.");
            return;
          }
          throw new Error(data.error || "Score update failed");
        }
        revisionRef.current = data.revision;
        setRevision(data.revision);
        if (umpireSaveVersion.current === saveVersion && !umpirePending.current) setSync("saved");
      }).catch(() => setSync("offline"));
    }, 1800);
  };
  const changeUmpireScore = (setIndex: number, side: "a" | "b", delta: number) => {
    const currentMatch = umpirePending.current ?? state.matches.find((match) => match.id === selectedMatch);
    if (!currentMatch || currentMatch.validated) return;
    const nextMatch = adjustMatchScore(currentMatch, setIndex, side, delta);
    setState((current) => ({ ...current, matches: current.matches.map((match) => match.id === nextMatch.id ? nextMatch : match) }));
    queueUmpireSave(nextMatch);
  };
  const finishUmpireSet = (setIndex: number) => {
    const currentMatch = umpirePending.current ?? state.matches.find((match) => match.id === selectedMatch);
    if (!currentMatch || currentMatch.validated) return;
    const nextMatch = completeMatchSet(currentMatch, setIndex);
    if (nextMatch === currentMatch) return;
    setState((current) => ({ ...current, matches: current.matches.map((match) => match.id === nextMatch.id ? nextMatch : match) }));
    queueUmpireSave(nextMatch);
  };
  const unlockUmpireSet = (setIndex: number) => {
    const currentMatch = umpirePending.current ?? state.matches.find((match) => match.id === selectedMatch);
    if (!currentMatch || currentMatch.validated) return;
    const nextMatch = uncompleteMatchSet(currentMatch, setIndex);
    if (nextMatch === currentMatch) return;
    setState((current) => ({ ...current, matches: current.matches.map((match) => match.id === nextMatch.id ? nextMatch : match) }));
    queueUmpireSave(nextMatch);
  };

  const entryMap = useMemo(() => new Map(state.divisions.flatMap((division) => division.entries).map((entry) => [entry.id, entry])), [state.divisions]);
  const publicMatches = state.matches.filter((match) => match.entryAId && match.entryBId);
  const liveMatches = publicMatches.filter((match) => match.status === "live");
  const finishedMatches = publicMatches.filter((match) => match.status === "finished");

  const renderStandings = () => <div className="stack">{state.divisions.map((division) => <section className="card standings-card" key={division.id}><div className="section-head"><div><p className="eyebrow">Regular stage</p><h2>{division.name} Standings</h2></div><span className="tie-note">Wins → Point Difference → Points For</span></div><StandingsTable state={state} division={division} /></section>)}</div>;

  const organizerContent = !unlocked ? <PinGate onUnlock={unlock} title={tab === "scores" ? "Group Scores & PINs" : "Organizer access"} /> : <>
    {tab === "setup" && <div className="stack"><section className="card"><h2>Umpire page access</h2><p>Set or change the shared umpire PIN. Umpires can open only Umpire and Spectator views. Match PINs still protect individual scorecards.</p><div className="pin-change-form"><label>New umpire PIN<input type="password" inputMode="numeric" value={newUmpirePin} onChange={e => setNewUmpirePin(e.target.value.replace(/\D/g, "").slice(0, 10))} /></label><label>Confirm umpire PIN<input type="password" inputMode="numeric" value={confirmUmpirePin} onChange={e => setConfirmUmpirePin(e.target.value.replace(/\D/g, "").slice(0, 10))} /></label><button className="secondary" disabled={pinChangeBusy} onClick={() => void changeUmpireAccessPin()}>Save umpire PIN</button><p role="status">{umpirePinMessage}</p></div></section><PhaseTracker state={state} onChange={(status) => commit((current) => ({ ...current, status }))} />{state.status !== "setup" && <p className="phase-lock-note">Tournament setup is locked in the {state.status} phase. Move the tracker back to Setup to change tournament details.</p>}<fieldset className="phase-fieldset" disabled={state.status !== "setup"}><div className="stack"><section className="card"><div className="section-head"><div><p className="eyebrow">Tournament controls</p><h2>Badminton Setup</h2></div><span className="rule-pill">Badminton only</span></div>
      <div className="form-grid"><label>Tournament name<input value={state.tournamentName} onChange={(event) => commit({ ...state, tournamentName: event.target.value })} /></label><label>Number of courts<DraftNumberInput min={1} max={20} value={state.courts} onCommit={(value) => commit({ ...state, courts: value })} /></label><label>Start date<input type="date" value={state.startDate} onChange={(event) => commit({ ...state, startDate: event.target.value })} /></label><label>End date<input type="date" value={state.endDate} onChange={(event) => commit({ ...state, endDate: event.target.value })} /></label><label>Daily start<input type="time" value={state.dayStart} onChange={(event) => commit({ ...state, dayStart: event.target.value })} /></label><label>Daily end<input type="time" value={state.dayEnd} onChange={(event) => commit({ ...state, dayEnd: event.target.value })} /></label><label>Estimated game duration<DraftNumberInput min={5} value={state.gameDuration} onCommit={(value) => commit({ ...state, gameDuration: value })} /></label></div>
      <div className="info-strip"><b>Badminton presets</b><span>Regular: 1 game to 31, win by 2, cap 35</span><span>Medal rounds: best of 3 to 21, win by 2, cap 30</span></div></section>
      <section className="division-toolbar"><div><p className="eyebrow">Custom competition structure</p><h2>Divisions</h2><p>Add as many divisions as the event needs. Every division can use a different name, competition type, bracket, and scoring format.</p></div><button className="primary" onClick={addNewDivision}>Add Division</button></section>
      {state.divisions.map((division) => <section className="card" key={division.id}><div className="section-head"><label className="division-name-field">Division name<input className="title-input" value={division.name} onChange={(event) => updateDivision(division.id, { name: event.target.value })} /></label><div className="division-actions"><span className="mode-badge">{division.mode}</span><button className="ghost" onClick={() => copyDivision(division.id)}>Duplicate</button><button className="danger" disabled={state.divisions.length === 1} onClick={() => { if (confirm(`Remove ${division.name}? Its registrations and matches will also be removed.`)) deleteDivision(division.id); }}>Remove</button></div></div><div className="form-grid compact">
        <label>Competition type<select value={division.mode} onChange={(event) => updateDivision(division.id, { mode: event.target.value as Division["mode"] })}><option value="singles">Singles</option><option value="doubles">Standard Pairing</option><option value="team">Team Game</option></select></label>
        {division.mode === "singles" && <label>Number of players<DraftNumberInput min={2} value={division.playerCount} onCommit={(value) => updateDivision(division.id, { playerCount: value })} /></label>}
        {division.mode === "doubles" && <label>Number of pairs<DraftNumberInput min={1} value={division.pairCount} onCommit={(value) => updateDivision(division.id, { pairCount: value, playerCount: value * 2, teamCount: value })} /></label>}
        {division.mode === "team" && <><label>Number of teams<DraftNumberInput min={2} value={division.teamCount} onCommit={(value) => updateDivision(division.id, { teamCount: value })} /></label><label>Players per team<DraftNumberInput min={2} value={division.playersPerTeam} onCommit={(value) => updateDivision(division.id, { playersPerTeam: value })} /></label><label>Players per pair<DraftNumberInput min={1} value={division.playersPerPair} onCommit={(value) => updateDivision(division.id, { playersPerPair: value })} /></label></>}
        <label>Group-stage bracket<select value={division.bracketFormat} onChange={(event) => updateDivision(division.id, { bracketFormat: event.target.value as Division["bracketFormat"] })}><option value="round_robin">Round Robin</option><option value="double_round_robin">Double Round Robin</option><option value="single_elimination">Single Elimination</option><option value="custom">Custom Match List</option></select></label>
        {division.bracketFormat === "custom" && <label>Number of group matches<DraftNumberInput min={1} value={division.customGroupGameCount} onCommit={(value) => updateDivision(division.id, { customGroupGameCount: value })} /></label>}
        <label>Number of sub-brackets<DraftNumberInput min={1} max={16} value={division.subBracketCount} onCommit={(value) => updateDivision(division.id, { subBracketCount: value })} /></label>
        {division.subBracketCount > 1 && <label>Qualifiers from each sub-bracket<DraftNumberInput min={1} max={8} value={division.qualifiersPerSubBracket} onCommit={(value) => updateDivision(division.id, { qualifiersPerSubBracket: value })} /></label>}
        <label>Group-stage match type<select value={division.groupMatchFormat} onChange={(event) => updateDivision(division.id, { groupMatchFormat: event.target.value as Division["groupMatchFormat"] })}><option value="single_31">1 Game to 31</option><option value="single_21">1 Game to 21</option><option value="best_of_3_21">Best of 3 to 21</option></select></label>
        <label>Championship format<select value={division.championshipFormat} onChange={(event) => updateDivision(division.id, { championshipFormat: event.target.value as Division["championshipFormat"] })}><option value="ladderized">Ladderized Knockout</option><option value="semifinals_final">Semifinals → Championship</option><option value="direct_medals">Top 2 Gold/Silver + Top 3/4 Bronze</option></select></label>
        {division.championshipFormat === "ladderized" && <label>Championship starts at<select value={division.knockoutSize} onChange={(event) => updateDivision(division.id, { knockoutSize: Number(event.target.value) as Division["knockoutSize"] })}><option value={64}>Round of 64</option><option value={32}>Round of 32</option><option value={16}>Round of 16</option><option value={8}>Quarterfinals</option><option value={4}>Semifinals</option><option value={2}>Final</option></select></label>}
        <label>Championship match type<select value={division.championshipMatchFormat} onChange={(event) => updateDivision(division.id, { championshipMatchFormat: event.target.value as Division["championshipMatchFormat"] })}><option value="single_31">1 Game to 31</option><option value="single_21">1 Game to 21</option><option value="best_of_3_21">Best of 3 to 21</option></select></label>
      </div></section>)}
      <div className="sticky-actions"><button className="primary" onClick={() => commit(regenerateMatches(state))}>Regenerate Entries & Brackets</button><button className="secondary" onClick={() => commit(assignSchedule(state))}>Generate Schedule</button></div></div></fieldset><section className="card organizer-security"><div><p className="eyebrow">Organizer security</p><h2>Change Organizer PIN</h2><p>Use 8–10 numbers. The new PIN will be required the next time the organizer area is opened.</p></div><div className="pin-change-form"><label>New PIN<input type="password" inputMode="numeric" autoComplete="new-password" value={newOrganizerPin} onChange={(event) => setNewOrganizerPin(event.target.value.replace(/\D/g, "").slice(0, 10))} /></label><label>Confirm new PIN<input type="password" inputMode="numeric" autoComplete="new-password" value={confirmOrganizerPin} onChange={(event) => setConfirmOrganizerPin(event.target.value.replace(/\D/g, "").slice(0, 10))} /></label><button type="button" className="secondary" disabled={pinChangeBusy || !newOrganizerPin || !confirmOrganizerPin} onClick={() => void changeOrganizerPin()}>{pinChangeBusy ? "Changing…" : "Change PIN"}</button>{pinChangeMessage && <p className={pinChangeMessage.includes("successfully") ? "success" : "error"}>{pinChangeMessage}</p>}</div></section></div>}
    {tab === "registration" && <div className="stack"><PaymentSettings organizerPin={organizerPin} /><section className="card registration-summary"><div><p className="eyebrow">Organizer registration desk</p><h2>Individual Player Registration</h2><p>Each person has a separate record, shirt size, registered level, and organizer-assigned final level. Pairing two players hides both from other partner selectors.</p></div><div className="summary-metrics"><div><strong>{state.registrations.length}</strong><span>Player entries</span></div><div><strong>{state.registrations.filter((player) => player.paid).length}</strong><span>Paid</span></div><div><strong>{state.registrations.filter((player) => player.shirtReceived).length}</strong><span>Shirts received</span></div></div></section>
      {state.divisions.map((division) => { const players = state.registrations.filter((player) => player.divisionId === division.id); return <section className="card registration-division" key={division.id}><div className="section-head"><div><p className="eyebrow">{division.mode}</p><h2>{division.name}</h2></div><button className="primary" disabled={dirty || sync !== "saved"} onClick={() => setRegistrationDialog({ divisionId: division.id })}>Add Player</button></div>{players.length === 0 ? <div className="empty-state"><strong>No registered players yet</strong><span>Add the first player for this competition.</span></div> : <div className="registration-list">{players.map((player, index) => { const availablePartners = players.filter((candidate) => candidate.id !== player.id && (!candidate.partnerId || candidate.partnerId === player.id)); return <article className="registration-player-card" key={player.id}><div className="registration-card-head"><div className="registration-number">{index + 1}</div><strong>{player.name || `Player ${index + 1}`}</strong><button className="icon-danger" aria-label={`Remove ${player.name}`} onClick={() => { if (confirm(`Remove ${player.name} from registration?`)) removeRegistration(player.id); }}>×</button></div><div className="registration-fields"><label>Club / group (optional)<input maxLength={80} value={player.club || ""} onChange={event => updateRegistration(player.id, { club: event.target.value })} /></label>{player.personId && <p>Linked player: {player.personId}</p>}{player.secondShirt && <label>Second-entry shirt<select value={player.secondShirt} onChange={event => updateRegistration(player.id, { secondShirt: event.target.value as "black" | "tournament" })}><option value="black">Black shirt</option><option value="tournament">Second tournament shirt</option></select></label>}<label>Player name<input value={player.name} onChange={(event) => updateRegistration(player.id, { name: event.target.value })} /></label>{division.mode !== "singles" && <label>Partner / Pair<select value={player.partnerId ?? ""} onChange={(event) => updateRegistration(player.id, { partnerId: event.target.value || null, partnerName: "" })}><option value="">Unpaired</option>{availablePartners.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.name}</option>)}</select></label>}{division.mode === "team" && <label>Team name<input value={player.teamName} onChange={(event) => updateRegistration(player.id, { teamName: event.target.value })} /></label>}<label>Organizer&apos;s final level<select value={player.playerLevel} onChange={(event) => updateRegistration(player.id, { playerLevel: event.target.value })}>{LEVELS.map((level) => <option key={level}>{level}</option>)}</select></label><label>Registered level<select value={player.desiredLevel} onChange={(event) => updateRegistration(player.id, { desiredLevel: event.target.value })}>{LEVELS.map((level) => <option key={level}>{level}</option>)}</select></label><label>Shirt size<select value={player.shirtSize} onChange={(event) => updateRegistration(player.id, { shirtSize: event.target.value })}>{["XS", "S", "M", "L", "XL", "2XL", "3XL"].map((size) => <option key={size}>{size}</option>)}</select></label>{division.subBracketCount > 1 && <label>Pool override<select value={player.poolOverride ?? ""} onChange={(event) => updateRegistration(player.id, { poolOverride: event.target.value === "" ? null : Number(event.target.value) })}><option value="">Automatic balancing</option>{Array.from({ length: division.subBracketCount }, (_, pool) => <option key={pool} value={pool}>{subBracketName(pool)}</option>)}</select></label>}<div className="payment-confirmation"><strong>{player.paid ? "Payment confirmed" : "Payment not confirmed"}</strong><button type="button" className={player.paid ? "ghost" : "secondary"} onClick={() => { if (confirm(player.paid ? `Remove payment confirmation for ${player.name}?` : `Confirm that payment for ${player.name} has been received?`)) updateRegistration(player.id, { paid: !player.paid }); }}>{player.paid ? "Undo payment confirmation" : "Confirm payment received"}</button></div><label className="check-field"><input type="checkbox" checked={player.shirtReceived} onChange={(event) => updateRegistration(player.id, { shirtReceived: event.target.checked })} /><span>Game shirt received</span></label></div><button type="button" className="secondary" disabled={dirty || sync !== "saved" || state.registrations.filter(r => (r.personId || r.id) === (player.personId || player.id)).length >= 2} onClick={() => setRegistrationDialog({ divisionId: player.divisionId, player })}>Add second entry</button><RegistrationPin key={`${player.id}-${organizerPin}`} registrationId={player.id} organizerPin={organizerPin} disabled={dirty || sync !== "saved"} onChanged={() => void fetchState(organizerPin)} />{player.paymentGroupId && <p className="shared-payment-label">Payment group: <code>{player.paymentGroupId}</code></p>}<PaymentProof registrationId={player.id} pin={organizerPin} organizer canUpload /></article>; })}</div>}</section>; })}
    </div>}
    {tab === "players" && <div className="stack"><section className="card derived-roster-note"><div><p className="eyebrow">Single source of truth</p><h2>Players are built from Registration</h2><p>Add, remove, pair, or edit people only in the Registration tab. This view groups those individual records into tournament entries and never creates another player record.</p></div><button type="button" className="secondary" onClick={() => setTab("registration")}>Open Registration</button></section>{state.divisions.map((division) => <section className="card" key={division.id}><div className="section-head"><div><p className="eyebrow">{division.mode}</p><h2>{division.name}</h2></div><span>{division.entries.length} derived entries</span></div>{division.entries.length === 0 ? <div className="empty-state"><strong>No entries to display</strong><span>Add players in the Registration tab.</span></div> : <div className="roster-grid">{division.entries.map((entry, entryIndex) => <article className="roster derived-roster" key={entry.id}><h3>{division.mode === "team" ? entry.teamName || `Team ${entryIndex + 1}` : division.mode === "doubles" ? `Pair ${entryIndex + 1} (${String.fromCharCode(65 + entryIndex)})` : `Player ${entryIndex + 1}`}</h3>{entry.players.map((player, playerIndex) => <div className="player-level-row" key={`${entry.id}-${playerIndex}`}><strong>{player}</strong><div className="player-meta"><span>Final: {entry.playerLevels?.[playerIndex] || "Not set"} · Registered: {entry.desiredLevels?.[playerIndex] || "Not set"}</span><span>Shirt: {entry.shirtSizes?.[playerIndex] || "Not set"}</span></div></div>)}<label className="level-override">Organizer pair/team level<select value={entry.levelOverride ?? ""} onChange={(event) => updateEntry(division.id, entry.id, { levelOverride: event.target.value || undefined })}><option value="">Automatic from player levels</option>{LEVELS.map((level) => <option key={level}>{level}</option>)}</select></label></article>)}</div>}</section>)}</div>}
    {tab === "brackets" && <div className="stack">{state.divisions.map((division) => { const divisionMatches = state.matches.filter((match) => match.divisionId === division.id); const matchupSelect = (match: Match, side: "entryAId" | "entryBId") => <select aria-label={`${match.label} ${side === "entryAId" ? "first" : "second"} entry`} value={match[side] ?? ""} onChange={(event) => updateChampionshipMatchup(match.id, side, event.target.value)}><option value="">TBD / Auto seed</option>{division.entries.map((entry) => <option key={entry.id} value={entry.id}>{displayName(entry)}</option>)}</select>; return <section className="card bracket-section" key={division.id}><div className="section-head"><div><p className="eyebrow">{division.bracketFormat.replaceAll("_", " ")} · {division.groupMatchFormat.replaceAll("_", " ")}</p><h2>{division.name}</h2></div><label className="manual-toggle"><input type="checkbox" checked={division.manualChampionshipMatchups} onChange={(event) => updateDivision(division.id, { manualChampionshipMatchups: event.target.checked })} /><span>Manually choose championship matchups</span></label></div><div className="bracket-round"><div><div className="subhead"><h3>Group Stage</h3>{division.bracketFormat === "custom" && <span>Custom matchup editing enabled</span>}</div><div className="match-mini-grid">{divisionMatches.filter((match) => match.stage === "regular").map((match) => <div className="mini-match" key={match.id}><span>{match.label} · {match.format.replaceAll("_", " ")}</span>{division.bracketFormat === "custom" ? <>{matchupSelect(match, "entryAId")}{matchupSelect(match, "entryBId")}</> : <><b>{displayName(entryMap.get(match.entryAId ?? ""))}</b><b>{displayName(entryMap.get(match.entryBId ?? ""))}</b></>}</div>)}</div></div><div className="championship-line"><div className="subhead"><h3>Championship Round</h3><span>{division.manualChampionshipMatchups ? "Manual matchup control" : "Automatically seeded from standings"}</span></div><div className="match-mini-grid">{divisionMatches.filter((match) => match.stage !== "regular").map((match) => <div className="mini-match medal" key={match.id}><span>{match.label} · {match.format.replaceAll("_", " ")}</span>{division.manualChampionshipMatchups ? <>{matchupSelect(match, "entryAId")}{matchupSelect(match, "entryBId")}</> : <><b>{displayName(entryMap.get(match.entryAId ?? ""))}</b><b>{displayName(entryMap.get(match.entryBId ?? ""))}</b></>}</div>)}</div></div></div></section>; })}</div>}
    {tab === "draw" && <BracketDraw state={state} />}
    {tab === "scores" && <div className="stack"><div className="section-head"><div><p className="eyebrow">Protected scoring</p><h2>Group Scores & Match PINs</h2></div><div className="action-row"><button className="secondary" onClick={() => setPrintMode({ type: "scorecards" })}>Print All Games</button><button className="danger" onClick={() => void resetAll()}>Reset All Game Scores</button></div></div><div className="score-game-grid">{state.matches.map((match) => <div className="score-game-cell" key={match.id}><div className="pin-toolbar"><div className="pin-ribbon">Umpire PIN <strong>{match.pin}</strong></div><button type="button" className="renew-pin" onClick={() => renewMatchPin(match.id)}>Generate New PIN</button></div><MatchCard match={match} state={state} organizer onChange={updateMatch} onValidate={() => validateMatch(match.id)} onUnvalidate={() => unvalidateMatch(match.id)} onReset={() => resetMatch(match.id)} onPrint={() => setPrintMode({ type: "scorecard", matchId: match.id })} /></div>)}</div></div>}
    {tab === "schedule" && <section className="card"><div className="section-head"><div><p className="eyebrow">Court plan</p><h2>Tournament Schedule</h2></div><div className="action-row"><button className="ghost" onClick={() => setPrintMode({ type: "schedule" })}>Print Schedule</button><button className="secondary" onClick={() => commit(assignSchedule(state))}>Regenerate Schedule</button></div></div><div className="schedule-list editable-schedule">{[...state.matches].sort((a, b) => (a.scheduledAt ?? "z").localeCompare(b.scheduledAt ?? "z")).map((match) => <div className="schedule-row" key={match.id}><input aria-label={`${match.label} scheduled time`} type="datetime-local" value={inputDateTime(match.scheduledAt)} disabled={match.validated} onChange={(event) => { const nextMatch = { ...match, scheduledAt: event.target.value ? new Date(event.target.value).toISOString() : null }; const candidate = { ...state, matches: state.matches.map((item) => item.id === match.id ? nextMatch : item) }; if (nextMatch.court && !isCourtAvailable(candidate, nextMatch.court, nextMatch.id)) alert(`Court ${nextMatch.court} is already assigned at that time.`); else updateMatch(nextMatch); }} /><select aria-label={`${match.label} scheduled court`} value={match.court ?? ""} disabled={match.validated} onChange={(event) => { const court = Number(event.target.value) || null; if (!court || isCourtAvailable(state, court, match.id)) updateMatch({ ...match, court }); else alert(`Court ${court} is already assigned at this time.`); }}><option value="">Court TBD</option>{Array.from({ length: state.courts }, (_, index) => { const court = index + 1; const available = isCourtAvailable(state, court, match.id); return <option key={court} value={court} disabled={!available}>Court {court}{available ? "" : " · In use"}</option>; })}</select><span>{match.label}</span><strong>{displayName(entryMap.get(match.entryAId ?? ""))} vs {displayName(entryMap.get(match.entryBId ?? ""))}</strong><Status match={match} /></div>)}</div></section>}
    {tab === "standings" && <TournamentProgress state={state} onPrintAll={() => setPrintMode({ type: "scorecards" })} />}
  </>;

  const umpireMatch = state.matches.find((match) => match.id === selectedMatch);
  const umpireContent = !umpireUnlocked ? <section className="gate card"><div className="gate-icon">🏸</div><p className="eyebrow">Umpire console</p><h2>Open a Match</h2><p>Enter the four-digit match PIN. The correct scorecard will open automatically.</p><form onSubmit={async (event) => { event.preventDefault(); const response = await fetch("/api/state", { method: "POST", headers: { "content-type": "application/json", ...(unlocked ? { "x-organizer-pin": organizerPin } : { "x-umpire-pin": umpireAccessPin }) }, body: JSON.stringify({ action: "verifyMatch", pin: umpirePin }) }); const data = await response.json(); if (!response.ok || !data.match) return alert(data.error || "Match PIN did not match an available game."); setSelectedMatch(data.match.id); setState((current) => ({ ...current, matches: current.matches.map((match) => match.id === data.match.id ? data.match : match) })); setUmpireUnlocked(true); }}><input aria-label="Match PIN" type="password" inputMode="numeric" autoComplete="off" placeholder="Match PIN" value={umpirePin} onChange={(event) => setUmpirePin(event.target.value.replace(/\D/g, "").slice(0, 4))} /><button className="primary" disabled={umpirePin.length !== 4}>Open Scorecard</button></form></section> : umpireMatch ? <section className="umpire-shell"><div className="section-head"><div><p className="eyebrow">Every tap is queued and synced in order</p><h2>{umpireMatch.label}</h2></div><div className="action-row"><button className="ghost" onClick={() => setPrintMode({ type: "scorecard", matchId: umpireMatch.id })}>Print Manual Card</button><button className="ghost" onClick={() => setUmpireUnlocked(false)}>Exit Match</button></div></div><MatchCard match={umpireMatch} state={state} scoreEditable onScoreStep={changeUmpireScore} onCompleteSet={finishUmpireSet} onUncompleteSet={unlockUmpireSet} /></section> : null;

  const spectatorContent = <div className="stack"><section className="scoreboard-hero"><p className="eyebrow">Live tournament</p><h2>{state.tournamentName}</h2><p>{liveMatches.length} live · {finishedMatches.length} finished · {state.courts} courts</p></section><div className="live-grid">{(liveMatches.length ? liveMatches : publicMatches.filter((match) => match.status !== "finished").slice(0, 6)).map((match) => <MatchCard key={match.id} match={match} state={state} />)}</div>{renderStandings()}</div>;
  const projectorContent = <Projector state={state} />;

  return <main className={`${state.theme === "dark" ? "dark" : ""} ${view === "register" ? "registration-view" : ""}`}>
    <header className="topbar" inert={accessOpen || Boolean(registrationDialog)}><div className="brand"><div className="mark">R</div><div><p>Racketeers</p><h1>Badminton Tournament Tracker</h1></div></div><nav className="view-switch" aria-label="View">{(unlocked ? ["organizer", "register", "umpire", "spectator", "projector"] : umpireAccessPin ? ["umpire", "spectator"] : ["register", "spectator"]).map(item => <button key={item} className={view === item ? "active" : ""} onClick={() => setView(item as View)}>{item === "register" ? "Registration" : item[0].toUpperCase() + item.slice(1)}</button>)}<button disabled={dirty || sync === "saving"} onClick={() => { setOrganizerPin(""); setUnlocked(false); setUmpireAccessPin(""); setUmpireUnlocked(false); setUmpirePin(""); setView("register"); setAccessPin(""); setAccessMessage(""); setAccessOpen(true); void fetchState(""); }}>{unlocked || umpireAccessPin ? "Sign out / switch access" : "Staff access"}</button></nav><div className="header-tools"><span className={`sync ${sync}`}>● {sync === "saved" ? "Synced" : sync === "saving" ? "Saving" : "Offline"}</span><button aria-label="Toggle theme" className="theme" onClick={() => setState(current => ({ ...current, theme: current.theme === "light" ? "dark" : "light" }))}>{state.theme === "light" ? "☾" : "☀"}</button></div></header>
    {view === "organizer" && <nav className="tabs" inert={accessOpen || Boolean(registrationDialog)}>{organizerTabs.map((item) => <button key={item.id} className={tab === item.id ? "active" : ""} onClick={() => setTab(item.id)}>{item.label}</button>)}</nav>}
    <div inert={accessOpen || Boolean(registrationDialog)} className={view === "projector" ? "projector-container" : "content"}>{view === "organizer" ? organizerContent : view === "register" ? <PublicRegistration state={state} onSaved={() => void fetchState(unlocked ? organizerPin : "")} /> : view === "umpire" ? umpireContent : view === "spectator" ? spectatorContent : projectorContent}</div>
    {accessOpen && <div className="modal-backdrop"><section className="card access-dialog" role="dialog" aria-modal="true" aria-labelledby="access-title"><p className="eyebrow">Welcome to Racketeers</p><h2 id="access-title">Staff access</h2><p>Enter your organizer or umpire PIN to open the tools available to your role.</p><form onSubmit={event => { event.preventDefault(); void enterAccess(); }}><label>Organizer or umpire PIN<input autoFocus type="password" inputMode="numeric" autoComplete="off" placeholder="Enter staff PIN" value={accessPin} onChange={e => setAccessPin(e.target.value.replace(/\D/g, "").slice(0, 10))} /></label><button className="primary" disabled={accessBusy || accessPin.length < 4}>{accessBusy ? "Checking…" : "Continue with PIN"}</button></form><p role="alert">{accessMessage}</p><button className="secondary" disabled={accessBusy} onClick={() => { setAccessOpen(false); setAccessPin(""); }}>Back to registration</button></section></div>}
    {registrationDialog && unlocked && <div className="modal-backdrop"><section className="registration-dialog" role="dialog" aria-modal="true" aria-label="Register player"><button className="secondary" onClick={() => setRegistrationDialog(null)}>Close registration form</button><PublicRegistration key={registrationDialog.player?.id || registrationDialog.divisionId} state={state} initialDivisionId={registrationDialog.divisionId} initialRegistration={registrationDialog.player} organizerPin={organizerPin} onSaved={() => void fetchState(organizerPin)} /></section></div>}
    {printMode && <PrintSheet state={state} mode={printMode} />}
  </main>;
}
