/* Кнопки ведущего прямо на карте, у правого верхнего угла каждой ловушки:
   - «глаз» — одним щелчком показать ловушку игрокам или спрятать;
   - «ключ» (у взведённой) — попробовать обезвредить её выделенным токеном;
   - «▶» (у взведённой) — сработать сейчас по всем в её области (так срабатывает «только вручную»).
   От каждого триггера к его ловушке — пунктирная линия, чтобы было видно, что с чем связано.
   Кнопки живут в #hud Foundry — HTML-слое поверх холста, который двигается и масштабируется вместе
   с картой (там же кнопки токенов). Видны только ведущему. */

import { attemptDisarm, noticedBy, setRevealed, triggerNow } from "./actions.mjs";
import { skillLabel } from "./dnd5e.mjs";
import { SETTINGS, THEME } from "./constants.mjs";
import { esc, t } from "./i18n.mjs";
import { activatorsOf, isRevealed, regionBounds, sceneTraps } from "./scene.mjs";
import { setting } from "./settings.mjs";

const ROOT_ID = "ssl-traps-hud";
let timer = null;
/** Ловушки, которые уже были замечены, когда сцена открылась или при прошлой перерисовке. */
const seenNoticed = new Set();
let primed = false;

/** Включены ли кнопки на карте у этого пользователя. */
export const mapButtonsOn = () => Boolean(game.user?.isGM && setting(SETTINGS.mapButtons) !== false);

function container() {
  const hud = document.getElementById("hud");
  if (!hud) return null;
  let el = document.getElementById(ROOT_ID);
  if (el && el.parentElement !== hud) {
    el.remove();
    el = null;
  }
  if (!el) {
    el = document.createElement("div");
    el.id = ROOT_ID;
    el.className = "ssl-traps st-map-hud";
    el.dataset.stTheme = THEME;
    el.addEventListener("click", onClick);
    // Не отдавать щелчок холсту под кнопкой (иначе снимется выделение токенов).
    el.addEventListener("pointerdown", (event) => event.target.closest(".st-map-btn") && event.stopPropagation());
    el.addEventListener("mousedown", (event) => event.target.closest(".st-map-btn") && event.stopPropagation());
    hud.append(el);
  }
  return el;
}

/** Кнопки сохраняют размер на экране при любом масштабе карты. */
export function syncHudZoom() {
  const el = document.getElementById(ROOT_ID);
  const scale = Number(canvas?.stage?.scale?.x) || 1;
  el?.style.setProperty("--st-inv", String(1 / scale));
}

function button(region, behavior) {
  const b = regionBounds(region);
  const shown = isRevealed(region);
  const name = esc(behavior.name || region.name);
  // Заметили, но игрокам ещё не показана: ведущий должен решить. Свежая отметка — с пульсом.
  const who = shown ? [] : noticedBy(region).map((n) => n.name).filter(Boolean);
  const fresh = who.length && primed && !seenNoticed.has(region.id);
  if (who.length) seenNoticed.add(region.id);
  else seenNoticed.delete(region.id);
  const tip = esc(
    who.length
      ? t("Hud.noticed", { name: behavior.name || region.name, who: who.join(", ") })
      : t(shown ? "Hud.hide" : "Hud.reveal", { name: behavior.name || region.name }),
  );
  const state = `${shown ? "is-shown" : "is-hidden"}${who.length ? " is-noticed" : ""}${fresh ? " is-new" : ""}`;
  const ids = `data-region="${region.id}" data-behavior="${behavior.id}"`;
  const eye = `<button type="button" class="st-map-btn ${state}" data-act="vis" ${ids} aria-pressed="${shown}" aria-label="${tip}" data-tooltip="${tip}" data-name="${name}">
    <i class="fa-solid ${shown ? "fa-eye" : "fa-eye-slash"}" inert></i></button>`;
  // Обезвредить — только взведённую.
  const s = behavior.system;
  const disarmTip = esc(t("Hud.disarm", { name: behavior.name || region.name, skill: skillLabel(s.disarmSkill), dc: s.disarmDC }));
  const key = behavior.disabled
    ? ""
    : `<button type="button" class="st-map-btn is-disarm" data-act="disarm" ${ids} aria-label="${disarmTip}" data-tooltip="${disarmTip}"><i class="fa-solid fa-screwdriver-wrench" inert></i></button>`;
  const fireTip = esc(t(s.manual ? "Hud.fireManual" : "Hud.fire", { name: behavior.name || region.name }));
  const fire = behavior.disabled
    ? ""
    : `<button type="button" class="st-map-btn is-fire${s.manual ? " is-manual" : ""}" data-act="fire" ${ids} aria-label="${fireTip}" data-tooltip="${fireTip}"><i class="fa-solid fa-play" inert></i></button>`;
  return `<div class="st-map-trap" style="left:${b.x + b.width}px;top:${b.y}px">${eye}${key}${fire}</div>`;
}

