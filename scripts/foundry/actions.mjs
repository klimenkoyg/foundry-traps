/* Действия ведущего с ловушками: поставить, взвести, показать, обезвредить, искать, сохранить. */

import { distanceToRect, placementRect, tokenCenter } from "../core/geometry.mjs";
import { addNoticer, fromBehaviorData, knowsTrap, normalizeTrap, notices, resolveDisarm, toBehaviorData } from "../core/trap.mjs";
import { BEHAVIOR_TYPE, MODULE_ID, SETTINGS, SEVERITY_COLOR, THEME_ATTR } from "./constants.mjs";
import { passivePerception, rollCheck } from "./dnd5e.mjs";
import { esc, t } from "./i18n.mjs";
import { getEntry, saveCustom } from "./library.mjs";
import { noticeCard, visButton } from "./chat.mjs";
import { hasLineOfSight, isRevealed, ownerIds, postMessage, regionBounds, sceneTraps, setVisible } from "./scene.mjs";
import { setting } from "./settings.mjs";
import { fireTrap } from "./trigger.mjs";

/**
 * Поставить ловушку: point — точка сцены (центр клетки под курсором).
 * source — id из библиотеки или запись { id, trap, name, text, flavor, scaled } из окна настройки
 * (scaled: урон уже под уровень партии tier).
 */
export async function placeTrap(scene, source, point, tier = setting(SETTINGS.tier)) {
  const entry = typeof source === "string" ? getEntry(source) : source;
  if (!entry || !scene) return null;
  const trap = normalizeTrap(entry.trap);
  const rect = placementRect(point, trap.size, scene.grid.size);
  const system = toBehaviorData(trap, { tier: entry.scaled ? 1 : tier, flavor: entry.flavor, text: entry.text });
  if (entry.id) system.trapId = entry.id;
  const name = entry.name || trap.name || t("Title");
  const data = {
    name,
    color: SEVERITY_COLOR[trap.severity] ?? SEVERITY_COLOR.dangerous,
    shapes: [{ type: "rectangle", ...rect, rotation: 0, hole: false }],
    visibility: CONST.REGION_VISIBILITY.GAMEMASTER,
    behaviors: [{ type: BEHAVIOR_TYPE, name, system }],
    flags: { [MODULE_ID]: { trapId: entry.id ?? trap.id, tier: Number(tier) || 1 } },
  };
  // v14: области живут на уровнях сцены — ставим на тот, что сейчас открыт.
  if (game.release.generation >= 14 && canvas.scene?.id === scene.id && canvas.level?.id) data.levels = [canvas.level.id];
  const [region] = await scene.createEmbeddedDocuments("Region", [data]);
  if (region) ui.notifications.info(t("Notify.placed", { name }));
  return region;
}

/** Ловушку на сцене поправили в окне настройки: поведение, имя, цвет и размер области. */
export async function updatePlaced(region, behavior, trap) {
  const t0 = normalizeTrap(trap);
  const system = toBehaviorData(t0, { tier: 1, flavor: t0.flavor, text: t0.text });
  system.trapId = behavior.system.trapId || system.trapId;
  const change = { name: t0.name };
  for (const [key, value] of Object.entries(system)) change[`system.${key}`] = value;
  await behavior.update(change);

  const regionChange = { name: t0.name, color: SEVERITY_COLOR[t0.severity] ?? SEVERITY_COLOR.dangerous };
  const grid = region.parent.grid.size;
  const b = regionBounds(region);
  const cells = Math.max(1, Math.round(Math.max(b.width, b.height) / grid));
  if (cells !== t0.size) {
    const rect = placementRect({ x: b.x + b.width / 2, y: b.y + b.height / 2 }, t0.size, grid);
    regionChange.shapes = [{ type: "rectangle", ...rect, rotation: 0, hole: false }];
  }
  await region.update(regionChange);
}

