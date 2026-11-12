export type SponsorImage = { id: string; name: string; url: string };

// The original Fruitas upload includes white space above and below the wordmark.
export const fruitasWordmarkId = "e2af2509-0312-4f9c-869d-863a79d035fc";

export function sponsorWall(images: SponsorImage[]) {
  const lead = images.find(image => image.id === fruitasWordmarkId)
    ?? images.find(image => /^fruitas(?:\s+logo)?$/i.test(image.name.trim()));
  return { lead, tiles: images.filter(image => image !== lead) };
}
export type SponsorLibrary = { images: SponsorImage[]; enabled: boolean };
export const sponsorImageUrl = (id: string) => `/api/sponsors?image=${encodeURIComponent(id)}`;
