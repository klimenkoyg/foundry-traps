/* Поведение области «Ловушка»: все параметры ловушки лежат в нём, срабатывает на вход токена.
   Окно настройки поведения Foundry строит само по схеме — так любую расставленную ловушку
   можно поправить в обычном окне области. */

import { FX_NAMES } from "../core/fx/presets.mjs";
import { SEVERITIES } from "../core/trap.mjs";
import { BEHAVIOR_TYPE, SETTINGS } from "./constants.mjs";
import { choices } from "./dnd5e.mjs";
import { t } from "./i18n.mjs";
import { setting } from "./settings.mjs";
import { fireTrap } from "./trigger.mjs";

const { RegionBehaviorType } = foundry.data.regionBehaviors;
const f = foundry.data.fields;

const labelled = (prefix, keys) => () => Object.fromEntries(keys.map((k) => [k, t(`${prefix}.${k}`)]));

/** Срабатывает ли ловушка на этот токен (настройка «на кого»). */
function canTrigger(token) {
  if (!token?.actor) return false;
  if (setting(SETTINGS.triggerBy) === "all") return true;
  return Boolean(token.actor.hasPlayerOwner);
}

export class TrapBehavior extends RegionBehaviorType {
  static LOCALIZATION_PREFIXES = ["TRAPS.Behavior"];

  static defineSchema() {
    const dc = (initial) => new f.NumberField({ required: true, nullable: false, integer: true, min: 0, max: 40, initial });
    const formula = () => new f.StringField({ required: true, blank: true, initial: "" });
    return {
      trapId: new f.StringField({ required: true, blank: true, initial: "" }),
      icon: new f.StringField({ required: true, blank: false, initial: "fa-solid fa-triangle-exclamation" }),
      severity: new f.StringField({ required: true, initial: "dangerous", choices: labelled("TRAPS.Severity", SEVERITIES) }),
      magical: new f.BooleanField({ initial: false }),
      affects: new f.StringField({ required: true, initial: "trigger", choices: labelled("TRAPS.Affects", ["trigger", "area"]) }),
      stops: new f.BooleanField({ initial: false }),
      detectDC: dc(15),
      disarmDC: dc(15),
      disarmSkill: new f.StringField({ required: true, initial: "thief", choices: choices.skills }),
      attackBonus: new f.NumberField({ required: false, nullable: true, integer: true, min: -5, max: 30, initial: null }),
      saveAbility: new f.StringField({ required: true, blank: true, initial: "", choices: choices.abilities }),
      saveDC: dc(13),
      onSave: new f.StringField({ required: true, initial: "half", choices: labelled("TRAPS.OnSave", ["half", "none"]) }),
      damage: formula(),
      damageType: new f.StringField({ required: true, initial: "bludgeoning", choices: choices.damageTypes }),
      damage2: formula(),
      damage2Type: new f.StringField({ required: true, blank: true, initial: "", choices: choices.damageTypesOptional }),
      condition: new f.StringField({ required: true, blank: true, initial: "", choices: choices.conditions }),
      fx: new f.StringField({ required: true, initial: "burst", choices: labelled("TRAPS.Fx", FX_NAMES) }),
      sound: new f.StringField({ required: true, blank: true, initial: "" }),
      rearm: new f.StringField({ required: true, initial: "auto", choices: labelled("TRAPS.Rearm", ["auto", "once"]) }),
      device: new f.StringField({ required: true, blank: true, initial: "" }),
      options: new f.ObjectField({ required: true, initial: {} }),
      fixedDamage: new f.BooleanField({ initial: false }),
      escapeDC: dc(0),
      escapeSkill: new f.StringField({ required: true, initial: "ath", choices: choices.skills }),
      flavor: new f.StringField({ required: true, blank: true, initial: "" }),
      notes: new f.StringField({ required: true, blank: true, initial: "" }),
      size: new f.NumberField({ required: true, nullable: false, integer: true, min: 1, max: 12, initial: 1 }),
      detected: new f.BooleanField({ initial: false }),
      disarmed: new f.BooleanField({ initial: false }),
      triggers: new f.NumberField({ required: true, nullable: false, integer: true, min: 0, initial: 0 }),
    };
  }

  static events = {
    [CONST.REGION_EVENTS.TOKEN_MOVE_IN]: TrapBehavior.#onMoveIn,
  };

  /**
   * Токен вошёл в область. Событие приходит всем клиентам: тот, кто двигал токен, останавливает
   * или придерживает его, а ловушку разыгрывает активный ведущий и потом отпускает движение.
   */
  static async #onMoveIn(event) {
    const token = event.data?.token;
    const movement = event.data?.movement;
    // Токен сдвинули принудительно (ведущий перетащил без хода) — не считается.
    if (movement?.passed?.waypoints?.at(-1)?.action === "displace") return;
    if (!canTrigger(token)) return;

    const gm = game.users.activeGM;
    if (event.user?.isSelf && movement && gm) {
      try {
        if (this.stops) token.stopMovement();
        else token.pauseMovement(this.parent.uuid);
      } catch (err) {
        console.warn("ssl_traps | не удалось придержать движение", err);
      }
    }
    if (!game.user.isActiveGM) return;
    try {
      await fireTrap(this.parent, { trigger: token });
    } finally {
      if (!this.stops && movement?.id) {
        try {
          await token.resumeMovement(movement.id, this.parent.uuid);
        } catch {
          /* движение уже закончено или отменено */
        }
      }
    }
  }
}

export function registerBehavior() {
  CONFIG.RegionBehavior.dataModels[BEHAVIOR_TYPE] = TrapBehavior;
  CONFIG.RegionBehavior.typeIcons[BEHAVIOR_TYPE] = "fa-solid fa-skull-crossbones";
  if (CONFIG.RegionBehavior.typeLabels) CONFIG.RegionBehavior.typeLabels[BEHAVIOR_TYPE] = "TRAPS.Behavior.label";
}

