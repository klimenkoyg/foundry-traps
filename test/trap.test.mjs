import assert from "node:assert/strict";
import { test } from "node:test";
import { CATALOG } from "../scripts/core/catalog.mjs";
import {
  filterTraps,
  fromBehaviorData,
  isFormula,
  normalizeTrap,
  resolveDisarm,
  resolveTarget,
  scaleFormula,
  scaleTrap,
  tierFactor,
  activation,
  MAX_ACTIVATORS,
  toBehaviorData,
  trapMode,
} from "../scripts/core/trap.mjs";
import { FX_PRESETS, SOUND_NAMES } from "../scripts/core/fx/presets.mjs";

test("каталог: уникальные id, корректные данные, известные анимации и звуки", () => {
  const ids = new Set();
  for (const raw of CATALOG) {
    assert.ok(!ids.has(raw.id), `повтор id ${raw.id}`);
    ids.add(raw.id);
    const t = normalizeTrap(raw);
    for (const key of Object.keys(raw)) assert.deepEqual(t[key], raw[key], `${raw.id}.${key} изменился при нормализации`);
    assert.ok(t.fx in FX_PRESETS, `${raw.id}: нет анимации ${t.fx}`);
    assert.ok(SOUND_NAMES.includes(t.sound), `${raw.id}: нет звука ${t.sound}`);
    if (raw.damage) assert.ok(isFormula(raw.damage));
  }
  assert.ok(CATALOG.length >= 15);
});

test("нормализация: мусор → значения по умолчанию, атака отменяет спасбросок", () => {
  const t = normalizeTrap({ severity: "nope", size: 99, detectDC: "abc", damage: "rm -rf", attackBonus: "5", saveAbility: "dex" });
  assert.equal(t.severity, "dangerous");
  assert.equal(t.size, 12);
  assert.equal(t.detectDC, 15);
  assert.equal(t.damage, "");
  assert.equal(t.attackBonus, 5);
  assert.equal(t.saveAbility, "");
  assert.equal(trapMode(t), "attack");
  assert.equal(trapMode(normalizeTrap({ saveAbility: "con" })), "save");
  assert.equal(trapMode(normalizeTrap({})), "auto");
});

test("формулы", () => {
  assert.ok(isFormula("2d6"));
  assert.ok(isFormula("1d4 + 2d10 - 1"));
  assert.ok(isFormula("d8"));
  assert.ok(!isFormula("2d6; alert(1)"));
  assert.ok(!isFormula(""));
});

test("пересчёт урона по уровню (SRD)", () => {
  assert.equal(tierFactor("dangerous", 1), 1);
  assert.equal(tierFactor("dangerous", 2), 2);
  assert.equal(tierFactor("deadly", 4), 6);
  assert.equal(tierFactor("setback", 4), 10);
  assert.equal(scaleFormula("2d10", 2), "4d10");
  assert.equal(scaleFormula("1d4+2", 9), "9d4+2");
  assert.equal(scaleFormula("d6", 3), "3d6");
  assert.equal(scaleFormula("2d10", 0.5), "1d10");
  const t = scaleTrap({ severity: "dangerous", damage: "2d10", damage2: "1d6", fixedDamage: false }, 3);
  assert.equal(t.damage, "10d10");
  assert.equal(t.damage2, "5d6");
});

test("исход: спасбросок", () => {
  const trap = normalizeTrap({ saveAbility: "dex", saveDC: 13, onSave: "half", condition: "prone" });
  assert.deepEqual(resolveTarget(trap, { save: { total: 13 } }), { mode: "save", success: true, multiplier: 0.5, condition: false });
  assert.deepEqual(resolveTarget(trap, { save: { total: 12 } }), { mode: "save", success: false, multiplier: 1, condition: true });
  const none = normalizeTrap({ saveAbility: "dex", saveDC: 13, onSave: "none" });
  assert.equal(resolveTarget(none, { save: { total: 20 } }).multiplier, 0);
});

test("исход: атака, естественные 1 и 20", () => {
  const trap = normalizeTrap({ attackBonus: 6 });
  assert.equal(resolveTarget(trap, { attack: { total: 15, natural: 9, ac: 15 } }).hit, true);
  assert.equal(resolveTarget(trap, { attack: { total: 14, natural: 8, ac: 15 } }).hit, false);
  assert.equal(resolveTarget(trap, { attack: { total: 26, natural: 20, ac: 30 } }).hit, true);
  assert.equal(resolveTarget(trap, { attack: { total: 7, natural: 1, ac: 5 } }).hit, false);
});

test("обезвреживание: провал на 5 и больше — срабатывает", () => {
  assert.equal(resolveDisarm(15, 15), "success");
  assert.equal(resolveDisarm(11, 15), "fail");
  assert.equal(resolveDisarm(10, 15), "triggered");
});

