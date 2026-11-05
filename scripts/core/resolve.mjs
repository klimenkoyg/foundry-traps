/* Розыгрыш срабатывания ловушки: кто попал под неё, чем проверялся, что получит.
   Чистые данные без Foundry. Их хранит карточка в чате: игроки дописывают свои спасброски,
   ведущий бросает за отсутствующих и наносит урон (foundry/card.mjs).

   state = {
     sceneId, name,
     trap: снимок нужных полей ловушки (trapSnapshot),
     parts: [{ value, type, formula }]   — урон, брошенный один раз на всех,
     targets: [{ id, actorId, name, img, cause, check, by, res, applied, dealt, conditioned }],
     saves: "players" | "module", damage: "button" | "auto"
   }
   cause — почему цель под ударом: "trigger" наступила, "area" в области, "manual" ведущий запустил.
   check — { total, natural?, ac? } или null (ещё не бросали); res — итог resolveTarget или null. */

import { resolveTarget, trapMode } from "./trap.mjs";

/** Кто бросает спасброски. */
export const SAVE_ROLLS = ["players", "module"];
/** Когда наносить урон и состояние. */
export const DAMAGE_MODES = ["button", "auto"];

/** Поля ловушки, которые нужны розыгрышу (копия на момент срабатывания). */
export function trapSnapshot(trap) {
  return {
    mode: trapMode(trap),
    icon: trap.icon,
    severity: trap.severity,
    flavor: trap.flavor ?? "",
    attackBonus: trap.attackBonus ?? null,
    saveAbility: trap.saveAbility ?? "",
    saveDC: trap.saveDC,
    onSave: trap.onSave,
    condition: trap.condition ?? "",
    escapeDC: trap.escapeDC ?? 0,
    escapeSkill: trap.escapeSkill ?? "",
  };
}

/** Новая цель розыгрыша. */
export const newTarget = ({ id, actorId, name, img = "", cause = "trigger" }) => ({
  id,
  actorId,
  name,
  img,
  cause,
  check: null,
  by: null,
  res: null,
  applied: false,
  dealt: null,
  conditioned: false,
});

/** Записать итог проверки цели (by — кто бросал: "player", "gm", "module"). Без проверки — check null. */
export function settle(trap, target, check = null, by = null) {
  const res =
    trap.mode === "attack" ? resolveTarget(trap, { attack: check }) : trap.mode === "save" ? resolveTarget(trap, { save: check }) : resolveTarget(trap);
  return { ...target, check: check ? { ...check } : null, by, res };
}

export const totalDamage = (parts = []) => parts.reduce((sum, p) => sum + (Number(p.value) || 0), 0);

/** Сколько урона получит цель до сопротивлений (половина — с округлением вниз). */
export const nominal = (state, target) => (target.res ? Math.floor(totalDamage(state.parts) * target.res.multiplier) : 0);

/** Есть ли что применить к цели: урон или состояние. */
export function hasEffect(state, target) {
  if (!target.res) return false;
  return (state.parts.length > 0 && target.res.multiplier > 0) || Boolean(state.trap.condition && target.res.condition);
}

/**
 * Стадия цели: "roll" — ждёт спасброска; "ready" — итог есть, урон ещё не нанесён;
 * "applied" — нанесено; "clear" — обошлось (промах, успех без урона).
 */
export function stage(state, target) {
  if (!target.res) return "roll";
  if (target.applied) return "applied";
  return hasEffect(state, target) ? "ready" : "clear";
}

/** Сколько целей на каждой стадии. */
export function counts(state) {
  const c = { roll: 0, ready: 0, applied: 0, clear: 0 };
  for (const t of state.targets) c[stage(state, t)]++;
  return c;
}

/** Показывать ли строку «выбраться»: хоть кого-то задело. */
export const anyHit = (state) => state.targets.some((t) => t.res && (t.res.multiplier > 0 || t.res.condition));
