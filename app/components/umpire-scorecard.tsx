"use client";

import { useEffect, useRef, useState } from "react";
import { Circle } from "@phosphor-icons/react/dist/csr/Circle";
import { DotsThree } from "@phosphor-icons/react/dist/csr/DotsThree";
import { HandWaving } from "@phosphor-icons/react/dist/csr/HandWaving";
import { Minus } from "@phosphor-icons/react/dist/csr/Minus";
import { Plus } from "@phosphor-icons/react/dist/csr/Plus";
import { displayName, isMatchUsingCourt, isSetWon, matchScoreLimit, matchResultSets, matchWinner, scoringRule, type Match, type TournamentState } from "../../lib/tournament";

type Props = {
  match: Match; state: TournamentState; sync: "saved" | "saving" | "offline"; focused: boolean;
  helpRequested: boolean; helpBusy: boolean; helpMessage: string;
  onToggleHelp: () => void; onToggleFocus: () => void; onPrint: () => void; onExit: () => void; onRetry: () => void;
  onScoreStep: (index: number, side: "a" | "b", delta: number) => void;
  onCompleteSet: (index: number) => void; onUnlockSet: (index: number) => void;
};

export function UmpireScorecard({ match, state, sync, focused, helpRequested, helpBusy, helpMessage, onToggleHelp, onToggleFocus, onPrint, onExit, onRetry, onScoreStep, onCompleteSet, onUnlockSet }: Props) {
  const menu = useRef<HTMLDetailsElement>(null);
  const [chosenSet, setChosenSet] = useState<number | null>(null);
  const division = state.divisions.find(item => item.id === match.divisionId);
  const resultSets = matchResultSets(match);
  const setCount = match.forfeit ? resultSets.length : match.format === "best_of_3_21" ? 3 : 1;
  const sets = Array.from({ length: setCount }, (_, index) => resultSets[index] ?? { a: 0, b: 0, complete: false });
  const winner = matchWinner(match);
  const firstOpen = sets.findIndex(set => !set.complete);
  const lastComplete = sets.map(set => set.complete).lastIndexOf(true);
  const index = Math.min(setCount - 1, chosenSet ?? (winner ? Math.max(0, lastComplete) : firstOpen < 0 ? setCount - 1 : firstOpen));
  const set = sets[index];
  const rule = scoringRule(match.format, match.scoring);
  const ruleText = rule.mode === "first_to_target" ? `First to ${rule.target} wins` : `First to ${rule.target} · Win by 2${rule.mode === "capped_win_by_two" ? ` · Cap ${rule.cap}` : ""}`;
  useEffect(() => {
    const closeOutside = (event: PointerEvent) => { if (!menu.current?.contains(event.target as Node) && menu.current) menu.current.open = false; };
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape" && menu.current?.open) { menu.current.open = false; menu.current.querySelector("summary")?.focus(); } };
    document.addEventListener("pointerdown", closeOutside); document.addEventListener("keydown", escape);
    return () => { document.removeEventListener("pointerdown", closeOutside); document.removeEventListener("keydown", escape); };
  }, []);
  const action = (callback: () => void) => { if (menu.current) menu.current.open = false; callback(); };
  return <section className="umpire-console" aria-label="Umpire scorecard">
    <header className="umpire-console-header"><div><h2>{match.court ? `Court ${match.court}` : "Court not assigned"}</h2><p>{match.label}{division ? ` · ${division.name}` : ""}</p></div><details className="umpire-more" ref={menu}><summary><DotsThree size={27} weight="bold" aria-hidden="true" /><span>More</span></summary><div className="umpire-more-actions"><button type="button" onClick={() => action(onToggleFocus)}>{focused ? "Show full site" : "Focus scorecard"}</button><button type="button" onClick={() => action(onPrint)}>Print manual card</button><button type="button" disabled={sync !== "saved"} onClick={() => action(onExit)}>Exit match</button></div></details></header>
    <div className={`umpire-console-sync ${sync}`} role="status"><Circle size={14} weight="fill" aria-hidden="true" /><span>{sync === "saved" ? "All scores saved" : sync === "saving" ? "Saving score… Keep this page open." : "Score not saved. Check your connection."}</span>{sync === "offline" && <button type="button" className="secondary" onClick={onRetry}>Retry save</button>}</div>
    <div className="umpire-console-court" aria-label="Court status"><div><strong className="umpire-court-badge">{!match.court ? "Awaiting court" : isMatchUsingCourt(match) ? "In use" : "Available"}</strong>{helpRequested && <small>Help requested · organizers notified</small>}</div><button type="button" className="court-help-button" disabled={!match.court || helpBusy} aria-pressed={helpRequested} onClick={onToggleHelp}><HandWaving size={23} aria-hidden="true" />{helpBusy ? "Updating…" : helpRequested ? "Cancel help request" : "Request help"}</button>{helpMessage && <p className="court-help-error" role="alert">{helpMessage}</p>}</div>
    {setCount > 1 && <div className="umpire-set-selector"><label>Set to display<select value={index} onChange={event => setChosenSet(Number(event.target.value))}>{sets.map((item, position) => <option key={position} value={position}>Set {position + 1} · {item.a}–{item.b}{item.complete ? " · Complete" : ""}</option>)}</select></label><button className="ghost" type="button" onClick={() => setChosenSet(null)}>Show current set</button></div>}
    <div className="umpire-console-pairs">{(["a", "b"] as const).map(side => { const name = displayName(division?.entries.find(entry => entry.id === (side === "a" ? match.entryAId : match.entryBId))); const locked = Boolean(match.hold || match.forfeit) || match.validated || set.complete || Boolean(winner); return <article className="umpire-pair" key={side}><h3>{name}</h3><div className="umpire-point-controls"><button type="button" className="umpire-minus" disabled={locked || set[side] === 0} aria-label={`Subtract one point from ${name}, set ${index + 1}`} onClick={() => onScoreStep(index, side, -1)}><Minus size={34} weight="bold" aria-hidden="true" /></button><output aria-label={`${name} set ${index + 1} score`}><small>Set {index + 1}</small><strong>{set[side]}</strong></output><button type="button" className="umpire-plus" disabled={locked || isSetWon(set, match.stage, match.format, match.scoring) || set[side] >= matchScoreLimit(match, set, side)} aria-label={`Add one point to ${name}, set ${index + 1}`} onClick={() => onScoreStep(index, side, 1)}><Plus size={40} weight="bold" aria-hidden="true" /></button></div></article>; })}</div>
    <footer className="umpire-console-footer"><p>{ruleText}</p>{match.hold ? <strong>Game on hold · Contact the organizer</strong> : match.forfeit ? <strong>Forfeiture recorded · Scores locked</strong> : match.validated ? <strong>Result validated · Scores locked</strong> : winner ? <strong>Game complete · Awaiting organizer validation</strong> : !set.complete && !isSetWon(set, match.stage, match.format, match.scoring) ? <span>Complete set appears at the winning score.</span> : null}{!match.validated && !match.hold && !match.forfeit && (set.complete ? <button type="button" className="unlock-set" onClick={() => onUnlockSet(index)}>Unlock Set {index + 1} to edit</button> : isSetWon(set, match.stage, match.format, match.scoring) && <button type="button" className="primary" onClick={() => onCompleteSet(index)}>Complete Set {index + 1}</button>)}</footer>
  </section>;
}
