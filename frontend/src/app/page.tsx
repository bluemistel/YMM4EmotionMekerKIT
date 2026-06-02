"use client";

import { useState, useEffect } from "react";
import { api, AnalysisItem, PlacementItem, ProjectInfo, pickWorkstateSavePath, pickWorkstateOpenPath } from "@/lib/api";
import HeaderBar from "@/components/HeaderBar";
import ProjectLoader, { FlowPhase } from "@/components/ProjectLoader";
import CharacterList from "@/components/CharacterList";
import MappingPanel from "@/components/MappingPanel";
import DialogueList from "@/components/DialogueList";
import TimelinePreview from "@/components/TimelinePreview";
import ExecuteModal from "@/components/ExecuteModal";
import PreviewPartsPanel from "@/components/PreviewPartsPanel";
import AnalysisOptimizerModal, { OptimizerInitial } from "@/components/AnalysisOptimizerModal";
import { OverrideEditorProvider } from "@/components/OverrideEditorContext";
import type { PostProcessConfig } from "@/components/PostProcessSettings";

interface CharacterConfig {
  preset_ini: string;
  tachie_dir: string;
  layer_offset: number;
  emotion_presets: Record<string, string>;
  emotion_intensity_presets: Record<string, Record<string, string>>;
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
  const [disabledEmotions, setDisabledEmotions] = useState<string[]>([]);
  const [showOptimizer, setShowOptimizer] = useState(true);
  const [optimizerOpen, setOptimizerOpen] = useState(false);
  const [optimizerInitial, setOptimizerInitial] = useState<OptimizerInitial>({ kakeai: true, readerWeight: 0.2, postprocess: false, contextGapSeconds: 0.4 });

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

  // 設定モーダル等で設定が変わったら再取得（検出ラベルの有効/無効などを反映）。
  useEffect(() => {
    function onChange() {
      api
        .autoLoadConfig()
        .then((cfg) => {
          if (cfg.settings) handleSettingsLoaded(cfg.settings as Record<string, unknown>);
        })
        .catch(() => {});
    }
    window.addEventListener("ymm4-settings-changed", onChange);
    return () => window.removeEventListener("ymm4-settings-changed", onChange);
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
    if (Array.isArray(settings.disabled_emotions)) {
      setDisabledEmotions(settings.disabled_emotions as string[]);
    }
    setShowOptimizer(settings.show_optimizer_on_load !== false);
    const turns = typeof settings.context_turns === "number" ? (settings.context_turns as number) : 2;
    const speaker = settings.context_speaker_labels !== false;
    setOptimizerInitial({
      kakeai: turns >= 1 && speaker,
      readerWeight: typeof settings.reader_weight === "number" ? (settings.reader_weight as number) : 0.2,
      postprocess: (settings.postprocess_enabled as boolean) ?? false,
      contextGapSeconds: typeof settings.context_gap_seconds === "number" ? (settings.context_gap_seconds as number) : 0.4,
    });
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
        emotion_intensity_presets: (c.emotion_intensity_presets as Record<string, Record<string, string>>) || {},
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

  // 分析本体（読込・検出後に実行）。ウィザードの開始/スキップからも呼ぶ。
  async function runAnalysis() {
    setFlowPhase("analyzing");
    setFlowMessage("感情分析を実行しています…（初回はモデルのダウンロードで数分かかる場合があります）");
    try {
      const res = await api.analyze();
      setAnalysisResults(res.results);
      if (res.disabled_emotions) setDisabledEmotions(res.disabled_emotions);
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

      // 自動最適化ウィザードを挟む（無効なら即分析）。
      if (showOptimizer) {
        setFlowMessage("");
        setOptimizerOpen(true);
      } else {
        await runAnalysis();
      }
    } catch (e) {
      setFlowPhase("error");
      setFlowMessage(e instanceof Error ? e.message : String(e));
    }
  }

  async function handleOptimizerStart(patch: Record<string, unknown>) {
    setOptimizerOpen(false);
    try {
      await api.updateSettings(patch);
    } catch {
      // non-fatal
    }
    await runAnalysis();
  }

  function handleOptimizerSkip() {
    setOptimizerOpen(false);
    void runAnalysis();
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
        if (r.disabled_emotions) setDisabledEmotions(r.disabled_emotions);
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
      if (r.disabled_emotions) setDisabledEmotions(r.disabled_emotions);
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
      if (res.disabled_emotions) setDisabledEmotions(res.disabled_emotions);
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
          <OverrideEditorProvider
            voiceIndex={selectedVoiceIndex}
            analysisItem={selectedAnalysisItem}
            characterName={activeCharacter || ""}
            presetNames={activeConfig?.preset_names || []}
            availableFiles={activeConfig?.available_files || {}}
            basePresetName={activeConfig?.emotion_presets?.default}
            onOverrideChange={refreshResolution}
          >
            <div className="h-full grid grid-cols-12 gap-4 px-6 py-5 max-w-[1880px] mx-auto">
              {/* カラム1: 固定プレビュー + パーツ個別変更 */}
              <div className="col-span-3 overflow-y-auto pr-1 flex flex-col gap-4">
                <PreviewPartsPanel />
              </div>

              {/* カラム2: キャラクター設定 + 個別設定 */}
              <div className="col-span-3 overflow-y-auto pr-1 flex flex-col gap-4">
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
                    onSaved={refreshResolution}
                    postprocessEnabled={postProcessSettings.postprocess_enabled}
                    disabledEmotions={disabledEmotions}
                  />
                )}
              </div>

              {/* カラム3: 感情分析結果 + タイムライン */}
              <div className="col-span-6 overflow-y-auto pr-1 flex flex-col gap-4">
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
              </div>
            </div>

            <ExecuteModal
              projectPath={project.path}
              hasAnalysis={analysisResults !== null && Object.keys(analysisResults).length > 0}
            />

            <AnalysisOptimizerModal
              open={optimizerOpen}
              initial={optimizerInitial}
              onStart={handleOptimizerStart}
              onSkip={handleOptimizerSkip}
            />
          </OverrideEditorProvider>
        )}
      </main>
    </div>
  );
}
