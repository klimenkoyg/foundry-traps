/* Западня · Trap Library — ловушки с анимациями для D&D 5e в Foundry VTT v13–v14. */

import { checkPassive, placeTrap, recolorActivators, removeActivators } from "./foundry/actions.mjs";
import { onRenderCard, registerCardSocket } from "./foundry/card.mjs";
import { addSceneControls, refreshSceneControls } from "./foundry/controls.mjs";
import { onRenderChatMessage, syncChatButtons } from "./foundry/chat.mjs";
import { TrapApp } from "./foundry/apps/trap-app.mjs";
import { registerBehavior } from "./foundry/behavior.mjs";
import { ACTIVATOR_TYPE, BEHAVIOR_TYPE, DRAG_TYPE, MODULE_ID, SETTINGS, tpl } from "./foundry/constants.mjs";
import { isDnd5e } from "./foundry/dnd5e.mjs";
import { playTrapFx, registerFxSocket } from "./foundry/fx.mjs";
import { clearHud, refreshHud, scheduleHud, syncHudZoom } from "./foundry/gm-hud.mjs";
import { clearMarkers, refreshMarkers, scheduleMarkers } from "./foundry/markers.mjs";
import { t } from "./foundry/i18n.mjs";
import { getEntry, listEntries } from "./foundry/library.mjs";
import { sceneTraps } from "./foundry/scene.mjs";
import { registerSettings, setting } from "./foundry/settings.mjs";
import { fireTrap } from "./foundry/trigger.mjs";
import { checkForUpdate } from "./foundry/update-check.mjs";

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
  // Вышла новая версия — ведущему окошко «что нового». Чуть позже: пусть мир сначала загрузится.
  if (game.user.isGM) {
    setTimeout(() => checkForUpdate().catch((err) => console.warn(`${MODULE_ID} | проверка обновлений`, err)), 4000);
  }
});

// Левая панель: своя группа «Ловушки» (на слое регионов).
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

// Убрали ловушку — убираем и её триггеры (это делает один клиент: активный ведущий).
Hooks.on("deleteRegion", (region) => {
  if (!game.user.isActiveGM) return;
  removeActivators(region).catch((err) => console.warn(`${MODULE_ID} | триггеры ловушки`, err));
});

// Окно ведущего и метки на карте следят за сценой — только за ловушками и их триггерами.
const OUR_TYPES = new Set([BEHAVIOR_TYPE, ACTIVATOR_TYPE]);
const isOurs = (doc) => (doc?.behaviors ? [...doc.behaviors] : [doc]).some((b) => OUR_TYPES.has(b?.type));

// Заметили ловушку — это две-три записи подряд (поведение, кто заметил, показать игрокам): метки,
// кнопки и сообщения в чате перерисовываем один раз, когда они пришли.
let sceneTimer = null;
function scheduleScene() {
  clearTimeout(sceneTimer);
  sceneTimer = setTimeout(() => {
    scheduleMarkers();
    scheduleHud();
    syncChatButtons();
  }, 40);
}

for (const hook of ["createRegion", "updateRegion", "deleteRegion", "createRegionBehavior", "updateRegionBehavior", "deleteRegionBehavior"]) {
  Hooks.on(hook, (doc) => {
    // Удаление перерисовываем всегда: у удалённой области поведений может уже не быть.
    if (!hook.startsWith("delete") && !isOurs(doc)) return;
    // Ловушку поставили или убрали — меняется и счётчик на вкладке; поправили — только вкладка сцены.
    TrapApp.refresh({ sceneOnly: hook.startsWith("update") });
    scheduleScene();
  });
}
Hooks.on("canvasReady", () => {
  if (game.user.isActiveGM) recolorActivators(canvas.scene).catch((err) => console.warn(`${MODULE_ID} | цвет триггеров`, err));
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
