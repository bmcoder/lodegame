export type TileCode = "." | "#" | "S" | "P" | "L" | "D" | "X";

export type ItemType = "coin" | "stone" | "iron" | "wood" | "key" | "heart" | "energy" | "prize";

export type FaceType = "happy" | "serious" | "angry" | "surprised";
export type HairLength = "short" | "medium" | "long";
export type GenderStyle = "neutral" | "soft" | "sharp";

export type CharacterCustomization = {
  hoodie: string;
  pants: string;
  hat: string;
  hairLength: HairLength;
  hairColor: string;
  face: FaceType;
  genderStyle: GenderStyle;
  pixelSkin?: Array<Array<string | null>>;
};

export type LevelItem = {
  type: ItemType;
  x: number;
  y: number;
};

export type EnemySpawn = {
  id: string;
  x: number;
  y: number;
  type: "walker" | "hunter" | "flyer" | "shooter" | "hauntedTrain" | "siren" | "skibidiToilet";
};

export type LevelDefinition = {
  id: number;
  name: string;
  timeLimit: number;
  enemySpeed: number;
  aggression: number;
  map: string[];
  enemies: EnemySpawn[];
  incubators: Array<{ x: number; y: number }>;
  items: LevelItem[];
  player: { x: number; y: number };
  exit: { x: number; y: number };
};

export type RuntimeStats = {
  score: number;
  gold: number;
  lives: number;
  maxLives: number;
  health: number;
  materials: number;
  stone: number;
  iron: number;
  wood: number;
  backpackLoad: number;
  backpackCapacity: number;
  keys: number;
  coins: number;
  goldTotal: number;
  energy: number;
  onlinePlayers: number;
  levelId: number;
  elapsedMs: number;
};

export type UpgradeKey = "runSpeed" | "fireRate" | "shotDamage" | "armor" | "jumpHeight" | "backpack" | "strength";
export type GearSlot = "weapon" | "armor" | "boots" | "backpack" | "module";

export type InventoryItem = {
  id: string;
  name: string;
  kind: "superPrize";
  slot: GearSlot;
  rarity: "common" | "rare" | "epic" | "legendary";
  weight: number;
  value: number;
  effect: UpgradeKey;
  power: number;
  color: string;
  durabilityMs: number;
  remainingMs: number;
};

export type PlayerProfile = {
  nickname: string;
  email?: string;
  spawnPoint?: { x: number; y: number };
  enemiesKilled: number;
  goldMined: number;
  playTimeMs: number;
  score: number;
  gold: number;
  materials: number;
  stone: number;
  iron: number;
  wood: number;
  upgrades: Record<UpgradeKey, number>;
  equipment: Partial<Record<GearSlot, InventoryItem>>;
  inventory: InventoryItem[];
};

export type MarketListing = {
  id: string;
  seller: string;
  item: InventoryItem;
  price: number;
  createdAt: number;
};

export type MinimapEntityType = "player" | "remotePlayer" | "enemy" | "coin" | "stone" | "iron" | "wood" | "key" | "heart" | "energy" | "prize" | "incubator" | "exit";

export type MinimapEntity = {
  id: string;
  type: MinimapEntityType;
  x: number;
  y: number;
};

export type MinimapSnapshot = {
  camera: { x: number; y: number; width: number; height: number };
  entities: MinimapEntity[];
};
