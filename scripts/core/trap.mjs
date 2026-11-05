/* Ловушка в чистом виде: описание, пересчёт под уровень, исход срабатывания, обезвреживание.
   Без Foundry — всё здесь покрыто тестами. */

import { deriveDevice, DEVICES, normalizeOptions } from "./devices.mjs";

/**
 * @typedef {object} TrapDef
 * @property {string} id
 * @property {string} [name]          Своё название (у встроенных — из перевода)
 * @property {string} [text]          Заметка для ведущего
 * @property {string} [flavor]        Что видят игроки при срабатывании
 * @property {string} icon            Значок Font Awesome
 * @property {"setback"|"dangerous"|"deadly"} severity
 * @property {boolean} magical
 * @property {number} width           Ширина области в клетках
 * @property {number} height          Высота области в клетках
 * @property {number} size            Большая сторона (для старых ловушек — сторона квадрата)
 * @property {"trigger"|"area"} affects  Только наступивший или все в области
 * @property {boolean} stops          Останавливает движение наступившего (яма, капкан, сеть)
 * @property {number} detectDC
 * @property {number} detectRange   С какого расстояния её можно заметить, фт (по клеткам, как линейка)
 * @property {number} disarmDC
 * @property {string} disarmSkill     Навык dnd5e (ath, arc, slt, inv…) или "thief" — воровские инструменты
 * @property {number|null} attackBonus Ловушка с атакой: бонус к попаданию против КД
 * @property {string} saveAbility     "" — без спасброска
 * @property {number} saveDC
 * @property {"half"|"none"} onSave   Урон при успешном спасброске
 * @property {string} damage
 * @property {string} damageType
 * @property {string} damage2
 * @property {string} damage2Type
 * @property {string} condition       Состояние при провале / попадании
 * @property {string} fx              Анимация (fx/presets.mjs)
 * @property {string} sound
 * @property {"auto"|"once"} rearm    Взводится снова или срабатывает один раз
 * @property {string} device          Устройство (devices.mjs): параметры на языке мира
 * @property {object} options         Параметры устройства: { depth: 30, spikes: "stakes", … }
 * @property {boolean} fixedDamage    Урон не пересчитывается по уровню (падение в яму)
 * @property {number} escapeDC        Выбраться (из ямы, капкана, сети): Сл; 0 — не нужно
 * @property {string} escapeSkill     Чем выбираться: навык dnd5e
 */

export const SEVERITIES = ["setback", "dangerous", "deadly"];
export const TIERS = [1, 2, 3, 4];
export const TIER_LEVELS = { 1: "1–4", 2: "5–10", 3: "11–16", 4: "17–20" };
export const ABILITIES = ["str", "dex", "con", "int", "wis", "cha"];
export const DISARM_SKILLS = ["thief", "ath", "acr", "arc", "inv", "slt", "sur"];
export const DAMAGE_TYPES = [
  "acid", "bludgeoning", "cold", "fire", "force", "lightning", "necrotic",
  "piercing", "poison", "psychic", "radiant", "slashing", "thunder",
];
export const CONDITIONS = [
  "blinded", "deafened", "frightened", "grappled", "incapacitated", "paralyzed",
  "poisoned", "prone", "restrained", "stunned", "unconscious",
];

/** Кубиков к10 урона по уровню партии и опасности (SRD 5.1, «Damage Severity by Level»). */
const DAMAGE_DICE = {
  1: { setback: 1, dangerous: 2, deadly: 4 },
  2: { setback: 2, dangerous: 4, deadly: 10 },
  3: { setback: 4, dangerous: 10, deadly: 18 },
  4: { setback: 10, dangerous: 18, deadly: 24 },
};

/** Разумные пределы сложности по опасности (SRD 5.1): подсказка в окне ловушки. */
export const SEVERITY_DC = { setback: [10, 11], dangerous: [12, 15], deadly: [16, 20] };

