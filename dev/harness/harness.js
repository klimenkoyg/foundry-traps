/* Стенд «Западни»: настоящий модуль поверх имитации Foundry. Карта, токены, чат, звук. */

const $ = (s) => document.querySelector(s);
const { scene, actors, controlled, sprites, primary, GRID, reset, testCollision } = window.__mock;
const COLS = 14;
const ROWS = 9;

function toast(level, message) {
  const el = document.createElement("div");
  el.className = `toast ${level}`;
  el.textContent = message;
  $("#toasts").append(el);
  setTimeout(() => el.remove(), 4000);
}

function chat(data) {
  const el = document.createElement("div");
  el.className = "msg";
  const whisper = data.whisper?.length ? ' <span class="whisper">шёпот</span>' : "";
  el.innerHTML = `<header>${data.speaker?.alias ?? ""}${whisper}</header>${data.content ?? ""}`;
  $("#chat-log").prepend(el);
  // Как Foundry: модули дорисовывают сообщение в хуке.
  Hooks.callAll("renderChatMessageHTML", data, el);
}

function renderParty() {
  $("#party").innerHTML = Object.values(actors)
    .map((a) => {
      const hp = a.system.attributes.hp;
      const st = [...a.statuses].map((s) => CONFIG.statusEffects.find((x) => x.id === s)?.name ?? s).join(", ");
      return `<div><span>${a.name}</span><b>${hp.value}/${hp.max}</b>${st ? `<small>${st}</small>` : ""}</div>`;
    })
    .join("");
}

window.__harness = { toast, chat, onWorldChange: renderParty };

game.i18n.translations = await (await fetch(`/lang/${game.i18n.lang}.json`, { cache: "no-store" })).json();
await import("/scripts/main.mjs");
Hooks.callAll("init");
Hooks.callAll("ready");
Hooks.callAll("canvasReady", canvas);
renderParty();

const api = game.modules.get("ssl_traps").api;

/* ---------- карта ---------- */
const map = $("#map");
const ctx = map.getContext("2d");
map.width = COLS * GRID;
map.height = ROWS * GRID;

const floor = document.createElement("canvas");
floor.width = map.width;
floor.height = map.height;
(() => {
  const f = floor.getContext("2d");
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  f.fillStyle = "#2f2a25";
  f.fillRect(0, 0, floor.width, floor.height);
  for (let y = 0; y < ROWS; y++) {
    for (let x = 0; x < COLS; x++) {
      const v = 52 + rnd() * 14;
      f.fillStyle = `rgb(${v + 8},${v + 3},${v - 3})`;
      f.fillRect(x * GRID + 2, y * GRID + 2, GRID - 4, GRID - 4);
    }
  }
  f.strokeStyle = "rgba(0,0,0,0.5)";
  for (let i = 0; i <= COLS; i++) f.strokeRect(i * GRID, 0, 0.5, floor.height);
  for (let i = 0; i <= ROWS; i++) f.strokeRect(0, i * GRID, floor.width, 0.5);
})();

const images = new Map();
function img(src) {
  if (!images.has(src)) {
    const im = new Image();
    im.src = src;
    images.set(src, im);
  }
  return images.get(src);
}

/* ---------- стены, зрение, туман ---------- */
/** Дальность зрения токенов игроков, клеток (комнаты освещены). */
const VISION = 9;
const explored = new Set();
const center = (tk) => ({ x: tk.x + GRID / 2, y: tk.y + GRID / 2 });
const partyTokens = () => scene._tokens.filter((tk) => tk.actor?.hasPlayerOwner);

/** Видит ли отряд точку: в пределах зрения и без стены между. Глазами ведущего видно всё. */
function partySees(p) {
  return partyTokens().some((tk) => {
    const o = center(tk);
    return Math.hypot(p.x - o.x, p.y - o.y) <= VISION * GRID && !testCollision(o, p);
  });
}
function isVisiblePoint(p) {
  return !window.__mock.playerView || partySees(p);
}
window.__harness.isVisiblePoint = isVisiblePoint;

/** Клетка видна, если отряд видит её центр или угол (чуть внутрь). */
function cellSeen(c, r) {
  const k = GRID * 0.12;
  const pts = [[0.5, 0.5], [0, 0], [1, 0], [0, 1], [1, 1]].map(([u, v]) => ({ x: (c + u) * GRID + (u === 0 ? k : u === 1 ? -k : 0), y: (r + v) * GRID + (v === 0 ? k : v === 1 ? -k : 0) }));
  return pts.some(partySees);
}

