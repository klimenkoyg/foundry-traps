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
 * @property {boolean} natural        Природная опасность (плесень, слизь, зыбучий песок); не бывает магической
 * @property {boolean} everyTurn      Бьёт ещё и в бою, в начале хода каждого, кто стоит в области
 * @property {boolean} visible        Встаёт на карту уже показанной игрокам (плесень на стене видно и так)
 * @property {string} image           Своя картинка на карте вместо рисунка модуля: путь на сервере или https-ссылка
 * @property {string} jb2a            Анимация JB2A: "" — подобрать к встроенной, "none" — только встроенная, иначе запись Sequencer
 * @property {number} width           Ширина области в клетках
 * @property {number} height          Высота области в клетках
 * @property {number} size            Большая сторона (для старых ловушек — сторона квадрата)
 * @property {"trigger"|"area"} affects  Только наступивший или все в области
 * @property {boolean} stops          Останавливает движение наступившего (яма, капкан, сеть)
 * @property {number} detectDC
 * @property {number} detectRange   С какого расстояния её можно заметить, фт (по клеткам, как линейка)
 * @property {"prc"|"inv"} detectSkill Чем замечают: Внимательность или Анализ (пассивно и при поиске)
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
 * @property {boolean} fixedDamage    Урон не пересчитывается по уровню партии (по умолчанию — да)
 * @property {number} escapeDC        Выбраться (из ямы, капкана, сети): Сл; 0 — не нужно
 * @property {string} escapeSkill     Чем выбираться: навык dnd5e
 * @property {boolean} manual         Срабатывает только по кнопке ведущего
 * @property {number} activators      Сколько триггеров ставить вместе с ловушкой: 0 — ни одного,
 *                                    срабатывает сама область; 1–3 — столько триггеров, их потом
 *                                    расставляет ведущий. Старое activator ("plate"/"wire") — один.
 */

export const SEVERITIES = ["setback", "dangerous", "deadly"];
/** Вид: механизм, магия или природная опасность. */
export const KINDS = ["mechanical", "magical", "natural"];
export const trapKind = (trap) => (trap?.magical ? "magical" : trap?.natural ? "natural" : "mechanical");
/** Чем замечают ловушку: Внимательность (prc) или Анализ (inv) — как пишут в приключениях. */
export const DETECT_SKILLS = ["prc", "inv"];

/** Больше триггеров у одной ловушки не ставим. */
export const MAX_ACTIVATORS = 3;
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
  natural: false,
  everyTurn: false,
  visible: false,
  image: "",
  jb2a: "",
  size: 1,
  affects: "trigger",
  stops: false,
  detectDC: 15,
  detectRange: 10,
  detectSkill: "prc",
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
  // Урон как записан, на любом уровне: так прозрачнее. Рост с уровнем — по желанию, галочкой.
  fixedDamage: true,
  escapeDC: 0,
  escapeSkill: "ath",
  manual: false,
  activators: 0,
};

const int = (v, fallback, min = -Infinity, max = Infinity) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : fallback;
};
const oneOf = (v, list, fallback) => (list.includes(v) ? v : fallback);
const str = (v) => (typeof v === "string" ? v.trim() : "");

/**
 * Своя картинка: путь на сервере Foundry («worlds/…/mold.webp») или ссылка http(s). Картинки внутри
 * данных (data:) не храним — они раздули бы мир; в файле обмена они лежат отдельно (core/share.mjs).
 */