test("в поведение и обратно: урон снимается до 1–4 уровня", () => {
  const raw = { ...CATALOG.find((x) => x.id === "fireJet"), fixedDamage: false };
  const system = toBehaviorData(raw, { tier: 2, flavor: "Пламя!" });
  assert.equal(system.damage, "4d10");
  assert.equal(system.flavor, "Пламя!");
  assert.equal(system.trapId, "fireJet");
  const back = fromBehaviorData(system, { id: "custom-1", name: "Моя струя", size: 1, tier: 2 });
  assert.equal(back.damage, "2d10");
  assert.equal(back.name, "Моя струя");
  assert.equal(back.id, "custom-1");
});

test("фильтр библиотеки", () => {
  const entries = CATALOG.map((raw) => ({ trap: normalizeTrap(raw), name: raw.id, text: "" }));
  assert.ok(filterTraps(entries, { kind: "magical" }).every((e) => e.trap.magical));
  assert.ok(filterTraps(entries, { severity: "deadly" }).every((e) => e.trap.severity === "deadly"));
  assert.deepEqual(filterTraps(entries, { damageType: "poison" }).map((e) => e.trap.id).sort(), ["poisonDarts", "poisonGas", "toxicFumes", "yellowMold"]);
  // Вид: механические, магические и природные не пересекаются.
  const natural = filterTraps(entries, { kind: "natural" }).map((e) => e.trap.id);
  assert.deepEqual(natural.sort(), ["brownMold", "greenSlime", "quicksand", "razorvine", "toxicFumes", "yellowMold"]);
  assert.ok(filterTraps(entries, { kind: "mechanical" }).every((e) => !e.trap.magical && !e.trap.natural));
  const all = ["mechanical", "magical", "natural"].flatMap((kind) => filterTraps(entries, { kind }));
  assert.equal(all.length, entries.length, "каждая ловушка ровно одного вида");
  assert.deepEqual(filterTraps(entries, { query: "PIT" }).map((e) => e.trap.id), ["pit", "spikedPit"]);
});

test("кто заметил ловушку: каждый персонаж учитывается один раз", async () => {
  const { DETECT_MODES, addNoticer, knowsTrap } = await import("../scripts/core/trap.mjs");
  assert.deepEqual(DETECT_MODES, ["gm", "reveal"], "по умолчанию — сообщить ведущему");
  let list = addNoticer([], { id: "mira", name: "Мира" });
  list = addNoticer(list, { id: "mira", name: "Мира" });
  list = addNoticer(list, { id: "brom", name: "Бром" });
  assert.deepEqual(list, [{ id: "mira", name: "Мира" }, { id: "brom", name: "Бром" }]);
  assert.deepEqual(addNoticer(null, { id: "x", name: 5 }), [{ id: "x", name: "5" }]);
  assert.deepEqual(addNoticer([{ name: "без id" }], {}), [], "мусор отбрасывается");
  assert.equal(knowsTrap({ noticedBy: list }, "mira"), true);
  assert.equal(knowsTrap({ noticedBy: list }, "goblin"), false);
  assert.equal(knowsTrap({ revealed: true }, "goblin"), true, "показанную видят все");
  assert.equal(knowsTrap({ noticedBy: "не список" }, "mira"), false);
});

test("ширина и высота ловушки: старый size — квадрат, туда и обратно через поведение", async () => {
  const { fromBehaviorData, normalizeTrap, toBehaviorData } = await import("../scripts/core/trap.mjs");
  const sq = normalizeTrap({ size: 3 });
  assert.deepEqual([sq.width, sq.height, sq.size], [3, 3, 3]);
  const corridor = normalizeTrap({ width: 1, height: 4 });
  assert.deepEqual([corridor.width, corridor.height, corridor.size], [1, 4, 4]);
  assert.deepEqual([normalizeTrap({ width: 0, height: 99 }).width, normalizeTrap({ width: 0, height: 99 }).height], [1, 12]);
  const sys = toBehaviorData(corridor);
  assert.deepEqual([sys.width, sys.height], [1, 4]);
  const back = fromBehaviorData(sys, { width: 4, height: 1 });
  assert.deepEqual([back.width, back.height], [4, 1], "размер берётся с области на сцене");
  const old = fromBehaviorData({ ...sys, width: undefined, height: undefined, size: 2 });
  assert.deepEqual([old.width, old.height], [2, 2], "старая ловушка без ширины — квадрат");
});

test("срабатывание: вручную, от триггера или от самой области; предустановки каталога", () => {
  assert.equal(activation({ manual: true }, 3), "manual");
  assert.equal(activation({ manual: false }, 2), "activator");
  assert.equal(activation({ manual: false }, 0), "area");
  const clean = normalizeTrap({ activators: 9, manual: "yes" });
  assert.equal(clean.activators, MAX_ACTIVATORS);
  assert.equal(clean.manual, true);
  assert.equal(normalizeTrap({}).manual, false);
  assert.equal(normalizeTrap({}).activators, 0);
  assert.equal(normalizeTrap({ activators: -1 }).activators, 0);
  // Ловушки 0.2.4: «плита» или «растяжка» — это один триггер.
  assert.equal(normalizeTrap({ activator: "wire" }).activators, 1);
  assert.equal(normalizeTrap({ activator: "" }).activators, 0);
  const byId = Object.fromEntries(CATALOG.map((e) => [e.id, normalizeTrap(e)]));
  for (const id of ["arrowVolley", "fallingNet", "collapsingRoof", "rollingBoulder", "poisonGas", "sleepGas"]) assert.equal(byId[id].activators, 1, id);
  assert.equal(byId.pit.activators, 0);
  assert.equal(byId.fireJet.activators, 0);
  // В поведение области и обратно.
  const system = toBehaviorData({ ...byId.arrowVolley, activators: 2, manual: true });
  assert.equal(system.activators, 2);
  assert.equal(system.manual, true);
  assert.equal(fromBehaviorData(system, { id: "x" }).activators, 2);
});