function drawWalls() {
  for (const w of scene.walls) {
    const [x1, y1, x2, y2] = w.c;
    ctx.save();
    ctx.lineCap = "square";
    if (w.door) {
      if (w.ds === 1) {
        // Открытая дверь: створка повёрнута на петле.
        ctx.strokeStyle = "#7a5634";
        ctx.lineWidth = 8;
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x1 + (y2 - y1) * 0.8, y1 + (y2 - y1) * 0.35);
        ctx.stroke();
      } else {
        ctx.fillStyle = "#6b4a2b";
        ctx.strokeStyle = "#2a1c10";
        ctx.lineWidth = 2;
        ctx.fillRect(x1 - 7, y1 + 3, 14, y2 - y1 - 6);
        ctx.strokeRect(x1 - 7, y1 + 3, 14, y2 - y1 - 6);
        ctx.fillStyle = "#d9b26a";
        ctx.beginPath();
        ctx.arc(x1 + 3, (y1 + y2) / 2, 2.5, 0, Math.PI * 2);
        ctx.fill();
      }
    } else {
      ctx.strokeStyle = "#17120e";
      ctx.lineWidth = 16;
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
      ctx.strokeStyle = "rgba(160,140,112,0.35)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(x1 - 7, y1);
      ctx.lineTo(x2 - 7, y2);
      ctx.stroke();
    }
    ctx.restore();
  }
}

function drawSprite(s) {
  const el = s.texture.el;
  ctx.globalAlpha = s.alpha ?? 1;
  ctx.drawImage(el, s.position.x, s.position.y, el.width * s.scale.x, el.height * s.scale.y);
  ctx.globalAlpha = 1;
}

function draw() {
  const player = window.__mock.playerView;
  const seen = new Set();
  for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) if (cellSeen(c, r)) seen.add(`${c},${r}`);
  for (const key of seen) explored.add(key);
  ctx.clearRect(0, 0, map.width, map.height);
  ctx.drawImage(floor, 0, 0);
  drawWalls();
  // Области — как их рисует Foundry: ведущему (и всем, если «видна всем»), заливкой цвета области.
  for (const region of scene._regions) {
    if (window.__mock.playerView && region.visibility !== 2) continue;
    const b = region.bounds;
    ctx.save();
    ctx.globalAlpha = 0.2;
    ctx.fillStyle = region.color;
    ctx.fillRect(b.x, b.y, b.width, b.height);
    ctx.globalAlpha = 0.7;
    ctx.strokeStyle = region.color;
    ctx.lineWidth = 2;
    ctx.strokeRect(b.x + 1, b.y + 1, b.width - 2, b.height - 2);
    if (!window.__mock.playerView) {
      ctx.globalAlpha = 0.85;
      ctx.fillStyle = "#fff";
      ctx.font = "600 15px system-ui";
      ctx.fillText(region.name, b.x + 8, b.y + b.height - 10);
    }
    ctx.restore();
  }
  // Уровень карты: метки (под токенами) — их закрывает туман, как пол.
  const onMap = [...primary].sort((a, b) => a.elevation - b.elevation || a.sortLayer - b.sortLayer || a.sort - b.sort);
  const tokensLayer = canvas.primary.constructor.SORT_LAYERS.TOKENS;
  for (const s of onMap) if (s.sortLayer < tokensLayer) drawSprite(s);
  for (const tk of scene._tokens) {
    // Глазами игрока чужие токены видно, только если отряд их видит.
    if (player && !tk.actor?.hasPlayerOwner && !partySees(center(tk))) continue;
    const cx = tk.x + GRID / 2;
    const cy = tk.y + GRID / 2;
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, GRID * 0.4, 0, Math.PI * 2);
    ctx.clip();
    ctx.drawImage(img(tk.texture.src), cx - GRID * 0.4, cy - GRID * 0.4, GRID * 0.8, GRID * 0.8);
    ctx.restore();
    ctx.lineWidth = 4;
    ctx.strokeStyle = controlled.has(tk.id) ? "#ffb02e" : "rgba(0,0,0,0.6)";
    ctx.beginPath();
    ctx.arc(cx, cy, GRID * 0.4, 0, Math.PI * 2);
    ctx.stroke();
  }
  for (const s of onMap) if (s.sortLayer >= tokensLayer) drawSprite(s);
  // Туман войны (глазами игрока): неразведанное — черно, разведанное, но не видимое — затемнено.
  if (player) {
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const key = `${c},${r}`;
        if (seen.has(key)) continue;
        ctx.fillStyle = explored.has(key) ? "rgba(8,6,5,0.62)" : "#060504";
        ctx.fillRect(c * GRID, r * GRID, GRID, GRID);
      }
    }
  }
  // Слой интерфейса — поверх всего, и тумана тоже.
  for (const s of [...sprites].sort((a, b) => a.zIndex - b.zIndex)) drawSprite(s);
  requestAnimationFrame(draw);
}
requestAnimationFrame(draw);

/** #hud повторяет масштаб карты: в Foundry это делает canvas.hud.align(), а масштаб — canvas.stage. */
function alignHud() {
  const r = map.getBoundingClientRect();
  const k = Math.min(r.width / map.width, r.height / map.height) || 1;
  const hud = $("#hud");
  hud.style.width = `${map.width}px`;
  hud.style.height = `${map.height}px`;
  hud.style.transform = `scale(${k})`;
  canvas.stage.scale.x = k;
  Hooks.callAll("canvasPan", canvas, { scale: k });
}
new ResizeObserver(alignHud).observe(map);
alignHud();

