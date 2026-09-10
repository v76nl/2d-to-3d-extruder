import * as THREE from "three";
import { exportSTL } from "./export.ts";
import { type FontKey, loadFont } from "./fonts.ts";
import { updateGeometry } from "./geometry.ts";
import { camera, renderer, rootGroup } from "./scene.ts";
import { state } from "./state.ts";

export function updateDimensionsInfo(): void {
  rootGroup.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(rootGroup);
  const dimInfo = document.getElementById("dimensions-info");
  if (!dimInfo) return;
  if (box.isEmpty()) {
    dimInfo.innerHTML = "W: 0 mm<br>H: 0 mm<br>D: 0 mm";
    return;
  }
  const w = (box.max.x - box.min.x).toFixed(1);
  const h = (box.max.y - box.min.y).toFixed(1);
  const d = (box.max.z - box.min.z).toFixed(1);
  dimInfo.innerHTML = `W: ${w} mm<br>H: ${h} mm<br>D: ${d} mm`;
}

export function showLoading(show: boolean): void {
  const loading = document.getElementById("loading");
  if (loading) loading.style.display = show ? "block" : "none";
}

export function updateReinforceVisibility(): void {
  const ctrl = document.getElementById("ctrl-ring-reinforce");
  const shape =
    typeof state.ringShape === "string"
      ? Number.parseInt(state.ringShape, 10)
      : state.ringShape;
  if (ctrl) ctrl.style.display = shape === 32 ? "flex" : "none";
}

