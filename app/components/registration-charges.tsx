import { formatPesos, registrationCharges, type ChargePerson } from "../../lib/registration-pricing";
import type { Division } from "../../lib/tournament";
export function RegistrationCharges({ divisions, people, contactUrl }: { divisions: Division[]; people: ChargePerson[]; contactUrl?: string }) {
  const charges = registrationCharges(divisions, people);
  const breakdown = <dl>{charges.lines.map((line, index) => <div key={index}><dt>{line.label}</dt><dd>{line.cents === null ? "Not set" : formatPesos(line.cents)}</dd></div>)}</dl>;
  return <section className="card registration-charges" aria-label="Payment amount"><h3>Amount for these entries</h3><p>Payment covers: {[...new Set(people.map(person => person.name))].join(", ")}.</p>
    <p className="registration-total"><strong>{charges.total === null ? "Confirm the total with the organizer before paying." : `Total: ${formatPesos(charges.total)}`}</strong></p>
    {charges.total === null ? <><p>Some entry or shirt prices are not set. You can submit your registration and add payment proof later using your private PIN.</p>{contactUrl && <a className="registration-contact" href={contactUrl} target="_blank" rel="noopener noreferrer">Contact organizer about pricing ↗</a>}<details><summary>View entry and shirt prices</summary>{breakdown}</details></> : breakdown}
    <small>Uses current prices for these entries. Earlier entries or payments are not deducted. PHP 0.00 means included/free.</small>
  </section>;
}
