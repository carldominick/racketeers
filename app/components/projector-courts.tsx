import type { CSSProperties } from "react";
import type { ProjectorCourt } from "../../lib/projector";
import type { ProjectorSettings } from "../../lib/projector-settings";

export function ProjectorCourts({ courts, allCourts, settings, tournamentName }: { courts: ProjectorCourt[]; allCourts: ProjectorCourt[]; settings: ProjectorSettings; tournamentName: string }) {
  const count = (status: ProjectorCourt["status"]) => allCourts.filter(court => court.status === status).length;
  return <div className="projector-court-overview">
    <header><p>{tournamentName}</p><h2>Courts right now</h2><div className="projector-court-summary"><span>{count("in_play")} in play</span><span>{count("reserved")} reserved</span><span>{count("available")} available</span></div></header>
    {courts.length ? <div className="projector-court-grid" style={{ "--court-columns": Math.min(6, courts.length) } as CSSProperties}>{courts.map(court => <article key={court.court} className={`projector-court ${court.status}`} aria-label={`Court ${court.court}: ${court.status.replace("_", " ")}`}>
      <div className="projector-court-heading"><h3><span className="sr-only">Court </span>{String(court.court).padStart(2, "0")}</h3><span className="projector-court-state">{court.status === "in_play" ? "In play" : court.status === "reserved" ? "Reserved" : "Available"}</span></div>
      {court.game ? <>
        <div className="projector-court-match">{court.game.multipleSets && settings.showScores && <p className="projector-active-set">Set {court.game.setNumber}</p>}{(["A", "B"] as const).map(side => <div className="projector-court-pair" key={side}><div>{settings.showPlayers ? court.game![side === "A" ? "playersA" : "playersB"].map((name, index) => <span className={name.length > 15 ? "projector-long-player" : undefined} key={index}>{name}</span>) : <span>Side {side}</span>}</div>{settings.showScores && <b aria-label={`Side ${side} score`}>{court.status === "reserved" ? "–" : court.game![side === "A" ? "scoreA" : "scoreB"]}</b>}</div>)}</div>
        <div className="projector-court-meta">{settings.showGameInfo && <p>{court.game.division} · Game {court.game.number}</p>}{court.status === "reserved" && <p className="projector-awaiting">Awaiting players</p>}</div>
      </> : <div className="projector-court-empty"><p>No game assigned</p></div>}
    </article>)}</div> : <p className="projector-empty">No courts are in play or reserved.</p>}
  </div>;
}
