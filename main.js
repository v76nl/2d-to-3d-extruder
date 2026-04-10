import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { SVGLoader } from 'three/addons/loaders/SVGLoader.js';
import { STLExporter } from 'three/addons/exporters/STLExporter.js';
import { FontLoader } from 'three/addons/loaders/FontLoader.js';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { Clipper, Paths64, FillRule } from 'clipper2-js';

const FONT_URLS = {
    'sans': 'https://cdn.jsdelivr.net/npm/@fontsource/noto-sans-jp@5/files/noto-sans-jp-japanese-700-normal.woff',
    'serif': 'https://cdn.jsdelivr.net/npm/@fontsource/noto-serif-jp@5/files/noto-serif-jp-japanese-700-normal.woff',
    'dot': 'https://cdn.jsdelivr.net/npm/@fontsource/dotgothic16@5/files/dotgothic16-japanese-400-normal.woff',
    'ramp': 'https://cdn.jsdelivr.net/npm/@fontsource/rampart-one@5/files/rampart-one-japanese-400-normal.woff'
};

const state = {
    mode: 'text',
    text: '印刷物',
    fontKey: 'sans',
    textSize: 10,
    textSpacing: 1, 
    modelThickness: 3,
    svgContent: null,
    svgScale: 1.0,
    mirrorX: false,
    
    baseEnabled: true, 
    basePadding: 2,
    baseThickness: 2,
    baseRadius: 1,
    
    ringEnabled: true,
    ringShape: 32,
    ringAutoY: true,
    ringX: 0,
    ringY: 0,
    ringSize: 3,
    ringTube: 1,
    ringRot: 0,
    ringReinforce: false
};

let currentFont = null;

const canvas = document.querySelector('#gl-canvas');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(window.devicePixelRatio);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0xf0f2f5);
scene.fog = new THREE.Fog(0xf0f2f5, 200, 600);

const gridHelper = new THREE.GridHelper(200, 20, 0xcccccc, 0xe5e5e5);
gridHelper.rotation.x = Math.PI / 2;
gridHelper.position.z = -0.1;
scene.add(gridHelper);

const planeGeometry = new THREE.PlaneGeometry(500, 500);
const planeMaterial = new THREE.ShadowMaterial({ opacity: 0.15 });
const plane = new THREE.Mesh(planeGeometry, planeMaterial);
plane.position.z = -0.2;
plane.receiveShadow = true;
scene.add(plane);

const camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 1, 1000);
camera.position.set(0, -60, 80);
camera.lookAt(0, 0, 0);
camera.up.set(0, 0, 1);

const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.dampingFactor = 0.05;

const ambientLight = new THREE.AmbientLight(0xffffff, 0.4);
scene.add(ambientLight);

const hemiLight = new THREE.HemisphereLight(0xffffff, 0x444444, 0.6);
hemiLight.position.set(0, 0, 50);
scene.add(hemiLight);

const dirLight = new THREE.DirectionalLight(0xffffff, 0.7);
dirLight.position.set(50, -50, 100);
dirLight.castShadow = true;
dirLight.shadow.mapSize.set(2048, 2048);
dirLight.shadow.bias = -0.0005;
scene.add(dirLight);

const materialMain = new THREE.MeshStandardMaterial({ color: 0x3b82f6, roughness: 0.3, side: THREE.DoubleSide });
const materialBase = new THREE.MeshStandardMaterial({ color: 0x9ca3af, roughness: 0.4, side: THREE.DoubleSide });
const materialRing = new THREE.MeshStandardMaterial({ color: 0xf59e0b, roughness: 0.3, side: THREE.DoubleSide });

const groupMain = new THREE.Group();
const groupBase = new THREE.Group();
const groupRing = new THREE.Group();
const rootGroup = new THREE.Group();

rootGroup.add(groupMain);
rootGroup.add(groupBase);
rootGroup.add(groupRing);
scene.add(rootGroup);

