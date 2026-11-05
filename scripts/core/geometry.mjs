/* Геометрия сцены без Foundry: куда встаёт ловушка, её рамка, расстояния. */

/**
 * Квадрат ловушки под курсором. Курсор — в центральной клетке (для чётного размера — левее и выше центра).
 * → { x, y, width, height } в пикселях сцены.
 */
export function placementRect(point, size, gridSize) {
  const n = Math.max(1, Math.round(size));
  const col = Math.floor(point.x / gridSize) - Math.floor((n - 1) / 2);
  const row = Math.floor(point.y / gridSize) - Math.floor((n - 1) / 2);
  return { x: col * gridSize, y: row * gridSize, width: n * gridSize, height: n * gridSize };
}

/** Рамка по фигурам области (rectangle, ellipse, circle, polygon) без учёта поворота. */
export function shapesBounds(shapes = []) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const add = (x, y) => {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  };
  for (const s of shapes) {
    if (!s || s.hole) continue;
    switch (s.type) {
      case "rectangle":
        add(s.x, s.y);
        add(s.x + s.width, s.y + s.height);
        break;
      case "ellipse":
        add(s.x - s.radiusX, s.y - s.radiusY);
        add(s.x + s.radiusX, s.y + s.radiusY);
        break;
      case "circle":
        add(s.x - s.radius, s.y - s.radius);
        add(s.x + s.radius, s.y + s.radius);
        break;
      case "polygon":
        for (let i = 0; i + 1 < (s.points?.length ?? 0); i += 2) add(s.points[i], s.points[i + 1]);
        break;
      default:
        break;
    }
  }
  if (minX === Infinity) return null;
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

export const rectCenter = (r) => ({ x: r.x + r.width / 2, y: r.y + r.height / 2 });

export const rectContains = (r, p) => p.x >= r.x && p.x <= r.x + r.width && p.y >= r.y && p.y <= r.y + r.height;

/** Расстояние от точки до прямоугольника (0 — внутри). */
export function distanceToRect(p, r) {
  const dx = Math.max(r.x - p.x, 0, p.x - (r.x + r.width));
  const dy = Math.max(r.y - p.y, 0, p.y - (r.y + r.height));
  return Math.hypot(dx, dy);
}

/** Центр токена: x, y — левый верхний угол, width/height — в клетках. */
export function tokenCenter(token, gridSize) {
  return { x: token.x + ((token.width ?? 1) * gridSize) / 2, y: token.y + ((token.height ?? 1) * gridSize) / 2 };
}

/** Расстояние в футах (единицах сцены) по пикселям. */
export const pixelsToUnits = (px, gridSize, gridDistance) => (px / gridSize) * gridDistance;

/**
 * Точки области, на которые персонаж может посмотреть: центр, углы и середины сторон, чуть внутрь
 * (inset px), чтобы луч не упирался в стену ровно по краю клетки. Видна хоть одна — видна область.
 */
export function sightPoints(r, inset = 2) {
  const k = Math.max(0, Math.min(inset, r.width / 2, r.height / 2));
  const xs = [r.x + k, r.x + r.width / 2, r.x + r.width - k];
  const ys = [r.y + k, r.y + r.height / 2, r.y + r.height - k];
  const points = [{ x: xs[1], y: ys[1] }];
  for (const y of ys) for (const x of xs) if (!(x === xs[1] && y === ys[1])) points.push({ x, y });
  return points;
}
