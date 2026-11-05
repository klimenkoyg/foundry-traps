import assert from "node:assert/strict";
import { test } from "node:test";
import { distanceToRect, placementRect, rectCenter, shapesBounds, tokenCenter } from "../scripts/core/geometry.mjs";

test("ловушка встаёт под курсор по клеткам", () => {
  assert.deepEqual(placementRect({ x: 250, y: 130 }, 1, 100), { x: 200, y: 100, width: 100, height: 100 });
  assert.deepEqual(placementRect({ x: 250, y: 130 }, 3, 100), { x: 100, y: 0, width: 300, height: 300 });
  assert.deepEqual(placementRect({ x: 250, y: 130 }, 2, 100), { x: 200, y: 100, width: 200, height: 200 });
});

test("рамка фигур области", () => {
  assert.deepEqual(shapesBounds([{ type: "rectangle", x: 100, y: 50, width: 200, height: 100 }]), { x: 100, y: 50, width: 200, height: 100 });
  assert.deepEqual(shapesBounds([{ type: "circle", x: 100, y: 100, radius: 50 }, { type: "polygon", points: [0, 0, 300, 20] }]), { x: 0, y: 0, width: 300, height: 150 });
  assert.equal(shapesBounds([]), null);
  assert.equal(shapesBounds([{ type: "rectangle", x: 0, y: 0, width: 10, height: 10, hole: true }]), null);
});

test("расстояния и центры", () => {
  const r = { x: 100, y: 100, width: 100, height: 100 };
  assert.equal(distanceToRect({ x: 150, y: 150 }, r), 0);
  assert.equal(distanceToRect({ x: 50, y: 150 }, r), 50);
  assert.equal(distanceToRect({ x: 230, y: 240 }, r), 50);
  assert.deepEqual(rectCenter(r), { x: 150, y: 150 });
  assert.deepEqual(tokenCenter({ x: 200, y: 300, width: 2, height: 1 }, 100), { x: 300, y: 350 });
});

test("точки взгляда: центр первым, затем углы и середины сторон внутри области", async () => {
  const { sightPoints } = await import("../scripts/core/geometry.mjs");
  const r = { x: 100, y: 200, width: 100, height: 100 };
  const pts = sightPoints(r, 5);
  assert.equal(pts.length, 9);
  assert.deepEqual(pts[0], { x: 150, y: 250 });
  for (const p of pts) {
    assert.ok(p.x >= 105 && p.x <= 195 && p.y >= 205 && p.y <= 295, JSON.stringify(p));
  }
  // Узкая область: отступ не выводит точки за край.
  for (const p of sightPoints({ x: 0, y: 0, width: 4, height: 4 }, 10)) assert.ok(p.x >= 0 && p.x <= 4 && p.y >= 0 && p.y <= 4);
});

test("расстояние до ловушки по клеткам, как линейка: 10 фт — через одну пустую клетку, и по диагонали тоже", async () => {
  const { chebyshevCells, nearestCellCenters, rangeCells } = await import("../scripts/core/geometry.mjs");
  const G = 100;
  const cells = (tok, trap) => {
    const [p, q] = nearestCellCenters(tok, trap, G);
    return chebyshevCells(p, q, G);
  };
  const tok = (c, r, n = 1) => ({ x: c * G, y: r * G, width: n * G, height: n * G });
  const trap = tok(5, 5);
  assert.equal(cells(tok(4, 5), trap), 1, "соседняя клетка — 5 фт");
  assert.equal(cells(tok(3, 5), trap), 2, "через одну пустую — 10 фт");
  assert.equal(cells(tok(2, 5), trap), 3, "через две — 15 фт");
  assert.equal(cells(tok(3, 3), trap), 2, "по диагонали через одну — 10 фт");
  assert.equal(cells(tok(5, 5), trap), 0, "стоит в ловушке");
  assert.equal(cells(tok(2, 4, 2), trap), 2, "большой токен 2×2 меряется от своего края");
  assert.equal(cells(tok(4, 1), { x: 3 * G, y: 4 * G, width: 3 * G, height: 3 * G }), 3, "до большой области — от её края");
  assert.equal(rangeCells(10), 2);
  assert.equal(rangeCells(5), 1);
  assert.equal(rangeCells("x"), 0);
});

test("прямоугольная ловушка под курсором: ширина и высота отдельно", async () => {
  const { placementRect, rectCells } = await import("../scripts/core/geometry.mjs");
  const G = 100;
  assert.deepEqual(placementRect({ x: 450, y: 450 }, 1, G, 3), { x: 400, y: 300, width: 100, height: 300 });
  assert.deepEqual(placementRect({ x: 450, y: 450 }, 3, G, 1), { x: 300, y: 400, width: 300, height: 100 });
  assert.deepEqual(placementRect({ x: 450, y: 450 }, 2, G), { x: 400, y: 400, width: 200, height: 200 }, "без высоты — квадрат");
  assert.deepEqual(rectCells({ x: 0, y: 0, width: 100, height: 400 }, G), { width: 1, height: 4 });
  assert.deepEqual(rectCells({ x: 0, y: 0, width: 10, height: 10 }, G), { width: 1, height: 1 }, "не меньше клетки");
});
