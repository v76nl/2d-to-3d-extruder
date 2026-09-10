import { Clipper, FillRule, Path64, Paths64 } from "clipper2-js";
import * as THREE from "three";

export interface FontCommand {
  type: "M" | "L" | "Q" | "C" | "Z";
  x?: number;
  y?: number;
  x1?: number;
  y1?: number;
  x2?: number;
  y2?: number;
}

// スケールで Y 反転しつつ法線を正しく保つ
// Three.js の ExtrudeGeometry は opentype / SVG の Y軸と向きが異なるため、
// scaleY=-1 を使って上下を反転する。負のスケールは面の裏表を反転するので
// 頂点インデックスの順序を入れ替えて法線の向きを戻す。
export function flipYCorrectly(
  geometry: THREE.BufferGeometry,
  scaleX = 1,
  scaleY = -1,
  scaleZ = 1,
): void {
  geometry.scale(scaleX, scaleY, scaleZ);

  if (scaleX * scaleY * scaleZ < 0) {
    const index = geometry.index;
    if (index) {
      // インデックス付きジオメトリ
      const array = index.array as Uint16Array | Uint32Array;
      for (let i = 0; i < array.length; i += 3) {
        const temp = array[i];
        array[i] = array[i + 2];
        array[i + 2] = temp;
      }
    } else {
      // 非インデックスジオメトリ (ExtrudeGeometry のデフォルト)
      const pos = geometry.attributes.position;
      const array = pos.array as Float32Array;
      for (let i = 0; i < array.length; i += 9) {
        for (let j = 0; j < 3; j++) {
          const temp = array[i + j];
          array[i + j] = array[i + 6 + j];
          array[i + 6 + j] = temp;
        }
      }
      if (geometry.attributes.uv) {
        const uv = geometry.attributes.uv.array as Float32Array;
        for (let i = 0; i < uv.length; i += 6) {
          for (let j = 0; j < 2; j++) {
            const temp = uv[i + j];
            uv[i + j] = uv[i + 4 + j];
            uv[i + 4 + j] = temp;
          }
        }
      }
    }
    geometry.computeVertexNormals();
  }
}

// Clipper2 ユーティリティ
// clipper2-js は整数座標で動作するため、浮動小数点座標を整数にスケールして渡す
export const CLIPPER_SCALE = 1e6;

// THREE.Shape の点列を Clipper 用の整数座標 Path64 に変換する。
// offsetX / offsetY を指定すると座標をシフトしてから変換する (文字カーソル位置の適用に使用)。
export function threeShapeToPath64(
  shape: THREE.Shape,
  curveSegments = 12,
  offsetX = 0,
  offsetY = 0,
): Path64 {
  const pts = shape.getPoints(curveSegments);
  const path = new Path64();
  pts.forEach((p) => {
    path.push({
      x: Math.round((p.x + offsetX) * CLIPPER_SCALE),
      y: Math.round((p.y + offsetY) * CLIPPER_SCALE),
    });
  });
  return path;
}

