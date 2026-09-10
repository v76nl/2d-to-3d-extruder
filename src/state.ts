export interface StateType {
  mode: "text" | "svg";
  text: string;
  fontKey: string;
  textSize: number;
  textSpacing: number;
  modelThickness: number;
  svgContent: string | null;
  svgScale: number;
  mirrorX: boolean;
  baseEnabled: boolean;
  basePadding: number;
  baseThickness: number;
  baseRadius: number;
  ringEnabled: boolean;
  ringShape: number;
  ringAutoY: boolean;
  ringX: number;
  ringY: number;
  ringSize: number;
  ringTube: number;
  ringRot: number;
  ringReinforce: boolean;
  [key: string]: any;
}

export const state: StateType = {
  mode: "text",
  text: "Xtrudy",
  fontKey: "sans",
  textSize: 10,
  textSpacing: -1,
  modelThickness: 3,
  svgContent: null,
  svgScale: 1.0,
  mirrorX: false,
  baseEnabled: true,
  basePadding: 2,
  baseThickness: 2,
  baseRadius: 5,
  ringEnabled: true,
  ringShape: 32,
  ringAutoY: false,
  ringX: 0,
  ringY: 11.5,
  ringSize: 3,
  ringTube: 1,
  ringRot: 0,
  ringReinforce: true,
};
