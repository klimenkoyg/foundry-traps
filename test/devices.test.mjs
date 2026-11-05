import assert from "node:assert/strict";
import { test } from "node:test";
import { CATALOG } from "../scripts/core/catalog.mjs";
import { DEVICES, deriveDevice, deviceFields, normalizeOptions, normalizeParam } from "../scripts/core/devices.mjs";
import {
  damageByTier,
  fromBehaviorData,
  normalizeTrap,
  scaleTrap,
  toBehaviorData,
  unscaleTrap,
  withDevice,
  withFixedDamage,
} from "../scripts/core/trap.mjs";
import { FX_PRESETS, SOUND_NAMES } from "../scripts/core/fx/presets.mjs";

test("у каждой встроенной ловушки есть устройство, и его числа совпадают с описанием", () => {
  for (const raw of CATALOG) {
    assert.ok(raw.device in DEVICES, `${raw.id}: нет устройства`);
    assert.deepEqual(normalizeOptions(raw.device, raw.options), raw.options, `${raw.id}: параметры не в норме`);
    const plain = normalizeTrap(raw);
    const derived = normalizeTrap({ ...raw, ...deriveDevice(raw.device, raw.options) });
    assert.deepEqual(derived, plain, `${raw.id}: устройство даёт другие числа`);
  }
});

test("любые значения параметров дают корректную ловушку", () => {
  for (const [name, def] of Object.entries(DEVICES)) {
    for (const p of def.params) {
      const values = p.type === "choice" ? p.options : p.type === "toggle" ? [false, true] : [p.min, p.max];
      for (const v of values) {
        const trap = normalizeTrap({ device: name, options: { [p.key]: v }, ...deriveDevice(name, { [p.key]: v }) });
        assert.equal(trap.options[p.key], v, `${name}.${p.key}=${v}`);
        assert.ok(trap.fx in FX_PRESETS, `${name}: анимация ${trap.fx}`);
        if (trap.sound) assert.ok(SOUND_NAMES.includes(trap.sound), `${name}: звук ${trap.sound}`);
      }
      assert.ok(p.fields.length, `${name}.${p.key}: не сказано, что задаёт`);
    }
  }
});

test("параметры: мусор → допустимые значения", () => {
  const depth = DEVICES.pit.params[0];
  assert.equal(normalizeParam(depth, 37), 40);
  assert.equal(normalizeParam(depth, 999), 200);
  assert.equal(normalizeParam(depth, "abc"), 10);
  assert.equal(normalizeParam(DEVICES.pit.params[1], "lava"), "stakes");
  assert.equal(normalizeParam(DEVICES.roof.params[1], "true"), true);
  assert.deepEqual(normalizeOptions("nope", { a: 1 }), {});
  assert.equal(normalizeTrap({ device: "nope" }).device, "");
  assert.deepEqual(normalizeOptions("rune", { power: "strong", base: "3d8", junk: 1 }), { power: "strong", base: "3d8" });
});

test("глубина ямы: 1d6 за 10 фт, не больше 20d6, от уровня не зависит", () => {
  assert.equal(deriveDevice("pit", { depth: 30 }).damage, "3d6");
  assert.equal(deriveDevice("pit", { depth: 200 }).damage, "20d6");
  const deep = withDevice(scaleTrap(CATALOG.find((x) => x.id === "pit"), 3), { depth: 60 }, 3);
  assert.equal(deep.damage, "6d6");
  assert.equal(scaleTrap(deep, 4).damage, "6d6");
  assert.equal(deep.escapeDC, 15);
  const slick = withDevice(deep, { walls: "slick", spikes: "poisoned" }, 3);
  assert.equal(slick.escapeDC, 20);
  assert.equal(slick.damage2, "2d6");
  assert.equal(slick.damage2Type, "piercing");
  assert.equal(slick.condition, "poisoned");
  assert.equal(slick.fx, "spikes");
});

test("параметры меняют только свои поля и учитывают уровень партии", () => {
  const gas = scaleTrap({ ...CATALOG.find((x) => x.id === "poisonGas"), fixedDamage: false }, 2);
  assert.equal(gas.damage, "4d10");
  const custom = { ...gas, detectDC: 19, name: "Склеп" };
  const thick = withDevice(custom, { density: "thick" }, 2);
  assert.equal(thick.saveDC, 15);
  assert.equal(thick.detectDC, 19);
  assert.equal(thick.name, "Склеп");
  assert.equal(thick.damage, "4d10");
  const sleep = withDevice(thick, { toxin: "sleep" }, 2);
  assert.equal(sleep.damage, "");
  assert.equal(sleep.condition, "unconscious");
  assert.equal(sleep.onSave, "none");
  assert.equal(sleep.fx, "sleep");
  assert.equal(sleep.options.density, "thick");
});

