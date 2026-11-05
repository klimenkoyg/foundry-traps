/* Срабатывание ловушки (только у активного ведущего): кто под ударом, анимация, бросок урона,
   карточка розыгрыша в чате (foundry/card.mjs). */

import { rectCenter } from "../core/geometry.mjs";
import { hasDamage, normalizeTrap } from "../core/trap.mjs";
import { startCard } from "./card.mjs";
import { playTrapFx } from "./fx.mjs";
import { t } from "./i18n.mjs";
import { regionElevation } from "./layers.mjs";
import { regionBounds, regionTokens, setVisible } from "./scene.mjs";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Ловушки, которые сейчас разыгрываются: второй вход в ту же секунду не запускает её повторно. */
const busy = new Set();

/**
 * Сработать.
 * trigger — токен, который наступил (для «только наступивший»);
 * targets — явный список токенов (ручной запуск из окна).
 */
export async function fireTrap(behavior, { trigger = null, targets = null, cause = null } = {}) {
  const region = behavior.region ?? behavior.parent;
  const scene = region?.parent;
  if (!region || !scene || busy.has(behavior.uuid)) return null;
  busy.add(behavior.uuid);
  try {
    return await resolve(behavior, region, scene, { trigger, targets, cause });
  } finally {
    busy.delete(behavior.uuid);
  }
}

async function resolve(behavior, region, scene, { trigger, targets, cause }) {
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
    width: bounds.width,
    height: bounds.height,
    elevation: regionElevation(region),
  });

  // Урон один раз на всех, как у заклинаний по области. Бросается после проверок (foundry/card.mjs):
  // сразу, если ждать нечего, иначе — когда придёт последний спасбросок или ведущий нажмёт «Бросить урон».
  const parts = [
    [trap.damage, trap.damageType],
    [trap.damage2, trap.damage2Type || trap.damageType],
  ]
    .filter(([formula]) => formula)
    .map(([formula, type]) => ({ formula, type, value: null }));

  // Пусть эффект «долетит», прежде чем у персонажей поменяются хиты.
  if (duration) await sleep(Math.min(700, duration * 0.35));

  // Карточка розыгрыша: цели, почему они под ударом, спасброски (игроков или модуля), урон —
  // сразу или по кнопке ведущего (foundry/card.mjs).
  const message = await startCard({ scene, trap, name, tokens, trigger, manual: Boolean(targets), cause, parts });

  // Сработавшую ловушку видно всем; одноразовая больше не срабатывает.
  const update = { "system.triggers": (behavior.system.triggers ?? 0) + 1, "system.detected": true };
  if (trap.rearm === "once") update.disabled = true;
  await behavior.update(update);
  await setVisible(region, true);

  if (!hasDamage(trap) && !trap.condition) ui.notifications.warn(t("Chat.alarmGm", { trap: name }));
  return message;
}
