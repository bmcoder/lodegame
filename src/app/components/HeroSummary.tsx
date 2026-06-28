"use client";

import { Backpack, Coins, Dumbbell, Gauge, Gem, Package, Shield, Swords, Zap } from "lucide-react";
import type { CharacterCustomization, GearSlot, PlayerProfile, UpgradeKey } from "@/app/lib/gameLogic/types";

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

export function HeroSummary({ profile, customization }: { profile: PlayerProfile; customization: CharacterCustomization }) {
  const inventoryCount = profile.inventory.length + Object.keys(profile.equipment).length;
  return (
    <section className="grid gap-4 rounded-lg border border-white/10 bg-white/5 p-4 lg:grid-cols-[auto_1fr]">
      <HeroAvatar profile={profile} customization={customization} />
      <div className="grid gap-4">
        <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
          <StatIcon icon={<Coins size={17} />} label="Золото" value={profile.gold} tone="text-yellow-200" />
          <StatIcon icon={<Zap size={17} />} label="Камень" value={profile.stone} tone="text-cyan-200" />
          <StatIcon icon={<Gem size={17} />} label="Железо" value={profile.iron} tone="text-slate-200" />
          <StatIcon icon={<Package size={17} />} label="Вещи" value={inventoryCount} tone="text-fuchsia-200" />
          <StatIcon icon={<Swords size={17} />} label="Очки" value={profile.score} tone="text-orange-200" />
        </div>

        <div>
          <h2 className="mb-2 text-lg font-semibold">Надето</h2>
          <div className="grid gap-2 md:grid-cols-5">
            {(Object.keys(slotLabels) as GearSlot[]).map((slot) => {
              const item = profile.equipment[slot];
              return (
                <div key={slot} className="rounded-md border border-white/10 bg-slate-950/40 px-3 py-2">
                  <div className="mb-1 flex items-center gap-2 text-xs text-slate-400">
                    {slotIcons[slot]}
                    {slotLabels[slot]}
                  </div>
                  <p className="truncate text-sm font-semibold" style={{ color: item?.color ?? "#e2e8f0" }}>
                    {item?.name ?? "пусто"}
                  </p>
                  {item && <p className="text-xs text-slate-400">+{item.power} · {formatWear(item)}</p>}
                </div>
              );
            })}
          </div>
        </div>

        <div>
          <h2 className="mb-2 text-lg font-semibold">Прокачка</h2>
          <div className="grid grid-cols-2 gap-2 md:grid-cols-7">
            {(Object.keys(upgradeLabels) as UpgradeKey[]).map((key) => (
              <div key={key} className="rounded-md border border-white/10 bg-slate-950/40 px-3 py-2">
                <p className="text-xs text-slate-400">{upgradeLabels[key]}</p>
                <p className="font-semibold">ур. {profile.upgrades[key]}</p>
              </div>
            ))}
          </div>
        </div>

        <div>
          <h2 className="mb-2 text-lg font-semibold">Рюкзак</h2>
          <div className="grid gap-2">
            {profile.inventory.length === 0 ? (
              <p className="rounded-md bg-slate-950/30 px-3 py-2 text-sm text-slate-300">Рюкзак пуст.</p>
            ) : (
              profile.inventory.map((item) => (
                <div key={item.id} className="grid gap-2 rounded-md border border-white/10 bg-slate-950/40 px-3 py-2 text-sm sm:grid-cols-[1fr_auto] sm:items-center">
                  <span>
                    <span className="block font-semibold" style={{ color: item.color }}>{item.name}</span>
                    <span className="text-xs text-slate-400">
                      {slotLabels[item.slot]} · +{item.power} · вес {item.weight} · срок {formatWear(item)}
                    </span>
                  </span>
                  <span className="text-xs text-slate-400">{slotLabels[item.slot]}</span>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

function formatWear(item: NonNullable<PlayerProfile["equipment"][GearSlot]>) {
  const remainingMs = item.remainingMs ?? item.durabilityMs ?? ITEM_DURABILITY_MS;
  return `${Math.ceil(remainingMs / 60_000)} мин`;
}

function HeroAvatar({ profile, customization }: { profile: PlayerProfile; customization: CharacterCustomization }) {
  const armor = profile.equipment.armor?.color ?? customization.hoodie;
  const boots = profile.equipment.boots?.color ?? customization.pants;
  const weapon = profile.equipment.weapon?.color;
  const backpack = profile.equipment.backpack?.color;
  const moduleColor = profile.equipment.module?.color;
  const hasPixelSkin = customization.pixelSkin?.some((row) => row.some(Boolean));
  return (
    <div className="relative h-36 w-28 rounded-lg border border-white/10 bg-slate-950/50">
      {hasPixelSkin && customization.pixelSkin ? (
        <PixelSkinView skin={customization.pixelSkin} className="absolute left-6 top-4 h-24 w-24" />
      ) : (
        <>
          {backpack && <span className="absolute left-3 top-12 h-14 w-6 rounded-sm" style={{ backgroundColor: backpack }} />}
          <span className="absolute left-10 top-5 h-6 w-7 rounded-sm" style={{ backgroundColor: "#f4c7a1" }} />
          <span className="absolute left-9 top-3 h-3 w-9 rounded-sm" style={{ backgroundColor: customization.hairColor }} />
          <span className="absolute left-8 top-12 h-12 w-12 rounded-sm border border-white/20" style={{ backgroundColor: armor }} />
          <span className="absolute left-5 top-14 h-10 w-3 rounded-sm" style={{ backgroundColor: armor }} />
          <span className="absolute right-5 top-14 h-10 w-3 rounded-sm" style={{ backgroundColor: armor }} />
          {moduleColor && <span className="absolute left-[2.65rem] top-[4.1rem] h-4 w-5 rounded-full border border-white/30" style={{ backgroundColor: moduleColor }} />}
          <span className="absolute left-9 top-[6.1rem] h-8 w-4 rounded-sm" style={{ backgroundColor: boots }} />
          <span className="absolute left-[3.55rem] top-[6.1rem] h-8 w-4 rounded-sm" style={{ backgroundColor: boots }} />
          {weapon && <span className="absolute right-0 top-14 h-2 w-11 rotate-12 rounded-full" style={{ backgroundColor: weapon }} />}
          <span className="absolute left-[2.7rem] top-9 h-1.5 w-1.5 rounded-full bg-slate-950" />
          <span className="absolute left-[3.45rem] top-9 h-1.5 w-1.5 rounded-full bg-slate-950" />
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

function StatIcon({ icon, label, value, tone }: { icon: React.ReactNode; label: string; value: string | number; tone: string }) {
  return (
    <div className="rounded-md border border-white/10 bg-slate-950/40 px-3 py-2">
      <div className="mb-1 flex items-center gap-2 text-xs text-slate-400">
        <span className={tone}>{icon}</span>
        {label}
      </div>
      <p className="font-semibold">{value}</p>
    </div>
  );
}
