const WIDTH = 224;
const HEIGHT = 48;

function createBaseMap() {
  const rows = Array.from({ length: HEIGHT }, (_, y) => {
    const row = Array.from({ length: WIDTH }, () => ".");
    row[0] = "#";
    row[WIDTH - 1] = "#";
    if (y === 0 || y === HEIGHT - 1) row.fill("#");
    return row;
  });

  for (let x = 1; x < WIDTH - 1; x += 1) {
    rows[22][x] = "P";
    rows[46][x] = "P";
  }
  for (let y = 1; y < HEIGHT - 1; y += 1) {
    for (const x of [5, 17, 37, 49, 62, 75, 96, 107, 116, 128, 150, 162, 175, 186, 207, 216]) rows[y][x] = "L";
  }
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

  for (let y = 22; y < HEIGHT - 1; y += 1) {
    for (const x of [12, 39, 66, 96, 125, 153, 181, 209]) rows[y][x] = "L";
  }

  return rows.map((row) => row.join(""));
}

const map = createBaseMap();
const errors = [];
const solid = new Set(["#", "P", "S"]);
const passable = (x, y) => y >= 0 && y < map.length && x >= 0 && x < map[0].length && !solid.has(map[y][x]);
const hasFloor = (x, y) => y + 1 >= map.length || solid.has(map[y + 1][x]) || map[y]?.[x] === "L";

map.forEach((row, y) => {
  if (row.length !== WIDTH) errors.push(`World row ${y} has width ${row.length}, expected ${WIDTH}`);
});
if (map.length !== HEIGHT) errors.push(`World height is ${map.length}, expected ${HEIGHT}`);

for (const point of [
  ["player spawn", { x: 3, y: 45 }],
  ["lower route left", { x: 2, y: 45 }],
  ["lower route right", { x: WIDTH - 3, y: 45 }],
]) {
  const [label, { x, y }] = point;
  if (!passable(x, y)) errors.push(`${label} is blocked at ${x}:${y}`);
  if (!hasFloor(x, y)) errors.push(`${label} has no floor at ${x}:${y}`);
}

for (let x = 1; x < WIDTH - 1; x += 1) {
  if (!passable(x, 45) || !hasFloor(x, 45)) errors.push(`Lower shared route is blocked at ${x}:45`);
}

for (const [index, row] of map.entries()) {
  for (const [x, tile] of [...row].entries()) {
    if (![".", "#", "P", "L", "D"].includes(tile)) errors.push(`Unexpected tile ${tile} at ${x}:${index}`);
  }
}

if (errors.length) {
  console.error(errors.join("\n"));
  process.exit(1);
}

console.log("Validated shared sandbox world: 224x48, spawn and lower route are passable.");
