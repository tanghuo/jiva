/** Album overview layout preference: grid | strip. Legacy wall values fall back to grid. */

export function readStoredAlbumLayout() {
  try {
    const raw = localStorage.getItem("wikiAlbumView");
    if (raw === "grid" || raw === "strip") return raw;
    // wall / justified / 等比 / 齐行 / unknown → grid
    return "grid";
  } catch {
    return "grid";
  }
}

export function persistAlbumLayout(layout) {
  try {
    localStorage.setItem("wikiAlbumView", layout === "strip" ? "strip" : "grid");
  } catch { /* preferences optional */ }
}
