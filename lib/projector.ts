/** Pack measured rows into pages without dropping or duplicating any row. */
export function paginateRows(heights: number[], available: number): { start: number; end: number }[] {
  const pages: { start: number; end: number }[] = [];
  let start = 0, used = 0;
  for (let i = 0; i < heights.length; i++) {
    const height = Math.max(1, heights[i]);
    if (i > start && used + height > available) { pages.push({ start, end: i }); start = i; used = 0; }
    used += height;
  }
  pages.push({ start, end: heights.length });
  return pages;
}
