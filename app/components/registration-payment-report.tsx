import type { RegistrationPaymentTotals, registrationPaymentReport } from "../../lib/registration-payment-report";
import { formatPesos } from "../../lib/registration-pricing";

export function RegistrationPaymentSummary({ totals }: { totals: RegistrationPaymentTotals }) {
  return <section className="registration-payment-summary">
    <h2>Payment totals</h2>
    <p>{totals.scope}</p>
    <dl>
      <div><dt>Total registration fees</dt><dd>{formatPesos(totals.fees)}</dd></div>
      <div><dt>Amount still to collect</dt><dd>{formatPesos(totals.outstanding)}</dd></div>
      <div><dt>Total validated payments</dt><dd>{formatPesos(totals.validated)}</dd></div>
    </dl>
    {totals.unpriced > 0 && <p>Total registration fees include priced entries only.</p>}
    {totals.needsReview > 0 && <p>{totals.needsReview} {totals.needsReview === 1 ? "billing scope needs" : "billing scopes need"} review. The amount still to collect includes known balances only. Review missing prices, earlier manual confirmations or historical allocations.</p>}
  </section>;
}

export function RegistrationPaymentPrintSheet({ tournamentName, report }: {
  tournamentName: string;
  report: ReturnType<typeof registrationPaymentReport>;
}) {
  return <section className="print-sheet registration-payment-print">
    <header><h1>Registration payments</h1><p>{tournamentName}</p></header>
    <RegistrationPaymentSummary totals={report.totals} />
    {report.scopes.length || report.historical.length ? <table>
      <thead><tr>
        <th scope="col">Division</th><th scope="col">Players</th><th scope="col">Fees</th><th scope="col">Still to collect</th><th scope="col">Validated</th>
      </tr></thead>
      <tbody>
        {report.scopes.map(scope => <tr key={scope.key}>
          <td>{scope.division?.name ?? "Unassigned"}</td>
          <td>{scope.entries.map(player => player.name).join(" / ")}</td>
          <td>{scope.due === null ? "Needs price" : formatPesos(scope.due)}</td>
          <td>{scope.outstanding === null ? "Needs review" : formatPesos(scope.outstanding)}</td>
          <td>{formatPesos(scope.confirmed)}</td>
        </tr>)}
        {report.historical.map(scope => <tr key={scope.key}>
          <td>Historical</td><td>Review registration changes</td><td>—</td><td>Needs review</td><td>{formatPesos(scope.confirmed)}</td>
        </tr>)}
      </tbody>
    </table> : <p>No registration payments in this selection.</p>}
  </section>;
}
