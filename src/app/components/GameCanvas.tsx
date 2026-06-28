"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Backpack, Bell, BellOff, Coins, DoorOpen, Dumbbell, Gauge, Gem, Hammer, MapIcon, MessageCircle, Package, Pause, Reply, RotateCcw, Shield, Shirt, ShoppingBag, Swords, Trash2, UserRound, X, Zap } from "lucide-react";
import { io, type Socket } from "socket.io-client";
import { getLevel, getNextLevelId } from "@/app/lib/data/levels";
import { upgradePrices, useGameState } from "@/app/hooks/useGameState";
import { experienceGrade, formatPlayTime } from "@/app/lib/gameLogic/experience";
import type { CharacterCustomization, GearSlot, InventoryItem, MarketListing, MinimapEntity, MinimapSnapshot, PlayerProfile, RuntimeStats, UpgradeKey } from "@/app/lib/gameLogic/types";
import { Hud } from "@/app/components/UI/Hud";
import { TouchControls } from "@/app/components/UI/TouchControls";

type GameCanvasProps = {
  levelId: number;
};

type EndState = {
  status: "won" | "lost";
  score: number;
} | null;

type ChatMessage = {
  id: string;
  playerId: string;
  author: string;
  text: string;
  replyTo?: {
    id: string;
    author: string;
    text: string;
  };
  createdAt: number;
};

type OnlineSnapshot = {
  total: number;
  players: Array<{ id: string; name: string }>;
};

type Notice = {
  id: number;
  text: string;
};

type BuildMode = "none" | "wall" | "ladder" | "door" | "remove";

