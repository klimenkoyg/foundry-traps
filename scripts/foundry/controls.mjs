/* Левая панель Foundry: своя группа «Ловушки».
   Группа работает на слое регионов: ловушки — это регионы, в режиме ловушек ведущий видит их контуры
   и может подвинуть или перерисовать область стандартными средствами Foundry. Кнопки группы
   открывают окно сразу на нужной вкладке, переключатель включает кнопки-глаза у ловушек на карте.
   На чужие панели (токены и другие) модуль кнопок не добавляет; быстро открыть окно — клавишей. */

import { TrapApp } from "./apps/trap-app.mjs";
import { SETTINGS } from "./constants.mjs";
import { setSetting, setting } from "./settings.mjs";

const ICON = "fa-solid fa-skull-crossbones";
const GROUP = "sslTraps";

/**
 * Включить слой регионов. В v13–v14 слой включает не поле layer группы, а её обработчик —
 * так делает и сама группа «Регионы». Не вышло — переключаемся на неё: там выбор областей точно работает.
 */
function activateRegions() {
  const layer = canvas?.regions;
  try {
    if (layer && !layer.active) layer.activate({ tool: "select" });
  } catch (err) {
    console.warn("ssl_traps | слой регионов не включился", err);
  }
  if (layer && !layer.active) {
    try {
      ui.controls?.activate?.({ control: "regions", tool: "select" });
    } catch {
      /* старая панель */
    }
  }
}

/** Инструменты группы; run(active) — что сделать по нажатию. */
function groupTools() {
  const open = (tab) => () => TrapApp.open(tab);
  return [
    // Обычный режим слоя регионов: выбрать область ловушки и поправить её. Как у «Выбрать» в группе
    // «Регионы»: без interaction области не отзываются на мышь, без control их нельзя выделить —
    // слой при этом включён, но щелчки по областям ничего не делают (v13–v14).
    {
      name: "select",
      title: "TRAPS.Controls.select",
      icon: "fa-solid fa-expand",
      interaction: true,
      control: true,
      run: (active) => active && activateRegions(),
    },
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
  const tools = groupTools();

  if (Array.isArray(controls)) {
    controls.push({
      name: GROUP,
      title: "TRAPS.Controls.group",
      icon: ICON,
      layer: "regions",
      visible: true,
      activeTool: "select",
      tools: tools.map(({ run, ...tool }) => ({ ...tool, visible: true, ...(run && tool.name !== "select" ? { onClick: run } : {}) })),
    });
    return;
  }

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
    // Как у группы «Регионы»: выбрали группу — включили слой, сменили инструмент — перерисовали области.
    onChange: (event, active) => {
      if (active) activateRegions();
    },
    onToolChange: (event, tool, active) => {
      canvas?.regions?.setAllRenderFlags?.({ refreshState: true });
      if (active && tool && !tool.control) canvas?.regions?.releaseAll?.();
    },
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