interface ShapeItem {
  shape: THREE.Shape;
  area: number;
  absArea: number;
  pts: THREE.Vector2[];
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

// Clipper の Paths64 結果を THREE.Shape[] に変換する。
// NonZero Union 後のリングを面積の符号でソリッド/ホールに振り分ける。
// 複数文字を一括 Union した場合の複数ソリッド・複数ホールにも対応するため、
// 各ホールをその bbox 重心が内包する最小のソリッドに割り当てる。
export function paths64ToThreeShapes(paths64: Paths64): THREE.Shape[] {
  if (!paths64 || paths64.length === 0) return [];

  const shapeItems: ShapeItem[] = paths64
    .map((path) => {
      if (path.length < 3) return null;
      const pts = path.map(
        (p) => new THREE.Vector2(p.x / CLIPPER_SCALE, p.y / CLIPPER_SCALE),
      );
      const s = new THREE.Shape(pts);
      const area = THREE.ShapeUtils.area(pts);
      if (Math.abs(area) < 1e-6) return null;
      // bbox を計算してホール割り当てに使用する
      let minX = Number.POSITIVE_INFINITY,
        maxX = Number.NEGATIVE_INFINITY,
        minY = Number.POSITIVE_INFINITY,
        maxY = Number.NEGATIVE_INFINITY;
      pts.forEach((p) => {
        if (p.x < minX) minX = p.x;
        if (p.x > maxX) maxX = p.x;
        if (p.y < minY) minY = p.y;
        if (p.y > maxY) maxY = p.y;
      });
      return {
        shape: s,
        area,
        absArea: Math.abs(area),
        pts,
        minX,
        maxX,
        minY,
        maxY,
      };
    })
    .filter((item): item is ShapeItem => item !== null);

  if (shapeItems.length === 0) return [];

  shapeItems.sort((a, b) => b.absArea - a.absArea);

  const primarySign = Math.sign(shapeItems[0].area);
  const solids = shapeItems.filter(
    (item) => Math.sign(item.area) === primarySign,
  );
  const holes = shapeItems.filter(
    (item) => Math.sign(item.area) !== primarySign,
  );

  // 各ホールを、その bbox 重心を包む最小面積のソリッドに割り当てる。
  // Clipper Union の結果は各ホールが必ず 1 つのソリッド内包に収まるため bbox で十分。
  holes.forEach((hole) => {
    const cx = (hole.minX + hole.maxX) / 2;
    const cy = (hole.minY + hole.maxY) / 2;
    let best: ShapeItem | null = null;
    solids.forEach((solid) => {
      if (
        cx >= solid.minX &&
        cx <= solid.maxX &&
        cy >= solid.minY &&
        cy <= solid.maxY
      ) {
        if (!best || solid.absArea < best.absArea) best = solid;
      }
    });
    (best ?? solids[0]).shape.holes.push(hole.shape);
  });

  return solids.map((item) => item.shape);
}

// opentype のコマンドから THREE.Shape の配列として返す (Clipper Union なし)。
// 複数文字を一括 Union するために commandsToShapes から分離したヘルパー。
export function parseCommandsToRawShapes(
  commands: FontCommand[],
): THREE.Shape[] {
  const shapes: THREE.Shape[] = [];
  let currentShape = new THREE.Shape();
  commands.forEach((cmd) => {
    switch (cmd.type) {
      case "M":
        if (currentShape.curves.length > 0) shapes.push(currentShape);
        currentShape = new THREE.Shape();
        if (cmd.x !== undefined && cmd.y !== undefined) {
          currentShape.moveTo(cmd.x, cmd.y);
        }
        break;
      case "L":
        if (cmd.x !== undefined && cmd.y !== undefined) {
          currentShape.lineTo(cmd.x, cmd.y);
        }
        break;
      case "Q":
        if (
          cmd.x1 !== undefined &&
          cmd.y1 !== undefined &&
          cmd.x !== undefined &&
          cmd.y !== undefined
        ) {
          currentShape.quadraticCurveTo(cmd.x1, cmd.y1, cmd.x, cmd.y);
        }
        break;
      case "C":
        if (
          cmd.x1 !== undefined &&
          cmd.y1 !== undefined &&
          cmd.x2 !== undefined &&
          cmd.y2 !== undefined &&
          cmd.x !== undefined &&
          cmd.y !== undefined
        ) {
          currentShape.bezierCurveTo(
            cmd.x1,
            cmd.y1,
            cmd.x2,
            cmd.y2,
            cmd.x,
            cmd.y,
          );
        }
        break;
      case "Z":
        currentShape.closePath();
        break;
    }
  });
  if (currentShape.curves.length > 0) shapes.push(currentShape);
  return shapes;
}

// opentype のコマンドから clipper2-js で Boolean Union し、自己交差のないクリーンな
// THREE.Shape[] を返す。Union することで 'X' のような交差フォントパスでも
// スライサーが非多様体エラーを起こさない STL を生成できる。
export function commandsToShapes(commands: FontCommand[]): THREE.Shape[] {
  // M コマンドごとに subpath に分離して THREE.Shape の点列を作る
  const rawShapes: THREE.Shape[] = [];
  let currentShape = new THREE.Shape();

  commands.forEach((cmd) => {
    switch (cmd.type) {
      case "M":
        if (currentShape.curves.length > 0) rawShapes.push(currentShape);
        currentShape = new THREE.Shape();
        if (cmd.x !== undefined && cmd.y !== undefined) {
          currentShape.moveTo(cmd.x, cmd.y);
        }
        break;
      case "L":
        if (cmd.x !== undefined && cmd.y !== undefined) {
          currentShape.lineTo(cmd.x, cmd.y);
        }
        break;
      case "Q":
        if (
          cmd.x1 !== undefined &&
          cmd.y1 !== undefined &&
          cmd.x !== undefined &&
          cmd.y !== undefined
        ) {
          currentShape.quadraticCurveTo(cmd.x1, cmd.y1, cmd.x, cmd.y);
        }
        break;
      case "C":
        if (
          cmd.x1 !== undefined &&
          cmd.y1 !== undefined &&
          cmd.x2 !== undefined &&
          cmd.y2 !== undefined &&
          cmd.x !== undefined &&
          cmd.y !== undefined
        ) {
          currentShape.bezierCurveTo(
            cmd.x1,
            cmd.y1,
            cmd.x2,
            cmd.y2,
            cmd.x,
            cmd.y,
          );
        }
        break;
      case "Z":
        currentShape.closePath();
        break;
    }
  });
  if (currentShape.curves.length > 0) rawShapes.push(currentShape);
  if (rawShapes.length === 0) return [];

  // 各 subpath を Clipper の Path64 に変換
  const paths = new Paths64();
  rawShapes.forEach((shape) => {
    const path64 = threeShapeToPath64(shape, 12);
    if (path64.length >= 3) paths.push(path64);
  });

  if (paths.length === 0) return [];

  // Clipper Union で自己交差を解消 (NonZero ルール)
  let unified: Paths64;
  try {
    unified = Clipper.Union(paths, undefined, FillRule.NonZero);
  } catch (e) {
    console.warn("Clipper Union failed, falling back to raw shapes:", e);
    return rawShapesFallback(commands);
  }

  if (!unified || unified.length === 0) return [];

  return paths64ToThreeShapes(unified);
}

// Clipper Union が失敗した場合のフォールバック。面積の符号でホールを判別し
// THREE.Shape[] を返す (Union なしなので自己交差パスは残ることがある)。
export function rawShapesFallback(commands: FontCommand[]): THREE.Shape[] {
  const shapes: THREE.Shape[] = [];
  let currentShape = new THREE.Shape();

  commands.forEach((cmd) => {
    switch (cmd.type) {
      case "M":
        if (currentShape.curves.length > 0) shapes.push(currentShape);
        currentShape = new THREE.Shape();
        if (cmd.x !== undefined && cmd.y !== undefined) {
          currentShape.moveTo(cmd.x, cmd.y);
        }
        break;
      case "L":
        if (cmd.x !== undefined && cmd.y !== undefined) {
          currentShape.lineTo(cmd.x, cmd.y);
        }
        break;
      case "Q":
        if (
          cmd.x1 !== undefined &&
          cmd.y1 !== undefined &&
          cmd.x !== undefined &&
          cmd.y !== undefined
        ) {
          currentShape.quadraticCurveTo(cmd.x1, cmd.y1, cmd.x, cmd.y);
        }
        break;
      case "C":
        if (
          cmd.x1 !== undefined &&
          cmd.y1 !== undefined &&
          cmd.x2 !== undefined &&
          cmd.y2 !== undefined &&
          cmd.x !== undefined &&
          cmd.y !== undefined
        ) {
          currentShape.bezierCurveTo(
            cmd.x1,
            cmd.y1,
            cmd.x2,
            cmd.y2,
            cmd.x,
            cmd.y,
          );
        }
        break;
      case "Z":
        currentShape.closePath();
        break;
    }
  });
  if (currentShape.curves.length > 0) shapes.push(currentShape);

  const shapesWithArea = shapes.map((s) => {
    const area = THREE.ShapeUtils.area(s.getPoints());
    return { shape: s, area, absArea: Math.abs(area) };
  });
  shapesWithArea.sort((a, b) => b.absArea - a.absArea);
  const finalSolids: THREE.Shape[] = [];
  if (shapesWithArea.length === 0) return [];
  const primarySign = Math.sign(shapesWithArea[0].area);
  shapesWithArea.forEach((item) => {
    if (Math.sign(item.area) === primarySign) {
      finalSolids.push(item.shape);
    } else {
      if (finalSolids.length > 0) finalSolids[0].holes.push(item.shape);
    }
  });
  return finalSolids;
}

// Clipper Paths64 の全頂点に整数シフトを適用した新しい Paths64 を返す
export function shiftPaths64(
  paths: Paths64,
  dx: number,
  dy: number,
): Paths64 {
  const result = new Paths64();
  paths.forEach((path) => {
    result.push(
      path.map((pt) => ({
        x: pt.x + Math.round(dx),
        y: pt.y + Math.round(dy),
      })),
    );
  });
  return result;
}

// 中央対称の角丸矩形 Paths64 を Clipper 座標系 (フォント Y-up 空間) で生成する
export function createRoundedRectPaths64(
  halfW: number,
  halfH: number,
  radius: number,
): Paths64 {
  const r = Math.min(radius, halfW, halfH);
  const shape = new THREE.Shape();
  shape.moveTo(-halfW + r, -halfH);
  shape.lineTo(halfW - r, -halfH);
  shape.quadraticCurveTo(halfW, -halfH, halfW, -halfH + r);
  shape.lineTo(halfW, halfH - r);
  shape.quadraticCurveTo(halfW, halfH, halfW - r, halfH);
  shape.lineTo(-halfW + r, halfH);
  shape.quadraticCurveTo(-halfW, halfH, -halfW, halfH - r);
  shape.lineTo(-halfW, -halfH + r);
  shape.quadraticCurveTo(-halfW, -halfH, -halfW + r, -halfH);
  const paths = new Paths64();
  const p64 = threeShapeToPath64(shape, 16);
  if (p64.length >= 3) paths.push(p64);
  return paths;
}
