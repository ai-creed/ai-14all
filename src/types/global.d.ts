import type { OneForAllDesktopApi } from "../../shared/contracts/commands";

declare global {
  interface Window {
    oneforall: OneForAllDesktopApi;
  }
}

export {};
