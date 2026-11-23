import { apiFetch } from "./client-request";
import { loadPaymentQueue } from "./payment-review-queue";
import { ReceiptRequestError } from "./receipt-batch";
import type { RegistrationExportSheet } from "./registration-export";
import type { TournamentState } from "./tournament";
import { registrationPaymentReport } from "./registration-payment-report";

/** Export the visible snapshot; receipt services must not block a roster download. */
export async function prepareRegistrationExport({ state, divisionId, pin, includePaymentData, request = apiFetch }: {
  state: TournamentState; divisionId: string; pin: string; includePaymentData: boolean; request?: typeof apiFetch;
}) {
  const sheets: RegistrationExportSheet[] = state.divisions
    .filter(division => divisionId === "all" || division.id === divisionId)
    .map(division => ({ name: division.name, rows: state.registrations.filter(player => player.divisionId === division.id).map(player => ({
      name: player.name, id: player.id, phone: player.phone, facebookProfile: player.facebookProfile, club: player.club,
      partnerName: state.registrations.find(candidate => candidate.id === player.partnerId)?.name || player.partnerName,
      divisionName: division.name, shirtSize: player.shirtSize, secondShirt: player.secondShirt, paid: player.paid,
      receiptGroupId: player.paymentGroupId || player.id,
      reviewStatus: "Unavailable - check in organizer view",
    })) }));
  if (!sheets.length) throw new Error("There are no divisions to export.");
  const rows = new Map(sheets.flatMap(sheet => sheet.rows.map(row => [row.id, row] as const)));
  const money = (cents: number) => (cents / 100).toFixed(2);
  const { totals, scopes, historical, allocations } = registrationPaymentReport(state, divisionId);
  const describe = (key: string) => (allocations.get(key) ?? []).map(({ transfer, cents }) =>
    `Accepted · Photo ${transfer.slot} · ${transfer.details.reference} · transfer PHP ${transfer.details.amount} · allocated PHP ${money(cents)} · ${transfer.groupId}/${transfer.id}`
  ).join("\n");
  for (const scope of scopes) {
    const members = [...scope.ids].sort().map(id => rows.get(id)).filter(row => row !== undefined);
    for (const row of members) row.billingScope = scope.key;
    const first = members[0];
    if (!first) continue;
    first.billingCells = [
      scope.due === null ? "" : money(scope.due), money(scope.confirmed),
      scope.outstanding === null ? "" : money(scope.outstanding),
      scope.due === null ? "" : money(Math.max(0, scope.confirmed - scope.due)),
      describe(scope.key),
    ];
  }
  const historicalRows = historical.map(({ key, confirmed }) => ({
    name: "Historical allocation · review registration changes", id: "", divisionName: "", paid: false, billingScope: key,
    billingCells: ["", money(confirmed), "", "", describe(key)], reviewStatus: "Historical allocation · verify billing scope",
  }));
  if (historicalRows.length && divisionId === "all") sheets.push({ name: "Historical allocations", rows: historicalRows });
  else if (historicalRows.length) sheets[0].rows.push(...historicalRows);
  if (!includePaymentData) return { sheets, totals, warning: "Exported the entries currently shown. Payment links and reviewed receipt fields were not loaded while changes are unsaved or the connection is unavailable." };
  const players = state.registrations.filter(player => rows.has(player.id));
  try {
    let links: Record<string, string> = {};
    const unavailable = new Set<string>();
    // Keep the body under the Worker request limit even at the maximum ID length.
    const batchSize = 50;
    for (let offset = 0; offset < players.length; offset += batchSize) {
      const ids = players.slice(offset, offset + batchSize).map(player => player.id);
      const response = await request("/api/payment-proof?export-links=1", {
        method: "POST", headers: { "content-type": "application/json", "x-organizer-pin": pin },
        body: JSON.stringify({ registrationIds: ids }), signal: AbortSignal.timeout(120_000),
      }).catch(() => null);
      if (response?.status === 401 || response?.status === 403) throw new ReceiptRequestError("Organizer access expired. Sign in again before exporting payment details.", response.status);
      if (!response?.ok) { ids.forEach(id => unavailable.add(id)); continue; }
      links = { ...links, ...(await response.json()).links };
    }
    const reviews = await loadPaymentQueue(players, pin, AbortSignal.timeout(120_000), request);
    for (const sheet of sheets) for (const row of sheet.rows) {
      if (!row.id) continue;
      const item = reviews.find(review => review.ids.includes(row.id));
      row.paymentProofUrl = links[row.id];
      row.receiptGroupId = item?.record?.groupId || row.receiptGroupId;
      row.receipt = item?.record?.details || undefined;
      row.reviewedAt = item?.record?.reviewedAt || "";
      row.reviewStatus = unavailable.has(row.id) ? "Unavailable - proof links could not be loaded" : !item?.record ? "No screenshot" : item.record.stale ? "Screenshot changed - re-review" : item.record.reviewedAt ? "Reviewed" : "Not reviewed";
      row.duplicateReference = Boolean(item?.record?.duplicateReference);
      row.proofVersion = item?.record?.proofVersion || "";
      const transfers = (state.paymentTransfers ?? []).filter(transfer => transfer.groupId === row.receiptGroupId || transfer.allocations.some(allocation => allocation.ids.includes(row.id)));
      const photos = item?.record?.photos ?? [];
      const evidence = photos.map(photo => {
        const accepted = transfers.some(transfer => transfer.slot === photo.slot && transfer.proofVersion === photo.proofVersion);
        const url = row.paymentProofUrl?.startsWith("http") ? new URL(row.paymentProofUrl) : null;
        url?.searchParams.set("slot", String(photo.slot));
        return `Photo ${photo.slot} · ${accepted ? "Accepted evidence" : "Uploaded, unconfirmed"}${url ? " · " + url : ""}`;
      });
      for (const transfer of transfers) {
        if (!photos.some(photo => photo.slot === transfer.slot && photo.proofVersion === transfer.proofVersion)) evidence.push(`Accepted photo ${transfer.slot} · saved screenshot missing or replaced · ${transfer.details.reference}`);
      }
      row.evidence = evidence.join("\n");
    }
    return { sheets, totals, warning: unavailable.size ? `Payment links could not be loaded for ${unavailable.size} exported registrations.` : "" };
  } catch (error) {
    if (error instanceof ReceiptRequestError && [401, 403].includes(error.status)) throw error;
    return { sheets, totals, warning: "Player details exported, but payment links and reviewed receipt fields could not be loaded. Check those fields in the organizer view and retry the export when connected." };
  }
}