export function GameCanvas({ levelId }: GameCanvasProps) {
  const router = useRouter();
  const hostRef = useRef<HTMLDivElement | null>(null);
  const gameRef = useRef<{ destroy: (removeCanvas: boolean) => void; scene: { scenes: { scene: { pause: () => void; resume: () => void } }[] } } | null>(null);
  const level = useMemo(() => getLevel(levelId), [levelId]);
  const customization = useGameState((state) => state.customization);
  const profile = useGameState((state) => state.profile);
  const authEmail = useGameState((state) => state.authEmail);
  const hydrated = useGameState((state) => state.hydrated);
  const profileRef = useRef(profile);
  const hydrate = useGameState((state) => state.hydrate);
  const setRuntime = useGameState((state) => state.setRuntime);
  const updateProfile = useGameState((state) => state.updateProfile);
  const buyUpgrade = useGameState((state) => state.buyUpgrade);
  const removeInventoryItem = useGameState((state) => state.removeInventoryItem);
  const completeLevel = useGameState((state) => state.completeLevel);
  const [stats, setStats] = useState<RuntimeStats | null>(null);
  const [message, setMessage] = useState("Загрузка шахты...");
  const [endState, setEndState] = useState<EndState>(null);
  const [paused, setPaused] = useState(false);
  const [mapSnapshot, setMapSnapshot] = useState<MinimapSnapshot | null>(null);
  const [buildMode, setBuildMode] = useState<BuildMode>("none");
  const [market, setMarket] = useState<MarketListing[]>([]);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatText, setChatText] = useState("");
  const [chatReplyTo, setChatReplyTo] = useState<ChatMessage | null>(null);
  const [showMap, setShowMap] = useState(false);
  const [showHero, setShowHero] = useState(false);
  const [showMarket, setShowMarket] = useState(false);
  const [notices, setNotices] = useState<Notice[]>([]);
  const [chatSoundEnabled, setChatSoundEnabled] = useState(() => {
    if (typeof window === "undefined") return true;
    return window.localStorage.getItem("lodegame-chat-sound") !== "off";
  });
  const marketSocketRef = useRef<Socket | null>(null);
  const marketSeenRef = useRef(false);
  const marketCountRef = useRef(0);
  const onlineSeenRef = useRef(false);
  const onlinePlayersRef = useRef<Set<string>>(new Set());
  const noticeSerialRef = useRef(1);

  const pushNotice = useCallback((text: string) => {
    const id = noticeSerialRef.current++;
    setNotices((current) => [...current, { id, text }].slice(-4));
    window.setTimeout(() => {
      setNotices((current) => current.filter((notice) => notice.id !== id));
    }, 5200);
  }, []);

  useEffect(() => {
    hydrate();
  }, [hydrate]);

  useEffect(() => {
    if (hydrated && !authEmail) router.replace("/menu");
  }, [authEmail, hydrated, router]);

  useEffect(() => {
    profileRef.current = profile;
    window.dispatchEvent(new CustomEvent("lodegame:profile-update", { detail: { profile } }));
  }, [profile]);

  useEffect(() => {
    window.localStorage.setItem("lodegame-chat-sound", chatSoundEnabled ? "on" : "off");
  }, [chatSoundEnabled]);

  useEffect(() => {
    const socket = io(process.env.NEXT_PUBLIC_LODEGAME_SOCKET_URL ?? "http://localhost:3001", {
      transports: ["websocket", "polling"],
    });
    marketSocketRef.current = socket;
    socket.on("market:list", (list: MarketListing[]) => {
      setMarket(list);
      if (marketSeenRef.current && list.length > marketCountRef.current) {
        pushNotice(`На рынке появились новые товары: +${list.length - marketCountRef.current}.`);
      }
      marketSeenRef.current = true;
      marketCountRef.current = list.length;
    });
    socket.on("online:snapshot", (snapshot: OnlineSnapshot) => {
      const currentIds = new Set(snapshot.players.map((player) => player.id));
      if (onlineSeenRef.current) {
        const joined = snapshot.players.filter((player) => !onlinePlayersRef.current.has(player.id));
        joined
          .filter((player) => player.name !== profileRef.current.nickname)
          .forEach((player) => pushNotice(`${player.name} присоединился к миру.`));
      }
      onlineSeenRef.current = true;
      onlinePlayersRef.current = currentIds;
    });
    socket.on("chat:history", (messages: ChatMessage[]) => setChatMessages(messages.slice(-60)));
    socket.on("chat:message", (message: ChatMessage) => {
      setChatMessages((current) => [...current, message].slice(-60));
      if (chatSoundEnabled && message.playerId !== socket.id) playChatSound();
    });
    socket.on("market:bought", (listing: MarketListing) => {
      updateProfile((current) => ({ ...current, gold: current.gold - listing.price, inventory: [...current.inventory, listing.item] }));
    });
    return () => {
      socket.disconnect();
      marketSocketRef.current = null;
    };
  }, [chatSoundEnabled, pushNotice, updateProfile]);

  useEffect(() => {
    let cancelled = false;

    async function mountGame() {
      if (!authEmail) return;
      const Phaser = await import("phaser");
      const { MainScene, gameSize } = await import("@/app/lib/phaser/MainScene");
      if (cancelled || !hostRef.current) return;

      const scene = new MainScene(level, customization, profileRef.current, {
        onStatus: (next) => {
          setStats({ ...next });
          setRuntime(next);
        },
        onMessage: setMessage,
        onEnd: (result) => {
          setEndState(result);
          if (result.status === "won") completeLevel(level.id, result.score);
        },
        onMap: setMapSnapshot,
        onBackpackFull: () => setShowHero(true),
        onProfileChange: (nextProfile) => updateProfile(() => nextProfile),
      });

      gameRef.current = new Phaser.Game({
        type: Phaser.AUTO,
        width: gameSize.width,
        height: gameSize.height,
        parent: hostRef.current,
        backgroundColor: "#101820",
        pixelArt: true,
        scale: {
          mode: Phaser.Scale.FIT,
          autoCenter: Phaser.Scale.CENTER_BOTH,
        },
        physics: {
          default: "arcade",
          arcade: {
            gravity: { y: 780, x: 0 },
            debug: false,
          },
        },
        scene,
      });
    }

    mountGame();

    return () => {
      cancelled = true;
      gameRef.current?.destroy(true);
      gameRef.current = null;
    };
  }, [authEmail, completeLevel, customization, level, setRuntime, updateProfile]);

  useEffect(() => {
    window.dispatchEvent(new CustomEvent("lodegame:pause-change", { detail: { paused } }));
    gameRef.current?.scene.scenes.forEach((scene) => {
      if (paused) scene.scene.pause();
      else scene.scene.resume();
    });
  }, [paused]);

  return (
    <div className="min-h-screen bg-[#101820] text-slate-50">
      {!authEmail && (
        <div className="grid min-h-screen place-items-center px-4 text-center">
          <div className="rounded-lg border border-white/10 bg-white/5 p-5">
            <h1 className="text-xl font-semibold">Нужен вход в аккаунт</h1>
            <p className="mt-2 text-sm text-slate-300">Авторизуйтесь в меню, чтобы войти в общий мир.</p>
          </div>
        </div>
      )}
      {authEmail && (
      <div className="mx-auto flex min-h-screen w-full max-w-7xl flex-col gap-4 px-4 py-4 lg:px-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-sm text-cyan-200">Единый онлайн-мир</p>
            <h1 className="text-2xl font-semibold">{level.name}</h1>
          </div>
          <div className="flex items-center gap-2">
            <button
              className="inline-flex h-10 items-center gap-2 rounded-md border border-white/15 px-3 text-sm hover:bg-white/10"
              onClick={() => setPaused((value) => !value)}
            >
              <Pause size={16} />
              {paused ? "Продолжить" : "Пауза"}
            </button>
            <button
              className="inline-flex h-10 items-center gap-2 rounded-md border border-white/15 px-3 text-sm hover:bg-white/10"
              onClick={() => window.location.reload()}
            >
              <RotateCcw size={16} />
              Заново
            </button>
          </div>
        </div>

        <Hud stats={stats} timeLimit={level.timeLimit} message={message} />

        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-white/10 bg-white/5 p-2">
          <BuildButton active={showHero} icon={<UserRound size={16} />} label="Герой" onClick={() => setShowHero(true)} />
          <BuildButton active={showMarket} icon={<ShoppingBag size={16} />} label="Магазин" onClick={() => setShowMarket(true)} />
          <BuildButton active={showMap} icon={<MapIcon size={16} />} label="КАРТА" onClick={() => setShowMap(true)} />
          <BuildButton active={buildMode === "wall"} icon={<Hammer size={16} />} label="Стена: 1 кам." onClick={() => selectBuildMode("wall", setBuildMode)} />
          <BuildButton active={buildMode === "ladder"} icon={<Hammer size={16} />} label="Лестн.: 1ж" onClick={() => selectBuildMode("ladder", setBuildMode)} />
          <BuildButton active={buildMode === "door"} icon={<DoorOpen size={16} />} label="Дверь: 1к+1ж" onClick={() => selectBuildMode("door", setBuildMode)} />
          <BuildButton active={buildMode === "remove"} icon={<Trash2 size={16} />} label="Убрать" onClick={() => selectBuildMode("remove", setBuildMode)} />
          <BuildButton active={false} icon={<Zap size={16} />} label="Моя база" onClick={() => window.dispatchEvent(new CustomEvent("lodegame:set-spawn"))} />
          <BuildButton active={buildMode === "none"} label="Выкл" onClick={() => selectBuildMode("none", setBuildMode)} />
          <span className="text-xs text-slate-300">Стена 1 камень, лестница 1 железо, дверь 1 камень + 1 железо. “Моя база” сохраняет место старта.</span>
        </div>

        <div className="relative overflow-hidden rounded-lg border border-white/15 bg-black shadow-2xl">
          <div ref={hostRef} className="aspect-[7/3] w-full touch-none" />
          {paused && (
            <div className="absolute inset-0 grid place-items-center bg-slate-950/70 text-3xl font-semibold">
              Пауза
            </div>
          )}
          {endState && (
            <div className="absolute inset-0 grid place-items-center bg-slate-950/85 p-4">
              <div className="w-full max-w-sm rounded-lg border border-white/15 bg-slate-900 p-5 text-center">
                <Zap className="mx-auto mb-3 text-yellow-200" />
                <h2 className="text-2xl font-semibold">{endState.status === "won" ? "Маршрут завершён" : "Попытка провалена"}</h2>
                <p className="mt-2 text-slate-300">Очки: {endState.score}</p>
                <div className="mt-5 flex justify-center gap-2">
                  {endState.status === "won" ? (
                    <button
                      className="rounded-md bg-cyan-300 px-4 py-2 font-semibold text-slate-950"
                      onClick={() => router.push(`/game/${getNextLevelId(level.id)}`)}
                    >
                      Дальше
                    </button>
                  ) : (
                    <button className="rounded-md bg-cyan-300 px-4 py-2 font-semibold text-slate-950" onClick={() => window.location.reload()}>
                      Повторить
                    </button>
                  )}
                  <Link className="rounded-md border border-white/15 px-4 py-2" href="/menu">
                    Меню
                  </Link>
                </div>
              </div>
            </div>
          )}
          <NoticeStack notices={notices} onClose={(id) => setNotices((current) => current.filter((notice) => notice.id !== id))} />
        </div>

        <ChatPanel
          messages={chatMessages}
          value={chatText}
          replyTo={chatReplyTo}
          soundEnabled={chatSoundEnabled}
          onChange={setChatText}
          onReply={setChatReplyTo}
          onCancelReply={() => setChatReplyTo(null)}
          onToggleSound={() => setChatSoundEnabled((value) => !value)}
          onSend={() => {
            const text = chatText.trim();
            if (!text) return;
            marketSocketRef.current?.emit("chat:send", {
              text,
              author: chatAuthor(profile.nickname),
              replyTo: chatReplyTo ? { id: chatReplyTo.id, author: chatReplyTo.author, text: chatReplyTo.text } : undefined,
            });
            setChatText("");
            setChatReplyTo(null);
          }}
        />

        {showHero && (
          <Modal title="Параметры героя" onClose={() => setShowHero(false)}>
            <HeroManagementPanel
              profile={profile}
              customization={customization}
              onBuy={buyUpgrade}
              onUse={(item) => {
                updateProfile((current) => equipItem(current, item));
              }}
              onUnequip={(slot) => updateProfile((current) => unequipItem(current, slot))}
              onRepair={(item) => updateProfile((current) => repairItem(current, item.id))}
              onUpgradeItem={(item) => updateProfile((current) => upgradeItem(current, item.id))}
              onSell={(item) => {
                const removed = removeInventoryItem(item.id);
                if (!removed) return;
                updateProfile((current) => ({ ...current, gold: current.gold + itemTradeValue(removed) }));
              }}
              onMarketSell={(item) => {
                const removed = removeInventoryItem(item.id);
                if (!removed) return;
                marketSocketRef.current?.emit("market:sell", { item: removed, price: itemTradeValue(removed) });
              }}
            />
          </Modal>
        )}

        {showMap && (
          <Modal title="Карта мира" onClose={() => setShowMap(false)} size="wide">
            <LevelMinimap levelMap={level.map} snapshot={mapSnapshot} />
          </Modal>
        )}

        {showMarket && (
          <Modal title="Магазин" onClose={() => setShowMarket(false)} size="wide">
            <MarketPanel
              profile={profile}
              market={market}
              onBuyResource={(kind) => updateProfile((current) => buyResource(current, kind))}
              onSellResource={(kind) => updateProfile((current) => sellResource(current, kind))}
              onMarketBuy={(listing) => {
                const capacity = 10 + (profile.upgrades.backpack + (profile.equipment.backpack?.power ?? 0)) * 6;
                const load = profile.inventory.reduce((sum, item) => sum + item.weight, 0);
                if (profile.gold < listing.price || load + listing.item.weight > capacity) return;
                marketSocketRef.current?.emit("market:buy", { id: listing.id });
              }}
            />
          </Modal>
        )}

        <TouchControls />
      </div>
      )}
    </div>
  );
}

