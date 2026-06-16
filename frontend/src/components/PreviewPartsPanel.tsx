"use client";
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import PresetPreview from "./PresetPreview";
import PsdLayerPanel from "./PsdLayerPanel";
import SavePresetForm from "./SavePresetForm";
import { useOverrideEditor, PART_FIELDS, NONE_PART } from "./OverrideEditorContext";

function basename(p: string | null | undefined): string {
  if (!p) return "";
  return p.split("\\").pop()!.split("/").pop() || "";
}

/** 全角約 maxW 文字を超えたら末尾を「…」で省略（CJK=1, 半角=0.5 で加算）。 */
function truncName(name: string, maxW = 11): string {
  let w = 0;
  let out = "";
  for (const ch of name) {
    w += ch.charCodeAt(0) > 0x2e80 ? 1 : 0.5;
    if (w > maxW) return out + "…";
    out += ch;
  }
  return out;
}

/** カラム1: 固定プレビュー（大）+ パーツ個別変更（プリセット標準値を反映）。 */
export default function PreviewPartsPanel() {
  const {
    voiceIndex,
    characterName,
    availableFiles,
    basePresetName,
    partOverrides,
    psdLayerOverrides,
    holdPrevious,
    effectivePreset,
    tachieType,
    setPart,
    onPresetsChanged,
  } = useOverrideEditor();
  const isPsd = tachieType === "psd";

  // プリセット標準（ユーザー上書き抜き）の解決パーツを取得して select の標準値に使う。
  const [baseParts, setBaseParts] = useState<Record<string, string | null>>({});
  useEffect(() => {
    let cancelled = false;
    setBaseParts({});
    if (isPsd || !characterName || !effectivePreset) return;
    api
      .getPresetPreviewMerged(characterName, {
        preset_name: effectivePreset,
        base_preset_name: basePresetName ?? null,
        with_defaults: true,
      })
      .then((r) => {
        if (!cancelled) setBaseParts(r.parts || {});
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [characterName, effectivePreset, basePresetName]);

  const hasAnyPartOverride = Object.values(partOverrides).some((v) => v);
  // プレビュー合成用: センチネルは "" に直してバックエンドでパーツ消去させる。
  const previewOverrides: Record<string, string> = {};
  Object.entries(partOverrides).forEach(([k, v]) => {
    previewOverrides[k] = v === NONE_PART ? "" : v;
  });

  return (
    <div className="panel p-5">
      <div className="flex items-center gap-2 mb-3">
        <span style={{ color: "var(--accent)", fontSize: "0.68rem" }}>&#9670;</span>
        <h2 className="section-title">プレビュー / パーツ</h2>
      </div>

      {voiceIndex == null ? (
        <p style={{ fontSize: "0.82rem", color: "var(--text-muted)", padding: "16px 2px" }}>
          「感情分析結果」で台詞を選択するとプレビューとパーツ個別変更を表示します。
        </p>
      ) : holdPrevious ? (
        <p style={{ fontSize: "0.8rem", color: "var(--text-muted)", lineHeight: 1.7, padding: "8px 2px" }}>
          この台詞は「前回の表情を保つ」が選択されています。専用の表情アイテムは作られないため、プレビューはありません。
        </p>
      ) : (
        <div className="space-y-3">
          {effectivePreset ? (
            <PresetPreview
              characterName={characterName}
              presetName={effectivePreset}
              basePresetName={basePresetName}
              overrideParts={previewOverrides}
              psd={isPsd}
              psdLayerOverrides={isPsd ? psdLayerOverrides : undefined}
              zoomable
              large
              showPartsList={false}
              viewKey="panel-preview"
            />
          ) : (
            <p style={{ fontSize: "0.8rem", color: "var(--text-faint)", padding: "8px 2px" }}>
              プリセット未解決です。「個別設定」で感情またはプリセットを指定してください。
            </p>
          )}

          {isPsd ? (
            <PsdLayerPanel />
          ) : (
          <div style={{ borderTop: "1px solid var(--border-dim)", paddingTop: "10px" }}>
            <span style={{ fontSize: "0.8rem", fontWeight: 700, color: "var(--text-secondary)" }}>
              パーツ個別変更
              <span className="label-hint">
                {hasAnyPartOverride
                  ? `${Object.values(partOverrides).filter(Boolean).length} 件変更中`
                  : "プリセット標準を表示中。変更すると強調されます"}
              </span>
            </span>
            {/* FullHD では2列、狭ウィンドウでは1列。 */}
            <div className="grid grid-cols-1 2xl:grid-cols-2 gap-x-3 gap-y-1.5 mt-2">
              {PART_FIELDS.map(({ key, label }) => {
                // 他1〜3（Etc）はオプション要素が多いため「（パーツなし）」を明示選択可能に。
                const allowNone = key.startsWith("Etc");
                const files = availableFiles?.[key] || [];
                const defaultName = basename(baseParts[key]);
                const ov = partOverrides[key];
                const isNone = ov === NONE_PART;
                const overridden = ov !== undefined && (isNone ? defaultName !== "" : ov !== defaultName);
                const value = isNone ? NONE_PART : ov && ov !== defaultName ? ov : "";
                const otherFiles = files.filter((f) => f !== defaultName);
                const noOptions = !defaultName && files.length === 0 && !allowNone;
                return (
                  <div key={key} className="flex items-center gap-2">
                    <span
                      className="flex-shrink-0"
                      style={{ width: "32px", fontSize: "0.72rem", color: overridden ? "var(--accent)" : "var(--text-muted)", fontWeight: overridden ? 700 : 500 }}
                    >
                      {label}
                    </span>
                    <select
                      value={value}
                      onChange={(e) => setPart(key, e.target.value)}
                      className="select-field flex-1"
                      style={{
                        fontSize: "0.72rem",
                        minWidth: 0,
                        maxWidth: "100%",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                        fontWeight: overridden ? 700 : 400,
                        color: overridden ? "var(--accent)" : undefined,
                      }}
                      disabled={noOptions}
                    >
                      {/* 標準（=プリセット解決値）。選択でこの値に戻すと上書き解除。 */}
                      <option value="">{defaultName ? truncName(defaultName) : "（パーツなし）"}</option>
                      {/* 標準がファイルのとき、明示的な「パーツなし」を選べるようにする（他1〜3）。 */}
                      {allowNone && defaultName && <option value={NONE_PART}>（パーツなし）</option>}
                      {otherFiles.map((name) => (
                        <option key={name} value={name}>
                          {truncName(name)}
                        </option>
                      ))}
                    </select>
                  </div>
                );
              })}
            </div>
            {effectivePreset && (
              <SavePresetForm
                onSave={async (name) => {
                  const r = await api.savePngPreset(characterName, {
                    name,
                    base_preset_name: effectivePreset,
                    part_overrides: previewOverrides,
                  });
                  return r.preset_names;
                }}
                onSaved={(_n, names) => onPresetsChanged?.(characterName, names)}
              />
            )}
          </div>
          )}
        </div>
      )}
    </div>
  );
}
