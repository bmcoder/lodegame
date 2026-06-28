import * as Phaser from "phaser";
import { io, type Socket } from "socket.io-client";
import type {
  CharacterCustomization,
  EnemySpawn,
  GearSlot,
  InventoryItem,
  ItemType,
  LevelDefinition,
  MinimapEntity,
  MinimapSnapshot,
  PlayerProfile,
  RuntimeStats,
} from "@/app/lib/gameLogic/types";

declare global {
  interface Window {
    webkitAudioContext?: typeof AudioContext;
  }
}

type SceneCallbacks = {
  onStatus: (stats: RuntimeStats) => void;
  onMessage: (message: string) => void;
  onEnd: (result: { status: "won" | "lost"; score: number }) => void;
  onMap?: (snapshot: MinimapSnapshot) => void;
  onProfileChange?: (profile: PlayerProfile) => void;
  onBackpackFull?: () => void;
};

type EnemySprite = Phaser.Physics.Arcade.Sprite & {
  enemyType?: EnemySpawn["type"];
  hp?: number;
  dir?: number;
  climbIntentUntil?: number;
  lastWaveAt?: number;
};

type Incubator = {
  x: number;
  y: number;
  sprite: Phaser.GameObjects.Container;
  bar: Phaser.GameObjects.Rectangle;
  readyAt: number;
  growing: boolean;
};

type RemotePlayer = {
  sprite: Phaser.GameObjects.Rectangle;
  label: Phaser.GameObjects.Text;
};

type BuildMode = "none" | "wall" | "ladder" | "door" | "remove";

type WorldGold = {
  id: string;
  x: number;
  y: number;
};

type WorldResource = {
  id: string;
  kind: "stone" | "iron";
  x: number;
  y: number;
};

type WorldPrize = InventoryItem & {
  x: number;
  y: number;
  expiresAt: number;
};

type ArcadeObject =
  | Phaser.Types.Physics.Arcade.GameObjectWithBody
  | Phaser.Physics.Arcade.Body
  | Phaser.Physics.Arcade.StaticBody
  | Phaser.Tilemaps.Tile;

type Hole = {
  key: string;
  x: number;
  y: number;
  sprite: Phaser.GameObjects.Rectangle;
  textureKey: string;
  permanent: boolean;
  restoreAt: number;
};

const TILE = 32;
const BULLET_SPEED = 420;
const PLAYER_SPEED = 175;
const JUMP_SPEED = 360;
const GRAVITY = 780;
const ITEM_DURABILITY_MS = 60 * 60_000;

export class MainScene extends Phaser.Scene {
  private level: LevelDefinition;
  private customization: CharacterCustomization;
  private profile: PlayerProfile;
  private callbacks: SceneCallbacks;
  private player!: Phaser.Physics.Arcade.Sprite;
  private solids!: Phaser.Physics.Arcade.StaticGroup;
  private ladders!: Phaser.Physics.Arcade.StaticGroup;
  private bullets!: Phaser.Physics.Arcade.Group;
  private enemyWaves!: Phaser.Physics.Arcade.Group;
  private enemies!: Phaser.Physics.Arcade.Group;
  private items!: Phaser.Physics.Arcade.StaticGroup;
  private exitZone!: Phaser.Physics.Arcade.Sprite;
  private tileSprites = new Map<string, Phaser.GameObjects.GameObject>();
  private itemSprites = new Map<string, Phaser.Physics.Arcade.Sprite>();
  private resourceSprites = new Map<string, Phaser.Physics.Arcade.Sprite>();
  private prizeSprites = new Map<string, Phaser.Physics.Arcade.Sprite>();
  private holes = new Map<string, Hole>();
  private incubators: Incubator[] = [];
  private remotePlayers = new Map<string, RemotePlayer>();
  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
  private keys!: Record<string, Phaser.Input.Keyboard.Key>;
  private mobile = { left: false, right: false, up: false, down: false };
  private facing = 1;
  private buildMode: BuildMode = "none";
  private lastShotAt = 0;
  private lastDigAt = 0;
  private lastSuperAt = 0;
  private lastEnemyContactDamageAt = 0;
  private lastOnLadderAt = -1000;
  private ended = false;
  private destroyed = false;
  private exiting = false;
  private exitStartedAt = 0;
  private stats: RuntimeStats;
  private audioContext?: AudioContext;
  private musicInterval?: number;
  private musicStep = 0;
  private audioUnlocked = false;
  private socket?: Socket;
  private lastNetworkSendAt = 0;
  private lastMapSendAt = 0;
  private playTimeSincePersist = 0;
  private enemySerial = 0;
  private chatFocused = false;
  private networkPaused = false;
  private pauseListener?: (event: Event) => void;

  constructor(level: LevelDefinition, customization: CharacterCustomization, profile: PlayerProfile, callbacks: SceneCallbacks) {
    super(`level-${level.id}`);
    this.level = level;
    this.customization = customization;
    this.profile = profile;
    this.callbacks = callbacks;
    this.stats = {
      score: profile.score,
      gold: profile.gold,
      lives: 3,
      maxLives: 3,
      health: 100,
      materials: profile.materials,
      stone: profile.stone,
      iron: profile.iron,
      backpackLoad: this.backpackLoad(),
      backpackCapacity: this.backpackCapacity(),
      keys: 0,
      coins: 0,
      goldTotal: 0,
      energy: 0,
      onlinePlayers: 1,
      levelId: level.id,
      elapsedMs: 0,
    };
  }

  preload() {
    this.createTextures();
  }

  create() {
    this.physics.world.gravity.y = GRAVITY;
    this.physics.world.setBounds(0, 0, this.level.map[0].length * TILE, this.level.map.length * TILE);

    this.solids = this.physics.add.staticGroup();
    this.ladders = this.physics.add.staticGroup();
    this.bullets = this.physics.add.group({ allowGravity: false });
    this.enemyWaves = this.physics.add.group({ allowGravity: false });
    this.enemies = this.physics.add.group();
    this.items = this.physics.add.staticGroup();

    this.buildMap();
    this.createPlayer();
    this.createIncubators();
    this.createEnemies();
    this.createItems();
    this.createInput();
    this.setupCamera();
    this.setupMultiplayer();
    this.setupPauseBridge();
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, this.stopAudio, this);
    this.events.once(Phaser.Scenes.Events.DESTROY, this.stopAudio, this);

    this.physics.add.collider(this.player, this.solids);
    this.physics.add.collider(this.enemies, this.solids);
    this.physics.add.collider(this.bullets, this.solids, this.hitSolidWithBullet, undefined, this);
    this.physics.add.collider(this.enemyWaves, this.solids, (wave) => {
      (wave as Phaser.GameObjects.GameObject).destroy();
    });
    this.physics.add.overlap(this.bullets, this.enemies, this.hitEnemy, undefined, this);
    this.physics.add.overlap(this.bullets, this.enemyWaves, this.neutralizeSonicWave, undefined, this);
    this.physics.add.overlap(this.player, this.enemyWaves, this.hitPlayerWave, undefined, this);
    this.physics.add.overlap(this.player, this.enemies, this.hitPlayerEnemyContact, undefined, this);
    this.physics.add.overlap(this.player, this.items, this.collectItem, undefined, this);
    this.physics.add.overlap(this.player, this.exitZone, this.tryExit, undefined, this);