const upgradeLabels: Record<UpgradeKey, string> = {
  runSpeed: "Бег",
  fireRate: "Стрельба",
  shotDamage: "Урон",
  armor: "Броня",
  jumpHeight: "Прыжок",
  backpack: "Рюкзак",
  strength: "Сила",
};

const slotLabels: Record<GearSlot, string> = {
  weapon: "Оружие",
  armor: "Броня",
  boots: "Сапоги",
  backpack: "Рюкзак",
  module: "Модуль",
};

const slotIcons: Record<GearSlot, React.ReactNode> = {
  weapon: <Swords size={16} />,
  armor: <Shield size={16} />,
  boots: <Gauge size={16} />,
  backpack: <Backpack size={16} />,
  module: <Dumbbell size={16} />,
};

const ITEM_DURABILITY_MS = 60 * 60_000;

function equipItem(profile: PlayerProfile, item: InventoryItem): PlayerProfile {
  const normalized = normalizeItem(item);
  const previous = profile.equipment[normalized.slot];
  return {
    ...profile,
    equipment: { ...profile.equipment, [normalized.slot]: normalized },
    inventory: [...profile.inventory.filter((candidate) => candidate.id !== normalized.id), ...(previous ? [previous] : [])],
  };
}

function normalizeItem(item: InventoryItem): InventoryItem {
  const previousDurabilityMs = Math.max(1, item.durabilityMs ?? ITEM_DURABILITY_MS);
  const previousRemainingMs = Math.max(0, item.remainingMs ?? previousDurabilityMs);
  const remainingRatio = Math.min(1, previousRemainingMs / previousDurabilityMs);
  return {
    ...item,
    rarity: item.rarity ?? "common",
    durabilityMs: ITEM_DURABILITY_MS,
    remainingMs: Math.round(ITEM_DURABILITY_MS * remainingRatio),
  };
}

function formatWear(item: InventoryItem) {
  const normalized = normalizeItem(item);
  const minutes = Math.ceil(normalized.remainingMs / 60_000);
  return `${minutes} мин`;
}

function itemTradeValue(item: InventoryItem) {
  const normalized = normalizeItem(item);
  const ratio = Math.max(0.08, Math.min(1, normalized.remainingMs / normalized.durabilityMs));
  return Math.max(1, Math.round(item.value * ratio));
}

function repairCost(item: InventoryItem) {
  const normalized = normalizeItem(item);
  const missingRatio = Math.max(0, 1 - normalized.remainingMs / normalized.durabilityMs);
  return Math.max(1, Math.ceil(item.value * 0.55 * missingRatio));
}

function upgradeItemCost(item: InventoryItem) {
  return Math.max(3, Math.ceil(item.value * (0.75 + item.power * 0.35)));
}

function mapProfileItems(profile: PlayerProfile, itemId: string, mapper: (item: InventoryItem) => InventoryItem) {
  const inventory = profile.inventory.map((item) => (item.id === itemId ? mapper(item) : item));
  const equipment = { ...profile.equipment };
  (Object.keys(equipment) as GearSlot[]).forEach((slot) => {
    const item = equipment[slot];
    if (item?.id === itemId) equipment[slot] = mapper(item);
  });
  return { ...profile, inventory, equipment };
}

