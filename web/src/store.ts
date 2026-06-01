import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { CustomEnvEntry, CustomModZone, CustomModSwap, CustomModHost } from './types';
import { ENV_VARS } from './types';

interface PaoPaoState {
  // Connection state
  connected: boolean;
  filesExist: Record<string, boolean>;

  // Environment variables (from custom_env.ini)
  envValues: Record<string, string>;
  envLoaded: boolean;

  // File contents (loaded from /data, edited locally, saved back)
  fileContents: Record<string, string>;

  // Custom env entries (parsed from custom_env.ini for visual editing)
  customEnvEntries: CustomEnvEntry[];
  // Custom mod zones/swaps/hosts (parsed from custom_mod.yaml)
  customModZones: CustomModZone[];
  customModSwaps: CustomModSwap[];
  customModHosts: CustomModHost[];

  // Actions
  setConnected: (v: boolean) => void;
  setFilesExist: (files: Record<string, boolean>) => void;
  setEnvValues: (env: Record<string, string>) => void;
  setEnvLoaded: (v: boolean) => void;
  setEnvValue: (key: string, value: string) => void;
  getFileContent: (filename: string) => string;
  setFileContent: (filename: string, content: string) => void;
  setCustomEnvEntries: (entries: CustomEnvEntry[]) => void;
  addCustomEnv: (entry: CustomEnvEntry) => void;
  removeCustomEnv: (index: number) => void;
  updateCustomEnv: (index: number, entry: CustomEnvEntry) => void;
  setCustomModZones: (zones: CustomModZone[]) => void;
  setCustomModSwaps: (swaps: CustomModSwap[]) => void;
  setCustomModHosts: (hosts: CustomModHost[]) => void;
  addCustomModZone: (zone: CustomModZone) => void;
  removeCustomModZone: (index: number) => void;
  updateCustomModZone: (index: number, zone: CustomModZone) => void;
  addCustomModSwap: (swap: CustomModSwap) => void;
  removeCustomModSwap: (index: number) => void;
  updateCustomModSwap: (index: number, swap: CustomModSwap) => void;
  addCustomModHost: (host: CustomModHost) => void;
  removeCustomModHost: (index: number) => void;
  updateCustomModHost: (index: number, host: CustomModHost) => void;
  resetAll: () => void;
}

const defaultEnvValues: Record<string, string> = {};
ENV_VARS.forEach((v) => {
  defaultEnvValues[v.key] = v.defaultValue;
});

export const useStore = create<PaoPaoState>()(
  persist(
    (set, get) => ({
      connected: false,
      filesExist: {},

      envValues: { ...defaultEnvValues },
      envLoaded: false,

      fileContents: {},

      customEnvEntries: [],
      customModZones: [],
      customModSwaps: [],
      customModHosts: [],

      setConnected: (v: boolean) => set({ connected: v }),
      setFilesExist: (files: Record<string, boolean>) => set({ filesExist: files }),
      setEnvValues: (env: Record<string, string>) =>
        set({ envValues: { ...defaultEnvValues, ...env }, envLoaded: true }),
      setEnvLoaded: (v: boolean) => set({ envLoaded: v }),
      setEnvValue: (key: string, value: string) =>
        set((state: PaoPaoState) => ({ envValues: { ...state.envValues, [key]: value } })),

      getFileContent: (filename: string) => get().fileContents[filename] || '',
      setFileContent: (filename: string, content: string) =>
        set((state: PaoPaoState) => ({ fileContents: { ...state.fileContents, [filename]: content } })),

      setCustomEnvEntries: (entries: CustomEnvEntry[]) => set({ customEnvEntries: entries }),
      addCustomEnv: (entry: CustomEnvEntry) =>
        set((state: PaoPaoState) => ({ customEnvEntries: [...state.customEnvEntries, entry] })),
      removeCustomEnv: (index: number) =>
        set((state: PaoPaoState) => ({
          customEnvEntries: state.customEnvEntries.filter((_: CustomEnvEntry, i: number) => i !== index),
        })),
      updateCustomEnv: (index: number, entry: CustomEnvEntry) =>
        set((state: PaoPaoState) => ({
          customEnvEntries: state.customEnvEntries.map((e: CustomEnvEntry, i: number) =>
            i === index ? entry : e
          ),
        })),

      setCustomModZones: (zones: CustomModZone[]) => set({ customModZones: zones }),
      setCustomModSwaps: (swaps: CustomModSwap[]) => set({ customModSwaps: swaps }),
      setCustomModHosts: (hosts: CustomModHost[]) => set({ customModHosts: hosts }),
      addCustomModZone: (zone: CustomModZone) =>
        set((state: PaoPaoState) => ({ customModZones: [...state.customModZones, zone] })),
      removeCustomModZone: (index: number) =>
        set((state: PaoPaoState) => ({
          customModZones: state.customModZones.filter((_: CustomModZone, i: number) => i !== index),
        })),
      updateCustomModZone: (index: number, zone: CustomModZone) =>
        set((state: PaoPaoState) => ({
          customModZones: state.customModZones.map((z: CustomModZone, i: number) =>
            i === index ? zone : z
          ),
        })),

      addCustomModSwap: (swap: CustomModSwap) =>
        set((state: PaoPaoState) => ({ customModSwaps: [...state.customModSwaps, swap] })),
      removeCustomModSwap: (index: number) =>
        set((state: PaoPaoState) => ({
          customModSwaps: state.customModSwaps.filter((_: CustomModSwap, i: number) => i !== index),
        })),
      updateCustomModSwap: (index: number, swap: CustomModSwap) =>
        set((state: PaoPaoState) => ({
          customModSwaps: state.customModSwaps.map((s: CustomModSwap, i: number) =>
            i === index ? swap : s
          ),
        })),

      addCustomModHost: (host: CustomModHost) =>
        set((state: PaoPaoState) => ({ customModHosts: [...state.customModHosts, host] })),
      removeCustomModHost: (index: number) =>
        set((state: PaoPaoState) => ({
          customModHosts: state.customModHosts.filter((_: CustomModHost, i: number) => i !== index),
        })),
      updateCustomModHost: (index: number, host: CustomModHost) =>
        set((state: PaoPaoState) => ({
          customModHosts: state.customModHosts.map((h: CustomModHost, i: number) =>
            i === index ? host : h
          ),
        })),

      resetAll: () => set({
        envValues: { ...defaultEnvValues },
        fileContents: {},
        customEnvEntries: [],
        customModZones: [],
        customModSwaps: [],
        customModHosts: [],
      }),
    }),
    {
      name: 'paopaodns-storage',
      partialize: (state) => ({
        fileContents: state.fileContents,
        customEnvEntries: state.customEnvEntries,
        customModZones: state.customModZones,
        customModSwaps: state.customModSwaps,
        customModHosts: state.customModHosts,
      }),
    }
  )
);