const toScene = (event) => {
  const r = map.getBoundingClientRect();
  return { x: ((event.clientX - r.left) / r.width) * map.width, y: ((event.clientY - r.top) / r.height) * map.height };
};
const tokenAt = (p) => scene._tokens.find((tk) => p.x >= tk.x && p.x < tk.x + GRID && p.y >= tk.y && p.y < tk.y + GRID);

/** Шаг за шагом по клеткам: вход в область ловушки → событие поведения, как в Foundry. */
let moving = false;
async function moveToken(token, target) {
  if (moving) return;
  moving = true;
  token._stopped = false;
  const from = { c: token.x / GRID, r: token.y / GRID };
  const to = { c: Math.floor(target.x / GRID), r: Math.floor(target.y / GRID) };
  const steps = Math.max(Math.abs(to.c - from.c), Math.abs(to.r - from.r));
  for (let i = 1; i <= steps && !token._stopped; i++) {
    const before = token.regions;
    const nx = Math.round(from.c + ((to.c - from.c) * i) / steps) * GRID;
    const ny = Math.round(from.r + ((to.r - from.r) * i) / steps) * GRID;
    // Как в Foundry: сквозь стену и закрытую дверь не пройти.
    if (testCollision({ x: token.x + GRID / 2, y: token.y + GRID / 2 }, { x: nx + GRID / 2, y: ny + GRID / 2 })) {
      toast("warn", "Стена: здесь не пройти.");
      break;
    }
    token.x = nx;
    token.y = ny;
    Hooks.callAll("updateToken", token, { x: token.x, y: token.y });
    await new Promise((r) => setTimeout(r, 140));
    for (const region of token.regions) {
      if (before.has(region)) continue;
      for (const behavior of region._behaviors) {
        if (behavior.disabled) continue;
        const handler = CONFIG.RegionBehavior.dataModels[behavior.type]?.events?.[CONST.REGION_EVENTS.TOKEN_MOVE_IN];
        const event = { name: "tokenMoveIn", region, user: game.user, data: { token, movement: { id: "move", passed: { waypoints: [{ action: "walk" }] } } } };
        await handler?.call(behavior.system, event);
      }
    }
  }
  moving = false;
}

/** Дверь под курсором: щелчок открывает и закрывает её. */
function doorAt(p) {
  return scene.walls.find((w) => {
    if (!w.door) return false;
    const [x1, y1, x2, y2] = w.c;
    return Math.abs(p.x - x1) < 22 && p.y > Math.min(y1, y2) - 6 && p.y < Math.max(y1, y2) + 6 && x1 === x2;
  });
}

map.addEventListener("click", (event) => {
  const p = toScene(event);
  const door = doorAt(p);
  if (door) {
    door.ds = door.ds === 1 ? 0 : 1;
    toast("info", door.ds === 1 ? "Дверь открыта." : "Дверь закрыта.");
    return;
  }
  const hit = tokenAt(p);
  if (hit) {
    if (!event.shiftKey) controlled.clear();
    controlled.add(hit.id);
    return;
  }
  const [selected] = canvas.tokens.controlled;
  if (selected) moveToken(selected.document, p);
});
map.addEventListener("dragover", (event) => {
  event.preventDefault();
  event.dataTransfer.dropEffect = "copy";
});
map.addEventListener("drop", (event) => {
  event.preventDefault();
  let data;
  try {
    data = JSON.parse(event.dataTransfer.getData("text/plain"));
  } catch {
    return;
  }
  Hooks.call("dropCanvasData", canvas, { ...data, ...toScene(event) });
});

/* ---------- панель ---------- */
$("#open").addEventListener("click", () => {
  if (window.__mock.playerView) window.__harness.setView(false);
  const controls = { tokens: { tools: {} } };
  Hooks.callAll("getSceneControlButtons", controls);
  controls.tokens.tools.sslTraps.onChange();
});
$("#reset").addEventListener("click", reset);
function setView(player) {
  window.__mock.setPlayerView(player);
  document.body.classList.toggle("is-player", player);
  $("#view").innerHTML = player
    ? '<i class="fa-solid fa-crown"></i> Глазами ведущего'
    : '<i class="fa-solid fa-user"></i> Глазами игрока';
}
$("#view").addEventListener("click", () => setView(!window.__mock.playerView));
window.__harness.setView = setView;
$("#demo").addEventListener("click", async () => {
  await api.place("fireJet", { x: 5.5 * GRID, y: 3.5 * GRID });
  await api.place("poisonGas", { x: 9.5 * GRID, y: 5.5 * GRID });
  await api.place("pit", { x: 7.5 * GRID, y: 1.5 * GRID });
});

// Сценарий из адреса: ?do=<js> — для снимков.
const script = new URLSearchParams(location.search).get("do");
if (script) await new Function("api", "scene", `return (async () => { ${script} })()`)(api, scene);
else $("#open").click();
