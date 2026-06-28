import { createServer } from "node:http";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Server } from "socket.io";

const port = Number(process.env.LODEGAME_SOCKET_PORT ?? 3001);
const httpServer = createServer();
const io = new Server(httpServer, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
  },
});

const players = new Map();
const playerSocketByAccount = new Map();
const worldPath = join(process.cwd(), "server", "world-state.json");
const world = loadWorld();
const prizes = new Map();
const chatHistory = [];
let nextPrizeId = 1;
const ITEM_DURABILITY_MS = 60 * 60_000;

function createBaseMap() {
  const width = 224;
  const height = 48;
  const upperZones = [
    { ladders: [5, 17], platforms: [[3, 2, 13], [6, 9, 24], [10, 2, 18], [14, 8, 26], [18, 2, 14]] },
    { ladders: [9, 21], platforms: [[2, 3, 22], [5, 12, 26], [9, 2, 17], [13, 7, 25], [17, 3, 20]] },
    { ladders: [6, 19], platforms: [[3, 2, 18], [7, 8, 26], [11, 2, 14], [15, 12, 26], [19, 4, 21]] },
    { ladders: [12, 23], platforms: [[2, 6, 25], [6, 2, 16], [10, 10, 26], [13, 3, 20], [17, 8, 24]] },
    { ladders: [4, 16], platforms: [[4, 2, 21], [8, 7, 25], [12, 2, 17], [16, 9, 26], [20, 3, 19]] },
    { ladders: [10, 22], platforms: [[3, 5, 24], [7, 2, 15], [10, 12, 26], [14, 4, 22], [18, 11, 25]] },
    { ladders: [7, 18], platforms: [[2, 3, 17], [5, 10, 26], [9, 2, 22], [13, 8, 26], [17, 3, 15], [21, 7, 25]] },
    { ladders: [11, 20], platforms: [[3, 2, 24], [6, 9, 26], [10, 2, 18], [14, 7, 25], [18, 3, 21]] },
  ];
  const rows = Array.from({ length: height }, (_, y) => {
    const row = Array.from({ length: width }, () => ".");
    row[0] = "#";
    row[width - 1] = "#";
    if (y === 0 || y === height - 1) row.fill("#");
    return row;
  });

  for (let x = 1; x < width - 1; x += 1) {
    rows[22][x] = "P";
    rows[46][x] = "P";
  }

  upperZones.forEach((zone, zoneIndex) => {
    const base = zoneIndex * 28;
    for (const [row, start, end] of zone.platforms) {
      for (let x = base + start; x < base + end; x += 1) rows[row][x] = "P";
    }
    for (let y = 1; y < 23; y += 1) {
      for (const ladder of zone.ladders) rows[y][base + ladder] = "L";
    }
  });

  for (let zone = 0; zone < 8; zone += 1) {
    const base = zone * 28;
    const offset = zone % 2 === 0 ? 0 : 4;
    for (const [row, start, end] of [
      [27, 3 + offset, 18 + offset],
      [31, 9 - offset / 2, 25],
      [35, 2, 15 + offset],
      [39, 8, 26],
      [43, 3 + offset, 21],
    ]) {
      for (let x = base + start; x < Math.min(base + end, base + 26); x += 1) rows[row][x] = "P";
    }
  }

  for (let y = 22; y < height - 1; y += 1) {
    for (const x of [12, 39, 66, 96, 125, 153, 181, 209]) rows[y][x] = "L";
  }

  return rows.map((row) => row.join(""));
}

function normalizeWorldMap(targetWorld) {
  const lowerLadders = [12, 39, 66, 96, 125, 153, 181, 209];
  let changed = false;
  for (let y = 22; y < targetWorld.map.length - 1; y += 1) {
    for (const x of lowerLadders) {
      if (targetWorld.map[y]?.[x] !== "L") {
        const row = targetWorld.map[y];
        targetWorld.map[y] = `${row.slice(0, x)}L${row.slice(x + 1)}`;
        changed = true;
      }
    }
  }
  return changed;
}

function loadWorld() {
  if (existsSync(worldPath)) {
    try {
      const parsed = JSON.parse(readFileSync(worldPath, "utf8"));
      if (Array.isArray(parsed.map) && Array.isArray(parsed.gold) && parsed.map.length === 48 && parsed.map[0]?.length === 224) {
        if (normalizeWorldMap(parsed)) writeFileSync(worldPath, JSON.stringify(parsed, null, 2));
        parsed.resources ??= [];
        parsed.market ??= [];
        parsed.nextMarketId ??= 1;
        parsed.nextResourceId ??= 1;
        return parsed;
      }
    } catch {
      // Fall back to a fresh world below.
    }
  }
  return { map: createBaseMap(), gold: [], resources: [], market: [], nextGoldId: 1, nextResourceId: 1, nextMarketId: 1 };
}

