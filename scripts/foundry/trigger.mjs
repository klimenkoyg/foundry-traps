/* Срабатывание ловушки (только у активного ведущего): анимация, броски, урон, состояния, карточка. */

import { rectCenter } from "../core/geometry.mjs";
import { hasDamage, normalizeTrap, resolveTarget, trapMode } from "../core/trap.mjs";
import { SETTINGS, THEME_ATTR } from "./constants.mjs";
import {
  abilityLabel,
  applyCondition,
  applyDamage,
  armorClass,
  conditionLabel,
  damageLabel,
  rollAttack,
  rollSave,
  skillLabel,
} from "./dnd5e.mjs";
import { playTrapFx } from "./fx.mjs";
import { regionElevation } from "./layers.mjs";
import { esc, t } from "./i18n.mjs";
import { postMessage, regionBounds, regionTokens, setVisible } from "./scene.mjs";
import { setting } from "./settings.mjs";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Ловушки, которые сейчас разыгрываются: второй вход в ту же секунду не запускает её повторно. */
const busy = new Set();

/**
 * Сработать.
 * trigger — токен, который наступил (для «только наступивший»);
 * targets — явный список токенов (ручной запуск из окна).
 */
export async function fireTrap(behavior, { trigger = null, targets = null } = {}) {
  const region = behavior.region ?? behavior.parent;
  const scene = region?.parent;
  if (!region || !scene || busy.has(behavior.uuid)) return null;
  busy.add(behavior.uuid);
  try {
    return await resolve(behavior, region, scene, { trigger, targets });
  } finally {
    busy.delete(behavior.uuid);
  }
}

async function resolve(behavior, region, scene, { trigger, targets }) {
  const trap = normalizeTrap(behavior.system.toObject());
  const name = behavior.name || region.name || t("Title");
  const bounds = regionBounds(region);

  let tokens;
  if (targets) tokens = targets;
  else if (trap.affects === "area") tokens = [...regionTokens(region), ...(trigger ? [trigger] : [])];
  else tokens = trigger ? [trigger] : regionTokens(region);
  tokens = [...new Set(tokens)].filter((tk) => tk?.actor);

  const duration = await playTrapFx(scene, {
    fx: trap.fx,
    sound: trap.sound,
    at: rectCenter(bounds),
    area: Math.max(bounds.width, bounds.height, scene.grid.size),
    elevation: regionElevation(region),
  });

  // Урон бросается один раз на всех, как у заклинаний по области.
  const rolls = [];
  const parts = [];
  for (const [formula, type] of [[trap.damage, trap.damageType], [trap.damage2, trap.damage2Type || trap.damageType]]) {
    if (!formula) continue;
    try {
      const roll = await new Roll(formula).evaluate();
      rolls.push(roll);
      parts.push({ value: roll.total, type, formula, roll });
    } catch (err) {
      console.warn(`ssl_traps | неверная формула урона «${formula}»`, err);
    }
  }

  const mode = trapMode(trap);
  const results = [];
  for (const token of tokens) {
    const actor = token.actor;
    const entry = { token, actor };
    if (mode === "attack") {
      const { roll, natural } = await rollAttack(trap.attackBonus);
      rolls.push(roll);
      entry.check = { total: roll.total, natural, ac: armorClass(actor) };
      entry.res = resolveTarget(trap, { attack: entry.check });
    } else if (mode === "save") {
      const roll = await rollSave(actor, trap.saveAbility, trap.saveDC);
      if (roll) rolls.push(roll);
      entry.check = { total: roll?.total ?? 0 };
      entry.res = resolveTarget(trap, { save: entry.check });
    } else {
      entry.res = resolveTarget(trap);
    }
    results.push(entry);
  }

  // Пусть эффект «долетит», прежде чем у персонажей поменяются хиты.
  if (duration) await sleep(Math.min(700, duration * 0.35));

  const apply = setting(SETTINGS.applyDamage);
  const total = parts.reduce((sum, p) => sum + p.value, 0);
  for (const r of results) {
    r.nominal = Math.floor(total * r.res.multiplier);
    if (apply && parts.length && r.res.multiplier > 0) {
      try {
        r.dealt = await applyDamage(r.actor, parts, r.res.multiplier);
      } catch (err) {
        console.warn("ssl_traps | урон не нанесён", err);
      }
    }
    if (trap.condition && r.res.condition) {
      r.conditioned = true;
      if (apply) {
        try {
          await applyCondition(r.actor, trap.condition);
        } catch (err) {
          console.warn("ssl_traps | состояние не наложено", err);
        }
      }
    }
  }

  await postMessage({ alias: name, rolls, content: cardHtml({ trap, name, parts, results, mode }) });

  // Сработавшую ловушку видно всем; одноразовая больше не срабатывает.
  const update = { "system.triggers": (behavior.system.triggers ?? 0) + 1, "system.detected": true };
  if (trap.rearm === "once") update.disabled = true;
  await behavior.update(update);
  await setVisible(region, true);

  if (!hasDamage(trap) && !trap.condition) ui.notifications.warn(t("Chat.alarmGm", { trap: name }));
  return results;
}