function flipYCorrectly(geometry, scaleX = 1, scaleY = -1, scaleZ = 1) {
    geometry.scale(scaleX, scaleY, scaleZ);
    
    // スケールで反転（鏡像）が生じる場合、面の向き（法線）が裏返るため頂点の順番を修正する
    if (scaleX * scaleY * scaleZ < 0) {
        const index = geometry.index;
        if (index) {
            const array = index.array;
            for (let i = 0; i < array.length; i += 3) {
                const temp = array[i];
                array[i] = array[i + 2];
                array[i + 2] = temp;
            }
        } else {
            // Non-indexed geometry (ExtrudeGeometry通常時) の対応
            const pos = geometry.attributes.position;
            const array = pos.array;
            for (let i = 0; i < array.length; i += 9) {
                for (let j = 0; j < 3; j++) {
                    const temp = array[i + j];
                    array[i + j] = array[i + 6 + j];
                    array[i + 6 + j] = temp;
                }
            }
            if (geometry.attributes.uv) {
                const uv = geometry.attributes.uv.array;
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

// ─── Clipper2 ユーティリティ ───────────────────────────────────────────────────
// clipper2-js は整数座標で動作するため、浮動小数点座標をスケールして渡す
const CLIPPER_SCALE = 1e6;

/**
 * THREE.Shape の点列 → Clipper の Path64（整数座標の配列）に変換
 */
function threeShapeToPath64(shape, curveSegments = 12) {
    const pts = shape.getPoints(curveSegments);
    const path = pts.map(p => ({
        x: Math.round(p.x * CLIPPER_SCALE),
        y: Math.round(p.y * CLIPPER_SCALE)
    }));
    return path;
}

/**
 * Clipper の Paths64 結果 → THREE.Shape[] に変換
 * NonZero Union 後の外形リングはすべて solid として扱い、
 * 面積の符号でホール（穴）を判別する。
 */
function paths64ToThreeShapes(paths64) {
    if (!paths64 || paths64.length === 0) return [];

    // 各パスを THREE.Shape に変換し面積を計算
    const shapeItems = paths64.map(path => {
        if (path.length < 3) return null;
        const pts = path.map(p => new THREE.Vector2(
            p.x / CLIPPER_SCALE,
            p.y / CLIPPER_SCALE
        ));
        const s = new THREE.Shape(pts);
        const area = THREE.ShapeUtils.area(pts);
        return { shape: s, area, pts };
    }).filter(Boolean);

    if (shapeItems.length === 0) return [];

    // 面積の絶対値でソート（大きいものが外形）
    shapeItems.sort((a, b) => Math.abs(b.area) - Math.abs(a.area));

    const primarySign = Math.sign(shapeItems[0].area);
    const solids = [];

    shapeItems.forEach(item => {
        if (Math.sign(item.area) === primarySign) {
            solids.push(item.shape);
        } else {
            // 符号が逆 → ホール。面積最大のソリッドに追加
            if (solids.length > 0) {
                solids[0].holes.push(item.shape);
            }
        }
    });

    return solids;
}

/**
 * opentype のコマンド列 → clipper2-js で Union してクリーンな THREE.Shape[] を返す
 *
 * 変更前: THREE.Shape を直接生成 → 自己交差パスがそのままExtrudeGeometryに流れ込む
 * 変更後: Clipper Union で2D段階の自己交差を解消してから THREE.Shape に変換
 */
function commandsToShapes(commands) {
    // ① まず M コマンドごとに subpath を分割して THREE.Shape の点列を作る
    const rawShapes = [];
    let currentShape = new THREE.Shape();

    commands.forEach(cmd => {
        switch(cmd.type) {
            case 'M':
                if (currentShape.curves.length > 0) rawShapes.push(currentShape);
                currentShape = new THREE.Shape();
                currentShape.moveTo(cmd.x, cmd.y);
                break;
            case 'L':
                currentShape.lineTo(cmd.x, cmd.y);
                break;
            case 'Q':
                currentShape.quadraticCurveTo(cmd.x1, cmd.y1, cmd.x, cmd.y);
                break;
            case 'C':
                currentShape.bezierCurveTo(cmd.x1, cmd.y1, cmd.x2, cmd.y2, cmd.x, cmd.y);
                break;
            case 'Z':
                currentShape.closePath();
                break;
        }
    });
    if (currentShape.curves.length > 0) rawShapes.push(currentShape);
    if (rawShapes.length === 0) return [];

    // ② 各 subpath を Clipper の Path64 に変換
    const paths = new Paths64();
    rawShapes.forEach(shape => {
        const path64 = threeShapeToPath64(shape, 12);
        if (path64.length >= 3) paths.push(path64);
    });

    if (paths.length === 0) return [];

    // ③ Clipper Union で自己交差を解消（NonZero ルール）
    let unified;
    try {
        unified = Clipper.Union(paths, undefined, FillRule.NonZero);
    } catch (e) {
        console.warn('Clipper Union failed, falling back to raw shapes:', e);
        // フォールバック: Union 失敗時は従来通りの処理
        return rawShapesFallback(commands);
    }

    if (!unified || unified.length === 0) return [];

    // ④ Union 結果を THREE.Shape[] に変換して返す
    return paths64ToThreeShapes(unified);
}

/**
 * Clipper が失敗した場合の従来フォールバック処理
 */
function rawShapesFallback(commands) {
    const shapes = [];
    let currentShape = new THREE.Shape();

    commands.forEach(cmd => {
        switch(cmd.type) {
            case 'M':
                if (currentShape.curves.length > 0) shapes.push(currentShape);
                currentShape = new THREE.Shape();
                currentShape.moveTo(cmd.x, cmd.y);
                break;
            case 'L': currentShape.lineTo(cmd.x, cmd.y); break;
            case 'Q': currentShape.quadraticCurveTo(cmd.x1, cmd.y1, cmd.x, cmd.y); break;
            case 'C': currentShape.bezierCurveTo(cmd.x1, cmd.y1, cmd.x2, cmd.y2, cmd.x, cmd.y); break;
            case 'Z': currentShape.closePath(); break;
        }
    });
    if (currentShape.curves.length > 0) shapes.push(currentShape);

    const shapesWithArea = shapes.map(s => {
        const area = THREE.ShapeUtils.area(s.getPoints());
        return { shape: s, area, absArea: Math.abs(area) };
    });
    shapesWithArea.sort((a, b) => b.absArea - a.absArea);
    const finalSolids = [];
    if (shapesWithArea.length === 0) return [];
    const primarySign = Math.sign(shapesWithArea[0].area);
    shapesWithArea.forEach(item => {
        if (Math.sign(item.area) === primarySign) {
            finalSolids.push(item.shape);
        } else {
            if (finalSolids.length > 0) finalSolids[0].holes.push(item.shape);
        }
    });
    return finalSolids;
}



function loadFont(key) {
    const url = FONT_URLS[key];
    if (!url) return;
    showLoading(true);
    opentype.load(url, (err, font) => {
        if (err) { console.error(err); showLoading(false); }
        else { currentFont = font; updateGeometry(); showLoading(false); }
    });
}

function updateGeometry() {
    requestAnimationFrame(_generate);
}

function _generate() {
    clearGroup(groupMain);
    clearGroup(groupBase);
    clearGroup(groupRing);

    let mainBox = new THREE.Box3();

    if (state.mode === 'text' && currentFont) {
        generateTextRobust(mainBox);
    } else if (state.mode === 'svg' && state.svgContent) {
        generateSVG(mainBox);
    }

    if (state.baseEnabled && !mainBox.isEmpty()) {
        generateBase(mainBox);
    }

    if (state.baseEnabled) {
         const width = (mainBox.max.x - mainBox.min.x) + (state.basePadding * 2);
         const height = (mainBox.max.y - mainBox.min.y) + (state.basePadding * 2);
         const midY = (mainBox.max.y + mainBox.min.y) / 2;
         const baseTopY = midY + height/2;
         
         if (state.ringEnabled) {
                 if (state.ringAutoY) {
                 const outerRadius = state.ringSize + state.ringTube;
                 const overlap = state.ringTube * 1.5;
                 state.ringY = Math.round((baseTopY + outerRadius - overlap) * 10) / 10;
                 
                 const sliderY = document.getElementById('ring-y');
                 if (sliderY) {
                    sliderY.value = state.ringY;
                    sliderY.disabled = true;
                    sliderY.style.opacity = '0.5';
                 }
                 const valY = document.getElementById('val-ring-y');
                 if (valY) {
                    valY.value = state.ringY;
                    valY.disabled = true;
                    valY.style.opacity = '0.5';
                 }
              } else {
                 const sliderY = document.getElementById('ring-y');
                 if (sliderY) {
                    sliderY.disabled = false;
                    sliderY.style.opacity = '1';
                 }
                 const valY = document.getElementById('val-ring-y');
                 if (valY) {
                    valY.disabled = false;
                    valY.style.opacity = '1';
                 }
             }
             generateRing();
             if (parseInt(state.ringShape) === 32 && state.ringReinforce) {
                 generateRingReinforcement(baseTopY);
             }
         }
    } else {
        if (state.ringEnabled) {
            if (state.ringAutoY && !mainBox.isEmpty()) {
                const outerRadius = state.ringSize + state.ringTube;
                const overlap = state.ringTube * 1.5;
                state.ringY = Math.round((mainBox.max.y + outerRadius - overlap) * 10) / 10;
                
                const sliderY = document.getElementById('ring-y');
                if (sliderY) {
                    sliderY.value = state.ringY;
                    sliderY.disabled = true;
                    sliderY.style.opacity = '0.5';
                }
                const valY = document.getElementById('val-ring-y');
                if (valY) {
                    valY.value = state.ringY;
                    valY.disabled = true;
                    valY.style.opacity = '0.5';
                }
            }
            generateRing();
            if (parseInt(state.ringShape) === 32 && state.ringReinforce) {
                const connY = !mainBox.isEmpty() ? mainBox.max.y : (state.ringY - (state.ringSize + state.ringTube));
                generateRingReinforcement(connY);
            }
        }
    }
    // ハンコ用左右反転: groupMain の X スケールで鏡像化
    groupMain.scale.x = state.mirrorX ? -1 : 1;

    updateDimensionsInfo();
}

function clearGroup(group) {
    while(group.children.length > 0){ 
        const obj = group.children[0];
        if(obj.geometry) obj.geometry.dispose();
        group.remove(obj); 
    }
}

function generateTextRobust(targetBox) {
    if (!state.text) return;
    let cursorX = 0;
    const size = state.textSize;
    const spacing = state.textSpacing;
    const chars = Array.from(state.text);
    
    chars.forEach((char) => {
        const path = currentFont.getPath(char, 0, 0, size);
        const shapes = commandsToShapes(path.commands);

        if (shapes.length > 0) {
            const geometry = new THREE.ExtrudeGeometry(shapes, {
                depth: state.modelThickness,
                bevelEnabled: false
            });
            
            flipYCorrectly(geometry);
            geometry.computeBoundingBox();

            const advanceWidth = currentFont.getAdvanceWidth(char, size);
            const mesh = new THREE.Mesh(geometry, materialMain);
            mesh.castShadow = true;
            mesh.receiveShadow = true;
            
            mesh.position.x = cursorX;
            mesh.position.z = 0;
            groupMain.add(mesh);
            cursorX += advanceWidth + spacing;
        } else {
             const advanceWidth = currentFont.getAdvanceWidth(char, size);
             cursorX += advanceWidth + spacing;
        }
    });

    if (groupMain.children.length > 0) {
        const groupBox = new THREE.Box3();
        groupMain.children.forEach(mesh => {
            mesh.geometry.computeBoundingBox();
            const geomBox = mesh.geometry.boundingBox.clone();
            geomBox.translate(mesh.position);
            groupBox.union(geomBox);
        });

        const midX = (groupBox.max.x + groupBox.min.x) / 2;
        const midY = (groupBox.max.y + groupBox.min.y) / 2;

        groupMain.children.forEach(c => {
            c.position.x -= midX;
            c.position.y -= midY;
        });
        
        targetBox.setFromObject(groupMain);
    }
}

function generateSVG(targetBox) {
    const loader = new SVGLoader();
    const svgData = loader.parse(state.svgContent);
    const shapes = [];
    svgData.paths.forEach((path) => shapes.push(...path.toShapes(true)));

    const geometry = new THREE.ExtrudeGeometry(shapes, {
        depth: state.modelThickness,
        bevelEnabled: false
    });

    flipYCorrectly(geometry, state.svgScale, -state.svgScale, 1);
    geometry.computeBoundingBox();

    const midX = (geometry.boundingBox.max.x + geometry.boundingBox.min.x) / 2;
    const midY = (geometry.boundingBox.max.y + geometry.boundingBox.min.y) / 2;
    geometry.translate(-midX, -midY, 0);

    const mesh = new THREE.Mesh(geometry, materialMain);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    groupMain.add(mesh);
    targetBox.copy(geometry.boundingBox);
}

function generateBase(targetBox) {
    const width = (targetBox.max.x - targetBox.min.x) + (state.basePadding * 2);
    const height = (targetBox.max.y - targetBox.min.y) + (state.basePadding * 2);
    const radius = state.baseRadius;

    const shape = new THREE.Shape();
    const x = -width / 2;
    const y = -height / 2;

    shape.moveTo(x + radius, y);
    shape.lineTo(x + width - radius, y);
    shape.quadraticCurveTo(x + width, y, x + width, y + radius);
    shape.lineTo(x + width, y + height - radius);
    shape.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
    shape.lineTo(x + radius, y + height);
    shape.quadraticCurveTo(x, y + height, x, y + height - radius);
    shape.lineTo(x, y + radius);
    shape.quadraticCurveTo(x, y, x + radius, y);

    const geometry = new THREE.ExtrudeGeometry(shape, {
        depth: state.baseThickness,
        bevelEnabled: false
    });

    const mesh = new THREE.Mesh(geometry, materialBase);
    mesh.position.z = 0; 
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    groupBase.add(mesh);
}

function generateRing() {
    const segs = parseInt(state.ringShape);
    let geometry;

    if (segs === 32) {
        // 中空円柱: 外円 - 内円 の Shape を押し出して X 軸で 90° 回転
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
            curveSegments: 32
        });
        geometry.translate(0, 0, -cylHeight / 2); // 中心を原点に
    } else {
        geometry = new THREE.TorusGeometry(state.ringSize, state.ringTube, 16, segs);
    }

    const mesh = new THREE.Mesh(geometry, materialRing);
    
    const ringZ = state.baseEnabled ? (state.baseThickness / 2) : (state.modelThickness / 2);
    mesh.position.set(state.ringX, state.ringY, ringZ);
    
    mesh.castShadow = true;
    mesh.receiveShadow = true;

    let baseRotation = (state.ringRot * Math.PI) / 180;
    if (segs === 3) baseRotation += (Math.PI / 6); 
    mesh.rotation.z = baseRotation;
    groupRing.add(mesh);
}

/**
 * 中空円柱リングとベース板を繋ぐ補強板を生成する
 * 形状: 円の外周下弧 + ベース板上辺(の円の投影線分) を閉じた2D Shape を押し出す
 */
function generateRingReinforcement(baseTopY) {
    const outerR = state.ringSize + state.ringTube;
    const cylHeight = state.ringTube * 2;
    const ringZ = state.baseEnabled ? (state.baseThickness / 2) : (state.modelThickness / 2);

    // リング中心を原点とした相対Y
    const localBaseY = baseTopY - state.ringY;
    if (localBaseY >= 0 || localBaseY <= -outerR * 2) return; // 範囲外

    const shape = new THREE.Shape();

    if (localBaseY > -outerR) {
        // ケースA: ベース上辺が円の外周と交わる
        const hw = Math.sqrt(outerR * outerR - localBaseY * localBaseY);
        const theta1 = Math.atan2(localBaseY, -hw);         // 左交点の角度
        let theta2   = Math.atan2(localBaseY,  hw);          // 右交点の角度
        if (theta2 < 0) theta2 += 2 * Math.PI;              // [0, 2π] に正規化

        shape.moveTo(hw, localBaseY);                        // B: 右交点
        shape.lineTo(-hw, localBaseY);                       // ベース線（右→左）
        shape.absarc(0, 0, outerR, theta1, theta2, false);  // CCW弧: 左→右 (下を経由)
    } else {
        // ケースB: ベース上辺が円全体の下にある
        shape.moveTo( outerR, localBaseY);                   // 右下
        shape.lineTo(-outerR, localBaseY);                   // 左下（ベース線）
        shape.lineTo(-outerR, 0);                            // 左壁を上へ
        shape.absarc(0, 0, outerR, Math.PI, 2 * Math.PI, false); // CCW弧: 左→底→右
        // (outerR, 0) → (outerR, localBaseY) は自動クローズ
    }

    const geometry = new THREE.ExtrudeGeometry(shape, {
        depth: cylHeight,
        bevelEnabled: false,
        curveSegments: 32
    });
    geometry.translate(0, 0, -cylHeight / 2);

    const mesh = new THREE.Mesh(geometry, materialRing);
    mesh.position.set(state.ringX, state.ringY, ringZ);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    groupRing.add(mesh);
}

function updateDimensionsInfo() {
    rootGroup.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(rootGroup);
    if (box.isEmpty()) {
        const dimInfo = document.getElementById('dimensions-info');
        if (dimInfo) dimInfo.innerHTML = 'W: 0 mm<br>H: 0 mm<br>D: 0 mm';
        return;
    }
    const w = (box.max.x - box.min.x).toFixed(1);
    const h = (box.max.y - box.min.y).toFixed(1);
    const d = (box.max.z - box.min.z).toFixed(1);
    const dimInfo = document.getElementById('dimensions-info');
    if (dimInfo) dimInfo.innerHTML = `W: ${w} mm<br>H: ${h} mm<br>D: ${d} mm`;
}

function showLoading(show) {
    const loading = document.getElementById('loading');
    if (loading) loading.style.display = show ? 'block' : 'none';
}

const btnText = document.getElementById('mode-text');
const btnSvg = document.getElementById('mode-svg');
function setMode(m) {
    const btnText = document.getElementById('mode-text');
    const btnSvg = document.getElementById('mode-svg');
    state.mode = m;
    if (m === 'text') {
        if (btnText) btnText.className = 'flex-1 py-1 px-2 btn-mode-active rounded text-sm transition';
        if (btnSvg) btnSvg.className = 'flex-1 py-1 px-2 btn-mode-inactive rounded text-sm transition';
        const ctrlText = document.getElementById('controls-text');
        if (ctrlText) ctrlText.style.display = 'block';
        const ctrlSvg = document.getElementById('controls-svg');
        if (ctrlSvg) ctrlSvg.style.display = 'none';
    } else {
        if (btnSvg) btnSvg.className = 'flex-1 py-1 px-2 btn-mode-active rounded text-sm transition';
        if (btnText) btnText.className = 'flex-1 py-1 px-2 btn-mode-inactive rounded text-sm transition';
        const ctrlText = document.getElementById('controls-text');
        if (ctrlText) ctrlText.style.display = 'none';
        const ctrlSvg = document.getElementById('controls-svg');
        if (ctrlSvg) ctrlSvg.style.display = 'block';
    }
    updateGeometry();
}
if (btnText) btnText.onclick = () => setMode('text');
if (btnSvg) btnSvg.onclick = () => setMode('svg');

const inputText = document.getElementById('input-text');
if (inputText) {
    inputText.addEventListener('input', (e) => {
        const val = e.target.value;
        state.text = val;
        if (val.length > 1 && !state.baseEnabled) {
            state.baseEnabled = true;
            const baseEnable = document.getElementById('base-enable');
            if (baseEnable) baseEnable.checked = true;
            const c = document.getElementById('controls-base');
            if (c) {
                c.style.opacity = '1'; c.style.pointerEvents = 'auto';
            }
        }
        updateGeometry();
    });
}

const textSizeSlider = document.getElementById('text-size');
if (textSizeSlider) {
    textSizeSlider.addEventListener('input', (e) => {
        state.textSize = parseFloat(e.target.value);
        updateGeometry();
    });
}

const textSpacingSlider = document.getElementById('text-spacing');
if (textSpacingSlider) {
    textSpacingSlider.addEventListener('input', (e) => {
        state.textSpacing = parseFloat(e.target.value);
        updateGeometry();
    });
}

const fontSelect = document.getElementById('font-select');
if (fontSelect) {
    fontSelect.addEventListener('change', (e) => {
        state.fontKey = e.target.value;
        loadFont(state.fontKey);
    });
}

const thicknessSlider = document.getElementById('model-thickness');
if (thicknessSlider) {
    thicknessSlider.addEventListener('input', (e) => {
        state.modelThickness = parseFloat(e.target.value);
        const valThick = document.getElementById('val-thickness');
        if (valThick) valThick.textContent = state.modelThickness + 'mm';
        updateGeometry();
    });
}

const fileInput = document.getElementById('input-file');
if (fileInput) {
    fileInput.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (evt) => { state.svgContent = evt.target.result; updateGeometry(); };
        reader.readAsText(file);
    });
}

