"use client";

import { useState, useEffect } from "react";
import { api, AnalysisItem, PlacementItem, ProjectInfo, pickWorkstateSavePath, pickWorkstateOpenPath } from "@/lib/api";
import HeaderBar from "@/components/HeaderBar";
import ProjectLoader, { FlowPhase } from "@/components/ProjectLoader";
import CharacterList from "@/components/CharacterList";
import MappingPanel from "@/components/MappingPanel";
import DialogueList from "@/components/DialogueList";
import TimelinePreview from "@/components/TimelinePreview";
import ExecutePanel from "@/components/ExecutePanel";
import PostProcessSettings, { PostProcessConfig } from "@/components/PostProcessSettings";

interface CharacterConfig {
  preset_ini: string;
  tachie_dir: string;
  layer_offset: number;
  emotion_presets: Record<string, string>;
  compound_presets_2: Record<string, string>;
  compound_presets_3: Record<string, string>;
  compound_max_score: number;
  emotion_parts: Record<string, Record<string, string>>;
  gradient_presets: Record<string, string>;
  preset_names?: string[];
  available_files?: Record<string, string[]>;
}

export default function Home() {
  const [project, setProject] = useState<ProjectInfo | null>(null);
  const [configs, setConfigs] = useState<Record<string, CharacterConfig>>({});
  const [selectedCharacter, setSelectedCharacter] = useState<string | null>(null);
  const [analysisResults, setAnalysisResults] = useState<Record<string, AnalysisItem> | null>(null);
  const [placements, setPlacements] = useState<PlacementItem[] | null>(null);
  const [selectedVoiceIndex, setSelectedVoiceIndex] = useState<number | null>(null);
  const [mappingTab, setMappingTab] = useState<"mapping" | "override">("mapping");
  const [flowPhase, setFlowPhase] = useState<FlowPhase>("idle");
  const [flowMessage, setFlowMessage] = useState("");
  const [postProcessSettings, setPostProcessSettings] = useState<PostProcessConfig>({
    postprocess_enabled: false,
    decay_rate: 0.0,
    gradient_sudden_threshold: 0.4,
    gradient_gradual_window: 3,
    gradient_gradual_max_delta: 0.15,
  });
  const [ymm4ExePath, setYmm4ExePath] = useState("");

  useEffect(() => {
    api.init();
    // Load any saved YMM4 exe path so the settings panel / preview defaults
    // are populated even before a project is loaded.
    api
      .autoLoadConfig()
      .then((cfg) => {
        // Restore app-wide settings (感情後処理の有効/無効 等) so they persist
        // across reloads instead of resetting to defaults.
        if (cfg.settings) handleSettingsLoaded(cfg.settings as Record<string, unknown>);
      })
      .catch(() => {
        // no saved config yet — fine
      });
  }, []);

  const fps = project?.video_info?.FPS || 30;

  function handleSettingsLoaded(settings: Record<string, unknown>) {
    setPostProcessSettings({
      postprocess_enabled: (settings.postprocess_enabled as boolean) ?? false,
      decay_rate: (settings.decay_rate as number) ?? 0.0,
      gradient_sudden_threshold: (settings.gradient_sudden_threshold as number) ?? 0.4,
      gradient_gradual_window: (settings.gradient_gradual_window as number) ?? 3,
      gradient_gradual_max_delta: (settings.gradient_gradual_max_delta as number) ?? 0.15,
    });
    if (typeof settings.ymm4_exe_path === "string") {
      setYmm4ExePath(settings.ymm4_exe_path as string);
    }
  }

  function handleConfigChange(name: string, config: CharacterConfig) {
    setConfigs((prev) => ({ ...prev, [name]: config }));
  }

  async function detectCharacters(applySettings = true) {
    const template = await api.generateTemplate();
    const newConfigs: Record<string, CharacterConfig> = {};
    for (const [name, raw] of Object.entries(template.characters)) {
      const c = raw as Record<string, unknown>;
      const presetIni = c.preset_ini as string;
      const tachieDir = c.tachie_dir as string;
      let presetNames: string[] = [];
      let availableFiles: Record<string, string[]> = {};
      if (presetIni) {
        try {
          const res = await api.loadPreset(name, presetIni, tachieDir);
          presetNames = res.preset_names;
          availableFiles = res.available_files || {};
        } catch {
          // preset.ini not found — tolerate
        }
      }
      newConfigs[name] = {
        preset_ini: presetIni || "",
        tachie_dir: tachieDir || "",
        layer_offset: (c.layer_offset as number) ?? 1,
        emotion_presets: (c.emotion_presets as Record<string, string>) || {},
        compound_presets_2: (c.compound_presets_2 as Record<string, string>) || {},
        compound_presets_3: (c.compound_presets_3 as Record<string, string>) || {},
        compound_max_score: (c.compound_max_score as number) ?? 0.65,
        emotion_parts: (c.emotion_parts as Record<string, Record<string, string>>) || {},
        gradient_presets: (c.gradient_presets as Record<string, string>) || {},
        preset_names: presetNames,
        available_files: availableFiles,
      };
    }
    setConfigs(newConfigs);
    if (applySettings && template.settings) handleSettingsLoaded(template.settings);
  }

  async function runFullPipeline(path: string) {
    setFlowPhase("loading");
    setFlowMessage("プロジェクトを読み込んでいます…");
    try {
      const info = await api.loadProject(path);
      setProject(info);
      setSelectedCharacter(null);
      setAnalysisResults(null);
      setPlacements(null);
      setSelectedVoiceIndex(null);
      setMappingTab("mapping");

      setFlowPhase("detecting");
      setFlowMessage("キャラクター・プリセットを検出しています…");
      await detectCharacters();
      await api.detectGroups(0, 1).catch(() => {});

      setFlowPhase("analyzing");
      setFlowMessage("感情分析を実行しています…（初回はモデルのダウンロードで数分かかる場合があります）");
      const res = await api.analyze();
      setAnalysisResults(res.results);

      try {
        const preview = await api.previewExecution();
        setPlacements(preview.placements);
      } catch {
        // preview may fail if some characters are unconfigured
      }

      setFlowPhase("done");
      setFlowMessage("");
    } catch (e) {
      setFlowPhase("error");
      setFlowMessage(e instanceof Error ? e.message : String(e));
    }
  }

  // --- 作業状態 (work-state) 保存 / 復元 ---
  async function saveWorkstate(): Promise<string | null> {
    if (!project) return null;
    const def = project.path.replace(/\.ymmp$/i, "") + ".ymmemo";
    const target = await pickWorkstateSavePath(def);
    if (!target) return null;
    const res = await api.saveWorkstate(target);
    return res.path;
  }

  async function restoreWorkstate(path: string) {
    setFlowPhase("loading");
    setFlowMessage("作業状態を読み込んでいます…");
    try {
      const info = await api.loadWorkstate(path);
      setProject(info);
      setSelectedCharacter(null);
      setSelectedVoiceIndex(null);
      setMappingTab("mapping");

      setFlowPhase("detecting");
      setFlowMessage("キャラクター・プリセットを復元しています…");
      // Rebuilds configs from the restored config (persisted to config.yaml by
      // the backend) and re-applies app-wide settings.
      await detectCharacters(true);

      // Restore the previously-computed analysis without re-running the model.
      try {
        const r = await api.getAnalysisResult();
        setAnalysisResults(r.results);
      } catch {
        setAnalysisResults(null);
      }
      try {
        const preview = await api.previewExecution();
        setPlacements(preview.placements);
      } catch {
        // ignore
      }

      setFlowPhase("done");
      setFlowMessage("");
    } catch (e) {
      setFlowPhase("error");
      setFlowMessage(e instanceof Error ? e.message : String(e));
    }
  }

  async function handleLoadWorkstate() {
    const path = await pickWorkstateOpenPath();
    if (path) await restoreWorkstate(path);
  }

  function handleReload() {
    setProject(null);
    setConfigs({});
    setSelectedCharacter(null);
    setAnalysisResults(null);
    setPlacements(null);
    setSelectedVoiceIndex(null);
    setMappingTab("mapping");
    setFlowPhase("idle");
    setFlowMessage("");
  }

  // Re-fetch resolution + placements without re-running BERT. The backend
  // recomputes `resolution` from the current config/overrides, so mapping
  // edits and per-line overrides reflect immediately.
  async function refreshResolution() {
    try {
      const preview = await api.previewExecution();
      setPlacements(preview.placements);
    } catch {
      // ignore
    }
    try {
      const r = await api.getAnalysisResult();
      setAnalysisResults(r.results);
    } catch {
      // ignore
    }
  }

  async function handleReanalyze() {
    setFlowPhase("analyzing");
    setFlowMessage("再分析しています…");
    try {
      await api.detectGroups(0, 1).catch(() => {});
      const res = await api.analyze();
      setAnalysisResults(res.results);
      try {
        const preview = await api.previewExecution();
        setPlacements(preview.placements);
      } catch {
        // ignore
      }
      setFlowPhase("done");
      setFlowMessage("");
    } catch (e) {
      setFlowPhase("error");
      setFlowMessage(e instanceof Error ? e.message : String(e));
    }
  }

  const totalFrames = project?.video_info?.Length || 0;

  const characterColors: Record<string, string> = {};
  if (project) {
    for (const c of project.characters) {
      if (c.color) characterColors[c.name] = c.color;
    }
  }

  const selectedAnalysisItem =
    selectedVoiceIndex !== null && analysisResults
      ? analysisResults[String(selectedVoiceIndex)]
      : null;

  const autoHighlightedCharacter = selectedAnalysisItem?.character_name || null;
  const resolvedSlot = selectedAnalysisItem?.resolution ?? null;
  const playheadFrame = selectedAnalysisItem?.frame ?? null;

  // Clicking a line auto-focuses its character (selectedCharacter is set in
  // onSelectVoice), so selectedCharacter is the primary source; fall back to
  // the selected line's character.
  const activeCharacter = selectedCharacter || autoHighlightedCharacter;
  const activeConfig = activeCharacter ? configs[activeCharacter] : null;

  return (
    <div className="flex flex-col" style={{ height: "100vh" }}>
      <HeaderBar
        project={project}
        onReload={project ? handleReload : undefined}
        onSaveWorkstate={project ? saveWorkstate : undefined}
        exePath={ymm4ExePath}
        onExePathChange={setYmm4ExePath}
      />

      <main className="flex-1 min-h-0">
        {!project ? (
          <div className="h-full overflow-y-auto px-6 py-5 max-w-[1440px] mx-auto">
            <ProjectLoader
              onRunPipeline={runFullPipeline}
              phase={flowPhase}
              message={flowMessage}
              exePath={ymm4ExePath}
              onExePathChange={setYmm4ExePath}
              onLoadWorkstate={handleLoadWorkstate}
            />
          </div>
        ) : (
          <div className="h-full grid grid-cols-12 gap-4 px-6 py-5 max-w-[1440px] mx-auto">
            <div className="col-span-5 overflow-y-auto pr-1 flex flex-col gap-4">
              <CharacterList
                project={project}
                configs={configs}
                onConfigsChange={setConfigs}
                onSelectCharacter={setSelectedCharacter}
                selectedCharacter={selectedCharacter}
                autoHighlightedCharacter={autoHighlightedCharacter}
                onSettingsLoaded={handleSettingsLoaded}
                onRedetect={() => detectCharacters(false)}
              />

              {activeCharacter && activeConfig && (
                <MappingPanel
                  characterName={activeCharacter}
                  config={activeConfig}
                  onConfigChange={(c) => handleConfigChange(activeCharacter, c)}
                  tab={mappingTab}
                  onTabChange={setMappingTab}
                  resolvedSlot={resolvedSlot}
                  selectedVoiceIndex={selectedVoiceIndex}
                  analysisItem={selectedAnalysisItem}
                  onOverrideChange={refreshResolution}
                  onSaved={refreshResolution}
                  postprocessEnabled={postProcessSettings.postprocess_enabled}
                />
              )}
            </div>

            <div className="col-span-7 overflow-y-auto pr-1 flex flex-col gap-4">
              <DialogueList
                analysisResults={analysisResults}
                fps={fps}
                onSelectVoice={(idx) => {
                  setSelectedVoiceIndex(idx);
                  setMappingTab("mapping");
                  const ch = analysisResults?.[String(idx)]?.character_name;
                  if (ch) setSelectedCharacter(ch);
                }}
                onReanalyze={handleReanalyze}
                analyzing={flowPhase === "analyzing"}
                selectedVoiceIndex={selectedVoiceIndex}
              />

              <TimelinePreview
                placements={placements}
                totalFrames={totalFrames}
                characterColors={characterColors}
                playheadFrame={playheadFrame}
              />

              <div className="grid grid-cols-2 gap-4 items-start">
                <PostProcessSettings
                  settings={postProcessSettings}
                  onSettingsChange={setPostProcessSettings}
                />
                <ExecutePanel
                  projectPath={project.path}
                  hasAnalysis={analysisResults !== null && Object.keys(analysisResults).length > 0}
                />
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