/** Взвести / выключить. Взведённая заново больше не «обезврежена» и для игроков. */
export const setArmed = (behavior, armed) => behavior.update(armed ? { disabled: false, "system.disarmed": false } : { disabled: true });

/** Показать игрокам / скрыть. Показанная считается замеченной. */
export async function setRevealed(region, behavior, revealed) {
  await setVisible(region, revealed);
  if (revealed && !behavior.system.detected) await behavior.update({ "system.detected": true });
}

/** Показать игрокам или спрятать все ловушки сцены. → сколько ловушек изменилось. */
export async function setAllRevealed(scene, revealed) {
  const done = new Set();
  let changed = 0;
  for (const { region, behavior } of sceneTraps(scene)) {
    if (done.has(region.id)) continue;
    done.add(region.id);
    if (isRevealed(region) === Boolean(revealed)) continue;
    await setRevealed(region, behavior, revealed);
    changed++;
  }
  return changed;
}

/** Кто уже заметил ловушку: [{ id, name }] — флаг области. */
export function noticedBy(region) {
  const list = region.getFlag?.(MODULE_ID, "noticedBy");
  return Array.isArray(list) ? list : [];
}

/** Знает ли персонаж о ловушке: её показали всем или он уже замечал её. */
const knows = (region, token) => knowsTrap({ revealed: isRevealed(region), noticedBy: noticedBy(region) }, token.actor?.id ?? token.id);

/** Шёпот игроку (и ведущему): «… замечает ловушку»; у ведущего в нём кнопка «показать / скрыть». */
export function tellPlayer(region, behavior, token) {
  const text = t("Chat.noticed", { name: esc(token.name), trap: esc(behavior.name) });
  return postMessage({
    alias: t("Title"),
    audience: ownerIds(token.actor),
    content: `<p ${THEME_ATTR} class="ssl-traps-note"><i class="fa-solid fa-eye" inert></i> ${text}${visButton(region)}</p>`,
  });
}

/**
 * Персонаж заметил ловушку; how — { kind: "passive" | "search", value, dc }.
 * Режим «сразу показать»: ловушка видна всем, игроку и ведущему приходит шёпот.
 * Режим «сообщить ведущему»: игроки ничего не узнают; ведущему — шёпот, кто и чем заметил,
 * с кнопками «показать игрокам», «сообщить только игроку», «на карте» (foundry/chat.mjs).
 * Каждого персонажа учитываем один раз → true, если он узнал о ловушке только сейчас.
 */
export async function markDetected(region, behavior, token, how = null) {
  if (knows(region, token)) return false;
  const who = { id: token.actor?.id ?? token.id, name: token.name };
  await behavior.update({ "system.detected": true });
  await region.update({ [`flags.${MODULE_ID}.noticedBy`]: addNoticer(noticedBy(region), who) });
  if (setting(SETTINGS.detectMode) === "reveal") {
    await setVisible(region, true);
    await tellPlayer(region, behavior, token);
    return true;
  }
  await postMessage({ alias: t("Title"), audience: "gm", content: noticeCard({ region, behavior, token, how }) });
  ui.notifications.info(t("Notify.noticed", { name: token.name, trap: behavior.name }));
  return true;
}

/** Расстояние обнаружения в пикселях сцены. */
function detectRangePx(scene) {
  const feet = Number(setting(SETTINGS.detectRange) ?? 10);
  return (feet / (scene.grid.distance || 5)) * scene.grid.size;
}

/**
 * Ловушки сцены, которые токен может заметить: ближе дальности обнаружения, не обезврежены и,
 * если включено, в прямой видимости — сквозь стену и закрытую дверь ловушку не заметить.
 */
function trapsNear(token) {
  const scene = token.parent;
  const center = tokenCenter(token, scene.grid.size);
  const range = detectRangePx(scene);
  const sight = setting(SETTINGS.detectSight) !== false;
  return sceneTraps(scene).filter(
    ({ region, behavior }) => !behavior.disabled && distanceToRect(center, regionBounds(region)) <= range && (!sight || hasLineOfSight(token, region)),
  );
}

