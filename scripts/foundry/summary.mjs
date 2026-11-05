/* Короткие сводки ловушки для окон: строки характеристик карточки и подсказки под параметрами
   устройства («3d6 дробящий · Сл 15»). */

import { trapMode } from "../core/trap.mjs";
import { abilityAbbr, conditionLabel, damageLabel, skillLabel } from "./dnd5e.mjs";
import { t } from "./i18n.mjs";

const damagePart = (formula, type) => `${formula} ${damageLabel(type).toLowerCase()}`;

/** Строки характеристик: заметить, обезвредить, проверка, урон, состояние, выбраться. */
export function stats(trap) {
  const mode = trapMode(trap);
  const check =
    mode === "attack"
      ? `+${trap.attackBonus} ${t("Stat.attack").toLowerCase()}`
      : mode === "save"
        ? `${abilityAbbr(trap.saveAbility)} ${t("Stat.dc", { dc: trap.saveDC })}`
        : t("Stat.auto");
  const parts = [[trap.damage, trap.damageType], [trap.damage2, trap.damage2Type || trap.damageType]]
    .filter(([f]) => f)
    .map(([f, type]) => damagePart(f, type));
  return [
    { key: "detect", icon: "fa-eye", label: t("Stat.detect"), value: t("Stat.dc", { dc: trap.detectDC }) },
    { key: "disarm", icon: "fa-screwdriver-wrench", label: t("Stat.disarm"), value: `${t("Stat.dc", { dc: trap.disarmDC })} · ${skillLabel(trap.disarmSkill)}` },
    { key: "check", icon: mode === "attack" ? "fa-crosshairs" : "fa-dice-d20", label: t(mode === "attack" ? "Stat.attack" : "Stat.save"), value: check },
    { key: "damage", icon: "fa-heart-crack", label: t("Stat.damage"), value: parts.join(" + ") || t("Stat.noDamage") },
    ...(trap.condition ? [{ key: "condition", icon: "fa-person-falling", label: t("Stat.condition"), value: conditionLabel(trap.condition) }] : []),
    ...(trap.escapeDC
      ? [{ key: "escape", icon: "fa-person-arrow-up-from-line", label: t("Stat.escape"), value: `${t("Stat.dc", { dc: trap.escapeDC })} · ${skillLabel(trap.escapeSkill)}` }]
      : []),
  ];
}

/** Что сейчас задаёт параметр устройства: значения его полей коротко. → [строки] */
export function fieldChips(trap, fields) {
  const out = [];
  for (const field of fields) {
    switch (field) {
      case "damage":
        out.push(trap.damage ? damagePart(trap.damage, trap.damageType) : t("Stat.noDamageShort"));
        break;
      case "damage2":
        if (trap.damage2) out.push(`+ ${damagePart(trap.damage2, trap.damage2Type || trap.damageType)}`);
        break;
      case "condition":
        if (trap.condition) out.push(conditionLabel(trap.condition));
        break;
      case "escapeDC":
        if (trap.escapeDC) out.push(t("Device.chip.escape", { dc: trap.escapeDC }));
        break;
      case "attackBonus":
        if (trap.attackBonus !== null) out.push(t("Device.chip.attack", { bonus: trap.attackBonus }));
        break;
      case "saveDC":
        out.push(t("Device.chip.save", { dc: trap.saveDC }));
        break;
      case "onSave":
        if (trap.saveAbility) out.push(t("Device.chip.onSave", { result: t(`OnSave.${trap.onSave}`).toLowerCase() }));
        break;
      case "affects":
        out.push(t(`Affects.${trap.affects}`));
        break;
      case "sound":
        if (trap.sound) out.push(t(`Sound.${trap.sound}`));
        break;
      case "fixedDamage":
        if (trap.fixedDamage) out.push(t("Device.chip.fixed"));
        break;
      default:
        break;
    }
  }
  return out;
}
