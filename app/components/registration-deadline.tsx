"use client";

import { useId, useState } from "react";
import { registrationDeadlineTime } from "../../lib/tournament";
import { CountdownClock } from "./tournament-countdown";

const manilaDateTime = new Intl.DateTimeFormat("en-PH", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Asia/Manila",
});

export function RegistrationDeadlineBanner({ deadline, remaining }: { deadline: number; remaining: number | null }) {
  const closed = remaining === 0;
  return <section className="registration-deadline-banner" aria-label="Registration deadline">
    <h3>{closed ? "Registration ended" : "Registration ends"}</h3>
    <p><time dateTime={new Date(deadline).toISOString()}>{manilaDateTime.format(deadline)}</time><span>Philippine time</span></p>
    {!closed && <CountdownClock remaining={remaining} label="Time left to register" className="registration-deadline-clock" />}
  </section>;
}

export function RegistrationDeadlineInput({ value, onCommit }: { value: string; onCommit: (deadline: string) => void }) {
  const fieldId = useId();
  const [editor, setEditor] = useState({ source: value, text: value });
  const text = editor.source === value ? editor.text : value;
  const valid = text === "" || registrationDeadlineTime(text) !== null;

  function applyDeadline() {
    if (text === value || !valid) return;
    onCommit(text);
    setEditor({ source: text, text });
  }

  return <section className="card registration-deadline-setup">
    <h2>Registration deadline</h2>
    <p id={`${fieldId}-help`}>New public entries close at this time. Existing entries can still be edited by PIN during the Registration phase. Leave this blank to close registration manually.</p>
    <div className="registration-deadline-controls">
      <label htmlFor={fieldId}>Registration ends (Philippine time)
        <input id={fieldId} type="datetime-local" value={text} aria-describedby={`${fieldId}-help`} aria-invalid={!valid}
          onChange={event => setEditor({ source: value, text: event.target.value })}
          onKeyDown={event => { if (event.key === "Enter") { event.preventDefault(); applyDeadline(); } }} />
      </label>
      <button type="button" className="primary" disabled={text === value || !valid} onClick={applyDeadline}>Apply deadline</button>
      {text && <button type="button" className="secondary" onClick={() => setEditor({ source: value, text: "" })}>Clear date</button>}
    </div>
    {!valid && <p role="alert">Enter a valid date and time.</p>}
  </section>;
}
