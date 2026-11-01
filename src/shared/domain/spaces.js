import { elementError, elementId } from "./elements.js";

export const SPACE_NAME_MAX = 40;
export const DEFAULT_SPACE_NAME = "默认";
export const DEFAULT_SPACE_COLOR = "#6B7C93";

/** Preset accents for content spaces (克制六色). */
export const SPACE_COLOR_PRESETS = [
  { id: "mist-blue", name: "雾蓝", color: "#6B7C93" },
  { id: "pine", name: "松绿", color: "#5F7A6A" },
  { id: "clay", name: "陶土", color: "#9A6B56" },
  { id: "grape", name: "葡萄灰", color: "#7A6B8A" },
  { id: "warm-sand", name: "暖沙", color: "#A08968" },
  { id: "ink-teal", name: "墨青", color: "#4F6F7A" },
];

const presetColors = new Set(SPACE_COLOR_PRESETS.map((entry) => entry.color.toUpperCase()));

export function spaceColor(value, { optional = false } = {}) {
  if (value === undefined || value === null || value === "") {
    if (optional) return undefined;
    return DEFAULT_SPACE_COLOR;
  }
  if (typeof value !== "string") throw elementError("无效的空间颜色");
  const color = value.trim().toUpperCase();
  if (!/^#[0-9A-F]{6}$/.test(color) || !presetColors.has(color)) {
    throw elementError("请选择预设的空间颜色");
  }
  return `#${color.slice(1)}`;
}

export function spaceName(value) {
  if (typeof value !== "string") throw elementError("请填写空间名称");
  const name = value.trim().normalize("NFC");
  if (!name || name.length > SPACE_NAME_MAX || /[\u0000-\u001f\u007f]/.test(name)) {
    throw elementError(`空间名称须为 1–${SPACE_NAME_MAX} 字的单行文字`);
  }
  return name;
}

export function spaceId(value) {
  return elementId(value);
}

export function spaceCreateInput(payload = {}) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw elementError("无效的空间");
  if (Object.keys(payload).some((key) => !["name", "color"].includes(key))) throw elementError("空间只支持名称和颜色");
  return { name: spaceName(payload.name), color: spaceColor(payload.color) };
}

export function spaceUpdateInput(payload = {}) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw elementError("无效的空间");
  if (Object.keys(payload).some((key) => !["name", "color"].includes(key))) throw elementError("空间只支持名称和颜色");
  if (payload.name === undefined && payload.color === undefined) throw elementError("请提供要修改的字段");
  return {
    ...(payload.name !== undefined ? { name: spaceName(payload.name) } : {}),
    ...(payload.color !== undefined ? { color: spaceColor(payload.color) } : {}),
  };
}

export function spaceMoveInput(payload = {}) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw elementError("无效的搬家请求");
  if (Object.keys(payload).some((key) => !["ids", "targetSpaceId"].includes(key))) throw elementError("无效的搬家请求");
  if (!Array.isArray(payload.ids) || !payload.ids.length || payload.ids.length > 500) {
    throw elementError("请选择 1–500 条内容搬家");
  }
  return {
    ids: [...new Set(payload.ids.map(elementId))],
    targetSpaceId: spaceId(payload.targetSpaceId),
  };
}