function saveWorld() {
  writeFileSync(worldPath, JSON.stringify(world, null, 2));
}

function worldSize() {
  return { width: world.map[0]?.length ?? 224, height: world.map.length || 48 };
}

function tileAt(x, y) {
  return world.map[y]?.[x] ?? "#";
}

function setTile(x, y, tile) {
  const row = world.map[y];
  if (!row) return false;
  world.map[y] = `${row.slice(0, x)}${tile}${row.slice(x + 1)}`;
  return true;
}

function canEdit(x, y) {
  const { width, height } = worldSize();
  return x > 0 && y > 0 && x < width - 1 && y < height - 1;
}

function spawnGold() {
  const { width, height } = worldSize();
  if (world.gold.length >= 80) return;
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const x = 2 + Math.floor(Math.random() * (width - 4));
    const y = 1 + Math.floor(Math.random() * (height - 3));
    if (tileAt(x, y) !== ".") continue;
    if (!["#", "P", "S"].includes(tileAt(x, y + 1)) && tileAt(x, y + 1) !== "L") continue;
    if (world.gold.some((gold) => gold.x === x && gold.y === y)) continue;
    const gold = { id: `gold-${world.nextGoldId++}`, x, y };
    world.gold.push(gold);
    io.emit("world:gold:spawn", gold);
    saveWorld();
    return;
  }
}

setInterval(spawnGold, 4500);

function spawnResource() {
  const { width, height } = worldSize();
  world.resources ??= [];
  if (world.resources.length >= 100) return;
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const x = 2 + Math.floor(Math.random() * (width - 4));
    const y = 1 + Math.floor(Math.random() * (height - 3));
    if (tileAt(x, y) !== ".") continue;
    if (!["#", "P", "S"].includes(tileAt(x, y + 1)) && tileAt(x, y + 1) !== "L") continue;
    if (world.gold.some((gold) => gold.x === x && gold.y === y)) continue;
    if (world.resources.some((resource) => resource.x === x && resource.y === y)) continue;
    const kind = Math.random() > 0.74 ? "iron" : "stone";
    const resource = { id: `resource-${world.nextResourceId++}`, kind, x, y };
    world.resources.push(resource);
    io.emit("world:resource:spawn", resource);
    saveWorld();
    return;
  }
}

setInterval(spawnResource, 5200);

const prizeTemplates = [
  { name: "Бластер", slot: "weapon", effect: "shotDamage", weight: 2, value: 16, color: "#f97316" },
  { name: "Карабин", slot: "weapon", effect: "fireRate", weight: 2, value: 15, color: "#38bdf8" },
  { name: "Пружинные сапоги", slot: "boots", effect: "jumpHeight", weight: 3, value: 14, color: "#22c55e" },
  { name: "Беговые сапоги", slot: "boots", effect: "runSpeed", weight: 2, value: 12, color: "#06b6d4" },
  { name: "Бронежилет", slot: "armor", effect: "armor", weight: 4, value: 15, color: "#94a3b8" },
  { name: "Рюкзак", slot: "backpack", effect: "backpack", weight: 5, value: 18, color: "#a855f7" },
  { name: "Силовой модуль", slot: "module", effect: "strength", weight: 3, value: 18, color: "#facc15" },
];

const rarityTable = [
  { rarity: "common", title: "Обычный", power: 1, value: 1, weight: 1 },
  { rarity: "rare", title: "Редкий", power: 2, value: 1.9, weight: 1.08 },
  { rarity: "epic", title: "Эпический", power: 3, value: 3.2, weight: 1.16 },
  { rarity: "legendary", title: "Легендарный", power: 4, value: 5, weight: 1.25 },
];

function rollRarity() {
  const roll = Math.random();
  if (roll > 0.985) return rarityTable[3];
  if (roll > 0.92) return rarityTable[2];
  if (roll > 0.68) return rarityTable[1];
  return rarityTable[0];
}

function createPrizeItem(template) {
  const rarity = rollRarity();
  return {
    ...template,
    name: `${rarity.title} ${template.name}`,
    rarity: rarity.rarity,
    power: rarity.power,
    weight: Math.max(1, Math.round(template.weight * rarity.weight)),
    value: Math.round(template.value * rarity.value),
    durabilityMs: ITEM_DURABILITY_MS,
    remainingMs: ITEM_DURABILITY_MS,
  };
}

