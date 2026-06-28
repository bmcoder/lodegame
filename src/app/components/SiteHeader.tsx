"use client";

import { useEffect } from "react";
import Link from "next/link";
import { Coins, Gem, Heart, LogIn, LogOut, Settings, Shield, Sparkles, UserPlus, Zap } from "lucide-react";
import { useGameState } from "@/app/hooks/useGameState";
import { experienceGrade } from "@/app/lib/gameLogic/experience";

export function SiteHeader() {
  const hydrate = useGameState((state) => state.hydrate);
  const authEmail = useGameState((state) => state.authEmail);
  const profile = useGameState((state) => state.profile);
  const runtime = useGameState((state) => state.runtime);
  const logout = useGameState((state) => state.logout);

  useEffect(() => {
    hydrate();
  }, [hydrate]);

  const nickname = profile.nickname?.trim() || "Игрок";
  const lives = runtime.lives || 3;
  const grade = experienceGrade(profile);

  return (
    <header className="fixed left-0 right-0 top-0 z-50 border-b border-white/10 bg-[#101820]/95 text-slate-50 shadow-lg shadow-black/20 backdrop-blur">
      <div className="mx-auto flex h-14 w-full max-w-7xl items-center gap-3 px-3 sm:px-4 lg:px-6">
        <Link className="inline-flex items-center gap-2 font-semibold tracking-normal text-cyan-100" href="/menu" title="Главное меню Lodegame">
          <span className="grid h-7 w-7 place-items-center rounded-md bg-cyan-300 text-slate-950">
            <Sparkles size={16} />
          </span>
          <span className="hidden sm:inline">Lodegame</span>
        </Link>

        <div className="ml-auto flex min-w-0 items-center gap-2">
          <div className="hidden min-w-0 items-center gap-2 rounded-md border border-white/10 bg-slate-950/45 px-2.5 py-1.5 sm:flex">
            <Shield size={15} className="shrink-0 text-cyan-200" />
            <span className="truncate text-sm font-semibold">{authEmail ? nickname : "Гость"}</span>
          </div>

          <div className="flex items-center gap-1 rounded-md border border-white/10 bg-slate-950/45 px-1.5 py-1">
            <HeaderStat
              icon={<Sparkles size={15} />}
              value={grade.points}
              tone="text-orange-200"
              title={`Опытность: ${grade.title}`}
              description={`Ранг зависит от убитых врагов, добытого золота и игрового времени. Прогресс до следующей градации: ${grade.progress}%.`}
            />
            <HeaderStat
              icon={<Coins size={15} />}
              value={profile.gold}
              tone="text-yellow-200"
              title="Золото"
              description="Золото тратится на прокачку героя, ремонт, апгрейд и покупку вещей на рынке."
            />
            <HeaderStat
              icon={<Zap size={15} />}
              value={profile.stone}
              tone="text-cyan-200"
              title="Камень"
              description="Камень собирается на карте и нужен для строительства стен и лестниц."
            />
            <HeaderStat
              icon={<Gem size={15} />}
              value={profile.iron}
              tone="text-slate-200"
              title="Железо"
              description="Железо собирается на карте, нужно для лестниц и может продаваться или покупаться в магазине."
            />
            <HeaderStat
              icon={<Heart size={15} />}
              value={lives}
              tone="text-rose-200"
              title="Жизни"
              description="Количество текущих жизней в игровой сессии. При потере жизни герой появляется на своей точке старта."
            />
          </div>

          {authEmail ? (
            <div className="flex items-center gap-1">
              <Link
                className="grid h-9 w-9 place-items-center rounded-md border border-white/15 text-sm hover:bg-white/10"
                href="/settings"
                title="Настройки игрока"
                aria-label="Настройки игрока"
              >
                <Settings size={15} />
              </Link>
              <button
                className="inline-flex h-9 items-center gap-2 rounded-md border border-white/15 px-3 text-sm hover:bg-white/10"
                onClick={logout}
                title="Выйти из аккаунта"
              >
                <LogOut size={15} />
                <span className="hidden md:inline">Выйти</span>
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-1">
              <Link
                className="inline-flex h-9 items-center gap-2 rounded-md bg-cyan-300 px-3 text-sm font-semibold text-slate-950"
                href="/settings"
                title="Войти в аккаунт"
              >
                <LogIn size={15} />
                <span className="hidden md:inline">Вход</span>
              </Link>
              <Link
                className="inline-flex h-9 items-center gap-2 rounded-md border border-white/15 px-3 text-sm hover:bg-white/10"
                href="/settings"
                title="Зарегистрировать новый аккаунт"
              >
                <UserPlus size={15} />
                <span className="hidden md:inline">Регистрация</span>
              </Link>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}

function HeaderStat({
  icon,
  value,
  tone,
  title,
  description,
}: {
  icon: React.ReactNode;
  value: string | number;
  tone: string;
  title: string;
  description: string;
}) {
  return (
    <span className="group relative inline-flex h-8 items-center gap-1.5 rounded px-2 text-sm" aria-label={`${title}: ${value}`} tabIndex={0}>
      <span className={tone}>{icon}</span>
      <span className="font-semibold tabular-nums">{value}</span>
      <span className="pointer-events-none absolute right-0 top-10 hidden w-64 rounded-md border border-white/10 bg-slate-950 px-3 py-2 text-left text-xs text-slate-300 shadow-xl group-hover:block group-focus:block">
        <span className="mb-1 block font-semibold text-slate-100">
          {title}: {value}
        </span>
        {description}
      </span>
    </span>
  );
}
