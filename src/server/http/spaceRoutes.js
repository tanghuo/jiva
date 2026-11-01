import { spaceId } from "../../shared/domain/spaces.js";
import { httpError, json, readJson } from "./http.js";

export async function handleSpaceRoute(wiki, req, res, url) {
  const method = req.method;
  const route = url.pathname;
  if (route === "/api/spaces") {
    if (method === "GET") { json(res, 200, { spaces: wiki.listSpaces() }); return true; }
    if (method === "POST") { json(res, 201, wiki.createSpace(await readJson(req))); return true; }
    throw httpError(405, "Method not allowed");
  }
  const one = route.match(/^\/api\/spaces\/([1-9]\d*)$/);
  if (one) {
    const id = spaceId(one[1]);
    if (method === "GET") { json(res, 200, wiki.listSpaces().find((space) => space.id === id) || (() => { throw httpError(404, "空间不存在"); })()); return true; }
    if (method === "PATCH") { json(res, 200, wiki.updateSpace(id, await readJson(req))); return true; }
    if (method === "DELETE") { json(res, 200, wiki.deleteSpace(id)); return true; }
    throw httpError(405, "Method not allowed");
  }
  if (route === "/api/elements/move") {
    if (method !== "POST") throw httpError(405, "Method not allowed");
    const current = resolveRequestSpaceId(wiki, req, url);
    json(res, 200, wiki.moveElements(current, await readJson(req)));
    return true;
  }
  return false;
}

/** Read spaceId from query, JSON-friendly header, or fall back to the library default. */
export function resolveRequestSpaceId(wiki, req, url, { required = false } = {}) {
  const raw = url.searchParams.get("spaceId") || req.headers["x-jiva-space-id"] || req.headers["x-space-id"];
  if ((raw === null || raw === undefined || raw === "") && !required) {
    return wiki.resolveSpaceId?.(undefined) ?? null;
  }
  if (raw === null || raw === undefined || raw === "") throw httpError(400, "请指定空间");
  return wiki.resolveSpaceId?.(raw) ?? spaceId(raw);
}