const DEFAULTS = {
  id: "",
  name: "",
  text: "",
  flavor: "",
  icon: "fa-solid fa-triangle-exclamation",
  severity: "dangerous",
  magical: false,
  size: 1,
  affects: "trigger",
  stops: false,
  detectDC: 15,
  detectRange: 10,
  disarmDC: 15,
  disarmSkill: "thief",
  attackBonus: null,
  saveAbility: "",
  saveDC: 13,
  onSave: "half",
  damage: "",
  damageType: "bludgeoning",
  damage2: "",
  damage2Type: "",
  condition: "",
  fx: "burst",
  sound: "",
  rearm: "auto",
  device: "",
  options: {},
  fixedDamage: false,
  escapeDC: 0,
  escapeSkill: "ath",
};

const int = (v, fallback, min = -Infinity, max = Infinity) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : fallback;
};
const oneOf = (v, list, fallback) => (list.includes(v) ? v : fallback);
const str = (v) => (typeof v === "string" ? v.trim() : "");

/** Любые данные (из каталога, настроек, поведения области) → полная корректная ловушка. */
export function normalizeTrap(raw = {}) {
  const t = { ...DEFAULTS, ...raw };
  // Ширина и высота; у старых ловушек и в каталоге — только size, это квадрат.
  const width = int(raw.width ?? raw.size, 1, 1, 12);
  const height = int(raw.height ?? raw.size, 1, 1, 12);
  const attack = t.attackBonus === null || t.attackBonus === undefined || t.attackBonus === "" ? null : int(t.attackBonus, null, -5, 30);
  return {
    id: str(t.id),
    name: str(t.name),
    text: str(t.text),
    flavor: str(t.flavor),
    icon: str(t.icon) || DEFAULTS.icon,
    severity: oneOf(t.severity, SEVERITIES, DEFAULTS.severity),
    magical: Boolean(t.magical),
    width,
    height,
    size: Math.max(width, height),
    affects: oneOf(t.affects, ["trigger", "area"], "trigger"),
    stops: Boolean(t.stops),
    detectDC: int(t.detectDC, DEFAULTS.detectDC, 0, 40),
    detectRange: int(t.detectRange, DEFAULTS.detectRange, 5, 120),
    disarmDC: int(t.disarmDC, DEFAULTS.disarmDC, 0, 40),
    disarmSkill: str(t.disarmSkill) || DEFAULTS.disarmSkill,
    attackBonus: attack,
    saveAbility: attack === null ? oneOf(t.saveAbility, ABILITIES, "") : "",
    saveDC: int(t.saveDC, DEFAULTS.saveDC, 1, 40),
    onSave: oneOf(t.onSave, ["half", "none"], "half"),
    damage: isFormula(t.damage) ? str(t.damage) : "",
    damageType: str(t.damageType) || DEFAULTS.damageType,
    damage2: isFormula(t.damage2) ? str(t.damage2) : "",
    damage2Type: str(t.damage2Type) || str(t.damageType) || DEFAULTS.damageType,
    condition: str(t.condition),
    fx: str(t.fx) || DEFAULTS.fx,
    sound: str(t.sound),
    rearm: oneOf(t.rearm, ["auto", "once"], "auto"),
    device: str(t.device) in DEVICES ? str(t.device) : "",
    options: normalizeOptions(str(t.device), t.options),
    fixedDamage: Boolean(t.fixedDamage),
    escapeDC: int(t.escapeDC, 0, 0, 40),
    escapeSkill: str(t.escapeSkill) || DEFAULTS.escapeSkill,
  };
}

/** Простая проверка формулы урона: кубики, числа, + и −. Пустая строка — урона нет. */
export function isFormula(value) {
  const s = str(value);
  if (!s) return false;
  return /^\s*(\d*d\d+|\d+)(\s*[+-]\s*(\d*d\d+|\d+))*\s*$/i.test(s);
}

