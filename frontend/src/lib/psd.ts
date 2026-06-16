// SPDX-License-Identifier: AGPL-3.0-or-later
import { PsdLayerNode } from "./api";

/** プリセット基準集合にデルタ（レイヤーID→表示/非表示）を重ねた可視集合を返す。 */
export function applyLayerDelta(
  base: Set<string> | string[],
  delta: Record<string, boolean> | null | undefined
): Set<string> {
  const out = new Set(base);
  for (const [id, on] of Object.entries(delta || {})) {
    if (on) out.add(id);
    else out.delete(id);
  }
  return out;
}

/** ツリー＋可視集合から「実際に表示されるリーフID集合」を返す。
 *  リーフが enable にあり、かつ全祖先フォルダも enable にあるときだけ表示する
 *  （フォルダが非表示ならその中のレイヤーも非表示＝Photoshop/YMM4 と同じ挙動）。
 *  i方式・n方式で共通（どちらもプリセットに必要なフォルダIDが含まれる）。 */
export function effectiveVisibleLeaves(
  tree: PsdLayerNode[],
  enable: Set<string>,
  _scheme: string
): Set<string> {
  const out = new Set<string>();
  function walk(nodes: PsdLayerNode[], ancestorsOn: boolean) {
    for (const n of nodes) {
      if (n.is_folder) {
        walk(n.children, ancestorsOn && enable.has(n.id));
      } else if (ancestorsOn && enable.has(n.id)) {
        out.add(n.id);
      }
    }
  }
  walk(tree, true);
  return out;
}
