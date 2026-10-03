export type SponsorImage = { id: string; name: string; url: string };
export type SponsorLibrary = { images: SponsorImage[]; enabled: boolean };
export const MAX_SPONSOR_BYTES = 2 * 1024 * 1024;
export const sponsorImageUrl = (id: string) => `/api/sponsors?image=${encodeURIComponent(id)}`;
