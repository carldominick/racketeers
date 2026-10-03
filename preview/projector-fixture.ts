/** Disposable 12-court visual fixture. Never imported by the production Worker. */
import { initialTournament, makeDivision, type Entry, type Match, type TournamentState } from "../lib/tournament";
export function projectorFixture(): TournamentState {
  const samples = [
    [1, "Level E", ["Miguel Santos", "Paolo Reyes"], ["Adrian Cruz", "Nico Garcia"], 18, 16],
    [2, "Level F", ["Bea Mendoza", "Carla Flores"], ["Dani Ramos", "Ella Aquino"], 24, 22],
    [3, "Level G", ["Marco Lim", "Luis Navarro"], ["Ethan Tan", "Andre Castillo"], 0, 0],
    [4, "Level E", ["Sofia Dela Cruz", "Isabel Lopez"], ["Mia Torres", "Chloe Diaz"], 12, 14],
    [5, "Level F", ["Rafael Bautista", "Diego Moreno"], ["Julian Perez", "Gabriel Ong"], 27, 25],
    [7, "Level G", ["Hannah Sy", "Angela Villanueva"], ["Jessa Mercado", "Camille Yu"], 20, 18],
    [8, "Level E", ["Aaron Chua", "Kevin Soriano"], ["Patrick Go", "Ryan Santiago"], 9, 11],
    [9, "Level F", ["Alyssa Fernandez", "Nicole Tolentino"], ["Kate Pascual", "Trisha Gonzales"], 0, 0],
    [10, "Level G", ["Mark Domingo", "Josh Velasco"], ["Carlo David", "Francis Robles"], 15, 13],
  ] as const;
  const divisions = ["Level E", "Level F", "Level G"].map(name => ({ ...makeDivision(name, "doubles"), id: `projector-${name}`, registrationManaged: false, entries: [] as Entry[] }));
  const matches = samples.map(([court, name, playersA, playersB, a, b], index): Match => {
    const division = divisions.find(item => item.name === name)!;
    const entry = (players: readonly string[], side: string): Entry => ({ id: `projector-${court}-${side}`, name: players.join(" / "), players: [...players] });
    const first = entry(playersA, "a"), second = entry(playersB, "b");
    division.entries.push(first, second);
    const reserved = court === 3 || court === 9;
    return { id: index === 0 ? "demo-match" : `projector-match-${court}`, divisionId: division.id, stage: "regular", round: 1, label: `Group Game ${index + 1}`, entryAId: first.id, entryBId: second.id, sets: [{ a, b, complete: false }], status: reserved ? "ready" : "live", court, courtInUse: !reserved, dispatchedAt: new Date().toISOString(), scheduledAt: null, validated: false, pin: index === 0 ? "4317" : String(5000 + index), format: "single_31" };
  });
  return { ...initialTournament(), status: "live", tournamentName: "Racketeers Badminton Cup", venue: "Sample badminton venue", courts: 12, startDate: "2026-10-03", endDate: "2026-10-03", divisions, matches, gameDay: { evenRotation: true, restMinutes: 0, nearCapEnabled: false, nearCapPoints: 5 } };
}