const svgScaleSlider = document.getElementById('svg-scale');
if (svgScaleSlider) {
    svgScaleSlider.addEventListener('input', (e) => {
        state.svgScale = parseFloat(e.target.value);
        updateGeometry();
    });
}

const baseEnableCheck = document.getElementById('base-enable');
if (baseEnableCheck) {
    baseEnableCheck.addEventListener('change', (e) => {
        state.baseEnabled = e.target.checked;
        const c = document.getElementById('controls-base');
        if (c) {
            c.style.opacity = state.baseEnabled ? '1' : '0.5';
            c.style.pointerEvents = state.baseEnabled ? 'auto' : 'none';
        }
        updateGeometry();
    });
}

['base-padding', 'base-thickness', 'base-radius'].forEach(id => {
    const slider = document.getElementById(id);
    if (slider) {
        slider.addEventListener('input', (e) => {
            const prop = id.replace(/-([a-z])/g, (g) => g[1].toUpperCase()).replace('base', 'base');
            state[prop] = parseFloat(e.target.value);
            updateGeometry();
        });
    }
});

const ringEnableCheck = document.getElementById('ring-enable');
if (ringEnableCheck) {
    ringEnableCheck.addEventListener('change', (e) => {
        state.ringEnabled = e.target.checked;
        const c = document.getElementById('controls-ring');
        if (c) {
            c.style.opacity = state.ringEnabled ? '1' : '0.5';
            c.style.pointerEvents = state.ringEnabled ? 'auto' : 'none';
        }
        updateGeometry();
    });
}

