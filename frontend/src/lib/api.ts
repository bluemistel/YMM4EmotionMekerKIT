let resolvedApiBase: string | null = null;

async function initApiBase(): Promise<string> {
  if (resolvedApiBase) return resolvedApiBase;

  if (typeof window !== "undefined") {
    const w = window as unknown as Record<string, unknown>;
    if (w.__API_PORT__) {
      resolvedApiBase = `http://localhost:${w.__API_PORT__}`;
      return resolvedApiBase;
    }
    const electronAPI = w.electronAPI as { getApiPort?: () => Promise<number> } | undefined;
    if (electronAPI?.getApiPort) {
      try {
        const port = await electronAPI.getApiPort();
        resolvedApiBase = `http://localhost:${port}`;
        return resolvedApiBase;
      } catch {
        // fall through
      }
    }
  }
  resolvedApiBase = "http://localhost:8000";
  return resolvedApiBase;
}

function getApiBase(): string {
  return resolvedApiBase || "http://localhost:8000";
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${getApiBase()}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail || res.statusText);
  }
  return res.json();
}

export interface ProjectInfo {
  path: string;
  characters: { name: string; tachie_directory: string | null; voice_layer: number | null; color: string | null }[];
  voice_count: number;
  video_info: Record<string, number>;
  timeline_count: number;
}

export interface VoiceInfo {
  index: number;
  character_name: string;
  serif: string;
  frame: number;
  length: number;
  layer: number;
}

export interface PresetInfo {
  preset_names: string[];
  presets: Record<string, { parts: Record<string, string> }>;
}

export interface PresetPreviewInfo {
  preset_name: string;
  parts: Record<string, string | null>;
  render_order: string[];
}

export interface EmotionScores {
  joy: number;
  anger: number;
  sadness: number;
  happiness: number;
  surprise: number;
  embarrassment: number;
}

export interface GradientInfo {
  values: Record<string, number>;
  type: "sudden" | "gradual" | null;
}

export interface DecayInfo {
  residual: Record<string, number>;
}

export interface ResolutionInfo {
  slot_key: string;
  preset_name: string;
  source: "override" | "gradient" | "mapping";
}

export interface AnalysisItem {
  character_name: string;
  serif: string;
  frame: number;
  length: number;
  emotion: EmotionScores;
  dominant: string | null;
  group_id?: number | null;
  raw_emotion?: EmotionScores | null;
  gradient?: GradientInfo | null;
  decay?: DecayInfo | null;
  resolution?: ResolutionInfo | null;
}

export interface DialogueGroupInfo {
  group_id: number;
  voice_indices: number[];
  start_frame: number;
  end_frame: number;
  voice_count: number;
  auto_detected: boolean;
}

export interface OverrideInfo {
  preset_name: string | null;
  part_overrides: Record<string, string> | null;
  locked: boolean;
  hold_previous?: boolean;
}

export interface PlacementItem {
  character_name: string;
  frame: number;
  length: number;
  layer: number;
  preset_name: string;
  source_serifs: string[];
}