/** Пассивная Внимательность: токен игрока передвинулся. */
export async function checkPassive(token) {
  const actor = token.actor;
  if (!actor?.hasPlayerOwner) return;
  const passive = passivePerception(actor);
  for (const { region, behavior } of trapsNear(token)) {
    if (knows(region, token) || !notices(passive, behavior.system.detectDC)) continue;
    await markDetected(region, behavior, token, { kind: "passive", value: passive, dc: behavior.system.detectDC });
  }
}

/** Поиск ловушек: каждый выделенный токен бросает Внимательность. */
export async function searchWith(tokens) {
  for (const token of tokens) {
    if (!token.actor) continue;
    const roll = await rollCheck(token.actor, "prc");
    let found = 0;
    let known = 0;
    for (const { region, behavior } of trapsNear(token)) {
      if (knows(region, token)) {
        known++;
        continue;
      }
      if (roll.total < behavior.system.detectDC) continue;
      if (await markDetected(region, behavior, token, { kind: "search", value: roll.total, dc: behavior.system.detectDC })) found++;
    }
    if (found) continue;
    // Ничего нового. В режиме «сообщить ведущему» игрок не должен догадаться по тишине или по ответу,
    // поэтому ответ получает только ведущий.
    const gmOnly = setting(SETTINGS.detectMode) !== "reveal";
    const key = known ? "Chat.searchNothingNew" : gmOnly ? "Chat.searchNoneGm" : "Chat.searchNone";
    await postMessage({
      alias: t("Title"),
      audience: gmOnly ? "gm" : ownerIds(token.actor),
      content: `<p ${THEME_ATTR} class="ssl-traps-note">${t(key, { name: esc(token.name), value: roll.total })}</p>`,
    });
  }
}

/** Попытка обезвредить: успех — ловушка выключена; провал на 5 и больше — срабатывает. */
export async function attemptDisarm(region, behavior, token) {
  const trap = normalizeTrap(behavior.system.toObject());
  const roll = await rollCheck(token.actor, trap.disarmSkill, trap.disarmDC);
  const outcome = resolveDisarm(roll.total, trap.disarmDC);
  const key = { success: "Chat.disarmOk", fail: "Chat.disarmFail", triggered: "Chat.disarmTriggered" }[outcome];
  const icon = { success: "fa-shield-halved", fail: "fa-hand", triggered: "fa-burst" }[outcome];
  await postMessage({
    alias: t("Title"),
    content: `<p ${THEME_ATTR} class="ssl-traps-note is-${outcome}"><i class="fa-solid ${icon}" inert></i> ${t(key, { name: esc(token.name), trap: esc(behavior.name) })}</p>`,
  });
  if (outcome === "success") {
    await behavior.update({ disabled: true, "system.detected": true, "system.disarmed": true });
    await setVisible(region, true);
  } else if (outcome === "triggered") {
    await fireTrap(behavior, { trigger: token, targets: trap.affects === "area" ? null : [token] });
  }
  return outcome;
}

/** Сработать вручную: по выделенным токенам или по всем в области. */
export function triggerNow(behavior, tokens) {
  return fireTrap(behavior, { targets: tokens?.length ? tokens : null });
}

/** Расставленную ловушку — в библиотеку своих (с уроном для 1–4 уровня). */
export async function saveToLibrary(region, behavior) {
  const system = behavior.system.toObject();
  const bounds = regionBounds(region);
  const size = Math.max(1, Math.round(Math.max(bounds.width, bounds.height) / region.parent.grid.size));
  const tier = Number(region.getFlag(MODULE_ID, "tier") ?? 1);
  const id = system.trapId?.startsWith("custom-") && getEntry(system.trapId) ? system.trapId : undefined;
  const trap = fromBehaviorData(system, { id, name: behavior.name || region.name, size, tier });
  const entry = await saveCustom(trap);
  ui.notifications.info(t("Notify.saved", { name: entry.name }));
  return entry;
}
