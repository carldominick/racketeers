export type SponsorImage = { id: string; name: string; url: string };
export type SponsorLibrary = { images: SponsorImage[]; enabled: boolean };
export const sponsorImageUrl = (id: string) => `/api/sponsors?image=${encodeURIComponent(id)}`;
