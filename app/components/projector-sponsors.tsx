/* eslint-disable @next/next/no-img-element -- Public sponsor images already come from the image library. */
import { fruitasWordmarkId, sponsorWall, type SponsorImage } from "../../lib/sponsors";
import "./projector-sponsors.css";

const houseOfFruitasLogoId = "18657386-e8cc-42bd-894e-31cdd7319ff8";

export function ProjectorSponsors({ images, tournamentName, title }: { images: SponsorImage[]; tournamentName: string; title: string }) {
  const { lead, tiles } = sponsorWall(images);
  // Keep the approved 5 + 4 grid for nine tiles; grow in both directions for larger libraries.
  const columns = Math.min(tiles.length, Math.max(5, Math.ceil(Math.sqrt(tiles.length * 2.5))));
  const rowCount = columns ? Math.ceil(tiles.length / columns) : 0;
  const rows = Array.from({ length: rowCount }, (_, index) => tiles.slice(index * columns, (index + 1) * columns));
  return <div className="projector-sponsor-wall">
    <header><p>{tournamentName}</p><h2>{title}</h2></header>
    <div className="projector-sponsor-art">
      {lead && <div className="projector-sponsor-lead"><img className={lead.id === fruitasWordmarkId ? "fruitas-wordmark" : undefined} src={lead.url} alt={lead.name} /></div>}
      {rows.length > 0 && <ul className="projector-sponsor-grid" aria-label={lead ? "Additional sponsor brands" : "Sponsors"}>
        {rows.flatMap((row, index) => {
          const offset = columns - row.length;
          return row.map((image, column) => <li key={image.id} style={{ gridArea: `${index + 1} / ${offset + column * 2 + 1} / span 1 / span 2` }}><img className={image.id === houseOfFruitasLogoId ? "house-of-fruitas-wordmark" : undefined} src={image.url} alt={image.name} /></li>);
        })}
      </ul>}
    </div>
  </div>;
}