/** Во сколько раз больше урона на этом уровне, чем на первом. */
export function tierFactor(severity, tier) {
  const row = DAMAGE_DICE[tier] ?? DAMAGE_DICE[1];
  const sev = SEVERITIES.includes(severity) ? severity : "dangerous";
  return row[sev] / DAMAGE_DICE[1][sev];
}

/** «2d6+1» × 2 → «4d6+1»: множим только число кубиков. */
export function scaleFormula(formula, factor) {
  const s = str(formula);
  if (!s || factor === 1) return s;
  return s.replace(/(\d*)d(\d+)/gi, (m, n, d) => `${Math.max(1, Math.round((Number(n) || 1) * factor))}d${d}`);
}

/** Ловушка под уровень партии: урон по таблице, сложности — как в описании. */
export function scaleTrap(trap, tier = 1) {
  const t = normalizeTrap(trap);
  const factor = t.fixedDamage ? 1 : tierFactor(t.severity, tier);
  return { ...t, damage: scaleFormula(t.damage, factor), damage2: scaleFormula(t.damage2, factor) };
}

/** Обратно к 1–4 уровню: так ловушки хранятся в библиотеке. */
export function unscaleTrap(trap, tier = 1) {
  const t = normalizeTrap(trap);
  const factor = t.fixedDamage ? 1 : tierFactor(t.severity, tier);
  if (factor === 1) return t;
  return { ...t, damage: scaleFormula(t.damage, 1 / factor), damage2: scaleFormula(t.damage2, 1 / factor) };
}

/**
 * Поменять параметры устройства: поля, которые оно задаёт, пересчитываются (урон — сразу под уровень
 * партии), остальное остаётся как было. trap — уже под этот уровень (как в окне настройки).
 */
export function withDevice(trap, options, tier = 1) {
  const t = normalizeTrap(trap);
  if (!t.device) return t;
  const opts = normalizeOptions(t.device, { ...t.options, ...options });
  const patch = deriveDevice(t.device, opts);
  const next = normalizeTrap({ ...t, ...patch, options: opts });
  const factor = next.fixedDamage ? 1 : tierFactor(next.severity, tier);
  if ("damage" in patch) next.damage = scaleFormula(next.damage, factor);
  if ("damage2" in patch) next.damage2 = scaleFormula(next.damage2, factor);
  return next;
}

/** Чем проверяется ловушка: атака, спасбросок или ничем (сработала — и всё). */
export function trapMode(trap) {
  if (trap.attackBonus !== null && trap.attackBonus !== undefined) return "attack";
  if (trap.saveAbility) return "save";
  return "auto";
}

export const hasDamage = (trap) => Boolean(trap.damage || trap.damage2);

/**
 * Исход для одной цели.
 * attack: { total, natural, ac } — для ловушки с атакой
 * save:   { total }              — для ловушки со спасброском
 * → { mode, hit?, success?, multiplier, condition }
 *   multiplier — доля урона (1, 0.5, 0); condition — накладывать ли состояние.
 */
export function resolveTarget(trap, { attack, save } = {}) {
  const mode = trapMode(trap);
  if (mode === "attack") {
    const natural = attack?.natural ?? 0;
    const hit = natural !== 1 && (natural === 20 || (attack?.total ?? 0) >= (attack?.ac ?? 10));
    return { mode, hit, multiplier: hit ? 1 : 0, condition: hit };
  }
  if (mode === "save") {
    const success = (save?.total ?? 0) >= trap.saveDC;
    const multiplier = success ? (trap.onSave === "half" ? 0.5 : 0) : 1;
    return { mode, success, multiplier, condition: !success };
  }
  return { mode, multiplier: 1, condition: true };
}

/** Обезвреживание: успех; провал; провал на 5 и больше — ловушка срабатывает. */
export function resolveDisarm(total, dc) {
  if (total >= dc) return "success";
  return dc - total >= 5 ? "triggered" : "fail";
}

