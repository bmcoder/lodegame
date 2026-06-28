"use client";

import { Coins, Gem, Hammer, Heart, HeartPulse, Timer, Users, Zap } from "lucide-react";
import type { RuntimeStats } from "@/app/lib/gameLogic/types";

type HudProps = {
  stats: RuntimeStats | null;
  timeLimit: number;
  message: string;
};

export function Hud({ stats, timeLimit, message }: HudProps) {
  const seconds = stats ? Math.floor(stats.elapsedMs / 1000) : 0;
  const remaining = timeLimit > 0 ? Math.max(0, timeLimit - seconds) : seconds;
  const hearts = stats ? Array.from({ length: stats.maxLives }, (_, index) => index < stats.lives) : [];

  return (
    <div className="grid gap-2 lg:grid-cols-[auto_1fr]">
      <div className="flex flex-wrap gap-2">
        <Metric icon={<Coins size={15} />} label="Очки" value={stats?.score ?? 0} />
        <Metric icon={<Coins size={15} />} label="Золото" value={stats?.gold ?? 0} />
        <Metric icon={<Hammer size={15} />} label="Рюкзак" value={stats ? `${stats.backpackLoad}/${stats.backpackCapacity}` : "0/10"} />
        <Metric icon={<Hammer size={15} />} label="Камень" value={stats?.stone ?? 0} />
        <Metric icon={<Gem size={15} />} label="Железо" value={stats?.iron ?? 0} />
        <Metric icon={<Hammer size={15} />} label="Дерево" value={stats?.wood ?? 0} />
        <Metric icon={<Zap size={15} />} label="Энергия" value={`${stats?.energy ?? 0}%`} />
        <Metric icon={<HeartPulse size={15} />} label="Здоровье" value={`${stats?.health ?? 100}%`} />
        <Metric icon={<Timer size={15} />} label="Время" value={remaining} />
        <Metric icon={<Users size={15} />} label="Онлайн" value={stats?.onlinePlayers ?? 1} />
        <div className="group relative flex h-11 items-center gap-1 rounded-md border border-white/10 bg-white/5 px-3" tabIndex={0} aria-label={`Жизни: ${stats?.lives ?? 3}`}>
          <Heart size={15} className="text-rose-200" />
          <div className="flex gap-0.5">
            {hearts.map((filled, index) => (
              <Heart key={index} size={13} className={filled ? "fill-rose-400 text-rose-400" : "text-slate-600"} />
            ))}
          </div>
          <Tooltip title="Жизни" value={stats?.lives ?? 3} text="Количество жизней в текущей игровой сессии." />
        </div>
      </div>
      <div className="rounded-md border border-cyan-200/20 bg-cyan-200/10 px-3 py-2 text-sm text-cyan-50">
        {message}
      </div>
    </div>
  );
}

function Metric({ icon, label, value }: { icon: React.ReactNode; label: string; value: string | number }) {
  return (
    <div className="group relative flex h-11 items-center gap-2 rounded-md border border-white/10 bg-white/5 px-3 tabular-nums" tabIndex={0} aria-label={`${label}: ${value}`}>
      <span className="text-slate-300">
        {icon}
      </span>
      <span className="text-sm font-semibold">{value}</span>
      <Tooltip title={label} value={value} text={tooltipText(label)} />
    </div>
  );
}

function Tooltip({ title, value, text }: { title: string; value: string | number; text: string }) {
  return (
    <span className="pointer-events-none absolute left-0 top-12 z-30 hidden w-56 rounded-md border border-white/10 bg-slate-950 px-3 py-2 text-xs text-slate-300 shadow-xl group-hover:block group-focus:block">
      <span className="mb-1 block font-semibold text-slate-100">
        {title}: {value}
      </span>
      {text}
    </span>
  );
}

function tooltipText(label: string) {
  const descriptions: Record<string, string> = {
    Очки: "Опыт и общий счет игрока.",
    Золото: "Валюта для покупок, ремонта, апгрейда и рынка.",
    Рюкзак: "Занятый вес и текущая вместимость рюкзака.",
    Камень: "Материал для строительства стен и лестниц. Собирается на карте или покупается в магазине.",
    Железо: "Редкий материал для лестниц. Собирается на карте или покупается в магазине.",
    Дерево: "Строительный ресурс. Собирается на карте или покупается в магазине.",
    Энергия: "Запас энергии для специальных действий.",
    Здоровье: "Текущий процент здоровья героя.",
    Время: "Время текущей игровой сессии.",
    Онлайн: "Количество игроков в общем мире.",
  };
  return descriptions[label] ?? label;
}