test("чем заметить: Внимательность по умолчанию, Анализ по выбору, в поведение и обратно", () => {
  assert.equal(normalizeTrap({}).detectSkill, "prc");
  assert.equal(normalizeTrap({ detectSkill: "inv" }).detectSkill, "inv");
  assert.equal(normalizeTrap({ detectSkill: "ath" }).detectSkill, "prc");
  const system = toBehaviorData({ ...CATALOG[0], detectSkill: "inv" });
  assert.equal(system.detectSkill, "inv");
  assert.equal(fromBehaviorData(system, { id: "x" }).detectSkill, "inv");
});

test("природная опасность и «каждый ход»: нормализация, в поведение и обратно", async () => {
  const { blankTrap, trapKind } = await import("../scripts/core/trap.mjs");
  assert.equal(normalizeTrap({}).natural, false);
  assert.equal(normalizeTrap({}).everyTurn, false);
  assert.equal(normalizeTrap({ natural: 1, everyTurn: "yes" }).natural, true);
  assert.equal(normalizeTrap({ natural: true, everyTurn: true }).everyTurn, true);
  // Магическая не бывает природной: магия важнее.
  const both = normalizeTrap({ magical: true, natural: true });
  assert.equal(both.natural, false);
  assert.equal(trapKind(both), "magical");
  assert.equal(trapKind(normalizeTrap({ natural: true })), "natural");
  assert.equal(trapKind(normalizeTrap({})), "mechanical");
  const system = toBehaviorData(normalizeTrap({ natural: true, everyTurn: true }));
  assert.equal(system.natural, true);
  assert.equal(system.everyTurn, true);
  const back = fromBehaviorData(system, { id: "x" });
  assert.equal(normalizeTrap(back).natural, true);
  assert.equal(normalizeTrap(back).everyTurn, true);
  // Заготовка для «Новая ловушка».
  const trap = blankTrap();
  assert.equal(trapKind(trap), "mechanical");
  assert.equal(trap.everyTurn, false);
  assert.ok(isFormula(trap.damage));
  assert.equal(trapMode(trap), "save");
});

test("видна сразу, своя картинка, анимация JB2A: нормализация, в поведение и обратно", async () => {
  const { imagePath, jb2aKey } = await import("../scripts/core/trap.mjs");
  const t = normalizeTrap({ visible: 1, image: " worlds/w/mold.webp ", jb2a: "jb2a.fog_cloud.02.green" });
  assert.equal(t.visible, true);
  assert.equal(t.image, "worlds/w/mold.webp");
  assert.equal(t.jb2a, "jb2a.fog_cloud.02.green");
  assert.equal(normalizeTrap({}).visible, false);
  // Картинка: путь или https; данные внутри, скрипты и разметка — нет.
  assert.equal(imagePath("https://example.com/a.png"), "https://example.com/a.png");
  for (const bad of ["data:image/png;base64,AAA", "javascript:alert(1)", "blob:x", 'a"><img', "a\nb", "x".repeat(2001)]) assert.equal(imagePath(bad), "", bad);
  // JB2A: "" — подобрать, "none" — только своя, иначе запись jb2a.…
  assert.equal(jb2aKey("none"), "none");
  assert.equal(jb2aKey("jb2a.explosion.01.orange"), "jb2a.explosion.01.orange");
  for (const bad of ["fire", "jb2a.", "jb2a.a b", "modules/x.webm"]) assert.equal(jb2aKey(bad), "", bad);
  const system = toBehaviorData(t);
  assert.equal(system.visible, true);
  assert.equal(system.image, "worlds/w/mold.webp");
  assert.equal(system.jb2a, "jb2a.fog_cloud.02.green");
  const back = normalizeTrap(fromBehaviorData(system, { id: "x" }));
  assert.equal(back.visible, true);
  assert.equal(back.image, "worlds/w/mold.webp");
  assert.equal(back.jb2a, "jb2a.fog_cloud.02.green");
  // Природные опасности, которые видно и так, встают показанными.
  const byId = Object.fromEntries(CATALOG.map((e) => [e.id, normalizeTrap(e)]));
  assert.equal(byId.brownMold.visible, true);
  assert.equal(byId.quicksand.visible, false);
  assert.equal(byId.pit.visible, false);
});