/** Замечает ли персонаж ловушку пассивной Внимательностью. */
export const notices = (passive, dc) => Number(passive) >= Number(dc);

/** Что делать, когда персонаж заметил ловушку: сообщить ведущему (по умолчанию) или сразу показать игрокам. */
export const DETECT_MODES = ["gm", "reveal"];

/** Знает ли персонаж о ловушке: её показали всем или он сам уже замечал её. */
export const knowsTrap = ({ revealed = false, noticedBy = [] } = {}, actorId) =>
  Boolean(revealed) || (Array.isArray(noticedBy) && noticedBy.some((n) => n?.id === actorId));

/** Список заметивших [{ id, name }] с ещё одним — без повторов. */
export function addNoticer(list, who) {
  const clean = Array.isArray(list) ? list.filter((n) => n?.id) : [];
  if (!who?.id || clean.some((n) => n.id === who.id)) return clean;
  return [...clean, { id: who.id, name: String(who.name ?? "") }];
}

/** Ловушка → данные поведения области (плоские поля схемы). */
export function toBehaviorData(trap, { tier = 1, flavor = "", text = "" } = {}) {
  const t = scaleTrap(trap, tier);
  return {
    trapId: t.id,
    icon: t.icon,
    severity: t.severity,
    magical: t.magical,
    affects: t.affects,
    stops: t.stops,
    detectDC: t.detectDC,
    detectRange: t.detectRange,
    disarmDC: t.disarmDC,
    disarmSkill: t.disarmSkill,
    attackBonus: t.attackBonus,
    saveAbility: t.saveAbility,
    saveDC: t.saveDC,
    onSave: t.onSave,
    damage: t.damage,
    damageType: t.damageType,
    damage2: t.damage2,
    damage2Type: t.damage2 ? t.damage2Type : "",
    condition: t.condition,
    fx: t.fx,
    sound: t.sound,
    rearm: t.rearm,
    device: t.device,
    options: t.options,
    fixedDamage: t.fixedDamage,
    escapeDC: t.escapeDC,
    escapeSkill: t.escapeSkill,
    flavor: flavor || t.flavor,
    notes: text || t.text,
    size: t.size,
    width: t.width,
    height: t.height,
  };
}

/** Данные поведения → ловушка для библиотеки (сохранить расставленную как свою). */
export function fromBehaviorData(system, { id, name, size, width, height, tier = 1 } = {}) {
  // В библиотеке урон хранится для 1–4 уровня: снимаем пересчёт, с которым ловушку ставили.
  const w = width ?? size ?? system.width ?? system.size;
  const h = height ?? size ?? system.height ?? system.size;
  return unscaleTrap({ ...system, id, name, text: system.notes, width: w, height: h }, tier);
}

/** Поиск и фильтр библиотеки. entries: [{ trap, name, text }] */
export function filterTraps(entries, { query = "", severity = "", kind = "", damageType = "" } = {}) {
  const q = str(query).toLowerCase();
  return entries.filter(({ trap, name, text }) => {
    if (severity && trap.severity !== severity) return false;
    if (kind === "magical" && !trap.magical) return false;
    if (kind === "mechanical" && trap.magical) return false;
    if (damageType) {
      // Тип урона без самого урона (сонный газ) не считается; окно передаёт только типы — им верим.
      const first = trap.damage === undefined || trap.damage ? trap.damageType : "";
      const second = trap.damage2 === undefined || trap.damage2 ? trap.damage2Type : "";
      if (first !== damageType && second !== damageType) return false;
    }
    if (!q) return true;
    return `${name} ${text}`.toLowerCase().includes(q);
  });
}

/** Новый id для своей ловушки: custom-<время>-<случайное>. */
export const customId = (now = Date.now(), rnd = Math.random()) => `custom-${now.toString(36)}${Math.floor(rnd * 1296).toString(36).padStart(2, "0")}`;
