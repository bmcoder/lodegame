"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Check, Eraser, Shirt, Smile, UserRound } from "lucide-react";
import { defaultCustomization, useGameState } from "@/app/hooks/useGameState";
import type { CharacterCustomization, FaceType, GenderStyle, HairLength } from "@/app/lib/gameLogic/types";

const colors = ["#2dd4bf", "#38bdf8", "#818cf8", "#f472b6", "#ef4444", "#f97316", "#facc15", "#22c55e", "#334155", "#f8fafc", "#7c3aed", "#111827"];
const hairColors = ["#111827", "#3f2f1c", "#6b3f24", "#a16207", "#d97706", "#facc15", "#e879f9", "#ef4444", "#38bdf8", "#22c55e", "#cbd5e1", "#ffffff"];
const faces: FaceType[] = ["happy", "serious", "angry", "surprised"];
const hairLengths: HairLength[] = ["short", "medium", "long"];
const genderStyles: GenderStyle[] = ["neutral", "soft", "sharp"];

export function CharacterEditor() {
  const customization = useGameState((state) => state.customization);
  const setCustomization = useGameState((state) => state.setCustomization);
  const hydrate = useGameState((state) => state.hydrate);
  const [pixelColor, setPixelColor] = useState<string | null>(colors[0]);

  useEffect(() => {
    hydrate();
  }, [hydrate]);

  return (
    <div className="min-h-screen bg-[#101820] text-slate-50">
      <main className="mx-auto grid min-h-screen w-full max-w-6xl gap-6 px-4 py-6 lg:grid-cols-[320px_1fr]">
        <aside className="flex flex-col justify-between rounded-lg border border-white/10 bg-white/5 p-5">
          <div>
            <p className="text-sm text-cyan-200">Конструктор персонажа</p>
            <h1 className="mt-1 text-3xl font-semibold">Образ героя</h1>
            <div className="mt-6 grid place-items-center rounded-lg bg-slate-950/70 p-6">
              <HeroPreview customization={customization} />
            </div>
          </div>
          <div className="mt-5 flex gap-2">
            <Link className="flex-1 rounded-md bg-cyan-300 px-4 py-2 text-center font-semibold text-slate-950" href="/menu">
              Сохранить
            </Link>
            <button
              className="rounded-md border border-white/15 px-4 py-2"
              onClick={() => setCustomization({ ...defaultCustomization, pixelSkin: undefined })}
            >
              Сбросить
            </button>
          </div>
        </aside>

        <section className="grid content-start gap-4">
          <Panel title="Одежда" icon={<Shirt size={18} />}>
            <ColorPicker label="Кофта" value={customization.hoodie} onChange={(hoodie) => setCustomization({ hoodie })} />
            <ColorPicker label="Штаны" value={customization.pants} onChange={(pants) => setCustomization({ pants })} />
            <ColorPicker label="Головной убор" value={customization.hat} onChange={(hat) => setCustomization({ hat })} />
          </Panel>

          <Panel title="Волосы" icon={<UserRound size={18} />}>
            <Segmented
              label="Длина"
              options={hairLengths}
              value={customization.hairLength}
              onChange={(hairLength) => setCustomization({ hairLength })}
            />
            <ColorPicker label="Цвет волос" value={customization.hairColor} palette={hairColors} onChange={(hairColor) => setCustomization({ hairColor })} />
          </Panel>

          <Panel title="Лицо" icon={<Smile size={18} />}>
            <Segmented label="Настроение" options={faces} value={customization.face} onChange={(face) => setCustomization({ face })} />
            <Segmented
              label="Стиль"
              options={genderStyles}
              value={customization.genderStyle}
              onChange={(genderStyle) => setCustomization({ genderStyle })}
            />
          </Panel>

          <Panel title="Пиксельный образ" icon={<Smile size={18} />}>
            <PixelEditor
              skin={customization.pixelSkin}
              selected={pixelColor}
              onSelected={setPixelColor}
              onChange={(pixelSkin) => setCustomization({ pixelSkin })}
            />
          </Panel>
        </section>
      </main>
    </div>
  );
}

function emptySkin() {
  return Array.from({ length: 16 }, () => Array.from({ length: 16 }, () => null as string | null));
}

