import * as THREE from "three";
import { STLExporter } from "three/addons/exporters/STLExporter";
import {
  mergeGeometries,
  mergeVertices,
} from "three/addons/utils/BufferGeometryUtils";
import { rootGroup } from "./scene.ts";

// シーン内の全メッシュをワールド座標で結合し、重複頂点を溶接してバイナリ STL として出力する
export function exportSTL(exportBtn: HTMLButtonElement | null): void {
  if (!exportBtn) return;
  exportBtn.disabled = true;
  exportBtn.textContent = "Processing...";

  setTimeout(() => {
    try {
      // 1. 全メッシュのジオメトリをワールド座標に変換して収集
      rootGroup.updateMatrixWorld(true);
      const geometries: THREE.BufferGeometry[] = [];
      rootGroup.traverse((obj) => {
        if (!(obj instanceof THREE.Mesh)) return;
        const geom = obj.geometry.clone();
        geom.applyMatrix4(obj.matrixWorld);
        // mergeGeometries はインデックスなしジオメトリを想定するため UV 等を削除
        geom.deleteAttribute("uv");
        geometries.push(geom);
      });

      if (geometries.length === 0) {
        alert("エクスポートするメッシュがありません。");
        return;
      }

      // 2. 1つのジオメトリに統合し、重複頂点を溶接
      const merged = mergeGeometries(geometries);
      if (!merged) throw new Error("mergeGeometries に失敗しました。");
      const welded = mergeVertices(merged, 1e-4);
      welded.computeVertexNormals();
      geometries.forEach((g) => g.dispose());
      merged.dispose();

      // 3. STL エクスポート
      const exporter = new STLExporter();
      const exportMesh = new THREE.Mesh(welded);
      const result = exporter.parse(exportMesh, { binary: true });
      welded.dispose();

      const blob = new Blob([result], {
        type: "application/octet-stream",
      });
      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      link.download = `keychain_v3.5_${Date.now()}.stl`;
      link.click();
    } catch (err: any) {
      console.error("Export error:", err);
      alert("エクスポートに失敗しました: " + err.message);
    } finally {
      exportBtn.disabled = false;
      exportBtn.textContent = "Export STL";
    }
  }, 50);
}
