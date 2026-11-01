import { DEFAULT_SPACE_COLOR } from "../../shared/domain/spaces.js";

const SPACE_COOKIE = "jivaSpaceId";

export function readStoredSpaceId() {
  try {
    const entry = document.cookie.split(";").map((item) => item.trim()).find((part) => part.startsWith(`${SPACE_COOKIE}=`));
    if (!entry) return null;
    const value = Number(decodeURIComponent(entry.slice(SPACE_COOKIE.length + 1)));
    return Number.isSafeInteger(value) && value > 0 ? value : null;
  } catch {
    return null;
  }
}

export function writeStoredSpaceId(spaceId) {
  try {
    document.cookie = `${SPACE_COOKIE}=${encodeURIComponent(String(spaceId))}; Path=/; Max-Age=31536000; SameSite=Strict`;
  } catch { /* Preferences still work in-memory when cookies are blocked. */ }
}

export function applySpaceAccent(color = DEFAULT_SPACE_COLOR) {
  const accent = color || DEFAULT_SPACE_COLOR;
  document.documentElement.style.setProperty("--space-accent", accent);
}

export { DEFAULT_SPACE_COLOR, SPACE_COLOR_PRESETS } from "../../shared/domain/spaces.js";
