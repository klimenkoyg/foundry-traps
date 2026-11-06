/* Обезвреживание глазами игрока.
   - Ведущий жмёт ключ с выделенным токеном. «Обезвреживание бросает: игрок» — модуль не бросает
     сам, а шлёт игроку (хозяину персонажа) карточку с кнопкой «Бросить»; у ведущего в ней — «Бросить
     за игрока». «Бросает ведущий» или у персонажа нет игрока — бросок сразу, как раньше.
   - «Игроки сами обезвреживают» — у игрока свой ключ у ловушки на карте (foundry/gm-hud.mjs), если
     он про неё знает (показали всем или ведущий сообщил ему) и его токен рядом.
   Игрок бросает с окном dnd5e, итог уходит активному ведущему по сокету; ведущий проверяет, что всё
   честно (персонаж игрока, рядом, знает, ловушка взведена), и доводит попытку до конца. Сложность
   игроку не показываем. */

import { finishDisarm, attemptDisarm, playerKnows } from "./actions.mjs";
import { MODULE_ID, SETTINGS, SOCKET, THEME_ATTR } from "./constants.mjs";
import { rollMessageId, waitForDice } from "./dice.mjs";
import { rollCheck, skillLabel } from "./dnd5e.mjs";
import { esc, t } from "./i18n.mjs";
import { cellsBetween, ownerIds, postMessage } from "./scene.mjs";
import { setting } from "./settings.mjs";

const FLAG = "disarm";

/** Рядом ли токен с ловушкой: внутри или в соседней клетке. */
export const nearTrap = (token, region) => cellsBetween(token, region) <= 1 + 1e-6;

/** Включён ли у игроков свой ключ. */
export const playersDisarm = () => setting(SETTINGS.playerDisarm) !== "off";

/**
 * Ведущий жмёт ключ (на карте или во вкладке сцены) с выделенным токеном: бросок — игроку карточкой
 * или сразу самому, по настройке «Обезвреживание бросает».
 */
export async function requestDisarm(region, behavior, token) {
  const owners = ownerIds(token.actor);
  if (setting(SETTINGS.disarmRolls) === "gm" || !owners.length) return attemptDisarm(region, behavior, token);
  const skill = esc(skillLabel(behavior.system.disarmSkill));
  const text = t("Chat.disarmAsk", { name: `<b>${esc(token.name)}</b>`, trap: esc(behavior.name), skill });
  return postMessage({
    alias: t("Title"),
    audience: owners,
    content: `<div ${THEME_ATTR} class="ssl-traps-note is-disarm-ask"><p><i class="fa-solid fa-screwdriver-wrench" inert></i> ${text}</p>
      <div class="st-note-actions"><button type="button" class="st-note-btn" data-ssl-traps-disarm><i class="fa-solid fa-dice-d20" inert></i> <span></span></button></div></div>`,
    flags: { [FLAG]: { sceneId: region.parent.id, regionId: region.id, behaviorId: behavior.id, tokenId: token.id, done: false } },
  });
}

/** Что за ловушка и токен в карточке-просьбе (или null, если их уже нет). */
function partsOf(info) {
  const scene = game.scenes?.get(info?.sceneId);
  const region = scene?.regions.get(info?.regionId);
  const behavior = region?.behaviors.get(info?.behaviorId);
  const token = scene?.tokens.get(info?.tokenId);
  return region && behavior && token?.actor ? { region, behavior, token } : null;
}

/** Бросок игрока (или ведущего за него) с окном dnd5e; кубики докатились — итог. → total или null. */
async function rollFor(token, behavior) {
  const roll = await rollCheck(token.actor, behavior.system.disarmSkill, behavior.system.disarmDC, { configure: true });
  if (!roll) return null;
  await waitForDice(rollMessageId(roll));
  return roll.total;
}

/* ---------------------------------------------------------------- карточка-просьба */

/** Хук renderChatMessageHTML: кнопка «Бросить» — хозяину персонажа, «Бросить за игрока» — ведущему. */
export function onRenderDisarm(message, html) {
  const info = message?.flags?.[MODULE_ID]?.[FLAG];
  if (!info) return;
  const root = html instanceof HTMLElement ? html : html?.[0];
  const btn = root?.querySelector?.("[data-ssl-traps-disarm]");
  if (!btn) return;
  const found = partsOf(info);
  const mine = found && found.token.actor.isOwner && !game.user.isGM;
  if (info.done || !found || !(mine || game.user.isGM)) {
    btn.closest(".st-note-actions")?.remove();
    return;
  }
  btn.querySelector("span").textContent = t(game.user.isGM ? "Chat.disarmRollFor" : "Chat.disarmRoll", { skill: skillLabel(found.behavior.system.disarmSkill) });
  if (btn.dataset.bound) return;
  btn.dataset.bound = "1";
  btn.addEventListener("click", async (event) => {
    event.preventDefault();
    btn.disabled = true;
    try {
      const total = await rollFor(found.token, found.behavior);
      if (total === null) return;
      if (game.user.isGM) await settleAsk(message.id, total, game.user.id);
      else game.socket.emit(SOCKET, { action: "trapDisarm", messageId: message.id, total, userId: game.user.id });
    } finally {
      btn.disabled = false;
    }
  });
}

/** Итог по карточке-просьбе: довести попытку и пометить карточку, чтобы второй раз не бросали. */
async function settleAsk(messageId, total, userId) {
  const message = game.messages.get(messageId);
  const info = message?.flags?.[MODULE_ID]?.[FLAG];
  const found = partsOf(info);
  const user = game.users.get(userId);
  if (!info || info.done || !found || !user) return;
  if (!user.isGM && !found.token.actor.testUserPermission(user, "OWNER")) return;
  await message.update({ [`flags.${MODULE_ID}.${FLAG}.done`]: true });
  await finishDisarm(found.region, found.behavior, found.token, total);
}

/* ---------------------------------------------------------------- свой ключ у игрока */

/** Игрок жмёт свой ключ у ловушки на карте. */
export async function playerDisarm(region, behavior, token) {
  if (!game.users.activeGM) return ui.notifications.warn(t("Notify.noGM"));
  const total = await rollFor(token, behavior);
  if (total === null) return;
  game.socket.emit(SOCKET, {
    action: "trapDisarm",
    sceneId: region.parent.id,
    regionId: region.id,
    behaviorId: behavior.id,
    tokenId: token.id,
    total,
    userId: game.user.id,
  });
}

/** Ведущий получил попытку игрока с карты: проверить, что всё честно, и довести до конца. */
async function settleOwn({ sceneId, regionId, behaviorId, tokenId, total, userId }) {
  const found = partsOf({ sceneId, regionId, behaviorId, tokenId });
  const user = game.users.get(userId);
  if (!found || !user || !playersDisarm()) return;
  const { region, behavior, token } = found;
  const ok = !behavior.disabled && token.actor.testUserPermission(user, "OWNER") && playerKnows(region, token.actor.id) && nearTrap(token, region);
  if (!ok) return;
  await finishDisarm(region, behavior, token, total);
}

export function registerDisarmSocket() {
  game.socket.on(SOCKET, (payload) => {
    if (payload?.action !== "trapDisarm" || !game.user.isActiveGM) return;
    const run = payload.messageId ? settleAsk(payload.messageId, payload.total, payload.userId) : settleOwn(payload);
    run.catch((err) => console.warn("ssl_traps | обезвреживание игрока", err));
  });
}