export function initEvents(): void {
  const btnText = document.getElementById("mode-text");
  const btnSvg = document.getElementById("mode-svg");

  function setMode(m: "text" | "svg") {
    const btnText = document.getElementById("mode-text");
    const btnSvg = document.getElementById("mode-svg");
    state.mode = m;
    if (m === "text") {
      if (btnText)
        btnText.className =
          "flex-1 py-1 px-2 btn-mode-active rounded text-sm transition";
      if (btnSvg)
        btnSvg.className =
          "flex-1 py-1 px-2 btn-mode-inactive rounded text-sm transition";
      const ctrlText = document.getElementById("controls-text");
      if (ctrlText) ctrlText.style.display = "block";
      const ctrlSvg = document.getElementById("controls-svg");
      if (ctrlSvg) ctrlSvg.style.display = "none";
    } else {
      if (btnSvg)
        btnSvg.className =
          "flex-1 py-1 px-2 btn-mode-active rounded text-sm transition";
      if (btnText)
        btnText.className =
          "flex-1 py-1 px-2 btn-mode-inactive rounded text-sm transition";
      const ctrlText = document.getElementById("controls-text");
      if (ctrlText) ctrlText.style.display = "none";
      const ctrlSvg = document.getElementById("controls-svg");
      if (ctrlSvg) ctrlSvg.style.display = "block";
    }
    updateGeometry();
  }

  if (btnText) btnText.onclick = () => setMode("text");
  if (btnSvg) btnSvg.onclick = () => setMode("svg");
  setMode(state.mode);

  const inputText = document.getElementById(
    "input-text",
  ) as HTMLInputElement | null;
  if (inputText) {
    inputText.addEventListener("input", () => {
      const val = inputText.value;
      state.text = val;
      if (val.length > 1 && !state.baseEnabled) {
        state.baseEnabled = true;
        const baseEnable = document.getElementById(
          "base-enable",
        ) as HTMLInputElement | null;
        if (baseEnable) baseEnable.checked = true;
        const c = document.getElementById("controls-base");
        if (c) {
          c.style.opacity = "1";
          c.style.pointerEvents = "auto";
        }
      }
      updateGeometry();
    });
  }

  const textSizeSlider = document.getElementById(
    "text-size",
  ) as HTMLInputElement | null;
  if (textSizeSlider) {
    textSizeSlider.addEventListener("input", () => {
      state.textSize = Number.parseFloat(textSizeSlider.value);
      updateGeometry();
    });
  }

  const textSpacingSlider = document.getElementById(
    "text-spacing",
  ) as HTMLInputElement | null;
  if (textSpacingSlider) {
    textSpacingSlider.addEventListener("input", () => {
      state.textSpacing = Number.parseFloat(textSpacingSlider.value);
      updateGeometry();
    });
  }

  const fontSelect = document.getElementById(
    "font-select",
  ) as HTMLSelectElement | null;
  if (fontSelect) {
    fontSelect.addEventListener("change", () => {
      state.fontKey = fontSelect.value;
      loadFont(state.fontKey as FontKey);
    });
  }

  const thicknessSlider = document.getElementById(
    "model-thickness",
  ) as HTMLInputElement | null;
  if (thicknessSlider) {
    thicknessSlider.addEventListener("input", () => {
      state.modelThickness = Number.parseFloat(thicknessSlider.value);
      const valThick = document.getElementById("val-thickness");
      if (valThick) valThick.textContent = state.modelThickness + "mm";
      updateGeometry();
    });
  }

  const fileInput = document.getElementById(
    "input-file",
  ) as HTMLInputElement | null;
  if (fileInput) {
    fileInput.addEventListener("change", () => {
      const files = fileInput.files;
      if (!files || files.length === 0) return;
      const file = files[0];
      const reader = new FileReader();
      reader.onload = (evt) => {
        if (evt.target && typeof evt.target.result === "string") {
          state.svgContent = evt.target.result;
          updateGeometry();
        }
      };
      reader.readAsText(file);
    });
  }

  const svgScaleSlider = document.getElementById(
    "svg-scale",
  ) as HTMLInputElement | null;
  if (svgScaleSlider) {
    svgScaleSlider.addEventListener("input", () => {
      state.svgScale = Number.parseFloat(svgScaleSlider.value);
      updateGeometry();
    });
  }

  const baseEnableCheck = document.getElementById(
    "base-enable",
  ) as HTMLInputElement | null;
  if (baseEnableCheck) {
    baseEnableCheck.addEventListener("change", () => {
      state.baseEnabled = baseEnableCheck.checked;
      const c = document.getElementById("controls-base");
      if (c) {
        c.style.opacity = state.baseEnabled ? "1" : "0.5";
        c.style.pointerEvents = state.baseEnabled ? "auto" : "none";
      }
      updateGeometry();
    });
  }

  ["base-padding", "base-thickness", "base-radius"].forEach((id) => {
    const slider = document.getElementById(id) as HTMLInputElement | null;
    if (slider) {
      slider.addEventListener("input", () => {
        const prop = id.replace(/-([a-z])/g, (_g, letter) =>
          letter.toUpperCase(),
        );
        state[prop] = Number.parseFloat(slider.value);
        updateGeometry();
      });
    }
  });

  const ringEnableCheck = document.getElementById(
    "ring-enable",
  ) as HTMLInputElement | null;
  if (ringEnableCheck) {
    ringEnableCheck.addEventListener("change", () => {
      state.ringEnabled = ringEnableCheck.checked;
      const c = document.getElementById("controls-ring");
      if (c) {
        c.style.opacity = state.ringEnabled ? "1" : "0.5";
        c.style.pointerEvents = state.ringEnabled ? "auto" : "none";
      }
      updateGeometry();
    });
  }

  const ringAutoYCheck = document.getElementById(
    "ring-auto-y",
  ) as HTMLInputElement | null;
  if (ringAutoYCheck) {
    ringAutoYCheck.addEventListener("change", () => {
      state.ringAutoY = ringAutoYCheck.checked;
      updateGeometry();
    });
  }

  // リングスライダー: range と number 入力を双方向でバインドする
  ["ring-x", "ring-y", "ring-size", "ring-tube", "ring-rot"].forEach(
    (id) => {
      const slider = document.getElementById(
        id,
      ) as HTMLInputElement | null;
      const numInput = document.getElementById(
        "val-" + id,
      ) as HTMLInputElement | null;
      const prop = id.replace(/-([a-z])/g, (_g, letter) =>
        letter.toUpperCase(),
      );

      if (slider) {
        slider.addEventListener("input", () => {
          const val = Number.parseFloat(slider.value);
          state[prop] = val;
          if (numInput) numInput.value = String(val);
          updateGeometry();
        });
      }
      if (numInput) {
        numInput.addEventListener("input", () => {
          let val = Number.parseFloat(numInput.value);
          if (Number.isNaN(val)) return;
          if (slider) {
            val = Math.min(
              Number.parseFloat(slider.max),
              Math.max(Number.parseFloat(slider.min), val),
            );
            slider.value = String(val);
          }
          state[prop] = val;
          updateGeometry();
        });
      }
    },
  );

  const ringShapeEl = document.getElementById(
    "ring-shape",
  ) as HTMLSelectElement | null;
  if (ringShapeEl) {
    ringShapeEl.addEventListener("input", () => {
      state.ringShape = Number.parseFloat(ringShapeEl.value);
      updateReinforceVisibility();
      updateGeometry();
    });
  }

  const ringReinforceCheck = document.getElementById(
    "ring-reinforce",
  ) as HTMLInputElement | null;
  if (ringReinforceCheck) {
    ringReinforceCheck.addEventListener("change", () => {
      state.ringReinforce = ringReinforceCheck.checked;
      updateGeometry();
    });
  }

  const exportBtn = document.getElementById(
    "btn-export",
  ) as HTMLButtonElement | null;
  if (exportBtn) {
    exportBtn.addEventListener("click", () => {
      exportSTL(exportBtn);
    });
  }

  const mirrorCheck = document.getElementById(
    "mirror-x",
  ) as HTMLInputElement | null;
  if (mirrorCheck) {
    mirrorCheck.addEventListener("change", () => {
      state.mirrorX = mirrorCheck.checked;
      updateGeometry();
    });
  }

  const uiPanel = document.getElementById("ui-panel");
  const btnToggle = document.getElementById("toggle-ui");
  if (btnToggle && uiPanel) {
    btnToggle.addEventListener("click", () => {
      uiPanel.classList.toggle("collapsed");
      btnToggle.textContent = uiPanel.classList.contains("collapsed")
        ? "UIを表示"
        : "UIを隠す";
    });
  }

  window.addEventListener("resize", () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });
}

