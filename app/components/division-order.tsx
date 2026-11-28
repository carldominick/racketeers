import { ArrowDown } from "@phosphor-icons/react/dist/csr/ArrowDown";
import { ArrowUp } from "@phosphor-icons/react/dist/csr/ArrowUp";
import type { Division } from "../../lib/tournament";

type Props = {
  divisions: Division[];
  selected: string;
  locked: boolean;
  onSelect: (id: string) => void;
  onMove: (id: string, direction: -1 | 1) => void;
};

export function DivisionOrder({ divisions, selected, locked, onSelect, onMove }: Props) {
  const index = divisions.findIndex(division => division.id === selected);
  const canMoveUp = index > 0;
  const canMoveDown = index >= 0 && index < divisions.length - 1;

  return <div className="division-order-controls">
    <label>Division<select value={selected} onChange={event => onSelect(event.target.value)}>
      {divisions.map(division => <option key={division.id} value={division.id}>{division.name}</option>)}
    </select></label>
    {!locked && divisions.length > 1 && <div className="division-order-buttons" role="group" aria-label="Move selected division">
      <button type="button" className="secondary" aria-disabled={!canMoveUp}
        onClick={() => { if (canMoveUp) onMove(selected, -1); }}><ArrowUp size={18} aria-hidden="true" />Move up</button>
      <button type="button" className="secondary" aria-disabled={!canMoveDown}
        onClick={() => { if (canMoveDown) onMove(selected, 1); }}><ArrowDown size={18} aria-hidden="true" />Move down</button>
      <span role="status" aria-label="Division position">{index + 1} of {divisions.length}</span>
    </div>}
  </div>;
}
