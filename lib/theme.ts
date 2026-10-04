export type TournamentTheme = "light" | "dark" | "black";

export const THEME_LABELS: Record<TournamentTheme, string> = {
  light: "Light", dark: "Dark", black: "Pure black",
};

export function normalizeTheme(value: unknown): TournamentTheme {
  return value === "dark" || value === "black" ? value : "light";
}

export function nextTheme(theme: TournamentTheme): TournamentTheme {
  return theme === "light" ? "dark" : theme === "dark" ? "black" : "light";
}
