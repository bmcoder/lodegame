"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Brush, Play, UserRound } from "lucide-react";
import { useGameState } from "@/app/hooks/useGameState";
import { HeroSummary } from "@/app/components/HeroSummary";

export default function SettingsPage() {
  const hydrate = useGameState((state) => state.hydrate);
  const authEmail = useGameState((state) => state.authEmail);
  const profile = useGameState((state) => state.profile);
  const customization = useGameState((state) => state.customization);
  const login = useGameState((state) => state.login);
  const register = useGameState((state) => state.register);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [nickname, setNickname] = useState("");
  const [message, setMessage] = useState("");

  useEffect(() => {
    hydrate();
  }, [hydrate]);

  return (
    <main className="min-h-screen bg-[#101820] text-slate-50">
      <div className="mx-auto grid min-h-screen w-full max-w-4xl content-start gap-5 px-4 py-6">
        <header className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-sm text-cyan-200">Настройки игрока</p>
            <h1 className="mt-1 text-4xl font-semibold">Аккаунт</h1>
          </div>
          <Link className="inline-flex h-10 items-center gap-2 rounded-md border border-white/15 px-4 text-sm hover:bg-white/10" href="/menu">
            В меню
          </Link>
        </header>

        <section className="rounded-lg border border-white/10 bg-white/5 p-4">
          {authEmail ? (
            <div className="grid gap-4">
              <div className="flex items-center gap-3">
                <span className="grid h-12 w-12 place-items-center rounded-md bg-cyan-300 text-slate-950">
                  <UserRound size={22} />
                </span>
                <div className="min-w-0">
                  <p className="truncate text-xl font-semibold">{profile.nickname}</p>
                  <p className="truncate text-sm text-slate-400">{authEmail}</p>
                </div>
              </div>
              <div className="grid gap-3 md:grid-cols-3">
                <Info label="Nickname" value={profile.nickname} />
                <Info label="Email" value={authEmail} />
                <Info label="Статус" value="Авторизован" />
              </div>
              <p className="rounded-md border border-amber-200/20 bg-amber-200/10 px-3 py-2 text-sm text-amber-100">
                Nickname задается один раз при регистрации и дальше не меняется.
              </p>
              <div className="flex flex-wrap gap-2">
                <Link className="inline-flex h-10 items-center gap-2 rounded-md bg-cyan-300 px-4 text-sm font-semibold text-slate-950" href="/game/1">
                  <Play size={16} />
                  Войти в мир
                </Link>
              </div>
            </div>
          ) : (
            <div className="grid gap-4">
              <p className="text-sm text-slate-300">Войдите в существующий аккаунт или зарегистрируйте новый. Nickname после регистрации изменить нельзя.</p>
              <form
                className="grid gap-3 md:grid-cols-[1fr_1fr_auto]"
                onSubmit={(event) => {
                  event.preventDefault();
                  const ok = login(email, password);
                  setMessage(ok ? "Вход выполнен." : "Неверный email или пароль.");
                }}
              >
                <Field label="Email" value={email} onChange={setEmail} />
                <Field label="Пароль" value={password} onChange={setPassword} type="password" />
                <button className="rounded-md bg-cyan-300 px-4 py-2 font-semibold text-slate-950 md:self-end" type="submit">
                  Войти
                </button>
              </form>
              <div className="grid gap-3 rounded-lg border border-white/10 bg-slate-950/30 p-3 md:grid-cols-[1fr_1fr_1fr_auto]">
                <Field label="Email" value={email} onChange={setEmail} />
                <Field label="Пароль" value={password} onChange={setPassword} type="password" />
                <Field label="Nickname" value={nickname} onChange={setNickname} />
                <button
                  className="rounded-md border border-white/15 px-4 py-2 md:self-end"
                  type="button"
                  onClick={() => {
                    const ok = register(email, password, nickname);
                    setMessage(ok ? "Аккаунт создан." : "Проверьте email/пароль или войдите в существующий аккаунт.");
                  }}
                >
                  Регистрация
                </button>
              </div>
              {message && <p className="text-sm text-cyan-200">{message}</p>}
            </div>
          )}
        </section>

        {authEmail && (
          <section>
            <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
              <div>
                <h2 className="text-xl font-semibold">Герой</h2>
                <p className="text-sm text-slate-400">Параметры, экипировка, рюкзак и прокачка персонажа.</p>
              </div>
              <Link className="inline-flex h-10 items-center gap-2 rounded-md bg-cyan-300 px-4 text-sm font-semibold text-slate-950" href="/customization">
                <Brush size={16} />
                Редактор героя
              </Link>
            </div>
            <HeroSummary profile={profile} customization={customization} />
          </section>
        )}
      </div>
    </main>
  );
}

function Field({ label, value, onChange, type = "text" }: { label: string; value: string; onChange: (value: string) => void; type?: string }) {
  return (
    <label className="grid gap-1 text-sm">
      <span className="text-slate-300">{label}</span>
      <input
        className="rounded-md border border-white/10 bg-slate-950/50 px-3 py-2 outline-none focus:border-cyan-200"
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-white/10 bg-slate-950/35 px-3 py-2">
      <p className="text-xs text-slate-400">{label}</p>
      <p className="truncate font-semibold">{value}</p>
    </div>
  );
}
