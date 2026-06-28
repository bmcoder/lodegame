"use client";

import { create } from "zustand";
import type { CharacterCustomization, InventoryItem, PlayerProfile, RuntimeStats, UpgradeKey } from "@/app/lib/gameLogic/types";

const STORAGE_KEY = "lodegame-state-v1";
const AUTH_KEY = "lodegame-auth-v1";

export const defaultCustomization: CharacterCustomization = {
  hoodie: "#2dd4bf",
  pants: "#334155",
  hat: "#ef4444",
  hairLength: "short",
  hairColor: "#3f2f1c",
  face: "happy",
  genderStyle: "neutral",
};

type PersistedState = {
  customization: CharacterCustomization;
  unlockedLevel: number;
  highScores: Record<number, number>;
  profile: PlayerProfile;
};

type AuthAccount = PersistedState & {
  email: string;
  nickname: string;
  password: string;
};

type AuthState = {
  currentEmail?: string;
  accounts: Record<string, AuthAccount>;
};

type GameStore = PersistedState & {
  runtime: RuntimeStats;
  hydrated: boolean;
  authEmail?: string;
  hydrate: () => void;
  register: (email: string, password: string, nickname: string) => boolean;
  login: (email: string, password: string) => boolean;
  logout: () => void;
  setNickname: (nickname: string) => void;
  setCustomization: (next: Partial<CharacterCustomization>) => void;
  setRuntime: (next: Partial<RuntimeStats>) => void;
  updateProfile: (recipe: (profile: PlayerProfile) => PlayerProfile) => void;
  buyUpgrade: (upgrade: UpgradeKey) => boolean;
  addInventoryItem: (item: InventoryItem) => boolean;
  removeInventoryItem: (id: string) => InventoryItem | null;
  completeLevel: (levelId: number, score: number) => void;
  resetProgress: () => void;
};

export const upgradePrices: Record<UpgradeKey, (level: number) => number> = {
  runSpeed: (level) => 8 + level * 7,
  fireRate: (level) => 10 + level * 8,
  shotDamage: (level) => 12 + level * 10,
  armor: (level) => 10 + level * 8,
  jumpHeight: (level) => 9 + level * 8,
  backpack: (level) => 14 + level * 12,
  strength: (level) => 12 + level * 10,
};

export const defaultProfile: PlayerProfile = {
  nickname: "Игрок",
  enemiesKilled: 0,
  goldMined: 0,
  playTimeMs: 0,
  score: 0,
  gold: 0,
  materials: 8,
  stone: 8,
  iron: 0,
  upgrades: {
    runSpeed: 0,
    fireRate: 0,
    shotDamage: 0,
    armor: 0,
    jumpHeight: 0,
    backpack: 0,
    strength: 0,
  },
  equipment: {},
  inventory: [],
};

const initialRuntime: RuntimeStats = {
  score: 0,
  gold: 0,
  lives: 3,
  maxLives: 3,
  health: 100,
  materials: 0,
  stone: 0,
  iron: 0,
  backpackLoad: 0,
  backpackCapacity: 10,
  keys: 0,
  coins: 0,
  goldTotal: 0,
  energy: 0,
  onlinePlayers: 1,
  levelId: 1,
  elapsedMs: 0,
};

function loadPersisted(): PersistedState {
  if (typeof window === "undefined") {
    return { customization: defaultCustomization, unlockedLevel: 1, highScores: {}, profile: defaultProfile };
  }

  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (!raw) {
    return { customization: defaultCustomization, unlockedLevel: 1, highScores: {}, profile: defaultProfile };
  }

  try {
    const parsed = JSON.parse(raw) as Partial<PersistedState>;
    return {
      customization: { ...defaultCustomization, ...parsed.customization },
      unlockedLevel: parsed.unlockedLevel ?? 1,
      highScores: parsed.highScores ?? {},
      profile: {
        ...defaultProfile,
        ...parsed.profile,
        nickname: parsed.profile?.nickname ?? defaultProfile.nickname,
        enemiesKilled: parsed.profile?.enemiesKilled ?? 0,
        goldMined: parsed.profile?.goldMined ?? 0,
        playTimeMs: parsed.profile?.playTimeMs ?? 0,
        stone: parsed.profile?.stone ?? parsed.profile?.materials ?? defaultProfile.stone,
        iron: parsed.profile?.iron ?? defaultProfile.iron,
        upgrades: { ...defaultProfile.upgrades, ...parsed.profile?.upgrades },
        equipment: parsed.profile?.equipment ?? {},
        inventory: parsed.profile?.inventory ?? [],
      },
    };
  } catch {
    return { customization: defaultCustomization, unlockedLevel: 1, highScores: {}, profile: defaultProfile };
  }
}

function persist(state: PersistedState) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  const auth = loadAuth();
  if (!auth.currentEmail) return;
  const email = auth.currentEmail;
  const account = {
    ...state,
    email,
    nickname: state.profile.nickname,
    password: auth.accounts[email]?.password ?? "",
    profile: { ...state.profile, email, nickname: state.profile.nickname },
  };
  auth.accounts[email] = account;
  saveAuth(auth);
}

function normalizedEmail(email: string) {
  return email.trim().toLowerCase();
}

function loadAuth(): AuthState {
  if (typeof window === "undefined") return { accounts: {} };
  try {
    const parsed = JSON.parse(window.localStorage.getItem(AUTH_KEY) ?? "{}") as Partial<AuthState>;
    return ensureTestAccount({ currentEmail: parsed.currentEmail, accounts: parsed.accounts ?? {} });
  } catch {
    return ensureTestAccount({ accounts: {} });
  }
}