const ringAutoYCheck = document.getElementById('ring-auto-y');
if (ringAutoYCheck) {
    ringAutoYCheck.addEventListener('change', (e) => {
        state.ringAutoY = e.target.checked;
        updateGeometry();
    });
}

// Ring sliders with bidirectional number inputs
['ring-x', 'ring-y', 'ring-size', 'ring-tube', 'ring-rot'].forEach(id => {
    const slider = document.getElementById(id);
    const numInput = document.getElementById('val-' + id);
    const prop = id.replace(/-([a-z])/g, (g) => g[1].toUpperCase());

    if (slider) {
        slider.addEventListener('input', (e) => {
            const val = parseFloat(e.target.value);
            state[prop] = val;
            if (numInput) numInput.value = val;
            updateGeometry();
        });
    }
    if (numInput) {
        numInput.addEventListener('input', (e) => {
            let val = parseFloat(e.target.value);
            if (isNaN(val)) return;
            if (slider) {
                val = Math.min(parseFloat(slider.max), Math.max(parseFloat(slider.min), val));
                slider.value = val;
            }
            state[prop] = val;
            updateGeometry();
        });
    }
});

// ring-shape (select, no number input)
function updateReinforceVisibility() {
    const ctrl = document.getElementById('ctrl-ring-reinforce');
    if (ctrl) ctrl.style.display = parseInt(state.ringShape) === 32 ? 'flex' : 'none';
}
const ringShapeEl = document.getElementById('ring-shape');
if (ringShapeEl) {
    ringShapeEl.addEventListener('input', (e) => {
        state.ringShape = parseFloat(e.target.value);
        updateReinforceVisibility();
        updateGeometry();
    });
}