function itemTradeValue(item) {
  const durabilityMs = Math.max(1, Number(item?.durabilityMs) || ITEM_DURABILITY_MS);
  const remainingMs = Math.max(0, Number(item?.remainingMs) || durabilityMs);
  const ratio = Math.max(0.08, Math.min(1, remainingMs / durabilityMs));
  return Math.max(1, Math.round((Number(item?.value) || 1) * ratio));
}

function spawnPrize() {
  const { width, height } = worldSize();
  if (prizes.size >= 8) return;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const x = 2 + Math.floor(Math.random() * (width - 4));
    const y = 1 + Math.floor(Math.random() * (height - 3));
    if (tileAt(x, y) !== ".") continue;
    if (!["#", "P", "S"].includes(tileAt(x, y + 1)) && tileAt(x, y + 1) !== "L") continue;
    const template = prizeTemplates[Math.floor(Math.random() * prizeTemplates.length)];
    const prize = { id: `prize-${nextPrizeId++}`, x, y, expiresAt: Date.now() + 45000, kind: "superPrize", ...createPrizeItem(template) };
    prizes.set(prize.id, prize);
    io.emit("world:prize:spawn", prize);
    setTimeout(() => {
      if (!prizes.has(prize.id)) return;
      prizes.delete(prize.id);
      io.emit("world:prize:despawn", { id: prize.id });
    }, 45000);
    return;
  }
}

setInterval(spawnPrize, 18000);

function roomFor(levelId) {
  return `level:${levelId}`;
}

function snapshot(levelId) {
  return [...players.values()]
    .filter((player) => player.levelId === levelId)
    .map((player) => ({
      id: player.id,
      x: player.x,
      y: player.y,
      face: player.face,
      hoodie: player.hoodie,
      name: player.name,
    }));
}

function broadcastRoom(levelId) {
  const room = roomFor(levelId);
  io.to(room).emit("players:snapshot", {
    online: io.sockets.adapter.rooms.get(room)?.size ?? 0,
    players: snapshot(levelId),
  });
}

function onlineSnapshot() {
  const byLevel = {};
  const list = [...players.values()].map((player) => {
    byLevel[player.levelId] = (byLevel[player.levelId] ?? 0) + 1;
    return {
      id: player.id,
      levelId: player.levelId,
      name: player.name,
    };
  });
  return { total: list.length, byLevel, players: list };
}

function broadcastOnline() {
  io.emit("online:snapshot", onlineSnapshot());
}

