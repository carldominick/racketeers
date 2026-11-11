"use client";

import { useId, useMemo, useState } from "react";
import type { Division, PlayerRegistration } from "../../lib/tournament";

function registrationPairs(players: PlayerRegistration[], mode: Division["mode"]) {
  const byId = new Map(players.map(player => [player.id, player]));
  const paired = new Set<string>();
  return players.flatMap(player => {
    if (paired.has(player.id)) return [];
    const partner = mode !== "singles" && player.partnerId ? byId.get(player.partnerId) : undefined;
    if (!partner || partner.id === player.id || partner.partnerId !== player.id) return [[player]];
    paired.add(partner.id);
    return [[player, partner]];
  });
}

const modes = { singles: "Singles", doubles: "Doubles", team: "Team" };

type Props = {
  divisions: Division[];
  registrations: PlayerRegistration[];
  locked: boolean;
  canEdit: boolean;
  onShirtReceived: (registrationId: string, received: boolean) => void;
  selectedId?: string;
  onSelect?: (registrationId: string) => void;
};

export function RegistrationRoster({ divisions, registrations, locked, canEdit, onShirtReceived, selectedId, onSelect }: Props) {
  const headingId = useId();
  const [query, setQuery] = useState("");
  const [divisionFilter, setDivisionFilter] = useState("");
  const [payment, setPayment] = useState("");
  const [shirts, setShirts] = useState("");
  const divisionId = divisions.some(division => division.id === divisionFilter) ? divisionFilter : "";
  const search = query.trim().toLocaleLowerCase();
  const groups = useMemo(() => divisions.map(division => {
    const players = registrations.filter(player => player.divisionId === division.id);
    return {
      division,
      total: players.length,
      confirmed: players.filter(player => player.paid).length,
      pairs: registrationPairs(players, division.mode),
    };
  }), [divisions, registrations]);
  const visible = groups
    .filter(({ division }) => !divisionId || division.id === divisionId)
    .map(group => ({
      ...group,
      pairs: group.pairs.filter(pair => pair.some(player =>
        player.name.toLocaleLowerCase().includes(search) && (!payment || Boolean(player.paid) === (payment === "paid")) &&
        (!shirts || player.secondShirt !== "none" && Boolean(player.shirtReceived) === (shirts === "received"))
      )),
    }))
    .filter(group => group.pairs.length > 0);

  return <section className={onSelect ? "registration-roster prepare-roster" : "registration-roster"} aria-labelledby={headingId}>
    <header>
      <h2 id={headingId}>{onSelect ? "Player entries" : "Registration roster"}</h2>
      <p>{locked ? "Shirt handout updates are available during Setup and Registration." : canEdit ? "Check off shirts as you hand them out." : "Player payments and shirt handouts by division."}</p>
    </header>
    <div className="registration-roster-filters">
      <label>Search players<input type="search" value={query} placeholder="Search by either player’s name" onChange={event => setQuery(event.target.value)} /></label>
      {!onSelect && <label>Division<select value={divisionId} onChange={event => setDivisionFilter(event.target.value)}>
        <option value="">All divisions</option>
        {divisions.map(division => <option key={division.id} value={division.id}>{division.name}</option>)}
      </select></label>}
      <label>Payment<select value={payment} onChange={event => setPayment(event.target.value)}>
        <option value="">All statuses</option><option value="unconfirmed">Not confirmed</option><option value="paid">Paid</option>
      </select></label>
      {onSelect && <label>Shirt<select value={shirts} onChange={event => setShirts(event.target.value)}>
        <option value="">All statuses</option><option value="awaiting">Awaiting pickup</option><option value="received">Received</option>
      </select></label>}
    </div>
    {visible.length === 0 && <p className="card" role="status">
      {groups.some(group => group.total) ? "No players match your search and filters." : "No players are registered yet."}
    </p>}
    {visible.map(({ division, pairs, confirmed, total }) => <section className="registration-roster-division" key={division.id}>
      <header>
        <div><h3>{division.name}</h3><span>{modes[division.mode]}</span></div>
        <p><strong>{confirmed} of {total}</strong> player payments confirmed</p>
      </header>
      <div className="registration-roster-pairs">
        {pairs.map(pair => <article className="registration-roster-pair" key={pair[0].id}>
          <table>
            <caption className="sr-only">{division.name}, {pair.map(player => player.name.trim() || "Unnamed player").join(" and ")}</caption>
            <colgroup><col /><col className="roster-received-column" /><col className="roster-size-column" /><col className="roster-payment-column" /></colgroup>
            <thead><tr><th scope="col">Player</th><th scope="col">Shirt received</th><th scope="col">Size</th><th scope="col">Payment</th></tr></thead>
            <tbody>
              {pair.map(player => {
                const name = player.name.trim() || "Unnamed player";
                const hasShirt = player.secondShirt !== "none";
                return <tr key={player.id} className={selectedId === player.id ? "prepare-selected" : undefined}>
                  <th scope="row">{onSelect ? <button className="prepare-player-link" type="button" aria-pressed={selectedId === player.id} onClick={() => onSelect(player.id)}>{name}</button> : name}</th>
                  <td className="roster-received-cell"><label>
                    <input type="checkbox" aria-label={`Shirt received for ${name}`} checked={hasShirt && Boolean(player.shirtReceived)} disabled={locked || !canEdit || !hasShirt}
                      onChange={event => onShirtReceived(player.id, event.target.checked)} />
                  </label></td>
                  <td>{hasShirt ? player.shirtSize || "—" : "No shirt"}</td>
                  <td><span className={`roster-payment-status${player.paid ? " paid" : ""}`}>{player.paid ? "Paid" : "Not confirmed"}</span></td>
                </tr>;
              })}
              {pair.length === 1 && division.mode !== "singles" && <tr className="roster-unpaired"><td colSpan={4}>Unpaired</td></tr>}
            </tbody>
          </table>
        </article>)}
      </div>
    </section>)}
  </section>;
}