export const api = {
  init() {
    return initApiBase();
  },

  loadProject(path: string, timelineIndex = 0) {
    return request<ProjectInfo>("/api/project/load", {
      method: "POST",
      body: JSON.stringify({ path, timeline_index: timelineIndex }),
    });
  },

  getVoices(timelineIndex = 0) {
    return request<{ voices: VoiceInfo[] }>(`/api/project/voices?timeline_index=${timelineIndex}`);
  },

  loadPreset(characterName: string, presetIniPath: string, tachieDir?: string) {
    return request<{ character_name: string; preset_count: number; preset_names: string[]; available_files: Record<string, string[]> }>(
      "/api/preset/load",
      {
        method: "POST",
        body: JSON.stringify({
          character_name: characterName,
          preset_ini_path: presetIniPath,
          tachie_dir: tachieDir,
        }),
      }
    );
  },

  getPresets(characterName: string) {
    return request<PresetInfo>(`/api/preset/${encodeURIComponent(characterName)}`);
  },

  getPresetPreview(characterName: string, presetName: string, withDefaults = false) {
    const qs = withDefaults ? "?with_defaults=true" : "";
    return request<PresetPreviewInfo>(
      `/api/preset/${encodeURIComponent(characterName)}/${encodeURIComponent(presetName)}/preview${qs}`
    );
  },

  /** Compose a preview server-side: YMM4 default tachie + base preset +
   *  preset + per-part overrides, returning the final merged parts. */
  getPresetPreviewMerged(
    characterName: string,
    body: {
      preset_name: string;
      base_preset_name?: string | null;
      with_defaults?: boolean;
      part_overrides?: Record<string, string>;
    }
  ) {
    return request<PresetPreviewInfo>(
      `/api/preset/${encodeURIComponent(characterName)}/preview`,
      {
        method: "POST",
        body: JSON.stringify({ with_defaults: true, ...body }),
      }
    );
  },

  presetImageUrl(path: string) {
    return `${getApiBase()}/api/preset/image?path=${encodeURIComponent(path)}`;
  },

  generateTemplate() {
    return request<{ settings: Record<string, unknown>; characters: Record<string, unknown> }>(
      "/api/config/generate-template",
      { method: "POST" }
    );
  },

  updateCharacterConfig(characterName: string, config: Record<string, unknown>) {
    return request<{ status: string }>(
      "/api/config/update-character",
      {
        method: "POST",
        body: JSON.stringify({ character_name: characterName, config }),
      }
    );
  },

  async updateSettings(settings: Record<string, unknown>) {
    const res = await request<{ status: string }>(
      "/api/config/update-settings",
      {
        method: "POST",
        body: JSON.stringify({ settings }),
      }
    );
    // Notify open previews so they refetch the server-side composite (e.g. the
    // YMM4 default 立ち絵 after the exe path changes) without a full reload.
    if (typeof window !== "undefined") {
      window.dispatchEvent(new Event("ymm4-settings-changed"));
    }
    return res;
  },

  analyze(timelineIndex = 0, model?: string) {
    return request<{ count: number; results: Record<string, AnalysisItem> }>(
      "/api/analyze",
      {
        method: "POST",
        body: JSON.stringify({ timeline_index: timelineIndex, model }),
      }
    );
  },

  getAnalysisResult() {
    return request<{ results: Record<string, AnalysisItem> }>("/api/analyze/result");
  },

  previewExecution(timelineIndex = 0) {
    return request<{ placements: PlacementItem[] }>(
      `/api/execute/preview?timeline_index=${timelineIndex}`
    );
  },

  execute(timelineIndex = 0, outputPath?: string, backup = true) {
    return request<{ status: string; output_path: string; face_items_count: number }>(
      "/api/execute",
      {
        method: "POST",
        body: JSON.stringify({
          timeline_index: timelineIndex,
          output_path: outputPath,
          backup,
        }),
      }
    );
  },

  detectGroups(timelineIndex = 0, gapThreshold = 1) {
    return request<{ count: number; groups: DialogueGroupInfo[] }>(
      "/api/groups/detect",
      {
        method: "POST",
        body: JSON.stringify({ timeline_index: timelineIndex, gap_threshold: gapThreshold }),
      }
    );
  },

  getGroups() {
    return request<{ count: number; groups: DialogueGroupInfo[] }>("/api/groups");
  },

  mergeGroups(groupIds: number[]) {
    return request<{ count: number }>(
      "/api/groups/merge",
      {
        method: "POST",
        body: JSON.stringify({ group_ids: groupIds }),
      }
    );
  },

  splitGroup(groupId: number, splitAtVoiceIndex: number) {
    return request<{ count: number }>(
      "/api/groups/split",
      {
        method: "POST",
        body: JSON.stringify({ group_id: groupId, split_at_voice_index: splitAtVoiceIndex }),
      }
    );
  },

  setOverride(voiceIndex: number, override: { preset_name?: string; part_overrides?: Record<string, string>; locked?: boolean; hold_previous?: boolean }) {
    return request<{ status: string }>(
      `/api/override/${voiceIndex}`,
      {
        method: "POST",
        body: JSON.stringify(override),
      }
    );
  },

  deleteOverride(voiceIndex: number) {
    return request<{ status: string }>(
      `/api/override/${voiceIndex}`,
      { method: "DELETE" }
    );
  },

  getOverrides() {
    return request<{ overrides: Record<string, OverrideInfo> }>("/api/overrides");
  },

  autoLoadConfig() {
    return request<{ settings: Record<string, unknown>; characters: Record<string, unknown> }>(
      "/api/config/auto-load"
    );
  },

  shutdownServer() {
    return request<{ status: string }>(
      "/api/server/shutdown",
      { method: "POST" }
    );
  },

  saveWorkstate(path: string) {
    return request<{ status: string; path: string }>(
      "/api/workstate/save",
      { method: "POST", body: JSON.stringify({ path }) }
    );
  },

  loadWorkstate(path: string, timelineIndex = 0) {
    return request<ProjectInfo & { has_analysis?: boolean }>(
      "/api/workstate/load",
      { method: "POST", body: JSON.stringify({ path, timeline_index: timelineIndex }) }
    );
  },
};