io.on("connection", (socket) => {
  socket.emit("online:snapshot", onlineSnapshot());
  socket.emit("world:snapshot", { map: world.map, gold: world.gold, resources: world.resources ?? [], prizes: [...prizes.values()] });
  socket.emit("market:list", world.market ?? []);
  socket.emit("chat:history", chatHistory);

  socket.on("player:join", (state) => {
    const levelId = Number(state.levelId) || 1;
    const accountId = String(state.accountId || state.name || socket.id).trim().toLowerCase().slice(0, 80);
    const previousSocketId = playerSocketByAccount.get(accountId);
    if (previousSocketId && previousSocketId !== socket.id) {
      const previous = players.get(previousSocketId);
      players.delete(previousSocketId);
      if (previous) {
        io.to(roomFor(previous.levelId)).emit("player:leave", previousSocketId);
        broadcastRoom(previous.levelId);
      }
    }
    playerSocketByAccount.set(accountId, socket.id);
    socket.join(roomFor(levelId));
    players.set(socket.id, {
      id: socket.id,
      accountId,
      levelId,
      x: Number(state.x) || 0,
      y: Number(state.y) || 0,
      face: state.face ?? "happy",
      hoodie: state.hoodie ?? "#2dd4bf",
      name: String(state.name || "").trim().slice(0, 24) || `Игрок ${socket.id.slice(0, 4)}`,
    });
    broadcastRoom(levelId);
    broadcastOnline();
  });

  socket.on("chat:send", (payload) => {
    const text = String(payload?.text ?? "").trim().slice(0, 240);
    if (!text) return;
    const player = players.get(socket.id);
    const replyPayload = payload?.replyTo;
    const replyTo = replyPayload?.id
      ? {
          id: String(replyPayload.id).slice(0, 80),
          author: String(replyPayload.author || "Игрок").trim().slice(0, 24),
          text: String(replyPayload.text || "").trim().slice(0, 120),
        }
      : undefined;
    const message = {
      id: `msg-${Date.now()}-${socket.id.slice(0, 5)}`,
      playerId: socket.id,
      author: player?.name ?? (String(payload?.author || "").trim().slice(0, 24) || `Игрок ${socket.id.slice(0, 4)}`),
      text,
      replyTo,
      createdAt: Date.now(),
    };
    chatHistory.push(message);
    if (chatHistory.length > 60) chatHistory.splice(0, chatHistory.length - 60);
    io.emit("chat:message", message);
  });

  socket.on("world:request", () => {
    socket.emit("world:snapshot", { map: world.map, gold: world.gold, resources: world.resources ?? [], prizes: [...prizes.values()] });
  });

  socket.on("world:build", (payload) => {
    const current = players.get(socket.id);
    const x = Math.floor(Number(payload?.x));
    const y = Math.floor(Number(payload?.y));
    const tile = payload?.tile;
    if (!current || !canEdit(x, y) || ![".", "P", "L", "D"].includes(tile)) return;
    if (tile !== "." && tileAt(x, y) !== ".") return;
    if (tile === "." && !["P", "L", "D", "S"].includes(tileAt(x, y))) return;
    setTile(x, y, tile);
    world.gold = world.gold.filter((gold) => !(gold.x === x && gold.y === y));
    world.resources = (world.resources ?? []).filter((resource) => !(resource.x === x && resource.y === y));
    saveWorld();
    io.emit("world:tile", { x, y, tile });
  });

  socket.on("gold:collect", (payload) => {
    const id = String(payload?.id ?? "");
    const index = world.gold.findIndex((gold) => gold.id === id);
    if (index === -1) return;
    const [gold] = world.gold.splice(index, 1);
    saveWorld();
    io.emit("gold:collected", { id: gold.id });
  });

  socket.on("resource:collect", (payload) => {
    const id = String(payload?.id ?? "");
    world.resources ??= [];
    const index = world.resources.findIndex((resource) => resource.id === id);
    if (index === -1) return;
    const [resource] = world.resources.splice(index, 1);
    saveWorld();
    io.emit("resource:collected", { id: resource.id });
  });

  socket.on("prize:collect", (payload) => {
    const id = String(payload?.id ?? "");
    if (!prizes.has(id)) return;
    prizes.delete(id);
    io.emit("world:prize:despawn", { id });
  });

  socket.on("market:sell", (payload) => {
    const item = payload?.item;
    if (!item?.id) return;
    const maxPrice = itemTradeValue(item);
    const price = Math.max(1, Math.min(maxPrice, Math.floor(Number(payload?.price) || maxPrice)));
    world.market ??= [];
    world.nextMarketId ??= 1;
    const listing = {
      id: `lot-${world.nextMarketId++}`,
      seller: players.get(socket.id)?.name ?? `Игрок ${socket.id.slice(0, 4)}`,
      item,
      price,
      createdAt: Date.now(),
    };
    world.market.push(listing);
    saveWorld();
    io.emit("market:list", world.market);
  });

  socket.on("market:buy", (payload) => {
    const id = String(payload?.id ?? "");
    world.market ??= [];
    const index = world.market.findIndex((listing) => listing.id === id);
    if (index === -1) return;
    const [listing] = world.market.splice(index, 1);
    saveWorld();
    socket.emit("market:bought", listing);
    io.emit("market:list", world.market);
  });

  socket.on("player:state", (state) => {
    const current = players.get(socket.id);
    if (!current) return;
    current.x = Number(state.x) || current.x;
    current.y = Number(state.y) || current.y;
    current.face = state.face ?? current.face;
    current.hoodie = state.hoodie ?? current.hoodie;
    socket.to(roomFor(current.levelId)).emit("player:update", {
      id: socket.id,
      x: current.x,
      y: current.y,
      face: current.face,
      hoodie: current.hoodie,
      name: current.name,
    });
  });

  socket.on("player:pause", () => {
    const current = players.get(socket.id);
    if (!current) return;
    players.delete(socket.id);
    if (current.accountId && playerSocketByAccount.get(current.accountId) === socket.id) {
      playerSocketByAccount.delete(current.accountId);
    }
    socket.to(roomFor(current.levelId)).emit("player:leave", socket.id);
    broadcastRoom(current.levelId);
    broadcastOnline();
  });

  socket.on("disconnect", () => {
    const current = players.get(socket.id);
    players.delete(socket.id);
    if (!current) return;
    if (current.accountId && playerSocketByAccount.get(current.accountId) === socket.id) {
      playerSocketByAccount.delete(current.accountId);
    }
    socket.to(roomFor(current.levelId)).emit("player:leave", socket.id);
    broadcastRoom(current.levelId);
    broadcastOnline();
  });
});

httpServer.listen(port, () => {
  console.log(`Lodegame multiplayer server listening on http://localhost:${port}`);
});
