"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Play, RotateCcw, Users } from "lucide-react";
import { io, type Socket } from "socket.io-client";
import { useGameState } from "@/app/hooks/useGameState";

type OnlineSnapshot = {
  total: number;
  players: Array<{ id: string; name: string }>;
};

export default function MenuPage() {
  const hydrate = useGameState((state) => state.hydrate);
  const profile = useGameState((state) => state.profile);
  const authEmail = useGameState((state) => state.authEmail);
  const resetProgress = useGameState((state) => state.resetProgress);
  const [online, setOnline] = useState<OnlineSnapshot>({ total: 0, players: [] });

  useEffect(() => {
    hydrate();
  }, [hydrate]);

  useEffect(() => {
    const socket: Socket = io(process.env.NEXT_PUBLIC_LODEGAME_SOCKET_URL ?? "http://localhost:3001", {
      transports: ["websocket", "polling"],
    });
    socket.on("online:snapshot", (snapshot: OnlineSnapshot) => setOnline(snapshot));
    return () => {
      socket.disconnect();
    };
  }, []);

  return (
    <main className="min-h-screen bg-[#101820] text-slate-50">
      <div className="mx-auto grid min-h-screen w-full max-w-5xl content-start gap-6 px-4 py-6">
        <header className="grid gap-5 md:grid-cols-[1fr_auto] md:items-end">
          <div>
            <p className="text-sm font-medium text-cyan-200">Единый онлайн-мир Lodegame</p>
            <h1 className="mt-2 text-5xl font-bold tracking-normal">Общий мир</h1>
            <p className="mt-3 max-w-2xl text-slate-300">
              Все игроки находятся на одной общей карте: собирайте золото, стройте базы, экипируйте предметы и торгуйте на рынке.
            </p>
          </div>
          <div className="flex gap-2">
            {authEmail ? (
              <Link className="inline-flex items-center gap-2 rounded-md bg-cyan-300 px-4 py-3 font-semibold text-slate-950" href="/game/1">
                <Play size={18} />
                Войти в мир
              </Link>
            ) : (
              <button className="inline-flex items-center gap-2 rounded-md bg-slate-600 px-4 py-3 font-semibold text-slate-300" disabled>
                <Play size={18} />
                Войти в мир
              </button>
            )}
          </div>
        </header>

        <section className="grid gap-4 md:grid-cols-[1fr_1fr]">
          <div className="rounded-lg border border-white/10 bg-white/5 p-4">
            <div className="flex items-center gap-2">
              <Users size={18} className="text-cyan-200" />
              <h2 className="text-lg font-semibold">Игроки онлайн: {online.total}</h2>
            </div>
            <div className="mt-3 grid gap-2 text-sm text-slate-300 sm:grid-cols-2">
              {online.players.length === 0 ? (
                <p>Сейчас никто не играет.</p>
              ) : (
                online.players.map((player) => (
                  authEmail ? (
                    <Link key={player.id} className="rounded-md bg-slate-950/40 px-3 py-2 hover:bg-slate-950/70" href="/game/1">
                      {player.name}
                    </Link>
                  ) : (
                    <span key={player.id} className="rounded-md bg-slate-950/40 px-3 py-2 text-slate-400">
                      {player.name}
                    </span>
                  )
                ))
              )}
            </div>
          </div>

          <div className="rounded-lg border border-white/10 bg-white/5 p-4">
            <h2 className="text-lg font-semibold">Профиль</h2>
            <div className="mt-3 grid grid-cols-3 gap-2 text-sm">
              <Stat label="Очки" value={profile.score} />
              <Stat label="Золото" value={profile.gold} />
              <Stat label="Предметы" value={profile.inventory.length + Object.keys(profile.equipment).length} />
            </div>
          </div>
        </section>

        <section className="grid gap-4 rounded-lg border border-white/10 bg-white/5 p-4 md:grid-cols-[1fr_auto] md:items-center">
          <div>
            <h2 className="text-lg font-semibold">Управление</h2>
            <p className="mt-1 text-sm text-slate-300">
              WASD или стрелки - движение, пробел - прыжок, E/клик - выстрел, Q - выкопать рядом, R - молния. Строительство: 1 стена, 2 лестница, 3 убрать, 4 дверь, 5 выключить.
            </p>
          </div>
          <button className="inline-flex items-center justify-center gap-2 rounded-md border border-white/15 px-4 py-3" onClick={resetProgress}>
            <RotateCcw size={17} />
            Сбросить профиль
          </button>
        </section>
      </div>
    </main>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-md bg-slate-950/40 px-3 py-2">
      <p className="text-xs text-slate-400">{label}</p>
      <p className="font-semibold">{value}</p>
    </div>
  );
}