const ringReinforceCheck = document.getElementById('ring-reinforce');
if (ringReinforceCheck) {
    ringReinforceCheck.addEventListener('change', (e) => {
        state.ringReinforce = e.target.checked;
        updateGeometry();
    });
}

const exportBtn = document.getElementById('btn-export');
if (exportBtn) {
    exportBtn.addEventListener('click', () => {
        exportBtn.disabled = true;
        exportBtn.textContent = 'Processing...';

        // 少し遅延させてUIを更新させてから処理
        setTimeout(() => {
            try {
                const exporter = new STLExporter();

                // ── Layer 2: 全メッシュをワールド座標でマージ → mergeVertices で頂点統合 ──
                rootGroup.updateMatrixWorld(true);

                const geometries = [];
                rootGroup.traverse(obj => {
                    if (!obj.isMesh || !obj.geometry) return;
                    // ジオメトリをクローンしてワールド変換を適用
                    const geo = obj.geometry.clone();
                    geo.applyMatrix4(obj.matrixWorld);
                    geometries.push(geo);
                });

                let exportTarget;
                if (geometries.length > 0) {
                    // 全ジオメトリを1つに統合
                    const merged = mergeGeometries(geometries, false);
                    geometries.forEach(g => g.dispose());

                    if (merged) {
                        // 重複頂点・T字交差を除去（tolerance: 0.1μm）
                        const cleaned = mergeVertices(merged, 1e-4);
                        merged.dispose();
                        cleaned.computeVertexNormals();

                        // 一時メッシュ（マテリアルなし）に入れてエクスポート
                        const tempMesh = new THREE.Mesh(cleaned);
                        exportTarget = tempMesh;
                    }
                }

                // フォールバック: 統合失敗時はそのまま
                if (!exportTarget) exportTarget = rootGroup;

                const result = exporter.parse(exportTarget, { binary: true });
                const blob = new Blob([result], { type: 'application/octet-stream' });
                const link = document.createElement('a');
                link.href = URL.createObjectURL(blob);
                link.download = `keychain_v3.5_${Date.now()}.stl`;
                link.click();
            } catch (err) {
                console.error('Export error:', err);
                alert('エクスポートに失敗しました: ' + err.message);
            } finally {
                exportBtn.disabled = false;
                exportBtn.textContent = 'Export STL';
            }
        }, 50);
    });
}

const mirrorCheck = document.getElementById('mirror-x');
if (mirrorCheck) {
    mirrorCheck.addEventListener('change', (e) => {
        state.mirrorX = e.target.checked;
        updateGeometry();
    });
}

const uiPanel = document.getElementById('ui-panel');
const btnToggle = document.getElementById('toggle-ui');
if (btnToggle && uiPanel) {
    btnToggle.addEventListener('click', () => {
        uiPanel.classList.toggle('collapsed');
        btnToggle.textContent = uiPanel.classList.contains('collapsed') ? 'Show UI' : 'Hide UI';
    });
}

window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
});

function animate() {
    requestAnimationFrame(animate);
    controls.update();
    renderer.render(scene, camera);
}

loadFont('sans');
animate();
