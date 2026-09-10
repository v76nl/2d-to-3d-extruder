import { updateGeometry } from "./geometry.ts";
import { showLoading } from "./ui.ts";

declare const opentype: {
  load(url: string, callback: (err: any, font: any) => void): void;
};

// フォントキー -> CDN上の woff ファイル URL
export const FONT_URLS = {
  sans: "https://cdn.jsdelivr.net/npm/@fontsource/noto-sans-jp@5/files/noto-sans-jp-japanese-700-normal.woff",
  serif:
    "https://cdn.jsdelivr.net/npm/@fontsource/noto-serif-jp@5/files/noto-serif-jp-japanese-700-normal.woff",
  dot: "https://cdn.jsdelivr.net/npm/@fontsource/dotgothic16@5/files/dotgothic16-japanese-400-normal.woff",
  ramp: "https://cdn.jsdelivr.net/npm/@fontsource/rampart-one@5/files/rampart-one-japanese-400-normal.woff",
} as const;

export type FontKey = keyof typeof FONT_URLS;

export let currentFont: any = null;

export function loadFont(key: FontKey): void {
  const url = FONT_URLS[key];
  if (!url) return;
  showLoading(true);
  opentype.load(url, (err, font) => {
    if (err) {
      console.error(err);
      showLoading(false);
    } else {
      currentFont = font;
      updateGeometry();
      showLoading(false);
    }
  });
}
