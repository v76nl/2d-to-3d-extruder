import { loadFont } from "./fonts.ts";
import { animate } from "./scene.ts";
import { initEvents, initUIFromState } from "./ui.ts";

if (import.meta.env.DEV) {
  document.title = `[DEV] ${document.title}`;
}

initUIFromState();
initEvents();
loadFont("sans");
animate();
