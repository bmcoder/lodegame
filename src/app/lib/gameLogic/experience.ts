import type { PlayerProfile } from "@/app/lib/gameLogic/types";

export type ExperienceGrade = {
  title: string;
  points: number;
  nextTitle?: string;
  nextAt?: number;
  progress: number;
};

const grades = [
  { title: "Новичок", at: 0 },
  { title: "Старатель", at: 300 },
  { title: "Охотник", at: 900 },
  { title: "Ветеран", at: 1800 },
  { title: "Мастер шахт", at: 3400 },
  { title: "Легенда мира", at: 6000 },
];

export function experiencePoints(profile: PlayerProfile) {
  const kills = profile.enemiesKilled ?? 0;
  const gold = profile.goldMined ?? 0;
  const minutes = Math.floor((profile.playTimeMs ?? 0) / 60_000);
  return kills * 120 + gold * 35 + minutes * 4;
}

export function experienceGrade(profile: PlayerProfile): ExperienceGrade {
  const points = experiencePoints(profile);
  let currentIndex = 0;
  for (let index = 0; index < grades.length; index += 1) {
    if (points >= grades[index].at) currentIndex = index;
  }
  const current = grades[currentIndex] ?? grades[0];
  const next = grades[currentIndex + 1];
  const progress = next ? Math.round(((points - current.at) / (next.at - current.at)) * 100) : 100;
  return {
    title: current.title,
    points,
    nextTitle: next?.title,
    nextAt: next?.at,
    progress: Math.max(0, Math.min(100, progress)),
  };
}

export function formatPlayTime(ms: number) {
  const totalMinutes = Math.floor(ms / 60_000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return hours > 0 ? `${hours} ч ${minutes} мин` : `${minutes} мин`;
}
