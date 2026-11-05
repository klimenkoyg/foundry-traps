/* Западня · Trap Library — ловушки с анимациями для D&D 5e в Foundry VTT v13–v14. */

import { checkPassive, placeTrap } from "./foundry/actions.mjs";
import { onRenderCard, registerCardSocket } from "./foundry/card.mjs";
import { addSceneControls, refreshSceneControls } from "./foundry/controls.mjs";
import { onRenderChatMessage, syncChatButtons } from "./foundry/chat.mjs";
import { TrapApp } from "./foundry/apps/trap-app.mjs";
import { registerBehavior } from "./foundry/behavior.mjs";
import { BEHAVIOR_TYPE, DRAG_TYPE, MODULE_ID, SETTINGS, tpl } from "./foundry/constants.mjs";
import { isDnd5e } from "./foundry/dnd5e.mjs";
import { playTrapFx, registerFxSocket } from "./foundry/fx.mjs";
import { clearHud, refreshHud, scheduleHud, syncHudZoom } from "./foundry/gm-hud.mjs";
import { clearMarkers, refreshMarkers, scheduleMarkers } from "./foundry/markers.mjs";
import { t } from "./foundry/i18n.mjs";
import { getEntry, listEntries } from "./foundry/library.mjs";
import { sceneTraps } from "./foundry/scene.mjs";
import { registerSettings, setting } from "./foundry/settings.mjs";
import { fireTrap } from "./foundry/trigger.mjs";

const open = () => TrapApp.open();

Hooks.once("init", () => {
  registerSettings({
    onLibrary: () => TrapApp.refresh(),
    onMapButtons: () => {
      refreshHud();
      refreshMarkers({ animate: false });
      refreshSceneControls();
    },
    onModes: () => TrapApp.refresh(),
  });
  registerBehavior();
  game.keybindings.register(MODULE_ID, "open", {
    name: "TRAPS.Keybinding.open",
    editable: [],
    restricted: true,
    onDown: () => {
      open();
      return true;
    },
  });
  foundry.applications.handlebars.loadTemplates(["trap-app.hbs", "trap-card.hbs", "trap-editor.hbs", "trap-preview.hbs"].map(tpl));
});

Hooks.once("ready", () => {
  registerFxSocket();
  registerCardSocket();
  if (game.user.isGM && !isDnd5e()) ui.notifications.warn(t("Notify.notDnd5e"));
  game.modules.get(MODULE_ID).api = {
    /** Окно ведущего: open("scene") — сразу на вкладке сцены. */
    open: (tab) => TrapApp.open(tab),
    /** Ловушки библиотеки: [{ id, name, trap, custom }]. */
    library: () => listEntries(),
    getTrap: (id) => getEntry(id),
    /** Поставить из макроса: place("pit", { x, y }, { tier: 2 }). */
    place: (trapId, point, { scene = canvas.scene, tier } = {}) => placeTrap(scene, trapId, point, tier),
    /** Ловушки сцены: [{ region, behavior }]. */
    traps: (scene = canvas.scene) => sceneTraps(scene),
    /** Сработать вручную (только активный ведущий). */
    fire: (behavior, options) => fireTrap(behavior, options),
    /** Показать анимацию без ловушки: playFx("fire", { x, y }, 200). */
    playFx: (fx, at, area = canvas.grid.size, sound) => playTrapFx(canvas.scene, { fx, sound, at, area }),
    behaviorType: BEHAVIOR_TYPE,
  };
});

// Левая панель: своя группа «Ловушки» (на слое регионов) и кнопка на панели токенов.
Hooks.on("getSceneControlButtons", addSceneControls);

// Ловушку перетащили из окна на карту.
Hooks.on("dropCanvasData", (cnv, data) => {
  if (data?.type !== DRAG_TYPE) return;
  if (!game.user.isGM) return false;
  const scene = cnv.scene ?? canvas.scene;
  if (!scene) {
    ui.notifications.warn(t("Notify.noScene"));
    return false;
  }
  // Из окна настройки прилетает готовый черновик, из библиотеки — id.
  const draft = data.draft;
  const source = draft
    ? { id: draft.sourceId, trap: draft, name: draft.name, text: draft.text, flavor: draft.flavor, scaled: true }
    : data.trapId;
  placeTrap(scene, source, { x: data.x, y: data.y }, draft?.tier);
  return false;
});

// Пассивная Внимательность: персонаж игрока подошёл к ловушке.
Hooks.on("updateToken", (token, change) => {
  if (!game.user.isActiveGM || !setting(SETTINGS.passiveDetect)) return;
  if (!("x" in change) && !("y" in change)) return;
  checkPassive(token).catch((err) => console.warn(`${MODULE_ID} | пассивная Внимательность`, err));
});

// Окно ведущего и метки на карте следят за сценой.
for (const hook of ["createRegion", "updateRegion", "deleteRegion", "createRegionBehavior", "updateRegionBehavior", "deleteRegionBehavior"]) {
  Hooks.on(hook, () => {
    TrapApp.refresh();
    scheduleMarkers();
    scheduleHud();
    syncChatButtons();
  });
}
Hooks.on("canvasReady", () => {
  TrapApp.refresh();
  refreshMarkers({ animate: false });
  refreshHud();
});
Hooks.on("canvasTearDown", () => {
  clearMarkers();
  clearHud();
});
Hooks.on("canvasPan", () => syncHudZoom());

// Кнопка ведущего «показать игрокам / скрыть» в сообщении о замеченной ловушке.
Hooks.on("renderChatMessageHTML", onRenderChatMessage);
// Карточка срабатывания: спасброски игроков и кнопки ведущего «нанести».
Hooks.on("renderChatMessageHTML", onRenderCard);
