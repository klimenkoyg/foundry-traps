/* Поведения областей модуля.
   «Ловушка» — все параметры ловушки; срабатывает, когда в область заходит токен, если у ловушки
   нет триггеров и она не «только вручную».
   «Триггер ловушки» — отдельная область (плита, растяжка): наступили на неё — срабатывает ловушка,
   на которую она ссылается, и бьёт всех в своей области. Триггеров у ловушки может быть несколько.
   Окно настройки поведения Foundry строит само по схеме — так любую расставленную ловушку
   можно поправить в обычном окне области. */

import { FX_NAMES } from "../core/fx/presets.mjs";
import { rectCenter, rectContains } from "../core/geometry.mjs";
import { MAX_ACTIVATORS, SEVERITIES } from "../core/trap.mjs";
import { ACTIVATOR_TYPE, BEHAVIOR_TYPE, SETTINGS } from "./constants.mjs";
import { choices } from "./dnd5e.mjs";
import { t } from "./i18n.mjs";
import { activatorsOf, regionBounds, trapOfActivator } from "./scene.mjs";
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
      detectRange: new f.NumberField({ required: true, nullable: false, integer: true, min: 5, max: 120, initial: 10 }),
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
      fixedDamage: new f.BooleanField({ initial: true }),
      escapeDC: dc(0),
      escapeSkill: new f.StringField({ required: true, initial: "ath", choices: choices.skills }),
      manual: new f.BooleanField({ initial: false }),
      activators: new f.NumberField({ required: true, nullable: false, integer: true, min: 0, max: MAX_ACTIVATORS, initial: 0 }),
      flavor: new f.StringField({ required: true, blank: true, initial: "" }),
      notes: new f.StringField({ required: true, blank: true, initial: "" }),
      size: new f.NumberField({ required: true, nullable: false, integer: true, min: 1, max: 12, initial: 1 }),
      width: new f.NumberField({ required: true, nullable: false, integer: true, min: 1, max: 12, initial: 1 }),
      height: new f.NumberField({ required: true, nullable: false, integer: true, min: 1, max: 12, initial: 1 }),
      detected: new f.BooleanField({ initial: false }),
      disarmed: new f.BooleanField({ initial: false }),
      triggers: new f.NumberField({ required: true, nullable: false, integer: true, min: 0, initial: 0 }),
    };
  }

  static events = {
    [CONST.REGION_EVENTS.TOKEN_MOVE_IN]: TrapBehavior.#onMoveIn,
  };

  /** Токен вошёл в область ловушки: срабатывает, если у неё нет триггеров и она не «вручную». */
  static async #onMoveIn(event) {
    if (this.manual) return;
    const region = this.parent.region ?? this.parent.parent;
    if (activatorsOf(region).length) return;
    await stepOn(event, this.parent, this.parent, {});
  }
}

/**
 * Область-триггер: ссылается на область ловушки (её id на той же сцене). Ставит её модуль —
 * вместе с ловушкой или кнопкой «Добавить триггер»; ведущий двигает и меняет её как обычную область.
 */
export class ActivatorBehavior extends RegionBehaviorType {
  static LOCALIZATION_PREFIXES = ["TRAPS.ActivatorBehavior"];

  static defineSchema() {
    return {
      trap: new f.StringField({ required: true, blank: true, initial: "" }),
    };
  }

  static events = {
    [CONST.REGION_EVENTS.TOKEN_MOVE_IN]: ActivatorBehavior.#onMoveIn,
  };

  /** Наступили на триггер: срабатывает его ловушка — по всем в её области. */
  static async #onMoveIn(event) {
    const region = this.parent.region ?? this.parent.parent;
    const found = trapOfActivator(region);
    if (!found || found.behavior.disabled || found.behavior.system.manual) return;
    // Триггер внутри области ловушки — наступивший тоже под ударом (и яма его остановит); снаружи — нет.
    const stepperInside = rectContains(regionBounds(found.region), rectCenter(regionBounds(region)));
    await stepOn(event, this.parent, found.behavior, { viaActivator: true, stepperInside });
  }
}

/**
 * Токен наступил на область (саму ловушку или её триггер). Событие приходит всем клиентам: тот,
 * кто двигал токен, останавливает или придерживает его, а ловушку разыгрывает активный ведущий
 * и потом отпускает движение. holder — поведение, от имени которого держим движение.
 */
async function stepOn(event, holder, trapBehavior, options) {
  const token = event.data?.token;
  const movement = event.data?.movement;
  // Токен сдвинули принудительно (ведущий перетащил без хода) — не считается.
  if (movement?.passed?.waypoints?.at(-1)?.action === "displace") return;
  if (!canTrigger(token)) return;

  // Яма, капкан и сеть останавливают того, кто в них попал; плита снаружи — только придерживает.
  const stops = Boolean(trapBehavior.system.stops) && (!options.viaActivator || options.stepperInside);
  const gm = game.users.activeGM;
  if (event.user?.isSelf && movement && gm) {
    try {
      if (stops) token.stopMovement();
      else token.pauseMovement(holder.uuid);
    } catch (err) {
      console.warn("ssl_traps | не удалось придержать движение", err);
    }
  }
  if (!game.user.isActiveGM) return;
  // Отпускаем движение, как только эффект «долетел», — не дожидаясь карточки в чате и записи
  // ловушки на сервер: иначе персонаж стоит лишнюю секунду. Не вышло раньше — отпустим в конце.
  let resumed = false;
  const resume = async () => {
    if (resumed || stops || !movement?.id) return;
    resumed = true;
    try {
      await token.resumeMovement(movement.id, holder.uuid);
    } catch {
      /* движение уже закончено или отменено */
    }
  };
  try {
    await fireTrap(trapBehavior, { trigger: token, ...options, onImpact: () => void resume() });
  } finally {
    await resume();
  }
}

export function registerBehavior() {
  CONFIG.RegionBehavior.dataModels[BEHAVIOR_TYPE] = TrapBehavior;
  CONFIG.RegionBehavior.typeIcons[BEHAVIOR_TYPE] = "fa-solid fa-skull-crossbones";
  CONFIG.RegionBehavior.dataModels[ACTIVATOR_TYPE] = ActivatorBehavior;
  CONFIG.RegionBehavior.typeIcons[ACTIVATOR_TYPE] = "fa-solid fa-shoe-prints";
  if (CONFIG.RegionBehavior.typeLabels) {
    CONFIG.RegionBehavior.typeLabels[BEHAVIOR_TYPE] = "TRAPS.Behavior.label";
    CONFIG.RegionBehavior.typeLabels[ACTIVATOR_TYPE] = "TRAPS.ActivatorBehavior.label";
  }
}

