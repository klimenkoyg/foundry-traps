import assert from "node:assert/strict";
import { test } from "node:test";
import { CATALOG } from "../scripts/core/catalog.mjs";
import { anyHit, counts, hasEffect, newTarget, nominal, settle, stage, totalDamage, trapSnapshot } from "../scripts/core/resolve.mjs";
import { normalizeTrap } from "../scripts/core/trap.mjs";

const byId = (id) => normalizeTrap((CATALOG.find((e) => (e.trap ?? e).id === id).trap ?? CATALOG.find((e) => (e.trap ?? e).id === id)));
const state = (trap, parts, targets) => ({ trap: trapSnapshot(trap), parts, targets });

test("спасбросок: цель ждёт броска, потом успех — половина, провал — полный урон и состояние", () => {
  const trap = { ...byId("poisonDarts"), attackBonus: null, saveAbility: "con", saveDC: 13, onSave: "half", condition: "poisoned" };
  const parts = [{ value: 7, type: "poison" }, { value: 2, type: "piercing" }];
  let mira = newTarget({ id: "t1", actorId: "a1", name: "Мира" });
  let brom = newTarget({ id: "t2", actorId: "a2", name: "Бром" });
  let s = state(trap, parts, [mira, brom]);
  assert.equal(stage(s, mira), "roll");
  assert.deepEqual(counts(s), { roll: 2, ready: 0, applied: 0, clear: 0 });

  mira = settle(s.trap, mira, { total: 15 }, "player");
  brom = settle(s.trap, brom, { total: 8 }, "module");
  s = { ...s, targets: [mira, brom] };
  assert.equal(totalDamage(parts), 9);
  assert.equal(nominal(s, mira), 4, "половина с округлением вниз");
  assert.equal(nominal(s, brom), 9);
  assert.equal(mira.res.condition, false);
  assert.equal(brom.res.condition, true);
  assert.equal(mira.by, "player");
  assert.deepEqual(counts(s), { roll: 0, ready: 2, applied: 0, clear: 0 });
  assert.equal(anyHit(s), true);

  s.targets[1] = { ...brom, applied: true, dealt: 9, conditioned: true };
  assert.equal(stage(s, s.targets[1]), "applied");
});

test("успех без урона и промах — «обошлось»; без проверки — сразу готово", () => {
  const save = { ...byId("poisonDarts"), attackBonus: null, saveAbility: "dex", saveDC: 13, onSave: "none", condition: "" };
  let s = state(save, [{ value: 5, type: "piercing" }], []);
  const ok = settle(s.trap, newTarget({ id: "t", name: "Мира" }), { total: 20 });
  assert.equal(stage(s, ok), "clear");
  assert.equal(hasEffect(s, ok), false);

  const attack = { ...byId("scythingBlade"), attackBonus: 5 };
  s = state(attack, [{ value: 10, type: "slashing" }], []);
  const miss = settle(s.trap, newTarget({ id: "t", name: "Бром" }), { total: 3, natural: 2, ac: 17 });
  const hit = settle(s.trap, newTarget({ id: "t", name: "Бром" }), { total: 25, natural: 18, ac: 17 });
  assert.equal(stage(s, miss), "clear");
  assert.equal(stage(s, hit), "ready");
  assert.equal(nominal(s, hit), 10);

  // Яма без спасброска (ведущий выбрал «без проверки» в окне настройки).
  const pit = { ...byId("pit"), saveAbility: "", attackBonus: null };
  s = state(pit, [{ value: 6, type: "bludgeoning" }], []);
  assert.equal(s.trap.mode, "auto");
  const fell = settle(s.trap, newTarget({ id: "t", name: "Мира" }));
  assert.equal(stage(s, fell), "ready");
  assert.equal(nominal(s, fell), 6);
});

test("только состояние (сеть): применять есть что, даже без урона", () => {
  const net = { ...byId("fallingNet"), damage: "", damage2: "" };
  const s = state(net, [], []);
  const t = settle(s.trap, newTarget({ id: "t", name: "Мира" }), s.trap.mode === "save" ? { total: 1 } : null);
  assert.equal(hasEffect(s, t), Boolean(s.trap.condition));
});