function repairItem(profile: PlayerProfile, itemId: string): PlayerProfile {
  const item = profile.inventory.find((candidate) => candidate.id === itemId) ?? Object.values(profile.equipment).find((candidate) => candidate?.id === itemId);
  if (!item) return profile;
  const cost = repairCost(item);
  if (profile.gold < cost) return profile;
  return mapProfileItems({ ...profile, gold: profile.gold - cost }, itemId, (current) => ({
    ...normalizeItem(current),
    remainingMs: ITEM_DURABILITY_MS,
  }));
}

function upgradeItem(profile: PlayerProfile, itemId: string): PlayerProfile {
  const item = profile.inventory.find((candidate) => candidate.id === itemId) ?? Object.values(profile.equipment).find((candidate) => candidate?.id === itemId);
  if (!item) return profile;
  const cost = upgradeItemCost(item);
  if (profile.gold < cost) return profile;
  return mapProfileItems({ ...profile, gold: profile.gold - cost }, itemId, (current) => {
    const normalized = normalizeItem(current);
    return {
      ...normalized,
      name: current.name.includes("+") ? current.name.replace(/\+(\d+)/, (_match, value) => `+${Number(value) + 1}`) : `${current.name} +1`,
      power: current.power + 1,
      value: Math.round(current.value * 1.35),
      durabilityMs: ITEM_DURABILITY_MS,
      remainingMs: ITEM_DURABILITY_MS,
    };
  });
}

function rarityLabel(rarity: InventoryItem["rarity"]) {
  if (rarity === "legendary") return "легендарный";
  if (rarity === "epic") return "эпический";
  if (rarity === "rare") return "редкий";
  return "обычный";
}

function unequipItem(profile: PlayerProfile, slot: GearSlot): PlayerProfile {
  const item = profile.equipment[slot];
  if (!item) return profile;
  const equipment = { ...profile.equipment };
  delete equipment[slot];
  return { ...profile, equipment, inventory: [...profile.inventory, item] };
}

function buyResource(profile: PlayerProfile, kind: "stone" | "iron"): PlayerProfile {
  const price = kind === "iron" ? 3 : 1;
  if (profile.gold < price) return profile;
  if (kind === "stone") {
    const stone = profile.stone + 1;
    return { ...profile, gold: profile.gold - price, stone, materials: stone };
  }
  return { ...profile, gold: profile.gold - price, iron: profile.iron + 1 };
}

function sellResource(profile: PlayerProfile, kind: "stone" | "iron"): PlayerProfile {
  if (kind === "stone") {
    if (profile.stone <= 0) return profile;
    const stone = profile.stone - 1;
    return { ...profile, gold: profile.gold + 1, stone, materials: stone };
  }
  if (profile.iron <= 0) return profile;
  return { ...profile, gold: profile.gold + 2, iron: profile.iron - 1 };
}

