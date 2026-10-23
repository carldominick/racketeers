import { formatPesos, registrationCharges, type ChargePerson } from "../../lib/registration-pricing";
import type { Division } from "../../lib/tournament";
export function RegistrationCharges({ divisions, people }: { divisions: Division[]; people: ChargePerson[] }) {
  const charges = registrationCharges(divisions, people);
  return <section className="card registration-charges" aria-label="Payment amount"><h3>Amount for these entries</h3><p>Payment covers: {[...new Set(people.map(person => person.name))].join(", ")}.</p><dl>{charges.lines.map((line, index) => <div key={index}><dt>{line.label}</dt><dd>{line.cents === null ? "Confirm with organizer" : formatPesos(line.cents)}</dd></div>)}</dl><p><strong>{charges.total === null ? "Total: confirm pricing with the organizer before paying." : `Total: ${formatPesos(charges.total)}`}</strong></p><small>Based on current organizer prices. These are the entries shown above; earlier entries or payments are not deducted. An included shirt is listed as PHP 0.00.</small></section>;
}
