"use client";

import { useState } from "react";
import { Printer } from "@phosphor-icons/react/dist/csr/Printer";
import type { MatchCardsPerSheet } from "./print-match-card";

export function BulkMatchCardPrint({ count, onPrint, label = "Print all games", buttonClass = "secondary" }: { count: number; onPrint: (perSheet: MatchCardsPerSheet) => void; label?: string; buttonClass?: string }) {
  const [perSheet, setPerSheet] = useState<MatchCardsPerSheet>(4);
  return <div className="bulk-match-card-print">
    <label>Cards per sheet
      <select value={perSheet} onChange={event => setPerSheet(event.target.value === "2" ? 2 : 4)}>
        <option value={4}>4 · Compact</option>
        <option value={2}>2 · Large</option>
      </select>
    </label>
    <button type="button" className={buttonClass} disabled={!count} onClick={() => onPrint(perSheet)}>
      <Printer size={18} aria-hidden="true" />{label}
    </button>
  </div>;
}