/* ---------------------------------------------------------------- карточка */

function checkLine(trap, mode) {
  if (mode === "attack") return t("Chat.attack", { bonus: trap.attackBonus });
  if (mode === "save") return t("Chat.save", { ability: abilityLabel(trap.saveAbility), dc: trap.saveDC });
  return "";
}

function targetHtml(r, trap, mode, parts) {
  const bits = [];
  if (mode === "attack") {
    const ok = r.res.hit;
    bits.push(`<span class="st-roll ${ok ? "is-bad" : "is-good"}">${r.check.total} · ${t(ok ? "Chat.hit" : "Chat.miss")}</span>`);
  } else if (mode === "save") {
    const ok = r.res.success;
    bits.push(`<span class="st-roll ${ok ? "is-good" : "is-bad"}">${r.check.total} · ${t(ok ? "Chat.saveOk" : "Chat.saveFail")}</span>`);
  }
  if (parts.length) {
    const n = r.dealt ?? r.nominal;
    if (n > 0 || r.res.multiplier > 0) {
      const half = r.res.multiplier > 0 && r.res.multiplier < 1 ? ` (${t("Chat.half")})` : "";
      bits.push(`<span class="st-dmg">${t("Chat.took", { n })}${half}</span>`);
    } else {
      bits.push(`<span class="st-dmg is-none">${t("Chat.tookNone")}</span>`);
    }
  }
  if (r.conditioned) bits.push(`<span class="st-cond">${t("Chat.condition", { condition: esc(conditionLabel(trap.condition)) })}</span>`);
  const img = r.token.texture?.src ? `<img src="${esc(r.token.texture.src)}" alt="">` : "";
  return `<li>${img}<b>${esc(r.token.name)}</b><span class="st-chips">${bits.join("")}</span></li>`;
}

export function cardHtml({ trap, name, parts, results, mode }) {
  const sev = t(`Severity.${trap.severity}`);
  const check = checkLine(trap, mode);
  const escape = trap.escapeDC && results.some((r) => r.conditioned || r.res.multiplier > 0)
    ? t("Chat.escape", { skill: skillLabel(trap.escapeSkill), dc: trap.escapeDC })
    : "";
  const dmg = parts
    .map((p) => `<span><b>${p.value}</b> ${esc(damageLabel(p.type))} <small>${esc(p.formula)}</small></span>`)
    .join(" + ");
  const list = results.length
    ? `<ul class="st-targets">${results.map((r) => targetHtml(r, trap, mode, parts)).join("")}</ul>`
    : `<p class="st-empty">${t("Chat.noTargets")}</p>`;
  return `<div class="ssl-traps-card" ${THEME_ATTR} data-severity="${trap.severity}">
  <header><i class="${esc(trap.icon)}" inert></i><div><h3>${esc(name)}</h3><small>${esc(sev)}</small></div></header>
  ${trap.flavor ? `<p class="st-flavor">${esc(trap.flavor)}</p>` : ""}
  ${check || dmg ? `<div class="st-meta">${check ? `<span>${esc(check)}</span>` : ""}${dmg ? `<span class="st-damage">${dmg}</span>` : ""}</div>` : ""}
  ${escape ? `<p class="st-escape"><i class="fa-solid fa-person-arrow-up-from-line" inert></i> ${esc(escape)}</p>` : ""}
  ${list}
</div>`;
}