// UI 初期化: state -> DOM への一方向同期
// 初期値は state オブジェクトのみで管理し、HTML 側には value/checked 属性を書かない
export function initUIFromState(): void {
  const set = (id: string, val: any) => {
    const el = document.getElementById(id) as HTMLInputElement | null;
    if (el) el.value = String(val);
  };
  const check = (id: string, val: boolean) => {
    const el = document.getElementById(id) as HTMLInputElement | null;
    if (el) el.checked = val;
  };
  const enable = (id: string, on: boolean) => {
    const el = document.getElementById(id) as HTMLInputElement | null;
    if (!el) return;
    el.disabled = !on;
    el.style.opacity = on ? "1" : "0.5";
  };
  const panelOpacity = (id: string, on: boolean) => {
    const el = document.getElementById(id) as HTMLElement | null;
    if (!el) return;
    el.style.opacity = on ? "1" : "0.5";
    el.style.pointerEvents = on ? "auto" : "none";
  };

  // テキスト
  set("input-text", state.text);
  set("font-select", state.fontKey);
  set("text-size", state.textSize);
  set("text-spacing", state.textSpacing);
  set("svg-scale", state.svgScale);
  set("model-thickness", state.modelThickness);
  check("mirror-x", state.mirrorX);
  const valThick = document.getElementById("val-thickness");
  if (valThick) valThick.textContent = state.modelThickness + "mm";

  // 土台
  check("base-enable", state.baseEnabled);
  panelOpacity("controls-base", state.baseEnabled);
  set("base-padding", state.basePadding);
  set("base-thickness", state.baseThickness);
  set("base-radius", state.baseRadius);

  // ストラップリング
  check("ring-enable", state.ringEnabled);
  set("ring-shape", state.ringShape);
  check("ring-reinforce", state.ringReinforce);
  check("ring-auto-y", state.ringAutoY);

  const ringProps: [string, string, string][] = [
    ["ring-x", "val-ring-x", "ringX"],
    ["ring-y", "val-ring-y", "ringY"],
    ["ring-size", "val-ring-size", "ringSize"],
    ["ring-tube", "val-ring-tube", "ringTube"],
    ["ring-rot", "val-ring-rot", "ringRot"],
  ];
  ringProps.forEach(([sid, nid, prop]) => {
    set(sid, state[prop]);
    set(nid, state[prop]);
  });

  // Auto Top Align 時は ring-y を無効化
  enable("ring-y", !state.ringAutoY);
  enable("val-ring-y", !state.ringAutoY);

  // 補強板の表示制御
  updateReinforceVisibility();
}
