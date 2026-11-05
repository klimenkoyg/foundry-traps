export const MODULE_ID = "ssl_traps";

/** Тип поведения области: «<id модуля>.trap» (documentTypes в module.json). */
export const BEHAVIOR_TYPE = `${MODULE_ID}.trap`;

/** Что тащим из окна на карту. */
export const DRAG_TYPE = `${MODULE_ID}.Trap`;

export const SOCKET = `module.${MODULE_ID}`;

/** Оформление окна и карточек чата: styles/theme-heroic.css. */
export const THEME = "heroic";
export const THEME_ATTR = `data-st-theme="${THEME}"`;

export const SETTINGS = {
  customTraps: "customTraps",
  tier: "tier",
  fxMode: "fxMode",
  volume: "volume",
  applyDamage: "applyDamage",
  chatMode: "chatMode",
  triggerBy: "triggerBy",
  passiveDetect: "passiveDetect",
  detectSight: "detectSight",
  detectMode: "detectMode",
  mapButtons: "mapButtons",
};

/** Цвет области по опасности. */
export const SEVERITY_COLOR = { setback: "#d9a441", dangerous: "#e0702e", deadly: "#c0392b" };

export const tpl = (path) => `modules/${MODULE_ID}/templates/${path}`;
