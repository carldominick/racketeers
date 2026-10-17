import { contactError } from "./tournament";

export type RegistrationDraft = {
  facebookProfile?: string;
  phone?: string;
  partnerFacebookProfile?: string;
  partnerPhone?: string;
  partnerId?: string | null;
  partnerEntryCount?: number;
  club?: string;
  partnerClub?: string;
  sourceRegistrationId?: string;
  samePartner?: boolean;
  secondShirt?: "black" | "tournament";
  partnerSecondShirt?: "black" | "tournament";
  entryCount?: number;
  id?: string;
  name: string;
  divisionId: string;
  partnerName: string;
  partnerShirtSize: string;
  partnerDesiredLevel: string;
  teamName: string;
  shirtSize: string;
  playerLevel: string;
  desiredLevel: string;
};

export type PartnerChoice = "same" | "different" | null;

type PartnerFields = Pick<RegistrationDraft, "partnerName" | "partnerClub" | "partnerFacebookProfile" | "partnerPhone" | "partnerShirtSize" | "partnerDesiredLevel" | "partnerSecondShirt">;

export function partnerFields(draft: Partial<RegistrationDraft>): PartnerFields {
  return {
    partnerName: draft.partnerName || "",
    partnerClub: draft.partnerClub || "",
    partnerFacebookProfile: draft.partnerFacebookProfile || "",
    partnerPhone: draft.partnerPhone || "",
    partnerShirtSize: draft.partnerShirtSize || "M",
    partnerDesiredLevel: draft.partnerDesiredLevel || "",
    partnerSecondShirt: draft.partnerSecondShirt,
  };
}

export function withPartnerFields(draft: RegistrationDraft, fields: Partial<PartnerFields>, samePartner: boolean): RegistrationDraft {
  return { ...draft, ...partnerFields(draft), ...fields, samePartner };
}

/** Keep the hidden doubles draft intact while sending only the selected mode. */
export function registrationForSubmission(draft: RegistrationDraft, mode: string | undefined): RegistrationDraft {
  if (mode !== "singles") return { ...draft };
  return {
    ...draft,
    partnerName: "",
    partnerClub: undefined,
    partnerFacebookProfile: undefined,
    partnerPhone: undefined,
    partnerShirtSize: "",
    partnerDesiredLevel: "",
    partnerId: undefined,
    partnerEntryCount: undefined,
    partnerSecondShirt: undefined,
    samePartner: false,
  };
}

/** Project the active branch without overwriting either person's saved draft. */
export function chooseSecondEntryPartner(differentDraft: RegistrationDraft, choice: PartnerChoice, primaryDraft: RegistrationDraft, primaryMode: string | undefined): RegistrationDraft {
  if (choice === "different") return { ...differentDraft, samePartner: false };
  if (choice === "same" && primaryMode && primaryMode !== "singles" && primaryDraft.partnerName.trim()) {
    return withPartnerFields(differentDraft, {
      ...partnerFields(primaryDraft),
      partnerSecondShirt: differentDraft.partnerSecondShirt || "tournament",
    }, true);
  }
  return { ...withPartnerFields(differentDraft, partnerFields({}), false), partnerId: undefined, partnerEntryCount: undefined };
}

export function entryDetailsError(draft: RegistrationDraft, mode: string | undefined): string | null {
  if (!draft.divisionId || !mode) return "Choose a division to continue.";
  if (!draft.name.trim()) return "Enter Player 1’s full name.";
  if (!draft.club?.trim()) return `${draft.name.trim()}: Enter a club / group name.`;
  const playerContactError = contactError(draft.facebookProfile, draft.phone);
  if (playerContactError) return `${draft.name.trim()}: ${playerContactError}`;
  if (mode === "singles") return null;
  if (!draft.partnerName.trim()) return "Enter Player 2 / Partner’s full name.";
  if (!draft.partnerClub?.trim()) return `${draft.partnerName.trim()}: Enter a club / group name.`;
  const partnerContactError = contactError(draft.partnerFacebookProfile, draft.partnerPhone);
  return partnerContactError ? `${draft.partnerName.trim()}: ${partnerContactError}` : null;
}