export function imagePath(value) {
  const v = str(value);
  if (!v || v.length > 2000 || /^(data|javascript|blob):/i.test(v) || /[\u0000-\u001f<>"]/.test(v)) return "";
  return v;
}

/** Анимация JB2A: "" (подобрать), "none" (только встроенная) или запись Sequencer «jb2a.…». */
export const jb2aKey = (value) => {
  const v = str(value);
  return v === "none" || /^jb2a\.[\w.-]{1,200}$/.test(v) ? v : "";
};

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
    natural: !t.magical && Boolean(t.natural),
    everyTurn: Boolean(t.everyTurn),
    visible: Boolean(t.visible),
    image: imagePath(t.image),
    jb2a: jb2aKey(t.jb2a),
    width,
    height,
    size: Math.max(width, height),
    affects: oneOf(t.affects, ["trigger", "area"], "trigger"),
    stops: Boolean(t.stops),
    detectDC: int(t.detectDC, DEFAULTS.detectDC, 0, 40),
    detectRange: int(t.detectRange, DEFAULTS.detectRange, 5, 120),
    detectSkill: oneOf(t.detectSkill, DETECT_SKILLS, DEFAULTS.detectSkill),
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
    fixedDamage: t.fixedDamage == null ? DEFAULTS.fixedDamage : Boolean(t.fixedDamage),
    escapeDC: int(t.escapeDC, 0, 0, 40),
    escapeSkill: str(t.escapeSkill) || DEFAULTS.escapeSkill,
    manual: Boolean(t.manual),
    // У ловушек 0.2.4 было activator: "plate" | "wire" — это один триггер.
    activators: int(raw.activators ?? (raw.activator ? 1 : 0), 0, 0, MAX_ACTIVATORS),
  };
}

/**
 * Как срабатывает ловушка: "manual" — только по кнопке ведущего; "activator" — когда наступают
 * на её триггер (count — сколько их на сцене); "area" — когда заходят в саму область.
 */
export function activation({ manual = false } = {}, count = 0) {
  if (manual) return "manual";
  return count > 0 ? "activator" : "area";
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
 * Урон на каждом уровне партии — чтобы в окне настройки было видно, сколько получат персонажи,
 * если урон растёт с уровнем. trap — уже под уровень tier (как в окне): на этом уровне урон как
 * в поле, на остальных — как поставит модуль. → [{ tier, factor, damage, damage2 }]
 */
export function damageByTier(trap, tier = 1) {
  const now = normalizeTrap({ ...trap, fixedDamage: false });
  const base = unscaleTrap(now, tier);
  return TIERS.map((k) => {
    const at = k === tier ? now : scaleTrap(base, k);
    return { tier: k, factor: tierFactor(now.severity, k), damage: at.damage, damage2: at.damage2 };
  });
}

/**
 * Включили или сняли «урон не зависит от уровня» у ловушки под уровень tier: урон в полях
 * переходит между «как записан» и «под уровень». На 1–4 уровне ничего не меняется.
 */
export function withFixedDamage(trap, fixed, tier = 1) {
  const t = normalizeTrap(trap);
  if (t.fixedDamage === Boolean(fixed)) return t;
  const free = { ...t, fixedDamage: false };
  const next = fixed ? unscaleTrap(free, tier) : scaleTrap(free, tier);
  return { ...t, damage: next.damage, damage2: next.damage2, fixedDamage: Boolean(fixed) };
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
/** Кто бросает обезвреживание, когда ведущий жмёт ключ: игрок (карточкой) или ведущий сразу. */
export const DISARM_ROLLS = ["players", "gm"];
/** Свой ключ у игроков на замеченных ловушках: есть или нет. */
export const PLAYER_DISARM = ["on", "off"];

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
    natural: t.natural,
    everyTurn: t.everyTurn,
    visible: t.visible,
    image: t.image,
    jb2a: t.jb2a,
    affects: t.affects,
    stops: t.stops,
    detectDC: t.detectDC,
    detectRange: t.detectRange,
    detectSkill: t.detectSkill,
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
    manual: t.manual,
    activators: t.activators,
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
    if (kind && trapKind(trap) !== kind) return false;
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

/** Заготовка для кнопки «Новая ловушка»: всё заполнено разумно, остаётся назвать и поправить. */
export function blankTrap() {
  return normalizeTrap({
    icon: "fa-solid fa-triangle-exclamation",
    severity: "setback",
    size: 1,
    detectDC: 12,
    disarmDC: 12,
    saveAbility: "dex",
    saveDC: 11,
    onSave: "half",
    damage: "2d6",
    damageType: "piercing",
    fx: "darts",
    sound: "click",
  });
}