/** Пунктир от середины каждого триггера к середине его ловушки (в пикселях сцены). */
function links(traps) {
  const lines = [];
  for (const { region } of traps) {
    const b = regionBounds(region);
    const to = { x: b.x + b.width / 2, y: b.y + b.height / 2 };
    for (const part of activatorsOf(region)) {
      const a = regionBounds(part);
      const from = { x: a.x + a.width / 2, y: a.y + a.height / 2 };
      lines.push(`<line x1="${from.x}" y1="${from.y}" x2="${to.x}" y2="${to.y}"/><circle cx="${from.x}" cy="${from.y}"/>`);
    }
  }
  return lines.length ? `<svg class="st-map-links" width="1" height="1" aria-hidden="true">${lines.join("")}</svg>` : "";
}

/** Перерисовать кнопки текущей сцены. */
export function refreshHud() {
  const on = mapButtonsOn() && canvas?.ready && canvas.scene;
  if (!on) {
    document.getElementById(ROOT_ID)?.replaceChildren();
    return;
  }
  const el = container();
  if (!el) return;
  const seen = new Set();
  const traps = [];
  for (const found of sceneTraps(canvas.scene)) {
    if (seen.has(found.region.id)) continue;
    seen.add(found.region.id);
    traps.push(found);
  }
  el.innerHTML = links(traps) + traps.map(({ region, behavior }) => button(region, behavior)).join("");
  primed = true;
  syncHudZoom();
}

export function scheduleHud() {
  clearTimeout(timer);
  timer = setTimeout(() => {
    try {
      refreshHud();
    } catch (err) {
      console.warn("ssl_traps | кнопки на карте", err);
    }
  }, 0);
}

export function clearHud() {
  document.getElementById(ROOT_ID)?.replaceChildren();
  seenNoticed.clear();
  primed = false;
}

async function onClick(event) {
  const btn = event.target.closest(".st-map-btn");
  if (!btn || !game.user.isGM) return;
  event.preventDefault();
  event.stopPropagation();
  const region = canvas.scene?.regions.get(btn.dataset.region);
  const behavior = region?.behaviors.get(btn.dataset.behavior);
  if (!region || !behavior) return;
  if (btn.dataset.act === "disarm") return disarm(btn, region, behavior);
  if (btn.dataset.act === "fire") return fire(btn, behavior);
  btn.disabled = true;
  try {
    await setRevealed(region, behavior, !isRevealed(region));
  } finally {
    btn.disabled = false;
  }
}

/** Сработать сейчас — по всем в области ловушки. Разыгрывает активный ведущий. */
async function fire(btn, behavior) {
  if (!game.users.activeGM?.isSelf) return ui.notifications.warn(t("Notify.noGM"));
  btn.disabled = true;
  try {
    await triggerNow(behavior, []);
  } finally {
    btn.disabled = false;
  }
}

/** Попытка обезвредить выделенным токеном: бросок навыка или воровских инструментов против Сл. */
async function disarm(btn, region, behavior) {
  const [token] = (canvas.tokens?.controlled ?? []).map((tk) => tk.document ?? tk).filter((d) => d?.actor);
  if (!token) return ui.notifications.warn(t("Notify.selectToken"));
  btn.disabled = true;
  try {
    await attemptDisarm(region, behavior, token);
  } finally {
    btn.disabled = false;
  }
}
