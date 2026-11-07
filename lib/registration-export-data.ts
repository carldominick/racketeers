import { apiFetch } from "./client-request";
import { loadPaymentQueue } from "./payment-review-queue";
import { ReceiptRequestError } from "./receipt-batch";
import type { RegistrationExportSheet } from "./registration-export";
import type { TournamentState } from "./tournament";

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
  if (!includePaymentData) return { sheets, warning: "Exported the entries currently shown. Payment links and reviewed receipt fields were not loaded while changes are unsaved or the connection is unavailable." };
  const players = state.registrations.filter(player => sheets.some(sheet => sheet.rows.some(row => row.id === player.id)));
  try {
    let links: Record<string, string> = {};
    if (players.length) {
      const response = await request("/api/payment-proof?export-links=1", {
        method: "POST", headers: { "content-type": "application/json", "x-organizer-pin": pin },
        body: JSON.stringify({ registrationIds: players.map(player => player.id) }), signal: AbortSignal.timeout(30_000),
      });
      if (response.status === 401 || response.status === 403) throw new ReceiptRequestError("Organizer access expired. Sign in again before exporting payment details.", response.status);
      if (!response.ok) throw new Error("Payment links could not be loaded.");
      links = (await response.json()).links || {};
    }
    const reviews = await loadPaymentQueue(players, pin, AbortSignal.timeout(120_000), request);
    for (const sheet of sheets) for (const row of sheet.rows) {
      const item = reviews.find(review => review.ids.includes(row.id));
      row.paymentProofUrl = links[row.id];
      row.receiptGroupId = item?.record?.groupId || row.receiptGroupId;
      row.receipt = item?.record?.details || undefined;
      row.reviewedAt = item?.record?.reviewedAt || "";
      row.reviewStatus = !item?.record ? "No screenshot" : item.record.stale ? "Screenshot changed - re-review" : item.record.reviewedAt ? "Reviewed" : "Not reviewed";
      row.duplicateReference = Boolean(item?.record?.duplicateReference);
      row.proofVersion = item?.record?.proofVersion || "";
    }
    return { sheets, warning: "" };
  } catch (error) {
    if (error instanceof ReceiptRequestError && [401, 403].includes(error.status)) throw error;
    return { sheets, warning: "Player details exported, but payment links and reviewed receipt fields could not be loaded. Check those fields in the organizer view and retry the export when connected." };
  }
}
