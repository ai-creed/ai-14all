import { contextBridge } from "electron";

contextBridge.exposeInMainWorld("oneforall", {});
