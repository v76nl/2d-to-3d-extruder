import * as THREE from "three";
import {
  groupBase,
  groupRing,
  materialBase,
  materialRing,
} from "./scene.ts";
import { state } from "./state.ts";

// 土台プレートの生成 (SVG モード用)
export function generateBase(targetBox: THREE.Box3): void {
  const width = targetBox.max.x - targetBox.min.x + state.basePadding * 2;
  const height = targetBox.max.y - targetBox.min.y + state.basePadding * 2;
  const radius = state.baseRadius;

  const shape = new THREE.Shape();
  const x = -width / 2;
  const y = -height / 2;

  shape.moveTo(x + radius, y);
  shape.lineTo(x + width - radius, y);
  shape.quadraticCurveTo(x + width, y, x + width, y + radius);
  shape.lineTo(x + width, y + height - radius);
  shape.quadraticCurveTo(
    x + width,
    y + height,
    x + width - radius,
    y + height,
  );
  shape.lineTo(x + radius, y + height);
  shape.quadraticCurveTo(x, y + height, x, y + height - radius);
  shape.lineTo(x, y + radius);
  shape.quadraticCurveTo(x, y, x + radius, y);

  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: state.baseThickness,
    bevelEnabled: false,
  });

  const mesh = new THREE.Mesh(geometry, materialBase);
  mesh.position.z = -state.baseThickness;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  groupBase.add(mesh);
}

// ストラップリングの生成 (真円: 中空円柱 / その他多角形: TorusGeometry)
export function generateRing(): void {
  const segs =
    typeof state.ringShape === "string"
      ? Number.parseInt(state.ringShape, 10)
      : state.ringShape;
  let geometry: THREE.BufferGeometry;

  if (segs === 32) {
    const outerR = state.ringSize + state.ringTube;
    const innerR = Math.max(0.1, state.ringSize - state.ringTube);
    const cylHeight = state.ringTube * 2;

    const shape = new THREE.Shape();
    shape.absarc(0, 0, outerR, 0, Math.PI * 2, false);
    const hole = new THREE.Path();
    hole.absarc(0, 0, innerR, 0, Math.PI * 2, true);
    shape.holes.push(hole);

    geometry = new THREE.ExtrudeGeometry(shape, {
      depth: cylHeight,
      bevelEnabled: false,
      curveSegments: 32,
    });
    geometry.translate(0, 0, -cylHeight / 2);
  } else {
    geometry = new THREE.TorusGeometry(
      state.ringSize,
      state.ringTube,
      16,
      segs,
    );
  }

  const mesh = new THREE.Mesh(geometry, materialRing);
  const ringZ = state.baseEnabled
    ? -state.baseThickness / 2
    : state.modelThickness / 2;
  mesh.position.set(state.ringX, state.ringY, ringZ);
  mesh.castShadow = true;
  mesh.receiveShadow = true;

  let baseRotation = (state.ringRot * Math.PI) / 180;
  if (segs === 3) baseRotation += Math.PI / 6;
  mesh.rotation.z = baseRotation;
  groupRing.add(mesh);
}

// ストラップリングと土台を結ぶ補強板の生成
export function generateRingReinforcement(baseTopY: number): void {
  const outerR = state.ringSize + state.ringTube;
  const cylHeight = state.ringTube * 2;
  const ringZ = state.baseEnabled
    ? -state.baseThickness / 2
    : state.modelThickness / 2;

  const localBaseY = baseTopY - state.ringY;
  if (localBaseY >= 0) return;

  const shape = new THREE.Shape();

  if (localBaseY > -outerR) {
    const hw = Math.sqrt(outerR * outerR - localBaseY * localBaseY);
    const theta1 = Math.atan2(localBaseY, -hw);
    let theta2 = Math.atan2(localBaseY, hw);
    if (theta2 < 0) theta2 += 2 * Math.PI;

    shape.moveTo(hw, localBaseY);
    shape.lineTo(-hw, localBaseY);
    shape.absarc(0, 0, outerR, theta1, theta2, false);
  } else {
    shape.moveTo(outerR, localBaseY);
    shape.lineTo(-outerR, localBaseY);
    shape.lineTo(-outerR, 0);
    shape.absarc(0, 0, outerR, Math.PI, 2 * Math.PI, false);
  }

  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: cylHeight,
    bevelEnabled: false,
    curveSegments: 32,
  });
  geometry.translate(0, 0, -cylHeight / 2);

  const mesh = new THREE.Mesh(geometry, materialRing);
  mesh.position.set(state.ringX, state.ringY, ringZ);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  groupRing.add(mesh);
}
