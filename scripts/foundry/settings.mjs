import { MODULE_ID, SETTINGS } from "./constants.mjs";

export const setting = (key) => game.settings.get(MODULE_ID, key);

export const setSetting = (key, value) => game.settings.set(MODULE_ID, key, value);

export function registerSettings({ onLibrary, onMapButtons, onDetectMode }) {
  const reg = (key, data) => game.settings.register(MODULE_ID, key, data);
  const name = (key) => ({ name: `TRAPS.Settings.${key}.name`, hint: `TRAPS.Settings.${key}.hint` });

  // Свои ловушки библиотеки: { id: TrapDef }.
  reg(SETTINGS.customTraps, { scope: "world", config: false, type: Object, default: {}, onChange: onLibrary });
  // Уровень партии в окне библиотеки — у каждого ведущего свой.
  reg(SETTINGS.tier, { scope: "client", config: false, type: Number, default: 1 });

  reg(SETTINGS.fxMode, {
    ...name("fxMode"),
    scope: "world",
    config: true,
    type: String,
    choices: {
      auto: "TRAPS.Settings.fxMode.auto",
      builtin: "TRAPS.Settings.fxMode.builtin",
      off: "TRAPS.Settings.fxMode.off",
    },
    default: "auto",
  });
  reg(SETTINGS.volume, {
    ...name("volume"),
    scope: "world",
    config: true,
    type: Number,
    range: { min: 0, max: 1, step: 0.05 },
    default: 0.7,
  });
  reg(SETTINGS.triggerBy, {
    ...name("triggerBy"),
    scope: "world",
    config: true,
    type: String,
    choices: { players: "TRAPS.Settings.triggerBy.players", all: "TRAPS.Settings.triggerBy.all" },
    default: "players",
  });
  reg(SETTINGS.applyDamage, { ...name("applyDamage"), scope: "world", config: true, type: Boolean, default: true });
  reg(SETTINGS.chatMode, {
    ...name("chatMode"),
    scope: "world",
    config: true,
    type: String,
    choices: { public: "TRAPS.Settings.chatMode.public", gm: "TRAPS.Settings.chatMode.gm" },
    default: "public",
  });
  reg(SETTINGS.passiveDetect, { ...name("passiveDetect"), scope: "world", config: true, type: Boolean, default: true });
  reg(SETTINGS.detectSight, { ...name("detectSight"), scope: "world", config: true, type: Boolean, default: true });
  // Персонаж заметил ловушку: сразу показать её игрокам или сообщить ведущему, а показать вручную.
  reg(SETTINGS.detectMode, {
    ...name("detectMode"),
    scope: "world",
    config: true,
    type: String,
    choices: { gm: "TRAPS.Settings.detectMode.gm", reveal: "TRAPS.Settings.detectMode.reveal" },
    default: "gm",
    onChange: onDetectMode,
  });
  // Кнопки «показать / скрыть» у ловушек на карте — у каждого ведущего свои.
  reg(SETTINGS.mapButtons, { ...name("mapButtons"), scope: "client", config: true, type: Boolean, default: true, onChange: onMapButtons });
}