function PixelEditor({
  skin,
  selected,
  onSelected,
  onChange,
}: {
  skin?: Array<Array<string | null>>;
  selected: string | null;
  onSelected: (color: string | null) => void;
  onChange: (skin: Array<Array<string | null>>) => void;
}) {
  const grid = skin?.length === 16 ? skin : emptySkin();
  const palette = [...new Set([...colors, ...hairColors, "#f4c7a1"])];
  return (
    <div className="grid gap-4 lg:grid-cols-[auto_1fr]">
      <div className="grid h-64 w-64 overflow-hidden rounded-md border border-white/15 bg-slate-950" style={{ gridTemplateColumns: "repeat(16, minmax(0, 1fr))" }}>
        {grid.flatMap((row, y) =>
          row.map((color, x) => (
            <button
              key={`${x}:${y}`}
              className="border border-white/[0.04]"
              style={{ backgroundColor: color ?? "transparent" }}
              onClick={() => {
                const next = grid.map((candidate) => [...candidate]);
                next[y][x] = selected;
                onChange(next);
              }}
              type="button"
            />
          )),
        )}
      </div>
      <div>
        <p className="mb-2 text-sm text-slate-300">Палитра</p>
        <div className="mb-3 grid grid-cols-6 gap-2 sm:grid-cols-9">
          {palette.map((color) => (
            <button
              key={color}
              aria-label={`Пиксель ${color}`}
              className={`h-9 w-9 rounded-md border ${selected === color ? "border-cyan-200 ring-2 ring-cyan-200/40" : "border-white/15"}`}
              style={{ backgroundColor: color }}
              onClick={() => onSelected(color)}
              type="button"
            />
          ))}
          <button
            className={`grid h-9 w-9 place-items-center rounded-md border ${selected === null ? "border-cyan-200 ring-2 ring-cyan-200/40" : "border-white/15"}`}
            onClick={() => onSelected(null)}
            type="button"
          >
            <Eraser size={17} />
          </button>
        </div>
        <button className="rounded-md border border-white/15 px-3 py-2 text-sm" onClick={() => onChange(emptySkin())} type="button">
          Очистить пиксели
        </button>
      </div>
    </div>
  );
}

function Panel({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-white/10 bg-white/5 p-4">
      <h2 className="mb-4 flex items-center gap-2 text-lg font-semibold">
        {icon}
        {title}
      </h2>
      <div className="grid gap-5">{children}</div>
    </div>
  );
}

function ColorPicker({
  label,
  value,
  onChange,
  palette = colors,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  palette?: string[];
}) {
  return (
    <div>
      <p className="mb-2 text-sm text-slate-300">{label}</p>
      <div className="grid grid-cols-6 gap-2 sm:grid-cols-12">
        {palette.map((color) => (
          <button
            key={color}
            aria-label={`${label} ${color}`}
            className="grid h-9 w-9 place-items-center rounded-md border border-white/15"
            style={{ backgroundColor: color }}
            onClick={() => onChange(color)}
          >
            {value === color && <Check size={17} className="drop-shadow-[0_1px_1px_rgba(0,0,0,0.9)]" />}
          </button>
        ))}
      </div>
    </div>
  );
}

function Segmented<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: T[];
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <div>
      <p className="mb-2 text-sm text-slate-300">{label}</p>
      <div className="flex flex-wrap gap-2">
        {options.map((option) => (
          <button
            key={option}
            className={`rounded-md border px-3 py-2 text-sm capitalize ${
              value === option ? "border-cyan-300 bg-cyan-300 text-slate-950" : "border-white/15 bg-white/5"
            }`}
            onClick={() => onChange(option)}
          >
            {option}
          </button>
        ))}
      </div>
    </div>
  );
}

function HeroPreview({ customization }: { customization: CharacterCustomization }) {
  const hasPixelSkin = customization.pixelSkin?.some((row) => row.some(Boolean));
  const face = {
    happy: "u",
    serious: "-",
    angry: "v",
    surprised: "o",
  }[customization.face];

  return (
    <div className="relative h-56 w-36">
      {hasPixelSkin && customization.pixelSkin ? (
        <div className="absolute left-2 top-2 grid h-52 w-32 overflow-hidden rounded-md border border-white/10" style={{ gridTemplateColumns: "repeat(16, minmax(0, 1fr))" }}>
          {customization.pixelSkin.flatMap((row, y) =>
            row.map((color, x) => <span key={`${x}:${y}`} style={{ backgroundColor: color ?? "transparent" }} />),
          )}
        </div>
      ) : (
        <>
      <div className="absolute left-10 top-5 h-10 w-16 rounded-t-md" style={{ backgroundColor: customization.hairColor }} />
      <div className="absolute left-11 top-8 grid h-14 w-14 place-items-center rounded-sm bg-[#f4c7a1] text-xl font-bold text-slate-950">
        {face}
      </div>
      <div className="absolute left-8 top-4 h-5 w-20 rounded-sm" style={{ backgroundColor: customization.hat }} />
      {customization.hairLength !== "short" && (
        <div
          className={`absolute left-8 top-10 w-20 rounded-b-md ${customization.hairLength === "long" ? "h-16" : "h-10"}`}
          style={{ backgroundColor: customization.hairColor }}
        />
      )}
      <div className="absolute left-7 top-24 h-20 w-24 rounded-sm" style={{ backgroundColor: customization.hoodie }} />
      <div className="absolute left-1 top-28 h-14 w-8 rounded-sm" style={{ backgroundColor: customization.hoodie }} />
      <div className="absolute right-1 top-28 h-14 w-8 rounded-sm" style={{ backgroundColor: customization.hoodie }} />
      <div className="absolute left-8 top-44 h-10 w-9 rounded-sm" style={{ backgroundColor: customization.pants }} />
      <div className="absolute right-8 top-44 h-10 w-9 rounded-sm" style={{ backgroundColor: customization.pants }} />
        </>
      )}
    </div>
  );
}
