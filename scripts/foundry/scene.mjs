/* Ловушки на сцене: найти, рамка области, видимость, сообщения в чат. */

import { shapesBounds, sightPoints, tokenCenter } from "../core/geometry.mjs";
import { BEHAVIOR_TYPE, MODULE_ID, SETTINGS } from "./constants.mjs";
import { setting } from "./settings.mjs";

/** Все ловушки сцены: [{ region, behavior }]. */
export function sceneTraps(scene) {
  if (!scene) return [];
  const list = [];
  for (const region of scene.regions ?? []) {
    for (const behavior of region.behaviors ?? []) {
      if (behavior.type === BEHAVIOR_TYPE) list.push({ region, behavior });
    }
  }
  return list;
}

/** Рамка области { x, y, width, height } в пикселях сцены. */
export function regionBounds(region) {
  const b = region.bounds;
  if (b && Number.isFinite(b.width) && b.width > 0) return { x: b.x, y: b.y, width: b.width, height: b.height };
  return shapesBounds(region.shapes?.map?.((s) => s.toObject?.() ?? s) ?? []) ?? { x: 0, y: 0, width: 0, height: 0 };
}

/** Токены внутри области. */
export function regionTokens(region) {
  if (region.tokens) return [...region.tokens];
  return region.parent.tokens.filter((t) => t.regions?.has?.(region));
}

/**
 * Видит ли токен хоть одну точку области. Взгляд перекрывают стены, закрывающие обзор, и закрытые
 * двери — та же проверка, по которой Foundry строит поле зрения. Нет проверки — считаем, что видит.
 */
export function hasLineOfSight(token, region) {
  const backend = CONFIG.Canvas?.polygonBackends?.sight;
  if (typeof backend?.testCollision !== "function") return true;
  const grid = token.parent?.grid?.size ?? canvas.grid?.size ?? 100;
  const origin = tokenCenter(token, grid);
  try {
    return sightPoints(regionBounds(region), Math.max(2, grid * 0.1)).some(
      (p) => !backend.testCollision(origin, p, { type: "sight", mode: "any" }),
    );
  } catch (err) {
    console.warn(`${MODULE_ID} | проверка видимости`, err);
    return true;
  }
}

const VIS = () => CONST.REGION_VISIBILITY;

/** Игроки видят метку ловушки (foundry/markers.mjs). Старые ловушки показывали саму область. */
export const isRevealed = (region) => Boolean(region.getFlag?.(MODULE_ID, "revealed")) || region.visibility === VIS().ALWAYS;

/**
 * Показать ловушку игрокам меткой или спрятать. Сама область всегда видна только ведущему:
 * цветная заливка выдаёт игрокам точный размер и цвет опасности, а метка говорит ровно «здесь ловушка».
 */
export function setVisible(region, visible) {
  const change = {};
  if (Boolean(region.getFlag?.(MODULE_ID, "revealed")) !== Boolean(visible)) change[`flags.${MODULE_ID}.revealed`] = Boolean(visible);
  if (region.visibility === VIS().ALWAYS) change.visibility = VIS().GAMEMASTER;
  if (!Object.keys(change).length) return null;
  return region.update(change);
}

export const gmIds = () => game.users.filter((u) => u.isGM).map((u) => u.id);

/** Владельцы-игроки актёра. */
export const ownerIds = (actor) =>
  game.users.filter((u) => !u.isGM && actor?.testUserPermission?.(u, "OWNER")).map((u) => u.id);

/**
 * Сообщение модуля в чат.
 * audience: "auto" — по настройке «карточка срабатывания»; "gm" — ведущим; массив id — им и ведущим.
 */
export function postMessage({ content, alias, rolls = [], audience = "auto" }) {
  const data = { content, speaker: { alias }, flags: { [MODULE_ID]: { card: true } } };
  if (rolls.length) data.rolls = rolls;
  if (audience === "gm" || (audience === "auto" && setting(SETTINGS.chatMode) === "gm")) data.whisper = gmIds();
  else if (Array.isArray(audience)) data.whisper = [...new Set([...gmIds(), ...audience])];
  return ChatMessage.create(data);
}
