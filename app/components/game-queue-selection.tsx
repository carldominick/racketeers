import { useState } from "react";
import { scheduledGameDate } from "../../lib/game-day";
import type { GameQueueSelection as Selection, TournamentState } from "../../lib/tournament";

function scheduleLabel(value?: string) {
  if (!value) return "All dates";
  if (value === "unscheduled") return "Unscheduled games";
  return new Date(`${value}T12:00:00+08:00`).toLocaleDateString("en-PH", {
    timeZone: "Asia/Manila", month: "short", day: "numeric", year: "numeric",
  });
}

type Props = {
  divisions: TournamentState["divisions"];
  matches: TournamentState["matches"];
  saved?: Selection;
  busy: boolean;
  onSave: (selection?: Selection) => void;
};

export function GameQueueSelection({ divisions, matches, saved, busy, onSave }: Props) {
  const [draft, setDraft] = useState<Selection>();
  const selection = draft ?? saved;
  const allIds = divisions.map(division => division.id);
  const selected = new Set(selection?.divisionIds ?? allIds);
  const savedIds = saved?.divisionIds;
  const savedCount = savedIds ? allIds.filter(id => savedIds.includes(id)).length : allIds.length;
  const dates = new Set(matches.map(match => scheduledGameDate(match.scheduledAt)).filter(date => date !== null));
  if (selection?.schedule && selection.schedule !== "unscheduled") dates.add(selection.schedule);

  return <details className="card desk-queue-selection">
    <summary>
      <strong>Queue selection</strong>
      <span>{savedIds ? `${savedCount} of ${allIds.length} divisions` : "All divisions"} · {scheduleLabel(saved?.schedule)}</span>
    </summary>
    <form onSubmit={event => {
      event.preventDefault();
      if (!draft || busy) return;
      onSave(draft.divisionIds || draft.schedule ? draft : undefined);
      setDraft(undefined);
    }}>
      <p>Choose which games can be queued and assigned to courts.</p>
      <fieldset disabled={busy}>
        <legend>Divisions to queue</legend>
        {divisions.map(division => <label key={division.id} className="desk-queue-division">
          <input type="checkbox" checked={selected.has(division.id)} onChange={event => {
            if (event.target.checked) selected.add(division.id); else selected.delete(division.id);
            const divisionIds = allIds.filter(id => selected.has(id));
            setDraft({ ...selection, divisionIds: divisionIds.length === allIds.length ? undefined : divisionIds });
          }} />
          {division.name}
        </label>)}
      </fieldset>
      <div className="desk-queue-selection-actions">
        <label>Schedule date (Philippine time)
          <select value={selection?.schedule ?? ""} disabled={busy} onChange={event =>
            setDraft({ ...selection, schedule: event.target.value || undefined })}>
            <option value="">All dates and unscheduled games</option>
            {[...dates].sort().map(date => <option value={date} key={date}>{scheduleLabel(date)}</option>)}
            <option value="unscheduled">Unscheduled games only</option>
          </select>
        </label>
        <button type="button" className="secondary" disabled={busy || !selection?.divisionIds}
          onClick={() => setDraft({ ...selection, divisionIds: undefined })}>Select all divisions</button>
        <button type="submit" className="primary" disabled={busy || !draft}>Apply queue selection</button>
      </div>
    </form>
  </details>;
}