    this.callbacks.onStatus(this.stats);
    this.exitZone.setAlpha(0.28);
    this.callbacks.onMessage("Соберите все золото, затем поднимайтесь к выходу.");
  }

  update(time: number, delta: number) {
    if (this.ended) return;

    this.stats.elapsedMs += delta;
    this.trackPlayTime(delta);
    if (this.exiting) {
      this.updateExitClimb();
      this.callbacks.onStatus(this.stats);
      return;
    }

    this.updatePlayer(time);
    this.updateEnemies();
    this.updateBullets();
    this.updateEnemyWaves();
    this.updateHoles(time);
    this.updateIncubators(time);
    this.updateEquipmentWear(delta);
    this.syncMultiplayer(time);
    this.syncMinimap(time);
    this.callbacks.onStatus(this.stats);
  }

  private createTextures() {
    this.makeBrickTexture("ground", 0xc27a28, 0x6f3716);
    this.makeBrickTexture("stone", 0x1688df, 0x062a4c);
    this.makeBrickTexture("platform", 0xc27a28, 0x6f3716);
    this.makeLadderTexture("ladder");
    this.makeLadderTexture("exit", 0xf8fafc, 0x94a3b8);
    this.makeDoorTexture("door");
    this.makeBlockTexture("bullet", 0xfef08a, 0xf97316);
    this.makeLongArmMonsterTexture("enemy");
    this.makeBlockTexture("enemyFlyer", 0xa78bfa, 0x5b21b6);
    this.makeHauntedTrainTexture("hauntedTrain");
    this.makeSirenTexture("siren");
    this.makeSkibidiTexture("skibidiToilet");
    this.makeSonicWaveTexture("sonicWave");
    this.makePoopTexture("poopWave");
    this.makeIncubatorTexture("incubator");
    this.makeAvatarTexture();
    this.makeGoldPileTexture("coin");
    this.makeItemTexture("stoneResource", 0x94a3b8);
    this.makeItemTexture("ironResource", 0xd1d5db);
    this.makeItemTexture("key", 0x38bdf8);
    this.makeItemTexture("heart", 0xfb7185);
    this.makeItemTexture("energy", 0xfef08a);
    this.makeItemTexture("prize", 0xc084fc);
  }

  private makeBlockTexture(key: string, fill: number, stroke: number) {
    const graphics = this.make.graphics({ x: 0, y: 0 }, false);
    graphics.fillStyle(fill, 1);
    graphics.fillRect(0, 0, TILE, TILE);
    graphics.lineStyle(2, stroke, 1);
    graphics.strokeRect(1, 1, TILE - 2, TILE - 2);
    graphics.generateTexture(key, TILE, TILE);
    graphics.destroy();
  }

  private makeBrickTexture(key: string, fill: number, mortar: number) {
    const graphics = this.make.graphics({ x: 0, y: 0 }, false);
    graphics.fillStyle(fill, 1);
    graphics.fillRect(0, 0, TILE, TILE);
    graphics.lineStyle(3, mortar, 1);
    graphics.strokeRect(1, 1, TILE - 2, TILE - 2);
    graphics.lineBetween(0, 15, TILE, 15);
    const offset = key === "stone" ? 0 : 8;
    graphics.lineBetween(10 + offset, 0, 10 + offset, 15);
    graphics.lineBetween(24 + offset, 15, 24 + offset, TILE);
    graphics.generateTexture(key, TILE, TILE);
    graphics.destroy();
  }

  private makeLadderTexture(key: string, rail = 0xf8fafc, shade = 0x854d0e) {
    const graphics = this.make.graphics({ x: 0, y: 0 }, false);
    graphics.fillStyle(0x000000, 1);
    graphics.fillRect(0, 0, TILE, TILE);
    graphics.fillStyle(shade, 1);
    graphics.fillRect(7, 0, 4, TILE);
    graphics.fillRect(21, 0, 4, TILE);
    graphics.fillStyle(rail, 1);
    graphics.fillRect(5, 0, 5, TILE);
    graphics.fillRect(22, 0, 5, TILE);
    for (let y = 3; y < TILE; y += 10) {
      graphics.fillRect(5, y, 22, 5);
    }
    graphics.generateTexture(key, TILE, TILE);
    graphics.destroy();
  }

  private makeDoorTexture(key: string) {
    const graphics = this.make.graphics({ x: 0, y: 0 }, false);
    graphics.fillStyle(0x0f172a, 0.78);
    graphics.fillRoundedRect(6, 2, 20, 30, 3);
    graphics.fillStyle(0x7c2d12, 1);
    graphics.fillRoundedRect(9, 6, 14, 24, 2);
    graphics.lineStyle(2, 0xfbbf24, 1);
    graphics.strokeRoundedRect(6, 2, 20, 30, 3);
    graphics.fillStyle(0xfacc15, 1);
    graphics.fillCircle(20, 18, 2);
    graphics.generateTexture(key, TILE, TILE);
    graphics.destroy();
  }

  private makeGoldPileTexture(key: ItemType) {
    const graphics = this.make.graphics({ x: 0, y: 0 }, false);
    graphics.fillStyle(0xfacc15, 1);
    graphics.fillTriangle(3, 24, 13, 6, 25, 24);
    graphics.fillStyle(0xfff7ad, 1);
    graphics.fillCircle(12, 13, 2);
    graphics.fillCircle(16, 16, 2);
    graphics.fillCircle(9, 18, 2);
    graphics.fillCircle(19, 21, 2);
    graphics.lineStyle(2, 0xa16207, 1);
    graphics.strokeTriangle(3, 24, 13, 6, 25, 24);
    graphics.generateTexture(key, 28, 28);
    graphics.destroy();
  }

  private makeItemTexture(key: ItemType | "stoneResource" | "ironResource", color: number) {
    const graphics = this.make.graphics({ x: 0, y: 0 }, false);
    graphics.fillStyle(color, 1);
    graphics.fillCircle(12, 12, 10);
    graphics.lineStyle(2, 0x111827, 1);
    graphics.strokeCircle(12, 12, 10);
    if (key === "key") {
      graphics.fillRect(18, 10, 9, 4);
      graphics.fillRect(24, 14, 3, 5);
    }
    if (key === "energy") {
      graphics.fillStyle(0xffffff, 1);
      graphics.fillTriangle(13, 2, 6, 14, 14, 13);
      graphics.fillTriangle(11, 12, 18, 11, 9, 24);
    }
    graphics.generateTexture(key, 28, 28);
    graphics.destroy();
  }

  private makeHauntedTrainTexture(key: string) {
    const graphics = this.make.graphics({ x: 0, y: 0 }, false);
    graphics.fillStyle(0x111827, 1);
    graphics.fillRect(3, 12, 24, 13);
    graphics.fillStyle(0x1d4ed8, 1);
    graphics.fillRect(5, 9, 15, 13);
    graphics.fillStyle(0x7f1d1d, 1);
    graphics.fillRect(20, 14, 7, 8);
    graphics.fillStyle(0xf8fafc, 1);
    graphics.fillCircle(10, 15, 3);
    graphics.fillCircle(18, 15, 3);
    graphics.fillStyle(0xef4444, 1);
    graphics.fillCircle(10, 15, 1.5);
    graphics.fillCircle(18, 15, 1.5);
    graphics.lineStyle(3, 0x0f172a, 1);
    graphics.lineBetween(8, 25, 4, 31);
    graphics.lineBetween(14, 25, 12, 31);
    graphics.lineBetween(21, 25, 25, 31);
    graphics.lineStyle(2, 0xfacc15, 1);
    graphics.strokeCircle(8, 26, 3);
    graphics.strokeCircle(21, 26, 3);
    graphics.generateTexture(key, 32, 32);
    graphics.destroy();
  }

  private makeLongArmMonsterTexture(key: string) {
    const graphics = this.make.graphics({ x: 0, y: 0 }, false);
    graphics.lineStyle(4, 0x1d4ed8, 1);
    graphics.lineBetween(8, 17, 1, 27);
    graphics.lineBetween(24, 17, 31, 27);
    graphics.lineBetween(12, 25, 9, 32);
    graphics.lineBetween(20, 25, 23, 32);
    graphics.fillStyle(0x2563eb, 1);
    graphics.fillRoundedRect(7, 7, 18, 20, 4);
    graphics.fillStyle(0x1e40af, 1);
    graphics.fillRect(10, 22, 12, 5);
    graphics.fillStyle(0xfef08a, 1);
    graphics.fillCircle(12, 14, 3);
    graphics.fillCircle(20, 14, 3);
    graphics.fillStyle(0x111827, 1);
    graphics.fillCircle(12, 14, 1.4);
    graphics.fillCircle(20, 14, 1.4);
    graphics.fillStyle(0xef4444, 1);
    graphics.fillRect(11, 20, 10, 3);
    graphics.fillStyle(0xffffff, 1);
    graphics.fillTriangle(13, 20, 15, 20, 14, 23);
    graphics.fillTriangle(18, 20, 20, 20, 19, 23);
    graphics.lineStyle(2, 0x0f172a, 1);
    graphics.strokeRoundedRect(7, 7, 18, 20, 4);
    graphics.generateTexture(key, 32, 34);
    graphics.destroy();
  }

  private makeSirenTexture(key: string) {
    const graphics = this.make.graphics({ x: 0, y: 0 }, false);
    graphics.lineStyle(4, 0x3f2f1c, 1);
    graphics.lineBetween(16, 7, 16, 28);
    graphics.lineBetween(16, 15, 8, 24);
    graphics.lineBetween(16, 15, 24, 24);
    graphics.lineBetween(16, 28, 10, 32);
    graphics.lineBetween(16, 28, 22, 32);
    graphics.fillStyle(0x5b4636, 1);
    graphics.fillRect(8, 2, 8, 7);
    graphics.fillRect(17, 2, 8, 7);
    graphics.fillStyle(0xef4444, 1);
    graphics.fillRect(10, 4, 4, 3);
    graphics.fillRect(19, 4, 4, 3);
    graphics.lineStyle(2, 0x111827, 1);
    graphics.strokeRect(8, 2, 8, 7);
    graphics.strokeRect(17, 2, 8, 7);
    graphics.generateTexture(key, 32, 34);
    graphics.destroy();
  }

  private makeSkibidiTexture(key: string) {
    const graphics = this.make.graphics({ x: 0, y: 0 }, false);
    graphics.fillStyle(0xe5e7eb, 1);
    graphics.fillRoundedRect(6, 15, 20, 15, 5);
    graphics.fillStyle(0xf8fafc, 1);
    graphics.fillEllipse(16, 15, 18, 9);
    graphics.fillStyle(0xf4c7a1, 1);
    graphics.fillRoundedRect(10, 4, 12, 14, 4);
    graphics.fillStyle(0x111827, 1);
    graphics.fillCircle(13, 10, 1.7);
    graphics.fillCircle(19, 10, 1.7);
    graphics.fillStyle(0xef4444, 1);
    graphics.fillRect(13, 15, 6, 2);
    graphics.lineStyle(2, 0x374151, 1);
    graphics.strokeRoundedRect(6, 15, 20, 15, 5);
    graphics.strokeEllipse(16, 15, 18, 9);
    graphics.lineStyle(2, 0x111827, 1);
    graphics.lineBetween(9, 30, 5, 33);
    graphics.lineBetween(23, 30, 27, 33);
    graphics.generateTexture(key, 32, 34);
    graphics.destroy();
  }

  private makeSonicWaveTexture(key: string) {
    const graphics = this.make.graphics({ x: 0, y: 0 }, false);
    graphics.lineStyle(2, 0x93c5fd, 1);
    graphics.strokeCircle(8, 8, 4);
    graphics.strokeCircle(8, 8, 7);
    graphics.lineStyle(1, 0xf8fafc, 1);
    graphics.lineBetween(1, 8, 15, 8);
    graphics.generateTexture(key, 16, 16);
    graphics.destroy();
  }

  private makePoopTexture(key: string) {
    const graphics = this.make.graphics({ x: 0, y: 0 }, false);
    graphics.fillStyle(0x7c2d12, 1);
    graphics.fillCircle(8, 11, 6);
    graphics.fillCircle(5, 13, 4);
    graphics.fillCircle(11, 13, 4);
    graphics.fillStyle(0xa16207, 1);
    graphics.fillCircle(8, 6, 3);
    graphics.lineStyle(1, 0x3f1d0b, 1);
    graphics.strokeCircle(8, 11, 6);
    graphics.generateTexture(key, 16, 16);
    graphics.destroy();
  }

  private makeIncubatorTexture(key: string) {
    const graphics = this.make.graphics({ x: 0, y: 0 }, false);
    graphics.fillStyle(0x3b1d4a, 1);
    graphics.fillRoundedRect(2, 3, 28, 26, 4);
    graphics.fillStyle(0x22d3ee, 0.45);
    graphics.fillRoundedRect(6, 7, 20, 16, 3);
    graphics.lineStyle(2, 0xf0abfc, 1);
    graphics.strokeRoundedRect(2, 3, 28, 26, 4);
    graphics.lineStyle(1, 0xffffff, 0.8);
    graphics.lineBetween(9, 9, 22, 21);
    graphics.lineBetween(22, 9, 9, 21);
    graphics.generateTexture(key, 32, 32);
    graphics.destroy();
  }

  private makeAvatarTexture() {
    const c = this.customization;
    const graphics = this.make.graphics({ x: 0, y: 0 }, false);
    const hasPixelSkin = c.pixelSkin?.some((row) => row.some(Boolean));
    if (hasPixelSkin && c.pixelSkin) {
      c.pixelSkin.forEach((row, y) => {
        row.forEach((color, x) => {
          if (!color) return;
          graphics.fillStyle(Phaser.Display.Color.HexStringToColor(color).color, 1);
          graphics.fillRect(x * 2, y * 2, 2, 2);
        });
      });
      graphics.generateTexture("hero", 32, 32);
      graphics.destroy();
      return;
    }
    graphics.fillStyle(0xf4c7a1, 1);
    graphics.fillRect(8, 2, 16, 11);
    graphics.fillStyle(Phaser.Display.Color.HexStringToColor(c.hairColor).color, 1);
    const hairHeight = c.hairLength === "long" ? 9 : c.hairLength === "medium" ? 7 : 5;
    graphics.fillRect(6, 0, 20, hairHeight);
    graphics.fillStyle(Phaser.Display.Color.HexStringToColor(c.hoodie).color, 1);
    graphics.fillRect(5, 14, 22, 12);
    graphics.fillStyle(Phaser.Display.Color.HexStringToColor(c.pants).color, 1);
    graphics.fillRect(7, 26, 8, 6);
    graphics.fillRect(17, 26, 8, 6);
    graphics.fillStyle(Phaser.Display.Color.HexStringToColor(c.hat).color, 1);
    graphics.fillRect(5, 0, 22, 4);
    graphics.fillRect(10, -4, 12, 5);
    graphics.fillStyle(0x111827, 1);
    graphics.fillRect(12, 8, 2, 2);
    graphics.fillRect(20, 8, 2, 2);
    if (c.face === "happy") graphics.fillRect(15, 11, 6, 2);
    if (c.face === "serious") graphics.fillRect(14, 11, 8, 1);
    if (c.face === "angry") {
      graphics.lineStyle(2, 0x111827, 1);
      graphics.lineBetween(11, 6, 15, 8);
      graphics.lineBetween(19, 8, 23, 6);
    }
    if (c.face === "surprised") graphics.strokeCircle(17, 11, 3);
    graphics.generateTexture("hero", 32, 32);
    graphics.destroy();
  }

  private buildMap() {
    this.level.map.forEach((row, y) => {
      [...row].forEach((tile, x) => {
        const px = x * TILE + TILE / 2;
        const py = y * TILE + TILE / 2;
        const key = `${x}:${y}`;
        if (tile === "#") this.createSolidTile(key, px, py, "stone", false);
        if (tile === "S") this.createSolidTile(key, px, py, "ground", true);
        if (tile === "P") this.createSolidTile(key, px, py, "platform", true);
        if (tile === "L") this.tileSprites.set(key, this.ladders.create(px, py, "ladder").setDepth(2));
        if (tile === "D") this.tileSprites.set(key, this.add.image(px, py, "door").setDepth(3));
      });
    });

    this.exitZone = this.physics.add.staticSprite(
      this.level.exit.x * TILE + TILE / 2,
      this.level.exit.y * TILE + TILE / 2,
      "exit",
    ).setDepth(2);
  }

  private createSolidTile(key: string, px: number, py: number, textureKey: string, diggable: boolean) {
    const tile = this.solids.create(px, py, textureKey).setDepth(1);
    tile.setData("tileKey", key);
    tile.setData("textureKey", textureKey);
    tile.setData("diggable", diggable);
    this.tileSprites.set(key, tile);
  }

  private createPlayer() {
    const spawn = this.profile.spawnPoint ?? this.level.player;
    this.player = this.physics.add.sprite(
      spawn.x * TILE + TILE / 2,
      spawn.y * TILE,
      "hero",
    );
    this.player.setSize(20, 30).setOffset(6, 2).setCollideWorldBounds(true).setDepth(10);
  }

  private createIncubators() {
    this.level.incubators.forEach((incubator) => {
      const x = incubator.x * TILE + TILE / 2;
      const y = incubator.y * TILE + TILE / 2;
      const sprite = this.add.container(x, y, [
        this.add.image(0, 0, "incubator"),
        this.add.rectangle(0, 20, 26, 4, 0x111827, 1),
      ]);
      const bar = this.add.rectangle(-13, 20, 0, 4, 0x22c55e, 1).setOrigin(0, 0.5);
      sprite.add(bar);
      this.incubators.push({ x: incubator.x, y: incubator.y, sprite, bar, readyAt: 0, growing: false });
    });
  }

  private createEnemies() {
    this.level.enemies.forEach((enemy) => {
      this.spawnEnemy(enemy.x, enemy.y, enemy.type);
    });
  }

  private spawnEnemy(x: number, y: number, type: EnemySprite["enemyType"] = "walker") {
    const texture =
      type === "flyer"
        ? "enemyFlyer"
        : type === "hauntedTrain"
          ? "hauntedTrain"
          : type === "siren"
            ? "siren"
            : type === "skibidiToilet"
              ? "skibidiToilet"
              : "enemy";
    const sprite = this.enemies.create(x * TILE + TILE / 2, y * TILE, texture) as EnemySprite;
    sprite.setDepth(8);
    sprite.enemyType = type;
    sprite.hp = type === "hunter" || type === "shooter" || type === "siren" || type === "hauntedTrain" || type === "skibidiToilet" ? 2 : 1;
    sprite.dir = Math.random() > 0.5 ? 1 : -1;
    sprite.lastWaveAt = 0;
    sprite.climbIntentUntil = 0;
    sprite.setData("spawned", `spawn-${this.enemySerial++}`);
    if (type === "hauntedTrain") sprite.setSize(28, 20).setOffset(2, 10);
    else if (type === "siren") sprite.setSize(18, 31).setOffset(7, 2);
    else if (type === "skibidiToilet") sprite.setSize(22, 29).setOffset(5, 4);
    else sprite.setSize(24, 28);
    sprite.setCollideWorldBounds(true);
    if (type === "flyer") sprite.setGravityY(-GRAVITY);
    return sprite;
  }

  private setupCamera() {
    this.cameras.main.setBounds(0, 0, this.level.map[0].length * TILE, this.level.map.length * TILE);
    this.cameras.main.startFollow(this.player, true, 0.12, 0.12);
    this.cameras.main.setDeadzone(140, 80);
  }

  private setupMultiplayer() {
    if (typeof window === "undefined") return;
    this.socket = io(process.env.NEXT_PUBLIC_LODEGAME_SOCKET_URL ?? "http://localhost:3001", {
      transports: ["websocket", "polling"],
    });
    this.socket.emit("player:join", this.multiplayerState());
    this.socket.emit("world:request");
    this.socket.on("players:snapshot", ({ online, players }: { online: number; players: Array<{ id: string; x: number; y: number; name: string; hoodie: string }> }) => {
      this.stats.onlinePlayers = Math.max(1, online);
      const visibleIds = new Set(players.map((player) => player.id));
      this.remotePlayers.forEach((remote, id) => {
        if (visibleIds.has(id)) return;
        remote.sprite.destroy();
        remote.label.destroy();
        this.remotePlayers.delete(id);
      });
      for (const player of players) {
        if (player.id === this.socket?.id) continue;
        this.upsertRemotePlayer(player);
      }
    });
    this.socket.on("player:update", (player: { id: string; x: number; y: number; name: string; hoodie: string }) => this.upsertRemotePlayer(player));
    this.socket.on("player:leave", (id: string) => {
      const remote = this.remotePlayers.get(id);
      remote?.sprite.destroy();
      remote?.label.destroy();
      this.remotePlayers.delete(id);
    });
    this.socket.on("world:snapshot", ({ map, gold, resources, prizes }: { map: string[]; gold: WorldGold[]; resources?: WorldResource[]; prizes?: WorldPrize[] }) => {
      this.applyWorldMap(map);
      this.replaceWorldGold(gold);
      this.replaceWorldResources(resources ?? []);
      prizes?.forEach((prize) => this.createWorldPrize(prize));
      this.callbacks.onMessage("Общий мир синхронизирован. Камень и железо можно собирать на карте.");
    });
    this.socket.on("world:tile", ({ x, y, tile }: { x: number; y: number; tile: "." | "P" | "L" | "D" }) => this.applyTile(x, y, tile));
    this.socket.on("world:gold:spawn", (gold: WorldGold) => {
      this.createWorldGold(gold);
      this.stats.goldTotal = this.itemSprites.size;
    });
    this.socket.on("gold:collected", ({ id }: { id: string }) => {
      this.itemSprites.get(id)?.destroy();
      this.itemSprites.delete(id);
      this.stats.goldTotal = this.itemSprites.size;
    });
    this.socket.on("world:resource:spawn", (resource: WorldResource) => this.createWorldResource(resource));
    this.socket.on("resource:collected", ({ id }: { id: string }) => {
      this.resourceSprites.get(id)?.destroy();
      this.resourceSprites.delete(id);
    });
    this.socket.on("world:prize:spawn", (prize: WorldPrize) => this.createWorldPrize(prize));
    this.socket.on("world:prize:despawn", ({ id }: { id: string }) => {
      this.prizeSprites.get(id)?.destroy();
      this.prizeSprites.delete(id);
    });
  }

  private multiplayerState() {
    return {
      levelId: this.level.id,
      x: this.player.x,
      y: this.player.y,
      face: this.customization.face,
      hoodie: this.customization.hoodie,
      name: this.profile.nickname,
      accountId: this.profile.email ?? this.profile.nickname,
    };
  }

  private setupPauseBridge() {
    if (typeof window === "undefined") return;
    this.pauseListener = (event: Event) => {
      const paused = Boolean((event as CustomEvent<{ paused?: boolean }>).detail?.paused);
      this.setNetworkPaused(paused);
    };
    window.addEventListener("lodegame:pause-change", this.pauseListener);
  }

  private setNetworkPaused(paused: boolean) {
    if (!this.socket || this.networkPaused === paused) return;
    this.networkPaused = paused;
    if (paused) {
      this.socket.emit("player:pause");
      return;
    }
    this.socket.emit("player:join", this.multiplayerState());
  }

  private upsertRemotePlayer(player: { id: string; x: number; y: number; name: string; hoodie: string }) {
    if (!this.canUseDisplayList() || !Number.isFinite(player.x) || !Number.isFinite(player.y)) return;
    let remote = this.remotePlayers.get(player.id);
    if (!remote) {
      const color = /^#[0-9a-fA-F]{6}$/.test(player.hoodie) ? Phaser.Display.Color.HexStringToColor(player.hoodie).color : 0x38bdf8;
      const sprite = this.add.rectangle(player.x, player.y, 20, 30, color, 0.85);
      sprite.setStrokeStyle(2, 0xffffff, 0.9);
      sprite.setDepth(9);
      const label = this.add.text(player.x - 22, player.y - 28, String(player.name || "Игрок").slice(0, 24), { fontSize: "10px", color: "#e0f2fe" }).setDepth(11);
      remote = { sprite, label };
      this.remotePlayers.set(player.id, remote);
    }
    remote.sprite.setPosition(Phaser.Math.Linear(remote.sprite.x, player.x, 0.45), Phaser.Math.Linear(remote.sprite.y, player.y, 0.45));
    remote.label.setPosition(remote.sprite.x - 22, remote.sprite.y - 28);
  }

  private createItems() {
    this.level.items.forEach((item) => {
      const sprite = this.items.create(item.x * TILE + TILE / 2, item.y * TILE + TILE / 2, item.type);
      sprite.setDepth(6);
      sprite.setData("type", item.type);
    });
  }

  private applyWorldMap(map: string[]) {
    if (!map.length) return;
    [...this.tileSprites.values()].forEach((tile) => tile.destroy());
    this.tileSprites.clear();
    this.solids.clear(true, true);
    this.ladders.clear(true, true);
    this.holes.forEach((hole) => hole.sprite.destroy());
    this.holes.clear();
    this.exitZone?.destroy();
    this.level.map = map.slice();
    this.physics.world.setBounds(0, 0, this.level.map[0].length * TILE, this.level.map.length * TILE);
    this.cameras.main.setBounds(0, 0, this.level.map[0].length * TILE, this.level.map.length * TILE);
    this.buildMap();
    this.physics.add.collider(this.player, this.solids);
    this.physics.add.collider(this.enemies, this.solids);
    this.physics.add.collider(this.bullets, this.solids, this.hitSolidWithBullet, undefined, this);
  }

  private applyTile(x: number, y: number, tile: "." | "P" | "L" | "D") {
    if (!this.level.map[y]) return;
    const key = `${x}:${y}`;
    this.tileSprites.get(key)?.destroy();
    this.tileSprites.delete(key);
    this.holes.get(key)?.sprite.destroy();
    this.holes.delete(key);
    this.level.map[y] = `${this.level.map[y].slice(0, x)}${tile}${this.level.map[y].slice(x + 1)}`;

    const px = x * TILE + TILE / 2;
    const py = y * TILE + TILE / 2;
    if (tile === "P") this.createSolidTile(key, px, py, "platform", true);
    if (tile === "L") this.tileSprites.set(key, this.ladders.create(px, py, "ladder").setDepth(2));
    if (tile === "D") this.tileSprites.set(key, this.add.image(px, py, "door").setDepth(3));
  }

  private replaceWorldGold(gold: WorldGold[]) {
    this.items.clear(true, true);
    this.itemSprites.clear();
    this.resourceSprites.clear();
    this.prizeSprites.clear();
    gold.forEach((item) => this.createWorldGold(item));
    this.stats.goldTotal = gold.length;
  }

  private createWorldGold(gold: WorldGold) {
    if (!this.canCreateWorldItem() || !Number.isFinite(gold.x) || !Number.isFinite(gold.y)) return;
    if (this.itemSprites.has(gold.id)) return;
    const sprite = this.items.create(gold.x * TILE + TILE / 2, gold.y * TILE + TILE / 2, "coin") as Phaser.Physics.Arcade.Sprite;
    sprite.setDepth(6);
    sprite.setData("type", "coin");
    sprite.setData("id", gold.id);
    this.itemSprites.set(gold.id, sprite);
  }

  private replaceWorldResources(resources: WorldResource[]) {
    resources.forEach((resource) => this.createWorldResource(resource));
  }

  private createWorldResource(resource: WorldResource) {
    if (!this.canCreateWorldItem() || !Number.isFinite(resource.x) || !Number.isFinite(resource.y)) return;
    if (this.resourceSprites.has(resource.id)) return;
    const texture = resource.kind === "iron" ? "ironResource" : "stoneResource";
    const sprite = this.items.create(resource.x * TILE + TILE / 2, resource.y * TILE + TILE / 2, texture) as Phaser.Physics.Arcade.Sprite;
    sprite.setDepth(6);
    sprite.setData("type", resource.kind);
    sprite.setData("id", resource.id);
    this.resourceSprites.set(resource.id, sprite);
  }

  private createWorldPrize(prize: WorldPrize) {
    if (!this.canCreateWorldItem() || !Number.isFinite(prize.x) || !Number.isFinite(prize.y)) return;
    if (this.prizeSprites.has(prize.id)) return;
    const sprite = this.items.create(prize.x * TILE + TILE / 2, prize.y * TILE + TILE / 2, "prize") as Phaser.Physics.Arcade.Sprite;
    sprite.setDepth(7);
    sprite.setData("type", "prize");
    sprite.setData("prize", prize);
    this.prizeSprites.set(prize.id, sprite);
    this.tweens.add({ targets: sprite, y: sprite.y - 5, duration: 420, yoyo: true, repeat: -1 });
    this.callbacks.onMessage(`На карте появился суперприз: ${prize.name}.`);
  }

  private canCreateWorldItem() {
    return Boolean(!this.destroyed && this.items && this.items.scene?.sys && this.scene.isActive());
  }

  private canUseDisplayList() {
    return Boolean(!this.destroyed && this.add && this.sys?.displayList && this.scene.isActive());
  }

  private collectPrize(prize: WorldPrize) {
    if (this.backpackLoad() + prize.weight > this.backpackCapacity()) {
      this.callbacks.onMessage(`Рюкзак переполнен: нужно место под ${prize.weight}, свободно ${Math.max(0, this.backpackCapacity() - this.backpackLoad())}. Освободите место, наденьте или продайте вещь.`);
      this.callbacks.onBackpackFull?.();
      return false;
    }
    this.socket?.emit("prize:collect", { id: prize.id });
    this.prizeSprites.delete(prize.id);
    this.updateProfile((profile) => ({ ...profile, inventory: [...profile.inventory, prize] }));
    this.playSfx("open");
    this.callbacks.onMessage(`Суперприз в рюкзаке: ${prize.name}. Можно использовать или продать.`);
    return true;
  }

  private createInput() {
    this.cursors = this.input.keyboard!.createCursorKeys();
    this.keys = this.input.keyboard!.addKeys("W,A,S,D,Q,E,R,SPACE,ONE,TWO,THREE,FOUR,FIVE") as Record<string, Phaser.Input.Keyboard.Key>;
    this.input.keyboard!.addCapture("SPACE");
    this.input.on("pointerdown", () => {
      this.unlockAudio();
      if (this.tryBuildAtPointer()) return;
      this.shoot(this.time.now);
    });
    this.input.keyboard!.on("keydown", this.unlockAudio, this);
    window.addEventListener("lodegame:control", this.handleMobileControl as EventListener);
    window.addEventListener("lodegame:build-mode", this.handleBuildMode as EventListener);
    window.addEventListener("lodegame:profile-update", this.handleProfileUpdate as EventListener);
    window.addEventListener("lodegame:set-spawn", this.handleSetSpawn as EventListener);
    window.addEventListener("lodegame:chat-focus", this.handleChatFocus as EventListener);
  }

  private handleMobileControl = (event: CustomEvent<{ action: string; active: boolean }>) => {
    const { action, active } = event.detail;
    if (active) this.unlockAudio();
    if (action in this.mobile) this.mobile[action as keyof typeof this.mobile] = active;
    if (active && action === "jump") this.jump(this.canJumpFromLadder(this.time.now));
    if (active && action === "shoot") this.shoot(this.time.now);
    if (active && action === "dig") this.dig(this.time.now);
    if (active && action === "super") this.superWeapon(this.time.now);
  };

  private handleBuildMode = (event: CustomEvent<{ mode: BuildMode }>) => {
    this.setBuildMode(event.detail.mode);
  };

  private handleProfileUpdate = (event: CustomEvent<{ profile: PlayerProfile }>) => {
    this.profile = event.detail.profile;
    this.syncPersistentStats();
  };

  private handleSetSpawn = () => {
    const x = Math.floor(this.player.x / TILE);
    const y = Math.floor(this.player.y / TILE);
    this.updateProfile((profile) => ({ ...profile, spawnPoint: { x, y } }));
    this.callbacks.onMessage(`Точка старта сохранена: ${x}:${y}. При входе и потере жизни герой появится здесь.`);
    this.playSfx("open");
  };

  private handleChatFocus = (event: CustomEvent<{ active: boolean }>) => {
    this.chatFocused = Boolean(event.detail.active);
    if (this.input.keyboard) this.input.keyboard.enabled = !this.chatFocused;
    if (this.chatFocused) this.player.setVelocityX(0);
  };

  private setBuildMode(mode: BuildMode) {
    this.buildMode = mode;
    const labels: Record<BuildMode, string> = {
      none: "Строительство выключено.",
      wall: "Режим строительства стены: кликните рядом с героем.",
      ladder: "Режим строительства лестницы: кликните рядом с героем.",
      door: "Режим строительства двери: кликните рядом с героем.",
      remove: "Режим демонтажа: кликните по стене, лестнице или двери.",
    };
    this.callbacks.onMessage(labels[this.buildMode]);
  }

  private tryBuildAtPointer() {
    if (this.buildMode === "none") return false;
    const pointer = this.input.activePointer;
    const worldPoint = pointer.positionToCamera(this.cameras.main) as Phaser.Math.Vector2;
    const x = Math.floor(worldPoint.x / TILE);
    const y = Math.floor(worldPoint.y / TILE);
    const playerTileX = Math.floor(this.player.x / TILE);
    const playerTileY = Math.floor(this.player.y / TILE);
    if (x === playerTileX && Math.abs(y - playerTileY) <= 1) {
      this.callbacks.onMessage("Нельзя строить прямо внутри героя.");
      return true;
    }
    const playerDistance = Phaser.Math.Distance.Between(this.player.x, this.player.y, x * TILE + TILE / 2, y * TILE + TILE / 2);
    if (playerDistance > TILE * 4.2) {
      this.callbacks.onMessage("Строить можно только рядом с героем.");
      return true;
    }

    const current = this.level.map[y]?.[x];
    if (!current || current === "#") return true;
    const stoneCost = this.buildMode === "wall" || this.buildMode === "door" ? 1 : 0;
    const ironCost = this.buildMode === "ladder" || this.buildMode === "door" ? 1 : 0;
    if (this.profile.stone < stoneCost || this.profile.iron < ironCost) {
      this.callbacks.onMessage(`Не хватает ресурсов: нужно камень ${stoneCost}, железо ${ironCost}.`);
      return true;
    }

    if (this.buildMode === "wall" && current === ".") {
      this.updateProfile((profile) => ({ ...profile, stone: profile.stone - stoneCost, materials: profile.stone - stoneCost }));
      this.applyTile(x, y, "P");
      this.socket?.emit("world:build", { x, y, tile: "P" });
      this.playSfx("dig");
      return true;
    }
    if (this.buildMode === "ladder" && current === ".") {
      this.updateProfile((profile) => ({ ...profile, stone: profile.stone - stoneCost, iron: profile.iron - ironCost, materials: profile.stone - stoneCost }));
      this.applyTile(x, y, "L");
      this.socket?.emit("world:build", { x, y, tile: "L" });
      this.playSfx("open");
      return true;
    }
    if (this.buildMode === "door" && current === ".") {
      this.updateProfile((profile) => ({ ...profile, stone: profile.stone - stoneCost, iron: profile.iron - ironCost, materials: profile.stone - stoneCost }));
      this.applyTile(x, y, "D");
      this.socket?.emit("world:build", { x, y, tile: "D" });
      this.playSfx("open");
      return true;
    }
    if (this.buildMode === "remove" && (current === "P" || current === "S" || current === "L" || current === "D")) {
      this.applyTile(x, y, ".");
      if (current === "L") this.updateProfile((profile) => ({ ...profile, stone: profile.stone + 1, materials: profile.stone + 1 }));
      if (current === "P" || current === "S") this.updateProfile((profile) => ({ ...profile, stone: profile.stone + 1, materials: profile.stone + 1 }));
      if (current === "D") this.updateProfile((profile) => ({ ...profile, stone: profile.stone + 1, iron: profile.iron + 1, materials: profile.stone + 1 }));
      this.socket?.emit("world:build", { x, y, tile: "." });
      this.playSfx("dig");
      return true;
    }

    this.callbacks.onMessage("Эту клетку нельзя изменить выбранным инструментом.");
    return true;
  }

  private updatePlayer(time: number) {
    if (this.chatFocused) {
      this.player.setVelocityX(0);
      return;
    }
    const left = this.cursors.left.isDown || this.keys.A.isDown || this.mobile.left;
    const right = this.cursors.right.isDown || this.keys.D.isDown || this.mobile.right;
    const up = this.cursors.up.isDown || this.keys.W.isDown || this.mobile.up;
    const down = this.cursors.down.isDown || this.keys.S.isDown || this.mobile.down;
    const onLadder = this.isSpriteOnLadder(this.player);
    if (onLadder) this.lastOnLadderAt = time;
    const wantsHorizontalExit = onLadder && (left || right) && !up && !down;
    const speed = this.runSpeed();
    const jumpPressed = Phaser.Input.Keyboard.JustDown(this.keys.SPACE);

    if (left) {
      this.player.setVelocityX(-speed);
      this.facing = -1;
      this.player.setFlipX(true);
    } else if (right) {
      this.player.setVelocityX(speed);
      this.facing = 1;
      this.player.setFlipX(false);
    } else {
      this.player.setVelocityX(0);
    }

    if (jumpPressed) {
      this.setGravity(this.player, true);
      this.jump(this.canJumpFromLadder(time));
    } else if (onLadder && !wantsHorizontalExit) {
      this.setGravity(this.player, false);
      if (up || down) this.player.x = Phaser.Math.Linear(this.player.x, this.tileCenterX(this.player.x), 0.16);
      if (up || down) {
        this.player.setVelocityY(up ? -120 : 120);
      } else {
        this.player.setVelocityY(0);
      }
    } else {
      this.setGravity(this.player, true);
    }

    if (Phaser.Input.Keyboard.JustDown(this.keys.E)) this.shoot(time);
    if (Phaser.Input.Keyboard.JustDown(this.keys.Q)) this.dig(time);
    if (Phaser.Input.Keyboard.JustDown(this.keys.R)) this.superWeapon(time);
    if (Phaser.Input.Keyboard.JustDown(this.keys.ONE)) this.setBuildMode("wall");
    if (Phaser.Input.Keyboard.JustDown(this.keys.TWO)) this.setBuildMode("ladder");
    if (Phaser.Input.Keyboard.JustDown(this.keys.THREE)) this.setBuildMode("remove");
    if (Phaser.Input.Keyboard.JustDown(this.keys.FOUR)) this.setBuildMode("door");
    if (Phaser.Input.Keyboard.JustDown(this.keys.FIVE)) this.setBuildMode("none");
  }

  private canJumpFromLadder(time: number) {
    return this.isSpriteOnLadder(this.player) || time - this.lastOnLadderAt < 220;
  }

  private jump(force = false) {
    if (force || this.player.body?.blocked.down || this.player.body?.touching.down || this.isSpriteOnLadder(this.player)) {
      this.setGravity(this.player, true);
      this.player.setVelocityY(-this.jumpSpeed());
      this.playSfx("jump");
    }
  }

  private shoot(time: number) {
    if (time - this.lastShotAt < this.fireCooldown()) return;
    this.lastShotAt = time;
    const bullet = this.bullets.create(this.player.x + this.facing * 20, this.player.y - 6, "bullet") as Phaser.Physics.Arcade.Sprite;
    bullet.setData("spawnX", bullet.x);
    bullet.setVelocityX(this.facing * BULLET_SPEED);
    bullet.setSize(16, 8);
    this.playSfx("shoot");
  }

  private backpackCapacity() {
    return 10 + this.profile.upgrades.backpack * 6 + this.gearPower("backpack") * 6;
  }

  private backpackLoad() {
    return this.profile.inventory.reduce((sum, item) => sum + item.weight, 0);
  }

  private carriedWeight() {
    return (
      this.backpackLoad() +
      Object.values(this.profile.equipment).reduce((sum, item) => sum + (item?.weight ?? 0), 0) +
      (this.profile.upgrades.backpack + this.gearPower("backpack")) * 1.5
    );
  }

  private carryPenalty() {
    const strengthAllowance = 8 + (this.profile.upgrades.strength + this.gearPower("strength")) * 4;
    return Phaser.Math.Clamp((this.carriedWeight() - strengthAllowance) / 28, 0, 0.42);
  }

  private runSpeed() {
    return Math.round((PLAYER_SPEED + (this.profile.upgrades.runSpeed + this.gearPower("runSpeed")) * 12) * (1 - this.carryPenalty()));
  }

  private jumpSpeed() {
    return Math.round((JUMP_SPEED + (this.profile.upgrades.jumpHeight + this.gearPower("jumpHeight")) * 16) * (1 - this.carryPenalty() * 0.75));
  }

  private fireCooldown() {
    return Math.max(190, 500 - (this.profile.upgrades.fireRate + this.gearPower("fireRate")) * 36);
  }

  private shotDamage() {
    return 1 + this.profile.upgrades.shotDamage + this.gearPower("shotDamage");
  }

  private armorMultiplier() {
    return Math.max(0.45, 1 - (this.profile.upgrades.armor + this.gearPower("armor")) * 0.07);
  }

  private gearPower(effect: InventoryItem["effect"]) {
    return Object.values(this.profile.equipment).reduce((sum, item) => sum + (item?.effect === effect ? item.power : 0), 0);
  }

  private syncPersistentStats() {
    this.stats.score = this.profile.score;
    this.stats.gold = this.profile.gold;
    this.stats.materials = this.profile.materials;
    this.stats.stone = this.profile.stone;
    this.stats.iron = this.profile.iron;
    this.stats.backpackLoad = this.backpackLoad();
    this.stats.backpackCapacity = this.backpackCapacity();
    this.callbacks.onProfileChange?.(this.profile);
  }

  private updateProfile(recipe: (profile: PlayerProfile) => PlayerProfile) {
    this.profile = recipe(this.profile);
    this.syncPersistentStats();
  }

  private trackPlayTime(delta: number) {
    this.playTimeSincePersist += delta;
    if (this.playTimeSincePersist < 10_000) return;
    const playTimeMs = Math.floor(this.playTimeSincePersist);
    this.playTimeSincePersist = 0;
    this.updateProfile((profile) => ({ ...profile, playTimeMs: (profile.playTimeMs ?? 0) + playTimeMs }));
  }

  private flushPlayTime() {
    if (this.playTimeSincePersist <= 0) return;
    const playTimeMs = Math.floor(this.playTimeSincePersist);
    this.playTimeSincePersist = 0;
    this.updateProfile((profile) => ({ ...profile, playTimeMs: (profile.playTimeMs ?? 0) + playTimeMs }));
  }

  private recordEnemyKill(count = 1) {
    if (count <= 0) return;
    this.updateProfile((profile) => ({ ...profile, enemiesKilled: (profile.enemiesKilled ?? 0) + count }));
  }

  private recordGoldMined(count = 1) {
    if (count <= 0) return;
    this.updateProfile((profile) => ({ ...profile, goldMined: (profile.goldMined ?? 0) + count }));
  }

  private normalizeItem(item: InventoryItem): InventoryItem {
    const previousDurabilityMs = Math.max(1, item.durabilityMs ?? ITEM_DURABILITY_MS);
    const previousRemainingMs = Math.max(0, item.remainingMs ?? previousDurabilityMs);
    const remainingRatio = Math.min(1, previousRemainingMs / previousDurabilityMs);
    return {
      ...item,
      durabilityMs: ITEM_DURABILITY_MS,
      remainingMs: Math.round(ITEM_DURABILITY_MS * remainingRatio),
    };
  }

  private updateEquipmentWear(delta: number) {
    const entries = Object.entries(this.profile.equipment) as Array<[GearSlot, InventoryItem | undefined]>;
    if (!entries.some(([, item]) => item)) return;
    let expired: string[] = [];
    const equipment = { ...this.profile.equipment };
    for (const [slot, item] of entries) {
      if (!item) continue;
      const normalized = this.normalizeItem(item);
      const remainingMs = Math.max(0, normalized.remainingMs - delta);
      if (remainingMs <= 0) {
        delete equipment[slot];
        expired = [...expired, normalized.name];
      } else {
        equipment[slot] = { ...normalized, remainingMs };
      }
    }
    this.updateProfile((profile) => ({ ...profile, equipment }));
    if (expired.length) this.callbacks.onMessage(`Срок службы истёк: ${expired.join(", ")}.`);
  }

  private addScore(amount: number) {
    if (amount <= 0) return;
    this.updateProfile((profile) => ({ ...profile, score: profile.score + amount }));
  }

  private dig(time: number) {
    if (time - this.lastDigAt < 650) return;
    const candidates = [
      {
        x: Math.floor((this.player.x + this.facing * TILE) / TILE),
        y: Math.floor((this.player.y + 20) / TILE),
      },
      {
        x: Math.floor((this.player.x + this.facing * TILE) / TILE),
        y: Math.floor((this.player.y + 36) / TILE),
      },
      {
        x: Math.floor(this.player.x / TILE),
        y: Math.floor((this.player.y + 36) / TILE),
      },
    ];
    const target = candidates.find(({ x, y }) => this.isDiggableTile(x, y));
    if (!target) {
      this.callbacks.onMessage("Рядом нет кирпича, который можно испарить.");
      return;
    }
    this.evaporateTile(target.x, target.y, time);
    this.lastDigAt = time;
    this.playSfx("dig");
  }

  private hitSolidWithBullet(bulletObject: ArcadeObject, blockObject: ArcadeObject) {
    (bulletObject as Phaser.GameObjects.GameObject).destroy();
    const block = blockObject as Phaser.GameObjects.GameObject;
    const tileKey = block.getData("tileKey") as string | undefined;
    const diggable = block.getData("diggable") as boolean | undefined;
    if (!tileKey || !diggable) return;
    const [x, y] = tileKey.split(":").map(Number);
    this.evaporateTile(x, y, this.time.now);
    this.playSfx("dig");
  }

  private isDiggableTile(x: number, y: number) {
    const key = `${x}:${y}`;
    const block = this.tileSprites.get(key);
    return Boolean(block?.getData("diggable") && !this.holes.has(key));
  }

  private evaporateTile(x: number, y: number, time: number) {
    const key = `${x}:${y}`;
    const block = this.tileSprites.get(key);
    if (!block || this.holes.has(key)) return;
    const textureKey = (block.getData("textureKey") as string | undefined) ?? "platform";
    block.destroy();
    this.tileSprites.delete(key);
    const sprite = this.add.rectangle(x * TILE + TILE / 2, y * TILE + TILE / 2, TILE - 3, TILE - 3, 0x000000, 0.92);
    this.holes.set(key, { key, x, y, sprite, textureKey, permanent: false, restoreAt: time + 5200 });
  }

  private superWeapon(time: number) {
    if (time - this.lastSuperAt < 800 || this.stats.energy < 100) return;
    this.lastSuperAt = time;
    let killed = 0;
    this.enemies.children.each((child) => {
      child.destroy();
      killed += 1;
      return true;
    });
    this.stats.energy = 0;
    this.recordEnemyKill(killed);
    this.addScore(killed * 150);
    this.cameras.main.flash(180, 250, 240, 120);
    this.callbacks.onMessage("Молния очистила экран.");
    this.playSfx("super");
  }

  private updateEnemies() {
    this.enemies.children.each((child) => {
      const enemy = child as EnemySprite;
      if (!enemy.active) return true;
      if (enemy.enemyType === "flyer") {
        enemy.setVelocityX((this.player.x > enemy.x ? 1 : -1) * this.level.enemySpeed * 0.8);
        enemy.setVelocityY(Math.sin(this.time.now / 350 + enemy.x) * 70 + (this.player.y - enemy.y) * 0.08);
        this.checkEnemyHole(enemy);
        return true;
      }

      const distance = Phaser.Math.Distance.Between(enemy.x, enemy.y, this.player.x, this.player.y);
      const seesPlayer = distance < 230 + this.level.aggression * 120 && Math.abs(enemy.y - this.player.y) < 90;
      if (enemy.enemyType === "siren") this.trySirenWave(enemy, seesPlayer);
      if (enemy.enemyType === "skibidiToilet") this.trySkibidiPoop(enemy, seesPlayer);
      const onLadder = this.isSpriteOnLadder(enemy);
      const playerVerticalDelta = this.player.y - enemy.y;
      const shouldLeaveLadderHorizontally = onLadder && Math.abs(playerVerticalDelta) < 22 && Math.abs(this.player.x - enemy.x) > 28;
      const shouldUseLadder =
        onLadder && !shouldLeaveLadderHorizontally && (Math.abs(playerVerticalDelta) > 34 || (enemy.climbIntentUntil ?? 0) > this.time.now);

      if (shouldUseLadder) {
        this.setGravity(enemy, false);
        enemy.x = Phaser.Math.Linear(enemy.x, this.tileCenterX(enemy.x), 0.18);
        enemy.setVelocityX(0);
        enemy.setVelocityY(Math.sign(playerVerticalDelta || -1) * this.level.enemySpeed * 0.85);
        enemy.climbIntentUntil = this.time.now + 600;
        this.checkEnemyHole(enemy);
        return true;
      }

      this.setGravity(enemy, true);
      let dir = enemy.dir ?? 1;
      if (seesPlayer || enemy.enemyType === "hunter" || enemy.enemyType === "siren" || enemy.enemyType === "skibidiToilet") dir = this.player.x > enemy.x ? 1 : -1;
      if (enemy.body?.blocked.left) dir = 1;
      if (enemy.body?.blocked.right) dir = -1;

      if (onLadder && !shouldLeaveLadderHorizontally && Math.random() < 0.012) {
        enemy.climbIntentUntil = this.time.now + 800;
      }

      enemy.dir = dir;
      const typeSpeed = enemy.enemyType === "siren" ? 0.42 : enemy.enemyType === "hauntedTrain" ? 0.55 : enemy.enemyType === "skibidiToilet" ? 0.36 : 1;
      enemy.setVelocityX(dir * this.level.enemySpeed * typeSpeed * (seesPlayer ? 1.25 : 1));
      enemy.setFlipX(dir < 0);
      this.checkEnemyHole(enemy);
      return true;
    });
  }

  private trySirenWave(enemy: EnemySprite, seesPlayer: boolean) {
    if (!seesPlayer || Math.abs(enemy.y - this.player.y) > 42) return;
    if (this.time.now - (enemy.lastWaveAt ?? 0) < 2400) return;
    enemy.lastWaveAt = this.time.now;
    const dir = this.player.x > enemy.x ? 1 : -1;
    const wave = this.enemyWaves.create(enemy.x + dir * 18, enemy.y - 4, "sonicWave") as Phaser.Physics.Arcade.Sprite;
    wave.setData("spawnX", wave.x);
    wave.setVelocityX(dir * 165);
    wave.setSize(14, 14);
    this.playSfx("siren");
  }

  private trySkibidiPoop(enemy: EnemySprite, seesPlayer: boolean) {
    if (!seesPlayer || Math.abs(enemy.y - this.player.y) > 50) return;
    if (this.time.now - (enemy.lastWaveAt ?? 0) < 2900) return;
    enemy.lastWaveAt = this.time.now;
    const dir = this.player.x > enemy.x ? 1 : -1;
    const projectile = this.enemyWaves.create(enemy.x + dir * 16, enemy.y + 2, "poopWave") as Phaser.Physics.Arcade.Sprite;
    projectile.setData("spawnX", projectile.x);
    projectile.setData("kind", "poop");
    projectile.setVelocityX(dir * 125);
    projectile.setVelocityY(-45);
    const body = projectile.body as Phaser.Physics.Arcade.Body | null;
    if (body) body.allowGravity = true;
    projectile.setGravityY(260);
    projectile.setSize(12, 12);
    this.playSfx("poop");
  }

  private updateBullets() {
    this.bullets.children.each((child) => {
      const bullet = child as Phaser.Physics.Arcade.Sprite;
      if (Math.abs(bullet.x - bullet.getData("spawnX")) > 360) bullet.destroy();
      return true;
    });
  }

  private updateEnemyWaves() {
    this.enemyWaves.children.each((child) => {
      const wave = child as Phaser.Physics.Arcade.Sprite;
      if (Math.abs(wave.x - wave.getData("spawnX")) > 300) wave.destroy();
      return true;
    });
  }

  private updateIncubators(time: number) {
    const targetEnemies = Math.max(this.level.enemies.length, this.stats.onlinePlayers * 3);
    const activeEnemies = this.enemies.countActive(true);

    for (const incubator of this.incubators) {
      if (!incubator.growing) continue;
      const progress = Phaser.Math.Clamp(1 - (incubator.readyAt - time) / 4500, 0, 1);
      incubator.bar.width = 26 * progress;
      if (time < incubator.readyAt) continue;
      incubator.growing = false;
      incubator.bar.width = 0;
      const types: EnemySpawn["type"][] = ["walker", "hauntedTrain", "siren", "skibidiToilet"];
      const type = types[(this.enemySerial + this.level.id) % types.length];
      this.spawnEnemy(incubator.x, incubator.y, type);
      this.callbacks.onMessage("Инкубатор выпустил нового врага.");
    }

    const growing = this.incubators.filter((incubator) => incubator.growing).length;
    if (activeEnemies + growing >= targetEnemies) return;

    const idle = this.incubators.find((incubator) => !incubator.growing);
    if (!idle) return;
    idle.growing = true;
    idle.readyAt = time + 4500;
    idle.bar.width = 1;
  }

  private syncMultiplayer(time: number) {
    if (!this.socket || this.networkPaused || time - this.lastNetworkSendAt < 80) return;
    this.lastNetworkSendAt = time;
    this.socket.emit("player:state", {
      x: this.player.x,
      y: this.player.y,
      face: this.customization.face,
      hoodie: this.customization.hoodie,
    });
  }

  private syncMinimap(time: number) {
    if (!this.callbacks.onMap || time - this.lastMapSendAt < 160) return;
    this.lastMapSendAt = time;
    const entities: MinimapEntity[] = [
      { id: "player", type: "player", x: this.player.x / TILE, y: this.player.y / TILE },
      { id: "exit", type: "exit", x: this.level.exit.x + 0.5, y: this.level.exit.y + 0.5 },
    ];

    this.remotePlayers.forEach((remote, id) => {
      entities.push({ id, type: "remotePlayer", x: remote.sprite.x / TILE, y: remote.sprite.y / TILE });
    });

    this.enemies.children.each((child) => {
      const enemy = child as EnemySprite;
      if (enemy.active) {
        entities.push({
          id: String(enemy.getData("spawned") ?? entities.length),
          type: "enemy",
          x: enemy.x / TILE,
          y: enemy.y / TILE,
        });
      }
      return true;
    });

    this.items.children.each((child) => {
      const item = child as Phaser.Physics.Arcade.Sprite;
      if (item.active) {
        const type = item.getData("type") as MinimapEntity["type"] | undefined;
        if (type) entities.push({ id: `item-${item.x}-${item.y}-${type}`, type, x: item.x / TILE, y: item.y / TILE });
      }
      return true;
    });

    this.incubators.forEach((incubator, index) => {
      entities.push({ id: `incubator-${index}`, type: "incubator", x: incubator.x + 0.5, y: incubator.y + 0.5 });
    });

    this.callbacks.onMap({
      camera: {
        x: this.cameras.main.scrollX / TILE,
        y: this.cameras.main.scrollY / TILE,
        width: this.cameras.main.width / TILE,
        height: this.cameras.main.height / TILE,
      },
      entities,
    });
  }

  private updateHoles(time: number) {
    this.holes.forEach((hole) => {
      if (hole.permanent || time < hole.restoreAt) return;
      this.sealHole(hole);
    });
  }

  private checkEnemyHole(enemy: EnemySprite) {
    const tx = Math.floor(enemy.x / TILE);
    const ty = Math.floor((enemy.y + 12) / TILE);
    const hole = this.holes.get(`${tx}:${ty}`);
    if (!hole) return;
    enemy.destroy();
    this.sealHole(hole);
    this.stats.energy = Math.min(100, this.stats.energy + 25);
    this.recordEnemyKill();
    this.addScore(120);
    this.callbacks.onMessage("Враг замурован. По клетке можно ходить.");
    this.playSfx("enemy");
  }

  private sealHole(hole: Hole) {
    hole.sprite.destroy();
    this.createSolidTile(hole.key, hole.x * TILE + TILE / 2, hole.y * TILE + TILE / 2, hole.textureKey, true);
    this.holes.delete(hole.key);
  }

  private hitEnemy(bulletObject: ArcadeObject, enemyObject: ArcadeObject) {
    (bulletObject as Phaser.GameObjects.GameObject).destroy();
    const enemy = enemyObject as EnemySprite;
    enemy.hp = (enemy.hp ?? 1) - this.shotDamage();
    if (enemy.hp <= 0) {
      enemy.destroy();
      this.stats.energy = Math.min(100, this.stats.energy + 20);
      this.recordEnemyKill();
      this.addScore(100);
      this.playSfx("enemy");
    } else {
      enemy.setTint(0xffffff);
      this.time.delayedCall(80, () => enemy.clearTint());
    }
  }

  private hitPlayerEnemyContact() {
    if (this.time.now - this.lastEnemyContactDamageAt < 420) return;
    this.lastEnemyContactDamageAt = this.time.now;
    this.damagePlayer(7);
  }

  private loseLife() {
    if (this.player.getData("invulnerable")) return;
    this.stats.lives -= 1;
    this.stats.health = 100;
    this.playSfx("hurt");
    if (this.stats.lives <= 0) {
      this.finish("lost");
      return;
    }
    this.player.setData("invulnerable", true);
    const spawn = this.profile.spawnPoint ?? this.level.player;
    this.player.setPosition(spawn.x * TILE + TILE / 2, spawn.y * TILE);
    this.player.setVelocity(0, 0);
    this.player.setTint(0xfef08a);
    this.time.delayedCall(1100, () => {
      this.player.clearTint();
      this.player.setData("invulnerable", false);
    });
  }

  private hitPlayerWave(_playerObject: ArcadeObject, waveObject: ArcadeObject) {
    const wave = waveObject as Phaser.Physics.Arcade.Sprite;
    const kind = wave.getData("kind") as string | undefined;
    wave.destroy();
    this.damagePlayer(kind === "poop" ? 14 : 20);
    if (kind === "poop") this.callbacks.onMessage("Скибиди-унитаз попал какашкой: -14% здоровья.");
  }

  private damagePlayer(amount: number) {
    if (this.player.getData("invulnerable")) return;
    this.stats.health = Math.max(0, this.stats.health - Math.round(amount * this.armorMultiplier()));
    this.playSfx("hurt");
    this.player.setTint(0x93c5fd);
    this.time.delayedCall(120, () => {
      if (!this.player.getData("invulnerable")) this.player.clearTint();
    });
    if (this.stats.health > 0) return;
    this.loseLife();
  }

  private neutralizeSonicWave(bulletObject: ArcadeObject, waveObject: ArcadeObject) {
    (bulletObject as Phaser.GameObjects.GameObject).destroy();
    (waveObject as Phaser.GameObjects.GameObject).destroy();
    this.addScore(25);
    this.playSfx("open");
  }

  private collectItem(_player: ArcadeObject, itemObject: ArcadeObject) {
    const item = itemObject as Phaser.Physics.Arcade.Sprite;
    const type = item.getData("type") as ItemType;
    if (type === "coin") {
      const id = item.getData("id") as string | undefined;
      if (id) {
        this.socket?.emit("gold:collect", { id });
        this.itemSprites.delete(id);
      }
      this.stats.coins += 1;
      this.recordGoldMined();
      this.updateProfile((profile) => ({
        ...profile,
        score: profile.score + 100,
        gold: profile.gold + 1,
      }));
      this.playSfx("gold");
      this.callbacks.onMessage("Золото собрано: +1.");
    }
    if (type === "stone" || type === "iron") {
      const id = item.getData("id") as string | undefined;
      if (id) {
        this.socket?.emit("resource:collect", { id });
        this.resourceSprites.delete(id);
      }
      const amount = type === "iron" ? 1 : 2;
      this.updateProfile((profile) => {
        const nextStone = profile.stone + (type === "stone" ? amount : 0);
        return {
          ...profile,
          stone: nextStone,
          iron: profile.iron + (type === "iron" ? amount : 0),
          materials: nextStone,
        };
      });
      this.playSfx("gold");
      this.callbacks.onMessage(type === "iron" ? "Железо собрано: +1." : "Камень собран: +2.");
    }
    if (type === "prize") {
      const prize = item.getData("prize") as WorldPrize | undefined;
      if (!prize || !this.collectPrize(prize)) return;
    }
    if (type === "key") {
      this.stats.keys += 1;
      this.addScore(150);
    }
    if (type === "heart") {
      this.stats.lives = Math.min(this.stats.maxLives + 1, this.stats.lives + 1);
      this.stats.maxLives = Math.max(this.stats.maxLives, this.stats.lives);
      this.stats.health = 100;
    }
    if (type === "energy") this.stats.energy = 100;
    item.destroy();
  }

  private tryExit() {
    this.callbacks.onMessage("Это общий мир без финального выхода: собирайте золото и стройте базу.");
  }

  private startExitClimb() {
    if (this.exiting || this.ended) return;
    this.exiting = true;
    this.exitStartedAt = this.time.now;
    this.callbacks.onMessage("Выход открыт. Герой поднимается на следующий уровень.");
    this.player.setData("invulnerable", true);
    this.player.setFlipX(false);
    this.player.setTint(0xfef08a);
    this.setGravity(this.player, false);
    const body = this.player.body as Phaser.Physics.Arcade.Body | null;
    if (body) body.checkCollision.none = true;
    this.player.setVelocity(0, -120);
    this.player.setPosition(this.exitZone.x, this.player.y);
    this.enemies.children.each((enemy) => {
      (enemy as Phaser.Physics.Arcade.Sprite).setVelocity(0, 0);
      return true;
    });
    this.enemyWaves.clear(true, true);
  }

  private updateExitClimb() {
    this.setGravity(this.player, false);
    this.player.x = Phaser.Math.Linear(this.player.x, this.exitZone.x, 0.35);
    this.player.setVelocity(0, -120);
    if (this.player.y < -TILE / 2 || this.time.now - this.exitStartedAt > 1300) {
      this.finish("won");
    }
  }

  private finish(status: "won" | "lost") {
    if (this.ended) return;
    this.ended = true;
    const timeBonus = status === "won" ? Math.max(0, this.level.timeLimit * 1000 - this.stats.elapsedMs) / 100 : 0;
    const score = Math.round(this.stats.score + timeBonus);
    this.playSfx(status === "won" ? "win" : "lose");
    this.callbacks.onEnd({ status, score });
  }

  private isSpriteOnLadder(sprite: Phaser.Physics.Arcade.Sprite) {
    const tx = Math.floor(sprite.x / TILE);
    const center = Math.floor(sprite.y / TILE);
    const feet = Math.floor((sprite.y + 13) / TILE);
    return this.level.map[center]?.[tx] === "L" || this.level.map[feet]?.[tx] === "L";
  }

  private tileCenterX(x: number) {
    return Math.floor(x / TILE) * TILE + TILE / 2;
  }

  private setGravity(sprite: Phaser.Physics.Arcade.Sprite, enabled: boolean) {
    const body = sprite.body as Phaser.Physics.Arcade.Body | null;
    if (!body) return;
    body.allowGravity = enabled;
  }

  shutdown() {
    this.destroyed = true;
    this.flushPlayTime();
    window.removeEventListener("lodegame:control", this.handleMobileControl as EventListener);
    window.removeEventListener("lodegame:build-mode", this.handleBuildMode as EventListener);
    window.removeEventListener("lodegame:profile-update", this.handleProfileUpdate as EventListener);
    window.removeEventListener("lodegame:set-spawn", this.handleSetSpawn as EventListener);
    window.removeEventListener("lodegame:chat-focus", this.handleChatFocus as EventListener);
    if (this.pauseListener) window.removeEventListener("lodegame:pause-change", this.pauseListener);
    this.input.keyboard?.off("keydown", this.unlockAudio, this);
    this.socket?.removeAllListeners();
    this.socket?.disconnect();
    this.remotePlayers.forEach((remote) => {
      remote.sprite.destroy();
      remote.label.destroy();
    });
    this.remotePlayers.clear();
    this.stopAudio();
  }

  private unlockAudio = () => {
    if (this.audioUnlocked) return;
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return;
    this.audioContext = new AudioContextClass();
    void this.audioContext.resume();
    this.audioUnlocked = true;
    this.startMusic();
  };

  private startMusic() {
    if (!this.audioContext || this.musicInterval) return;
    const melody = [392, 0, 392, 523, 494, 0, 392, 330, 349, 392, 0, 330, 294, 0, 330, 349];
    const bass = [98, 98, 0, 98, 131, 0, 131, 0];
    this.musicInterval = window.setInterval(() => {
      if (!this.audioContext || this.ended) return;
      const now = this.audioContext.currentTime;
      const note = melody[this.musicStep % melody.length];
      const bassNote = bass[this.musicStep % bass.length];
      if (note) this.playTone(note, now, 0.07, "square", 0.025);
      if (bassNote && this.musicStep % 2 === 0) this.playTone(bassNote, now, 0.1, "triangle", 0.018);
      this.musicStep += 1;
    }, 145);
  }

  private stopAudio = () => {
    if (this.musicInterval) window.clearInterval(this.musicInterval);
    this.musicInterval = undefined;
    void this.audioContext?.close();
    this.audioContext = undefined;
    this.audioUnlocked = false;
  };

  private playSfx(kind: "jump" | "shoot" | "dig" | "super" | "enemy" | "hurt" | "gold" | "open" | "win" | "lose" | "siren" | "poop") {
    if (!this.audioContext) return;
    const now = this.audioContext.currentTime;
    if (kind === "jump") this.playArp([220, 330], now, 0.045);
    if (kind === "shoot") this.playSlide(880, 220, now, 0.09, "square", 0.045);
    if (kind === "dig") this.playNoise(now, 0.08, 0.04);
    if (kind === "super") this.playArp([220, 330, 440, 660, 880], now, 0.055);
    if (kind === "enemy") this.playSlide(180, 70, now, 0.16, "sawtooth", 0.04);
    if (kind === "hurt") this.playSlide(160, 55, now, 0.22, "square", 0.05);
    if (kind === "gold") this.playArp([660, 880, 1175], now, 0.04);
    if (kind === "open") this.playArp([523, 659, 784, 1047], now, 0.06);
    if (kind === "win") this.playArp([523, 659, 784, 1047, 1319], now, 0.09);
    if (kind === "lose") this.playArp([220, 196, 165, 147], now, 0.12);
    if (kind === "siren") this.playArp([740, 554, 740, 466], now, 0.07);
    if (kind === "poop") this.playArp([180, 140, 100], now, 0.055);
  }

  private playArp(notes: number[], start: number, step: number) {
    notes.forEach((note, index) => this.playTone(note, start + index * step, step * 0.85, "square", 0.055));
  }

  private playTone(frequency: number, start: number, duration: number, type: OscillatorType, gainValue: number) {
    if (!this.audioContext) return;
    const oscillator = this.audioContext.createOscillator();
    const gain = this.audioContext.createGain();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, start);
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(gainValue, start + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    oscillator.connect(gain);
    gain.connect(this.audioContext.destination);
    oscillator.start(start);
    oscillator.stop(start + duration + 0.02);
  }

  private playSlide(from: number, to: number, start: number, duration: number, type: OscillatorType, gainValue: number) {
    if (!this.audioContext) return;
    const oscillator = this.audioContext.createOscillator();
    const gain = this.audioContext.createGain();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(from, start);
    oscillator.frequency.exponentialRampToValueAtTime(to, start + duration);
    gain.gain.setValueAtTime(gainValue, start);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    oscillator.connect(gain);
    gain.connect(this.audioContext.destination);
    oscillator.start(start);
    oscillator.stop(start + duration + 0.02);
  }

  private playNoise(start: number, duration: number, gainValue: number) {
    if (!this.audioContext) return;
    const sampleRate = this.audioContext.sampleRate;
    const buffer = this.audioContext.createBuffer(1, sampleRate * duration, sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i += 1) {
      data[i] = (Math.random() * 2 - 1) * (1 - i / data.length);
    }
    const source = this.audioContext.createBufferSource();
    const gain = this.audioContext.createGain();
    gain.gain.setValueAtTime(gainValue, start);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    source.buffer = buffer;
    source.connect(gain);
    gain.connect(this.audioContext.destination);
    source.start(start);
  }
}

export const gameSize = { width: 28 * TILE, height: 12 * TILE };
