/* Всё, что зависит от системы dnd5e (5.x на Foundry v13, 6.x на v14): броски, урон, состояния,
   подписи. Вызовы одинаковы в обеих версиях: rollX(config, dialog, message). */

import { ABILITIES, CONDITIONS, DAMAGE_TYPES, DISARM_SKILLS } from "../core/trap.mjs";
import { t } from "./i18n.mjs";

export const isDnd5e = () => game.system.id === "dnd5e";

const cfg = () => globalThis.CONFIG?.DND5E ?? {};
const loc = (s) => (s ? game.i18n.localize(s) : "");

/* ---------- подписи ---------- */

export function abilityLabel(key) {
  return loc(cfg().abilities?.[key]?.label) || key.toUpperCase();
}

export function abilityAbbr(key) {
  return loc(cfg().abilities?.[key]?.abbreviation) || key.toUpperCase();
}

export function damageLabel(key) {
  const entry = cfg().damageTypes?.[key];
  return loc(entry?.label ?? entry) || key;
}

export function skillLabel(key) {
  if (key === "thief") return t("Skill.thief");
  // Чем замечают ловушку (Внимательность, Анализ), модуль называет сам, если язык — его: без
  // перевода dnd5e в русском мире подпись иначе вышла бы по-английски.
  if ((key === "prc" || key === "inv") && /^(ru|en)/.test(game.i18n?.lang ?? "")) return t(`Skill.${key}`);
  const entry = cfg().skills?.[key];
  return loc(entry?.label ?? entry) || key;
}

function statusEntry(id) {
  const list = CONFIG.statusEffects;
  if (!list) return null;
  return Array.isArray(list) ? list.find((s) => s.id === id) : list[id];
}

export function conditionLabel(id) {
  if (!id) return "";
  const s = statusEntry(id);
  const c = cfg().conditionTypes?.[id];
  return loc(s?.name ?? s?.label ?? c?.name ?? c?.label) || id;
}

/** Списки для выпадающих меню схемы поведения. */
export const choices = {
  abilities: () => ({ "": "—", ...Object.fromEntries(abilityKeys().map((k) => [k, abilityLabel(k)])) }),
  damageTypes: () => Object.fromEntries(damageKeys().map((k) => [k, damageLabel(k)])),
  damageTypesOptional: () => ({ "": "—", ...choices.damageTypes() }),
  skills: () => Object.fromEntries(skillKeys().map((k) => [k, skillLabel(k)])),
  conditions: () => ({ "": "—", ...Object.fromEntries(conditionKeys().map((k) => [k, conditionLabel(k)])) }),
};

const abilityKeys = () => (cfg().abilities ? Object.keys(cfg().abilities) : ABILITIES);
const damageKeys = () => (cfg().damageTypes ? Object.keys(cfg().damageTypes) : DAMAGE_TYPES);
const skillKeys = () => ["thief", ...(cfg().skills ? Object.keys(cfg().skills) : DISARM_SKILLS.filter((k) => k !== "thief"))];
function conditionKeys() {
  const known = CONDITIONS.filter((id) => statusEntry(id) || cfg().conditionTypes?.[id]);
  return known.length ? known : CONDITIONS;
}

/* ---------- характеристики ---------- */

export const passivePerception = (actor) => Number(actor?.system?.skills?.prc?.passive ?? 10);

/** Пассивное значение навыка: Внимательность, Анализ… (без навыка — 10). */
export const passiveSkill = (actor, skill = "prc") => Number(actor?.system?.skills?.[skill]?.passive ?? 10);

export const armorClass = (actor) => Number(actor?.system?.attributes?.ac?.value ?? 10);

function hitPoints(actor) {
  const hp = actor?.system?.attributes?.hp;
  return hp ? Number(hp.value ?? 0) + Number(hp.temp ?? 0) : null;
}

/* ---------- броски (без своих сообщений: результат идёт в карточку ловушки) ---------- */

/** Новые объекты на каждый бросок: dnd5e дописывает в них свои поля. */
const quiet = () => [{ configure: false }, { create: false }];

/** Спасбросок → Roll или null. */
export async function rollSave(actor, ability, dc) {
  try {
    const rolls = await actor.rollSavingThrow({ ability, target: dc }, ...quiet());
    if (rolls?.[0]) return rolls[0];
  } catch (err) {
    console.warn("ssl_traps | спасбросок dnd5e не удался, бросаю сам", err);
  }
  const mod = Number(actor?.system?.abilities?.[ability]?.save?.value ?? actor?.system?.abilities?.[ability]?.mod ?? 0);
  return new Roll("1d20 + @mod", { mod }).evaluate();
}

/**
 * Спасбросок, который бросает сам игрок (или ведущий за него): с окном dnd5e (преимущество,
 * бонусы) и своим сообщением в чате — кубики видят все. → Roll или null (окно закрыли).
 */
export async function rollSaveVisible(actor, ability, dc) {
  try {
    const rolls = await actor.rollSavingThrow({ ability, target: dc }, { configure: true }, { create: true });
    return rolls?.[0] ?? null;
  } catch (err) {
    console.warn("ssl_traps | спасбросок dnd5e не удался, бросаю сам", err);
  }
  const mod = Number(actor?.system?.abilities?.[ability]?.save?.value ?? actor?.system?.abilities?.[ability]?.mod ?? 0);
  const roll = await new Roll("1d20 + @mod", { mod }).evaluate();
  await roll.toMessage({ speaker: ChatMessage.getSpeaker({ actor }), flavor: t("Chat.saveFlavor", { ability: abilityLabel(ability), dc }) });
  return roll;
}

/** Атака ловушки → { roll, natural }. */
export async function rollAttack(bonus) {
  const roll = await new Roll("1d20 + @bonus", { bonus }).evaluate();
  const natural = roll.dice[0]?.total ?? 0;
  return { roll, natural };
}

/**
 * Проверка обезвреживания или поиска: навык или воровские инструменты. С сообщением в чате.
 * configure — с окном dnd5e (преимущество, бонусы): так бросает сам игрок. → Roll или null (окно закрыли).
 */
export async function rollCheck(actor, skill, dc, { configure = false } = {}) {
  try {
    const rolls = skill === "thief"
      ? await actor.rollToolCheck({ tool: "thief", target: dc }, { configure }, { create: true })
      : await actor.rollSkill({ skill, target: dc }, { configure }, { create: true });
    if (rolls?.[0]) return rolls[0];
    if (configure) return null; // окно закрыли
  } catch (err) {
    console.warn("ssl_traps | проверка dnd5e не удалась, бросаю сам", err);
  }
  const roll = await new Roll("1d20").evaluate();
  await roll.toMessage({ speaker: ChatMessage.getSpeaker({ actor }), flavor: skillLabel(skill) });
  return roll;
}

/* ---------- урон и состояния ---------- */

/**
 * parts: [{ value, type }] — урон до множителя. → сколько хитов реально снято (с сопротивлениями).
 */
export async function applyDamage(actor, parts, multiplier) {
  const list = parts.filter((p) => p.value > 0).map((p) => ({ value: p.value, type: p.type, properties: new Set() }));
  if (!list.length || multiplier <= 0) return 0;
  const before = hitPoints(actor);
  await actor.applyDamage(list, { multiplier });
  const after = hitPoints(actor);
  return before === null || after === null ? null : Math.max(0, before - after);
}

export async function applyCondition(actor, id) {
  if (!id || !statusEntry(id)) return false;
  if (actor.statuses?.has?.(id)) return true;
  await actor.toggleStatusEffect(id, { active: true });
  return true;
}