interface ElectronAPI {
  isElectron?: boolean;
  getApiPort?: () => Promise<number>;
  openYmmpDialog?: () => Promise<string | null>;
  saveYmmpDialog?: (defaultPath?: string) => Promise<string | null>;
  saveWorkstateDialog?: (defaultPath?: string) => Promise<string | null>;
  openWorkstateDialog?: () => Promise<string | null>;
  openExeDialog?: () => Promise<string | null>;
  openExternal?: (url: string) => Promise<boolean>;
  getAppVersion?: () => Promise<string>;
  getPathForFile?: (file: File) => string;
}

/** App version shown in the settings panel when running in a plain browser
 *  (Electron reports the real packaged version via getAppVersion). */
export const APP_VERSION_FALLBACK = "1.0.1";

function getElectronAPI(): ElectronAPI | undefined {
  if (typeof window === "undefined") return undefined;
  return (window as unknown as Record<string, unknown>).electronAPI as
    | ElectronAPI
    | undefined;
}

export function isElectron(): boolean {
  return !!getElectronAPI()?.isElectron;
}

/** Open the native file dialog (Electron only). Returns the chosen .ymmp
 *  path, or null if cancelled / unavailable. */
export async function pickYmmpPath(): Promise<string | null> {
  const e = getElectronAPI();
  if (!e?.openYmmpDialog) return null;
  try {
    return await e.openYmmpDialog();
  } catch {
    return null;
  }
}

/** Open the native "save as" dialog for the .ymmp output (Electron only).
 *  Returns the chosen path (always ending in .ymmp), or null. */
export async function pickSavePath(defaultPath?: string): Promise<string | null> {
  const e = getElectronAPI();
  if (!e?.saveYmmpDialog) return null;
  try {
    return await e.saveYmmpDialog(defaultPath);
  } catch {
    return null;
  }
}

/** Open the native "save as" dialog for a work-state (.ymmemo) file. */
export async function pickWorkstateSavePath(defaultPath?: string): Promise<string | null> {
  const e = getElectronAPI();
  if (!e?.saveWorkstateDialog) return null;
  try {
    return await e.saveWorkstateDialog(defaultPath);
  } catch {
    return null;
  }
}

/** Open the native picker for an existing work-state (.ymmemo) file. */
export async function pickWorkstateOpenPath(): Promise<string | null> {
  const e = getElectronAPI();
  if (!e?.openWorkstateDialog) return null;
  try {
    return await e.openWorkstateDialog();
  } catch {
    return null;
  }
}

/** Open the native exe-file picker (Electron only). Returns the chosen
 *  path, or null if cancelled / unavailable. */
export async function pickExePath(): Promise<string | null> {
  const e = getElectronAPI();
  if (!e?.openExeDialog) return null;
  try {
    return await e.openExeDialog();
  } catch {
    return null;
  }
}

/** Open a URL in the user's default browser. Uses the Electron shell when
 *  available, otherwise falls back to window.open in dev. */
export async function openExternalUrl(url: string): Promise<void> {
  const e = getElectronAPI();
  if (e?.openExternal) {
    try {
      await e.openExternal(url);
      return;
    } catch {
      // fall through to browser
    }
  }
  if (typeof window !== "undefined") {
    window.open(url, "_blank", "noopener,noreferrer");
  }
}

/** Return the application version. Electron reports the packaged version;
 *  a plain browser uses a constant fallback. */
export async function getAppVersion(): Promise<string> {
  const e = getElectronAPI();
  if (e?.getAppVersion) {
    try {
      return await e.getAppVersion();
    } catch {
      // fall through
    }
  }
  return APP_VERSION_FALLBACK;
}

/** Resolve the absolute path of a dropped File. Electron 32+ removed
 *  File.path, so webUtils.getPathForFile (exposed via preload) is required.
 *  Returns "" in a plain browser (dev) where the path is unavailable. */
export function resolveDroppedPath(file: File): string {
  const e = getElectronAPI();
  if (e?.getPathForFile) {
    try {
      return e.getPathForFile(file) || "";
    } catch {
      return "";
    }
  }
  const legacy = (file as unknown as { path?: string }).path;
  return legacy || "";
}