function HeroStatus({ profile, customization }: { profile: PlayerProfile; customization: CharacterCustomization }) {
  const equipped = profile.equipment;
  return (
    <section className="grid gap-3 rounded-lg border border-white/10 bg-white/5 p-3 lg:grid-cols-[auto_1fr]">
      <HeroAvatar customization={customization} profile={profile} />
      <div className="grid gap-3">
        <div className="grid grid-cols-2 gap-2 md:grid-cols-6">
          <ResourceBadge icon={<Coins size={17} />} label="Золото" value={profile.gold} tone="text-yellow-200" />
          <ResourceBadge icon={<Zap size={17} />} label="Камень" value={profile.stone} tone="text-cyan-200" />
          <ResourceBadge icon={<Gem size={17} />} label="Железо" value={profile.iron} tone="text-slate-200" />
          <ResourceBadge icon={<Package size={17} />} label="Предметы" value={profile.inventory.length} tone="text-fuchsia-200" />
          <ResourceBadge icon={<Swords size={17} />} label="Оружие" value={equipped.weapon?.name ?? "нет"} tone="text-orange-200" />
          <ResourceBadge icon={<Shirt size={17} />} label="Шмот" value={equipped.armor?.name ?? equipped.boots?.name ?? "нет"} tone="text-emerald-200" />
        </div>
        <div className="grid gap-2 md:grid-cols-5">
          {(Object.keys(slotLabels) as GearSlot[]).map((slot) => (
            <div key={slot} className="rounded-md border border-white/10 bg-slate-950/35 px-3 py-2">
              <div className="mb-1 flex items-center gap-2 text-xs text-slate-400">
                {slotIcons[slot]}
                {slotLabels[slot]}
              </div>
              <p className="truncate text-sm font-semibold" style={{ color: equipped[slot]?.color ?? "#e2e8f0" }}>
                {equipped[slot]?.name ?? "пусто"}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function HeroManagementPanel({
  profile,
  customization,
  onBuy,
  onUse,
  onUnequip,
  onRepair,
  onUpgradeItem,
  onSell,
  onMarketSell,
}: {
  profile: PlayerProfile;
  customization: CharacterCustomization;
  onBuy: (upgrade: UpgradeKey) => boolean;
  onUse: (item: InventoryItem) => void;
  onUnequip: (slot: GearSlot) => void;
  onRepair: (item: InventoryItem) => void;
  onUpgradeItem: (item: InventoryItem) => void;
  onSell: (item: InventoryItem) => void;
  onMarketSell: (item: InventoryItem) => void;
}) {
  const grade = experienceGrade(profile);
  const backpackGear = profile.equipment.backpack?.power ?? 0;
  const capacity = 10 + (profile.upgrades.backpack + backpackGear) * 6;
  const load = profile.inventory.reduce((sum, item) => sum + item.weight, 0);
  const equippedLoad = Object.values(profile.equipment).reduce((sum, item) => sum + (item?.weight ?? 0), 0);
  const backpackWeight = (profile.upgrades.backpack + backpackGear) * 1.5;
  return (
    <section className="grid gap-4">
      <HeroStatus profile={profile} customization={customization} />

      <div className="rounded-lg border border-white/10 bg-white/5 p-3">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="text-sm font-semibold">Опытность: {grade.title}</h3>
            <p className="text-xs text-slate-400">
              Учитываются убитые враги, добытое золото и игровое время.
            </p>
          </div>
          <span className="rounded-md bg-orange-300 px-3 py-1 text-sm font-semibold text-slate-950">{grade.points}</span>
        </div>
        <div className="mb-3 h-2 overflow-hidden rounded-full bg-slate-950/60">
          <div className="h-full rounded-full bg-orange-300" style={{ width: `${grade.progress}%` }} />
        </div>
        <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
          <ResourceBadge icon={<Swords size={17} />} label="Убито врагов" value={profile.enemiesKilled ?? 0} tone="text-rose-200" />
          <ResourceBadge icon={<Coins size={17} />} label="Добыто золота" value={profile.goldMined ?? 0} tone="text-yellow-200" />
          <ResourceBadge icon={<Zap size={17} />} label="Игровое время" value={formatPlayTime(profile.playTimeMs ?? 0)} tone="text-cyan-200" />
          <ResourceBadge icon={<Gauge size={17} />} label="Следующий ранг" value={grade.nextTitle ? `${grade.progress}%` : "макс"} tone="text-orange-200" />
        </div>
      </div>

      <div className="rounded-lg border border-white/10 bg-white/5 p-3">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-semibold">Прокачка героя</h3>
          <span className="text-sm text-yellow-200">Золото: {profile.gold}</span>
        </div>
        <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
          {(Object.keys(upgradeLabels) as UpgradeKey[]).map((key) => {
            const price = upgradePrices[key](profile.upgrades[key]);
            return (
              <button
                key={key}
                className="rounded-md border border-white/10 bg-slate-950/40 px-3 py-2 text-left text-sm hover:bg-white/10 disabled:opacity-45"
                disabled={profile.gold < price}
                onClick={() => onBuy(key)}
              >
                <span className="block font-semibold">
                  {upgradeLabels[key]} {profile.upgrades[key]}
                </span>
                <span className="text-xs text-slate-300">{price} золота</span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="rounded-lg border border-white/10 bg-white/5 p-3">
        <h3 className="mb-2 text-sm font-semibold">Надетая экипировка</h3>
        <div className="grid grid-cols-2 gap-2 md:grid-cols-5">
          {(Object.keys(slotLabels) as GearSlot[]).map((slot) => {
            const item = profile.equipment[slot];
            return (
              <div key={slot} className="rounded-md border border-white/10 bg-slate-950/40 px-3 py-2 text-left text-sm">
                <div className="mb-1 flex items-center gap-2 text-xs text-slate-400">
                  {slotIcons[slot]} {slotLabels[slot]}
                </div>
                <p className="truncate font-semibold" style={{ color: item?.color ?? "#94a3b8" }}>
                  {item?.name ?? "пусто"}
                </p>
                {item && <p className="text-xs text-slate-400">осталось {formatWear(item)}</p>}
                {item && (
                  <div className="mt-2 grid gap-1">
                    <button className="rounded border border-white/15 px-2 py-1 text-xs" onClick={() => onUnequip(slot)}>
                      Снять
                    </button>
                    <button
                      className="rounded bg-emerald-300 px-2 py-1 text-xs font-semibold text-slate-950 disabled:opacity-45"
                      disabled={profile.gold < repairCost(item)}
                      onClick={() => onRepair(item)}
                    >
                      Ремонт {repairCost(item)}
                    </button>
                    <button
                      className="rounded bg-violet-300 px-2 py-1 text-xs font-semibold text-slate-950 disabled:opacity-45"
                      disabled={profile.gold < upgradeItemCost(item)}
                      onClick={() => onUpgradeItem(item)}
                    >
                      Апгрейд {upgradeItemCost(item)}
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      <div className="rounded-lg border border-white/10 bg-white/5 p-3">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-semibold">Рюкзак героя</h3>
          <span className="text-sm text-slate-300">
            Внутри {load}/{capacity}, надето {equippedLoad}, рюкзак +{backpackWeight.toFixed(1)}
          </span>
        </div>
        <div className="grid max-h-56 gap-2 overflow-auto pr-1">
          {profile.inventory.length === 0 ? (
            <p className="rounded-md bg-slate-950/30 px-3 py-2 text-sm text-slate-300">Рюкзак пуст.</p>
          ) : (
            profile.inventory.map((item) => (
              <div key={item.id} className="grid gap-2 rounded-md border border-white/10 bg-slate-950/40 px-3 py-2 text-sm sm:grid-cols-[1fr_auto_auto_auto] sm:items-center">
                <span className="flex items-center gap-3">
                  <span className="grid h-9 w-9 place-items-center rounded-md border border-white/10" style={{ backgroundColor: `${item.color}33`, color: item.color }}>
                    {slotIcons[item.slot]}
                  </span>
                  <span>
                    <span className="block font-semibold">{item.name}</span>
                    <span className="text-xs text-slate-400">
                      {rarityLabel(item.rarity)} · {slotLabels[item.slot]} · {upgradeLabels[item.effect]} +{item.power} · вес {item.weight} · срок {formatWear(item)} · цена {itemTradeValue(item)}
                    </span>
                  </span>
                </span>
                <button className="rounded bg-cyan-300 px-2 py-1 font-semibold text-slate-950" onClick={() => onUse(item)}>
                  Надеть
                </button>
                <button className="rounded border border-white/15 px-2 py-1" onClick={() => onSell(item)}>
                  Быстро {itemTradeValue(item)}
                </button>
                <button className="rounded border border-amber-200/30 px-2 py-1 text-amber-100" onClick={() => onMarketSell(item)}>
                  На рынок {itemTradeValue(item)}
                </button>
              </div>
            ))
          )}
        </div>
        <p className="mt-2 text-xs text-slate-400">Вещи в рюкзаке не изнашиваются. Вес груза влияет на скорость и прыжок.</p>
      </div>
    </section>
  );
}

function HeroAvatar({ customization, profile }: { customization: CharacterCustomization; profile: PlayerProfile }) {
  const armor = profile.equipment.armor?.color ?? customization.hoodie;
  const boots = profile.equipment.boots?.color ?? customization.pants;
  const weapon = profile.equipment.weapon?.color;
  const backpack = profile.equipment.backpack?.color;
  const hasPixelSkin = customization.pixelSkin?.some((row) => row.some(Boolean));
  return (
    <div className="relative h-28 w-24 rounded-lg border border-white/10 bg-slate-950/50">
      {hasPixelSkin && customization.pixelSkin ? (
        <PixelSkinView skin={customization.pixelSkin} className="absolute left-7 top-3 h-20 w-20" />
      ) : (
        <>
          {backpack && <span className="absolute left-3 top-10 h-11 w-5 rounded-sm" style={{ backgroundColor: backpack }} />}
          <span className="absolute left-9 top-4 h-5 w-6 rounded-sm" style={{ backgroundColor: "#f4c7a1" }} />
          <span className="absolute left-8 top-2 h-3 w-8 rounded-sm" style={{ backgroundColor: customization.hairColor }} />
          <span className="absolute left-7 top-9 h-10 w-10 rounded-sm border border-white/20" style={{ backgroundColor: armor }} />
          <span className="absolute left-5 top-11 h-8 w-2.5 rounded-sm" style={{ backgroundColor: armor }} />
          <span className="absolute right-5 top-11 h-8 w-2.5 rounded-sm" style={{ backgroundColor: armor }} />
          <span className="absolute left-8 top-[4.6rem] h-7 w-3 rounded-sm" style={{ backgroundColor: boots }} />
          <span className="absolute left-[3.25rem] top-[4.6rem] h-7 w-3 rounded-sm" style={{ backgroundColor: boots }} />
          {weapon && <span className="absolute right-1 top-10 h-2 w-9 rotate-12 rounded-full" style={{ backgroundColor: weapon }} />}
          <span className="absolute left-[2.55rem] top-7 h-1.5 w-1.5 rounded-full bg-slate-950" />
          <span className="absolute left-[3.25rem] top-7 h-1.5 w-1.5 rounded-full bg-slate-950" />
        </>
      )}
      <span className="absolute bottom-2 left-2 right-2 truncate text-center text-[10px] text-slate-300">{profile.nickname}</span>
    </div>
  );
}

function PixelSkinView({ skin, className }: { skin: Array<Array<string | null>>; className: string }) {
  return (
    <div className={`grid overflow-hidden rounded-sm border border-white/10 ${className}`} style={{ gridTemplateColumns: "repeat(16, minmax(0, 1fr))" }}>
      {skin.flatMap((row, y) =>
        row.map((color, x) => <span key={`${x}:${y}`} style={{ backgroundColor: color ?? "transparent" }} />),
      )}
    </div>
  );
}

function Modal({
  title,
  children,
  onClose,
  size = "normal",
}: {
  title: string;
  children: React.ReactNode;
  onClose: () => void;
  size?: "normal" | "wide";
}) {
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/75 p-4">
      <div className={`max-h-[86vh] w-full overflow-hidden rounded-lg border border-white/15 bg-[#17212a] shadow-2xl ${size === "wide" ? "max-w-6xl" : "max-w-4xl"}`}>
        <div className="flex items-center justify-between gap-3 border-b border-white/10 px-4 py-3">
          <h2 className="text-lg font-semibold">{title}</h2>
          <button className="grid h-9 w-9 place-items-center rounded-md border border-white/15 hover:bg-white/10" onClick={onClose} aria-label="Закрыть">
            <X size={17} />
          </button>
        </div>
        <div className="max-h-[calc(86vh-58px)] overflow-auto p-4">{children}</div>
      </div>
    </div>
  );
}

function NoticeStack({ notices, onClose }: { notices: Notice[]; onClose: (id: number) => void }) {
  if (notices.length === 0) return null;
  return (
    <div className="pointer-events-none absolute right-3 top-3 z-20 grid w-80 max-w-[calc(100%-1.5rem)] gap-2">
      {notices.map((notice) => (
        <div key={notice.id} className="pointer-events-auto flex items-start gap-2 rounded-md border border-cyan-200/25 bg-slate-950/90 px-3 py-2 text-sm text-slate-100 shadow-xl">
          <Bell size={16} className="mt-0.5 shrink-0 text-cyan-200" />
          <span className="min-w-0 flex-1">{notice.text}</span>
          <button className="rounded p-0.5 text-slate-400 hover:bg-white/10 hover:text-slate-100" onClick={() => onClose(notice.id)} aria-label="Закрыть уведомление">
            <X size={14} />
          </button>
        </div>
      ))}
    </div>
  );
}

function ResourceBadge({ icon, label, value, tone }: { icon: React.ReactNode; label: string; value: string | number; tone: string }) {
  return (
    <div className="rounded-md border border-white/10 bg-slate-950/35 px-3 py-2">
      <div className="mb-1 flex items-center gap-2 text-xs text-slate-400">
        <span className={tone}>{icon}</span>
        {label}
      </div>
      <div className="truncate text-sm font-semibold">{value}</div>
    </div>
  );
}

function chatAuthor(nickname: string) {
  const trimmed = nickname.trim();
  if (!trimmed || trimmed.includes("@")) return "Игрок";
  return trimmed.slice(0, 24);
}

function stopGameKeyboard(event: React.KeyboardEvent<HTMLInputElement>) {
  event.stopPropagation();
  event.nativeEvent.stopImmediatePropagation();
}

function formatChatTime(createdAt: number) {
  return new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(createdAt));
}

function playChatSound() {
  const AudioContextClass = window.AudioContext ?? window.webkitAudioContext;
  if (!AudioContextClass) return;
  const context = new AudioContextClass();
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  oscillator.type = "square";
  oscillator.frequency.value = 880;
  gain.gain.setValueAtTime(0.035, context.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, context.currentTime + 0.12);
  oscillator.connect(gain);
  gain.connect(context.destination);
  oscillator.start();
  oscillator.stop(context.currentTime + 0.12);
  setTimeout(() => context.close(), 180);
}

function ChatPanel({
  messages,
  value,
  replyTo,
  soundEnabled,
  onChange,
  onReply,
  onCancelReply,
  onToggleSound,
  onSend,
}: {
  messages: ChatMessage[];
  value: string;
  replyTo: ChatMessage | null;
  soundEnabled: boolean;
  onChange: (value: string) => void;
  onReply: (message: ChatMessage) => void;
  onCancelReply: () => void;
  onToggleSound: () => void;
  onSend: () => void;
}) {
  return (
    <section className="rounded-lg border border-white/10 bg-white/5 p-3">
      <div className="mb-2 flex items-center gap-2">
        <MessageCircle size={18} className="text-cyan-200" />
        <h2 className="text-sm font-semibold">Общий чат игроков</h2>
        <button
          className="ml-auto inline-flex h-8 items-center gap-2 rounded-md border border-white/15 px-2 text-xs hover:bg-white/10"
          type="button"
          onClick={onToggleSound}
        >
          {soundEnabled ? <Bell size={15} /> : <BellOff size={15} />}
          {soundEnabled ? "Звук вкл" : "Звук выкл"}
        </button>
      </div>
      <div className="grid max-h-40 gap-1 overflow-auto rounded-md bg-slate-950/45 p-2 text-sm">
        {messages.length === 0 ? (
          <p className="text-slate-400">Сообщений пока нет.</p>
        ) : (
          messages.map((message) => (
            <div key={message.id} className="group rounded-md px-2 py-1 text-slate-200 hover:bg-white/5">
              {message.replyTo && (
                <div className="mb-1 rounded border-l-2 border-cyan-200/70 bg-slate-900/70 px-2 py-1 text-xs text-slate-300">
                  <span className="font-semibold text-cyan-200">{message.replyTo.author}: </span>
                  {message.replyTo.text}
                </div>
              )}
              <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                <span className="font-semibold text-cyan-200">{message.author}</span>
                <span className="text-[11px] text-slate-500">{formatChatTime(message.createdAt)}</span>
                <button
                  className="inline-flex items-center gap-1 rounded border border-white/10 px-1.5 py-0.5 text-[11px] text-slate-300 opacity-100 hover:bg-white/10 sm:opacity-0 sm:group-hover:opacity-100"
                  type="button"
                  onClick={() => onReply(message)}
                >
                  <Reply size={12} />
                  Ответить
                </button>
              </div>
              <p className="break-words">{message.text}</p>
            </div>
          ))
        )}
      </div>
      {replyTo && (
        <div className="mt-2 flex items-center gap-2 rounded-md border border-cyan-200/30 bg-cyan-300/10 px-3 py-2 text-sm">
          <Reply size={15} className="text-cyan-200" />
          <span className="min-w-0 flex-1 truncate text-slate-200">
            Ответ {replyTo.author}: {replyTo.text}
          </span>
          <button className="rounded p-1 hover:bg-white/10" type="button" onClick={onCancelReply} aria-label="Отменить ответ">
            <X size={15} />
          </button>
        </div>
      )}
      <form
        className="mt-2 flex gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          onSend();
        }}
      >
        <input
          className="min-w-0 flex-1 rounded-md border border-white/10 bg-slate-950/50 px-3 py-2 text-sm outline-none focus:border-cyan-200"
          maxLength={240}
          placeholder="Написать всем..."
          value={value}
          onFocus={() => window.dispatchEvent(new CustomEvent("lodegame:chat-focus", { detail: { active: true } }))}
          onBlur={() => window.dispatchEvent(new CustomEvent("lodegame:chat-focus", { detail: { active: false } }))}
          onChange={(event) => onChange(event.target.value)}
          onKeyDownCapture={stopGameKeyboard}
          onKeyUpCapture={stopGameKeyboard}
        />
        <button className="rounded-md bg-cyan-300 px-4 py-2 text-sm font-semibold text-slate-950" type="submit">
          Отправить
        </button>
      </form>
    </section>
  );
}

function MarketPanel({
  profile,
  market,
  onBuyResource,
  onSellResource,
  onMarketBuy,
}: {
  profile: ReturnType<typeof useGameState.getState>["profile"];
  market: MarketListing[];
  onBuyResource: (kind: "stone" | "iron") => void;
  onSellResource: (kind: "stone" | "iron") => void;
  onMarketBuy: (listing: MarketListing) => void;
}) {
  const backpackGear = profile.equipment.backpack?.power ?? 0;
  const capacity = 10 + (profile.upgrades.backpack + backpackGear) * 6;
  const load = profile.inventory.reduce((sum, item) => sum + item.weight, 0);

  return (
    <section className="grid gap-3">
      <div className="rounded-lg border border-white/10 bg-white/5 p-3">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold">Материалы</h2>
          <span className="text-xs text-slate-400">Камень: {profile.stone} · Железо: {profile.iron} · Золото: {profile.gold}</span>
        </div>
        <div className="grid gap-2 md:grid-cols-2">
          <ResourceTradeCard
            icon={<Zap size={18} />}
            title="Камень"
            description="Основной материал для стен и лестниц. Появляется на карте серыми кучками."
            amount={profile.stone}
            buyLabel="Купить 1 зол."
            sellLabel="Продать +1 зол."
            buyDisabled={profile.gold < 1}
            sellDisabled={profile.stone <= 0}
            onBuy={() => onBuyResource("stone")}
            onSell={() => onSellResource("stone")}
          />
          <ResourceTradeCard
            icon={<Gem size={18} />}
            title="Железо"
            description="Редкий материал для лестниц. Появляется на карте светлыми слитками."
            amount={profile.iron}
            buyLabel="Купить 3 зол."
            sellLabel="Продать +2 зол."
            buyDisabled={profile.gold < 3}
            sellDisabled={profile.iron <= 0}
            onBuy={() => onBuyResource("iron")}
            onSell={() => onSellResource("iron")}
          />
        </div>
      </div>

      <div className="rounded-lg border border-white/10 bg-white/5 p-3">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold">Рынок игроков</h2>
          <span className="text-xs text-slate-400">Свободно в рюкзаке: {Math.max(0, capacity - load)}</span>
        </div>
        <div className="grid max-h-[48vh] gap-2 overflow-auto pr-1 md:grid-cols-2">
          {market.length === 0 ? (
            <p className="rounded-md bg-slate-950/30 px-3 py-2 text-sm text-slate-300">Лотов пока нет.</p>
          ) : (
            market.map((listing) => (
              <div key={listing.id} className="grid gap-2 rounded-md bg-slate-950/40 px-3 py-2 text-sm sm:grid-cols-[1fr_auto] sm:items-center">
                <span>
                  {listing.item.name} от {listing.seller}: {listing.price} золота
                </span>
                <button
                  className="rounded bg-yellow-300 px-2 py-1 font-semibold text-slate-950 disabled:opacity-45"
                  disabled={profile.gold < listing.price || load + listing.item.weight > capacity}
                  onClick={() => onMarketBuy(listing)}
                >
                  Купить
                </button>
              </div>
            ))
          )}
        </div>
      </div>
    </section>
  );
}

function ResourceTradeCard({
  icon,
  title,
  description,
  amount,
  buyLabel,
  sellLabel,
  buyDisabled,
  sellDisabled,
  onBuy,
  onSell,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  amount: number;
  buyLabel: string;
  sellLabel: string;
  buyDisabled: boolean;
  sellDisabled: boolean;
  onBuy: () => void;
  onSell: () => void;
}) {
  return (
    <div className="rounded-md border border-white/10 bg-slate-950/40 p-3">
      <div className="mb-2 flex items-start gap-3">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-md border border-white/10 bg-white/5 text-cyan-200">{icon}</span>
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="font-semibold">{title}</h3>
            <span className="rounded bg-white/10 px-2 py-0.5 text-xs text-slate-200">{amount}</span>
          </div>
          <p className="mt-1 text-xs text-slate-400">{description}</p>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <button className="rounded bg-cyan-300 px-3 py-2 text-sm font-semibold text-slate-950 disabled:opacity-45" disabled={buyDisabled} onClick={onBuy}>
          {buyLabel}
        </button>
        <button className="rounded border border-white/15 px-3 py-2 text-sm hover:bg-white/10 disabled:opacity-45" disabled={sellDisabled} onClick={onSell}>
          {sellLabel}
        </button>
      </div>
    </div>
  );
}

function selectBuildMode(mode: BuildMode, setBuildMode: (mode: BuildMode) => void) {
  setBuildMode(mode);
  window.dispatchEvent(new CustomEvent("lodegame:build-mode", { detail: { mode } }));
}

function BuildButton({ active, icon, label, onClick }: { active: boolean; icon?: React.ReactNode; label: string; onClick: () => void }) {
  return (
    <button
      className={`inline-flex h-9 items-center gap-2 rounded-md border px-3 text-sm ${
        active ? "border-cyan-200 bg-cyan-300 text-slate-950" : "border-white/15 bg-slate-950/30 text-slate-100 hover:bg-white/10"
      }`}
      onClick={onClick}
    >
      {icon}
      {label}
    </button>
  );
}

function LevelMinimap({ levelMap, snapshot }: { levelMap: string[]; snapshot: MinimapSnapshot | null }) {
  const width = levelMap[0]?.length ?? 1;
  const height = levelMap.length || 1;

  return (
    <section className="rounded-lg border border-white/10 bg-white/5 p-3">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-slate-100">Карта уровня</h2>
        <div className="flex flex-wrap gap-3 text-xs text-slate-300">
          <Legend color="bg-cyan-300" label="Вы" />
          <Legend color="bg-sky-500" label="Игроки" />
          <Legend color="bg-rose-500" label="Враги" />
          <Legend color="bg-yellow-300" label="Золото" />
          <Legend color="bg-slate-400" label="Камень" />
          <Legend color="bg-zinc-200" label="Железо" />
          <Legend color="bg-emerald-500" label="Двери" />
          <Legend color="bg-fuchsia-400" label="Инкубатор" />
        </div>
      </div>
      <div
        className="relative h-48 overflow-hidden rounded-md border border-white/10 bg-slate-950 md:h-56"
        style={{ aspectRatio: `${width} / ${height}`, maxHeight: 240 }}
      >
        <div className="absolute inset-0">
          {levelMap.map((row, y) =>
            [...row].map((tile, x) => {
              const color =
                tile === "#"
                  ? "bg-sky-800"
                  : tile === "S"
                    ? "bg-orange-700"
                    : tile === "P"
                      ? "bg-orange-500"
                      : tile === "L"
                        ? "bg-amber-200"
                        : tile === "D"
                          ? "bg-emerald-500"
                          : "bg-transparent";
              if (tile === ".") return null;
              return (
                <span
                  key={`${x}:${y}`}
                  className={`absolute ${color}`}
                  style={{
                    left: `${(x / width) * 100}%`,
                    top: `${(y / height) * 100}%`,
                    width: `${100 / width}%`,
                    height: `${100 / height}%`,
                    opacity: tile === "L" || tile === "D" ? 0.85 : 0.72,
                  }}
                />
              );
            }),
          )}
          {snapshot?.entities.map((entity) => (
            <MinimapDot key={`${entity.type}-${entity.id}`} entity={entity} width={width} height={height} />
          ))}
          {snapshot && (
            <span
              className="absolute border border-cyan-200/90 bg-cyan-200/10"
              style={{
                left: `${(snapshot.camera.x / width) * 100}%`,
                top: `${(snapshot.camera.y / height) * 100}%`,
                width: `${(snapshot.camera.width / width) * 100}%`,
                height: `${(snapshot.camera.height / height) * 100}%`,
              }}
            />
          )}
        </div>
      </div>
    </section>
  );
}

function MinimapDot({ entity, width, height }: { entity: MinimapEntity; width: number; height: number }) {
  const style = {
    left: `${(entity.x / width) * 100}%`,
    top: `${(entity.y / height) * 100}%`,
  };
  const base = "absolute z-10 -translate-x-1/2 -translate-y-1/2 rounded-full ring-1 ring-slate-950/80";
  const className =
    entity.type === "player"
      ? `${base} h-3 w-3 bg-cyan-300 ring-2 ring-white`
      : entity.type === "remotePlayer"
        ? `${base} h-2.5 w-2.5 bg-sky-500`
        : entity.type === "enemy"
          ? `${base} h-2.5 w-2.5 bg-rose-500`
          : entity.type === "coin"
            ? `${base} h-2 w-2 bg-yellow-300`
            : entity.type === "stone"
              ? `${base} h-2 w-2 bg-slate-400`
              : entity.type === "iron"
                ? `${base} h-2 w-2 bg-zinc-200`
            : entity.type === "incubator"
              ? `${base} h-2.5 w-2.5 bg-fuchsia-400`
              : entity.type === "exit"
                ? `${base} h-3 w-3 rounded-sm bg-emerald-300`
                : `${base} h-2 w-2 bg-lime-300`;

  return <span className={className} style={style} />;
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={`h-2.5 w-2.5 rounded-full ${color}`} />
      {label}
    </span>
  );
}
