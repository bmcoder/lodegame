import type { EnemySpawn, LevelDefinition } from "@/app/lib/gameLogic/types";

const ZONE_WIDTH = 28;
const ZONES = 8;
const WIDTH = ZONE_WIDTH * ZONES;
const HEIGHT = 48;

const zoneBlueprints = [
  { ladders: [5, 17], platforms: [[3, 2, 13], [6, 9, 24], [10, 2, 18], [14, 8, 26], [18, 2, 14], [22, 3, 25]] },
  { ladders: [9, 21], platforms: [[2, 3, 22], [5, 12, 26], [9, 2, 17], [13, 7, 25], [17, 3, 20], [22, 2, 26]] },
  { ladders: [6, 19], platforms: [[3, 2, 18], [7, 8, 26], [11, 2, 14], [15, 12, 26], [19, 4, 21], [22, 2, 26]] },
  { ladders: [12, 23], platforms: [[2, 6, 25], [6, 2, 16], [10, 10, 26], [13, 3, 20], [17, 8, 24], [22, 2, 26]] },
  { ladders: [4, 16], platforms: [[4, 2, 21], [8, 7, 25], [12, 2, 17], [16, 9, 26], [20, 3, 19], [22, 2, 26]] },
  { ladders: [10, 22], platforms: [[3, 5, 24], [7, 2, 15], [10, 12, 26], [14, 4, 22], [18, 11, 25], [22, 2, 26]] },
  { ladders: [7, 18], platforms: [[2, 3, 17], [5, 10, 26], [9, 2, 22], [13, 8, 26], [17, 3, 15], [21, 7, 25], [22, 2, 26]] },
  { ladders: [11, 20], platforms: [[3, 2, 24], [6, 9, 26], [10, 2, 18], [14, 7, 25], [18, 3, 21], [22, 2, 26]] },
] as const;

function createMap(): string[] {
  const rows = Array.from({ length: HEIGHT }, (_, y) => {
    const row = Array.from({ length: WIDTH }, () => ".");
    row[0] = "#";
    row[WIDTH - 1] = "#";
    if (y === 0 || y === HEIGHT - 1) row.fill("#");
    return row;
  });

  zoneBlueprints.forEach((zone, zoneIndex) => {
    const base = zoneIndex * ZONE_WIDTH;
    for (const [row, start, end] of zone.platforms) {
      for (let x = base + start; x < base + end; x += 1) rows[row][x] = "P";
    }
  });

  for (let x = 1; x < WIDTH - 1; x += 1) {
    rows[22][x] = "P";
    rows[46][x] = "P";
  }

  for (let zone = 0; zone < ZONES; zone += 1) {
    const base = zone * ZONE_WIDTH;
    const offset = zone % 2 === 0 ? 0 : 4;
    for (const [row, start, end] of [
      [27, 3 + offset, 18 + offset],
      [31, 9 - offset / 2, 25],
      [35, 2, 15 + offset],
      [39, 8, 26],
      [43, 3 + offset, 21],
    ]) {
      for (let x = base + start; x < Math.min(base + end, base + ZONE_WIDTH - 2); x += 1) rows[row][x] = "P";
    }
  }

  for (let y = 22; y < HEIGHT - 1; y += 1) {
    for (const x of [12, 39, 66, 96, 125, 153, 181, 209]) rows[y][x] = "L";
  }

  zoneBlueprints.forEach((zone, zoneIndex) => {
    const base = zoneIndex * ZONE_WIDTH;
    for (let y = 1; y < HEIGHT - 1; y += 1) {
      for (const ladder of zone.ladders) rows[y][base + ladder] = "L";
    }
  });

  rows[1][7 * ZONE_WIDTH + 20] = "X";
  return rows.map((row) => row.join(""));
}

function createEnemies(levelId: number): EnemySpawn[] {
  const count = Math.min(5 + Math.floor(levelId / 2), 18);
  const templates: EnemySpawn[] = [
    { id: "train-1", x: 16, y: 21, type: "hauntedTrain" },
    { id: "siren-1", x: 42, y: 21, type: "siren" },
    { id: "skibidi-1", x: 54, y: 21, type: "skibidiToilet" },
    { id: "blue-1", x: 66, y: 14, type: "hunter" },
    { id: "train-2", x: 89, y: 21, type: "hauntedTrain" },
    { id: "blue-2", x: 109, y: 16, type: "walker" },
    { id: "siren-2", x: 137, y: 21, type: "siren" },
    { id: "skibidi-2", x: 151, y: 21, type: "skibidiToilet" },
    { id: "blue-3", x: 157, y: 17, type: "shooter" },
    { id: "train-3", x: 183, y: 20, type: "hauntedTrain" },
    { id: "blue-4", x: 207, y: 21, type: "walker" },
    { id: "siren-3", x: 30, y: 12, type: "siren" },
    { id: "train-4", x: 56, y: 8, type: "hauntedTrain" },
    { id: "blue-5", x: 83, y: 9, type: "hunter" },
    { id: "skibidi-3", x: 101, y: 12, type: "skibidiToilet" },
    { id: "siren-4", x: 116, y: 12, type: "siren" },
    { id: "blue-6", x: 146, y: 6, type: "walker" },
    { id: "train-5", x: 170, y: 12, type: "hauntedTrain" },
    { id: "blue-7", x: 194, y: 8, type: "shooter" },
    { id: "siren-5", x: 214, y: 17, type: "siren" },
    { id: "blue-8", x: 124, y: 21, type: "hunter" },
  ];
  return templates.slice(0, count);
}

export function getLevel(levelId: number): LevelDefinition {
  return {
    id: 1,
    name: "Общий мир",
    timeLimit: 0,
    enemySpeed: 82,
    aggression: 0.55,
    player: { x: 3 + (Math.max(1, Math.floor(levelId || 1)) % 8) * 2, y: 45 },
    exit: { x: 7 * ZONE_WIDTH + 20, y: 1 },
    map: createMap(),
    enemies: createEnemies(8),
    incubators: [
      { x: 8, y: 21 },
      { x: 36, y: 21 },
      { x: 67, y: 21 },
      { x: 91, y: 21 },
      { x: 123, y: 21 },
      { x: 151, y: 21 },
      { x: 181, y: 20 },
      { x: 209, y: 21 },
    ],
    items: [],
  };
}

export const levels = [getLevel(1)];

export function getNextLevelId(levelId: number): number {
  return Math.max(1, Math.floor(levelId || 1));
}