test("руна: сила считается от урона из описания", () => {
  const rune = CATALOG.find((x) => x.id === "lightningRune");
  assert.equal(withDevice(rune, { power: "weak" }).damage, "2d8");
  assert.equal(withDevice(rune, { power: "strong" }).damage, "5d8");
  assert.equal(withDevice(rune, { power: "devastating" }).damage, "6d8");
  assert.equal(withDevice(withDevice(rune, { power: "weak" }), { power: "normal" }).damage, "3d8");
});

test("устройство и параметры доезжают до поведения области и обратно в библиотеку", () => {
  const pit = withDevice(CATALOG.find((x) => x.id === "pit"), { depth: 50, walls: "rough" });
  const system = toBehaviorData(pit, { tier: 3 });
  assert.equal(system.device, "pit");
  assert.deepEqual(system.options, { depth: 50, spikes: "none", walls: "rough" });
  assert.equal(system.damage, "5d6");
  assert.equal(system.escapeDC, 10);
  const back = fromBehaviorData(system, { id: "custom-x", name: "Колодец", tier: 3 });
  assert.equal(back.damage, "5d6");
  assert.equal(back.options.depth, 50);

  const dart = scaleTrap({ ...CATALOG.find((x) => x.id === "poisonDarts"), fixedDamage: false }, 2);
  assert.equal(dart.damage, "2d4");
  assert.equal(unscaleTrap(dart, 2).damage, "1d4");
});

test("по умолчанию урон не зависит от уровня партии", () => {
  const dart = CATALOG.find((x) => x.id === "poisonDarts");
  assert.equal(normalizeTrap(dart).fixedDamage, true);
  assert.equal(scaleTrap(dart, 3).damage, "1d4");
  assert.equal(scaleTrap(dart, 3).damage2, "2d6");
  // Сохранённые раньше ловушки со снятой галочкой продолжают расти с уровнем.
  assert.equal(normalizeTrap({ ...dart, fixedDamage: false }).fixedDamage, false);
  assert.equal(scaleTrap({ ...dart, fixedDamage: false }, 3).damage, "5d4");
});

test("урон по уровням для окна настройки: текущий — как в поле, остальные — как поставит модуль", () => {
  const dart = scaleTrap({ ...CATALOG.find((x) => x.id === "poisonDarts"), fixedDamage: false }, 2);
  const rows = damageByTier(dart, 2);
  assert.deepEqual(
    rows.map((r) => [r.tier, r.factor, r.damage, r.damage2]),
    [
      [1, 1, "1d4", "2d6"],
      [2, 2, "2d4", "4d6"],
      [3, 5, "5d4", "10d6"],
      [4, 9, "9d4", "18d6"],
    ],
  );
  // Поле поправили руками: на текущем уровне — ровно оно.
  assert.equal(damageByTier({ ...dart, damage: "3d4" }, 2)[1].damage, "3d4");
});

test("галочка «не зависит от уровня»: урон в полях переходит между «как записан» и «под уровень»", () => {
  const dart = scaleTrap(CATALOG.find((x) => x.id === "poisonDarts"), 3);
  assert.equal(dart.damage, "1d4");
  const grows = withFixedDamage(dart, false, 3);
  assert.equal(grows.fixedDamage, false);
  assert.equal(grows.damage, "5d4");
  assert.equal(grows.damage2, "10d6");
  const back = withFixedDamage(grows, true, 3);
  assert.equal(back.fixedDamage, true);
  assert.equal(back.damage, "1d4");
  assert.equal(back.damage2, "2d6");
  // На 1–4 уровне кубики не меняются.
  assert.equal(withFixedDamage(scaleTrap(dart, 1), false, 1).damage, "1d4");
});

test("поля устройства известны заранее", () => {
  assert.ok(deviceFields("pit").includes("escapeDC"));
  assert.ok(deviceFields("jet").includes("affects"));
  assert.deepEqual(deviceFields("nope"), []);
});