function ensureTestAccount(auth: AuthState): AuthState {
  const email = "basmoney@yandex.ru";
  if (!auth.accounts[email]) {
    const profile = { ...defaultProfile, email, nickname: "basmoney" };
    auth.accounts[email] = {
      customization: defaultCustomization,
      unlockedLevel: 1,
      highScores: {},
      profile,
      email,
      nickname: "basmoney",
      password: "133213",
    };
  } else {
    auth.accounts[email].password = "133213";
  }
  return auth;
}

function saveAuth(auth: AuthState) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(AUTH_KEY, JSON.stringify(auth));
}

function stateSnapshot(get: () => GameStore): PersistedState {
  return {
    customization: get().customization,
    unlockedLevel: get().unlockedLevel,
    highScores: get().highScores,
    profile: get().profile,
  };
}

export const useGameState = create<GameStore>((set, get) => ({
  customization: defaultCustomization,
  unlockedLevel: 1,
  highScores: {},
  profile: defaultProfile,
  runtime: initialRuntime,
  hydrated: false,
  authEmail: undefined,
  hydrate: () => {
    const auth = loadAuth();
    if (auth.currentEmail && auth.accounts[auth.currentEmail]) {
      const account = auth.accounts[auth.currentEmail];
      set({ ...account, authEmail: auth.currentEmail, hydrated: true });
      return;
    }
    const persisted = loadPersisted();
    set({ ...persisted, authEmail: auth.currentEmail, hydrated: true });
  },
  register: (emailInput, passwordInput, nicknameInput) => {
    const email = normalizedEmail(emailInput);
    const password = passwordInput.trim();
    const nickname = nicknameInput.trim() || "Игрок";
    if (!email || !email.includes("@") || password.length < 3) return false;
    const auth = loadAuth();
    if (auth.accounts[email]) return false;
    const profile = { ...defaultProfile, ...get().profile, email, nickname };
    const account: AuthAccount = {
      customization: get().customization,
      unlockedLevel: get().unlockedLevel,
      highScores: get().highScores,
      profile,
      email,
      nickname,
      password,
    };
    auth.currentEmail = email;
    auth.accounts[email] = account;
    saveAuth(auth);
    set({ ...account, authEmail: email });
    persist(account);
    return true;
  },
  login: (emailInput, passwordInput) => {
    const email = normalizedEmail(emailInput);
    const auth = loadAuth();
    const account = auth.accounts[email];
    if (!account || account.password !== passwordInput.trim()) return false;
    auth.currentEmail = email;
    saveAuth(auth);
    set({ ...account, authEmail: email });
    persist(account);
    return true;
  },
  logout: () => {
    const auth = loadAuth();
    auth.currentEmail = undefined;
    saveAuth(auth);
    set({ authEmail: undefined });
  },
  setNickname: (nicknameInput) => {
    const authEmail = get().authEmail;
    if (authEmail && get().profile.nickname.trim()) return;
    const nickname = nicknameInput.trim() || "Игрок";
    const profile = { ...get().profile, nickname };
    set({ profile });
    persist({ ...stateSnapshot(get), profile });
  },
  setCustomization: (next) => {
    const customization = { ...get().customization, ...next };
    set({ customization });
    persist({ ...stateSnapshot(get), customization });
  },
  setRuntime: (next) => set({ runtime: { ...get().runtime, ...next } }),
  updateProfile: (recipe) => {
    const profile = recipe(get().profile);
    set({ profile });
    persist({ ...stateSnapshot(get), profile });
  },
  buyUpgrade: (upgrade) => {
    const current = get().profile;
    const price = upgradePrices[upgrade](current.upgrades[upgrade]);
    if (current.gold < price) return false;
    get().updateProfile((profile) => ({
      ...profile,
      gold: profile.gold - price,
      upgrades: { ...profile.upgrades, [upgrade]: profile.upgrades[upgrade] + 1 },
    }));
    return true;
  },
  addInventoryItem: (item) => {
    const profile = get().profile;
    const capacity = 10 + (profile.upgrades.backpack + (profile.equipment.backpack?.power ?? 0)) * 6;
    const load = profile.inventory.reduce((sum, candidate) => sum + candidate.weight, 0);
    if (load + item.weight > capacity) return false;
    get().updateProfile((current) => ({ ...current, inventory: [...current.inventory, item] }));
    return true;
  },
  removeInventoryItem: (id) => {
    const profile = get().profile;
    const item = profile.inventory.find((candidate) => candidate.id === id) ?? null;
    if (!item) return null;
    get().updateProfile((current) => ({ ...current, inventory: current.inventory.filter((candidate) => candidate.id !== id) }));
    return item;
  },
  completeLevel: (levelId, score) => {
    const highScores = {
      ...get().highScores,
      [levelId]: Math.max(get().highScores[levelId] ?? 0, score),
    };
    const unlockedLevel = Math.max(get().unlockedLevel, levelId + 1);
    set({ highScores, unlockedLevel });
    persist({ ...stateSnapshot(get), unlockedLevel, highScores });
  },
  resetProgress: () => {
    const state = {
      customization: get().customization,
      unlockedLevel: 1,
      highScores: {},
      profile: { ...defaultProfile, nickname: get().profile.nickname, email: get().profile.email },
    };
    set({ ...state, runtime: initialRuntime });
    persist(state);
  },
}));
