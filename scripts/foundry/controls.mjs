/* Левая панель Foundry: своя группа «Ловушки» и кнопка на панели токенов.
   Группа работает на слое регионов: ловушки — это регионы, в режиме ловушек ведущий видит их контуры
   и может подвинуть или перерисовать область стандартными средствами Foundry. Кнопки группы
   открывают окно сразу на нужной вкладке, переключатель включает кнопки-глаза у ловушек на карте.
   Кнопка на панели токенов остаётся: ведущий почти всё время там. */

import { TrapApp } from "./apps/trap-app.mjs";
import { SETTINGS } from "./constants.mjs";
import { setSetting, setting } from "./settings.mjs";

const ICON = "fa-solid fa-skull-crossbones";
const GROUP = "sslTraps";

/** Инструменты группы; run(active) — что сделать по нажатию. */
function groupTools() {
  const open = (tab) => () => TrapApp.open(tab);
  return [
    // Обычный режим слоя регионов: выбрать область ловушки и поправить её.
    { name: "select", title: "TRAPS.Controls.select", icon: "fa-solid fa-expand" },
    { name: "library", title: "TRAPS.Controls.library", icon: "fa-solid fa-book-skull", button: true, run: open("library") },
    { name: "mine", title: "TRAPS.Controls.mine", icon: "fa-solid fa-feather-pointed", button: true, run: open("mine") },
    { name: "scene", title: "TRAPS.Controls.scene", icon: "fa-solid fa-map-location-dot", button: true, run: open("scene") },
    {
      name: "mapButtons",
      title: "TRAPS.Controls.mapButtons",
      icon: "fa-solid fa-eye",
      toggle: true,
      active: setting(SETTINGS.mapButtons) !== false,
      run: (active) => setSetting(SETTINGS.mapButtons, Boolean(active)),
    },
  ];
}

/** Хук getSceneControlButtons: v13–v14 — объект групп, раньше — массив. */
export function addSceneControls(controls) {
  if (!game.user.isGM) return;
  const openButton = { name: GROUP, title: "TRAPS.Controls.open", icon: ICON, button: true, visible: true };
  const tools = groupTools();

  if (Array.isArray(controls)) {
    controls.find((c) => c.name === "token")?.tools.push({ ...openButton, onClick: () => TrapApp.open() });
    controls.push({
      name: GROUP,
      title: "TRAPS.Controls.group",
      icon: ICON,
      layer: "regions",
      visible: true,
      activeTool: "select",
      tools: tools.map(({ run, ...tool }) => ({ ...tool, visible: true, ...(run ? { onClick: run } : {}) })),
    });
    return;
  }

  const tokens = controls.tokens;
  if (tokens?.tools) tokens.tools[GROUP] = { ...openButton, order: Object.keys(tokens.tools).length, onChange: () => TrapApp.open() };
  // Сразу после регионов: рядом с тем, с чем ловушки и работают.
  const after = Number(controls.regions?.order ?? Object.keys(controls).length);
  controls[GROUP] = {
    name: GROUP,
    title: "TRAPS.Controls.group",
    icon: ICON,
    layer: "regions",
    order: after + 0.5,
    visible: true,
    activeTool: "select",
    tools: Object.fromEntries(
      tools.map(({ run, ...tool }, i) => [tool.name, { ...tool, order: i, visible: true, ...(run ? { onChange: (event, active) => run(active) } : {}) }]),
    ),
  };
}

/** Переключатель группы следует за настройкой, если её поменяли в другом месте. */
export function refreshSceneControls() {
  try {
    ui.controls?.render?.();
  } catch {
    /* панель ещё не готова */
  }
}
