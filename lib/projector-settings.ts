export const PROJECTOR_SLIDES = [
  { id: "courts", label: "Court overview", seconds: 30 },
  { id: "live", label: "Live matchups", seconds: 20 },
  { id: "upcoming", label: "Upcoming matchups", seconds: 20 },
  { id: "finished", label: "Results", seconds: 15 },
  { id: "standings", label: "Standings", seconds: 20 },
] as const;

export type ProjectorSlideId = typeof PROJECTOR_SLIDES[number]["id"];
export type ProjectorSlideSetting = { id: ProjectorSlideId; enabled: boolean; seconds: number };
export type ProjectorSettings = {
  slides: ProjectorSlideSetting[];
  autoAdvance: boolean;
  showPlayers: boolean;
  showScores: boolean;
  showGameInfo: boolean;
  showAvailableCourts: boolean;
};
export const MIN_SLIDE_SECONDS = 5;
export const MAX_SLIDE_SECONDS = 300;

/** Canonical, public-safe display preferences; older v5 states need no migration. */
export function normalizeProjectorSettings(input?: unknown): ProjectorSettings {
  const raw = input && typeof input === "object" ? input as Record<string, unknown> : {};
  const seen = new Set<string>();
  const slides: ProjectorSlideSetting[] = [];
  for (const value of Array.isArray(raw.slides) ? raw.slides : []) {
    if (!value || typeof value !== "object") continue;
    const item = value as Record<string, unknown>;
    const fallback = PROJECTOR_SLIDES.find(slide => slide.id === item.id);
    if (!fallback || seen.has(fallback.id)) continue;
    seen.add(fallback.id);
    slides.push({ id: fallback.id, enabled: item.enabled !== false, seconds: typeof item.seconds === "number" && Number.isFinite(item.seconds) ? Math.max(MIN_SLIDE_SECONDS, Math.min(MAX_SLIDE_SECONDS, Math.trunc(item.seconds))) : fallback.seconds });
  }
  for (const fallback of PROJECTOR_SLIDES) if (!seen.has(fallback.id)) slides.push({ id: fallback.id, enabled: true, seconds: fallback.seconds });
  return { slides, autoAdvance: raw.autoAdvance !== false, showPlayers: raw.showPlayers !== false, showScores: raw.showScores !== false, showGameInfo: raw.showGameInfo !== false, showAvailableCourts: raw.showAvailableCourts !== false };
}
