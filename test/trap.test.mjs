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
  assert.deepEqual(filterTraps(entries, { damageType: "poison" }).map((e) => e.trap.id).sort(), ["poisonDarts", "poisonGas"]);
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
