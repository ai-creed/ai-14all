/**
 * Test stub for the `electron` module.
 *
 * Unit tests run under plain Node (vitest), not inside an Electron runtime, so
 * importing the real `electron` package executes its `index.js`, which throws
 * "Electron failed to install correctly" whenever the downloaded binary path
 * can't be resolved (e.g. CI on Node 24). Unit tests should never depend on the
 * Electron binary — they either inject fakes (the mcp bridges) or exercise pure
 * logic (open-external). This stub is aliased in via `vitest.config.ts` so every
 * `import … from "electron"` resolves here instead of the real package. Tests
 * that need to assert on Electron APIs still provide their own per-file
 * `vi.mock("electron", …)`, which overrides this alias.
 */

const noop = (): void => {};
const asyncNoop = async (): Promise<void> => {};

export const app = {
	getPath: () => "/tmp/test-home",
	getAppPath: () => "/tmp/app-resources",
	getName: () => "ai-14all",
	getVersion: () => "0.0.0-test",
	on: noop,
	once: noop,
	off: noop,
	whenReady: async () => {},
	quit: noop,
	exit: noop,
	focus: noop,
	requestSingleInstanceLock: () => true,
	setAsDefaultProtocolClient: () => true,
	removeAsDefaultProtocolClient: () => true,
	setName: noop,
	commandLine: { appendSwitch: noop },
};

export class BrowserWindow {
	static getAllWindows = () => [] as BrowserWindow[];
	static fromWebContents = () => null;
	static fromId = () => null;
	webContents = {
		send: noop,
		on: noop,
		once: noop,
		openDevTools: noop,
		setWindowOpenHandler: noop,
	};
	on = noop;
	once = noop;
	loadURL = asyncNoop;
	loadFile = asyncNoop;
	show = noop;
	hide = noop;
	focus = noop;
	close = noop;
	destroy = noop;
	isDestroyed = () => false;
}

export const Menu = {
	buildFromTemplate: () => ({ popup: noop }),
	setApplicationMenu: noop,
	getApplicationMenu: () => null,
};

export class MenuItem {}

export const dialog = {
	showOpenDialog: async () => ({ canceled: true, filePaths: [] as string[] }),
	showSaveDialog: async () => ({ canceled: true, filePath: undefined }),
	showMessageBox: async () => ({ response: 0 }),
	showErrorBox: noop,
};

export const ipcMain = {
	handle: noop,
	handleOnce: noop,
	removeHandler: noop,
	on: noop,
	once: noop,
	off: noop,
	removeAllListeners: noop,
};

export const ipcRenderer = {
	invoke: async () => undefined,
	send: noop,
	sendSync: () => undefined,
	on: noop,
	once: noop,
	off: noop,
	removeListener: noop,
	removeAllListeners: noop,
};

export const contextBridge = {
	exposeInMainWorld: noop,
	exposeInIsolatedWorld: noop,
};

export const webUtils = {
	getPathForFile: () => "",
};

export const shell = {
	openExternal: asyncNoop,
	openPath: async () => "",
	showItemInFolder: noop,
	trashItem: asyncNoop,
	beep: noop,
};

export const utilityProcess = {
	fork: () => ({
		on: noop,
		once: noop,
		postMessage: noop,
		kill: () => true,
		pid: 0,
	}),
};

export const nativeImage = {
	createFromPath: () => ({ isEmpty: () => true, toDataURL: () => "" }),
	createFromDataURL: () => ({ isEmpty: () => true, toDataURL: () => "" }),
	createEmpty: () => ({ isEmpty: () => true, toDataURL: () => "" }),
};

export const nativeTheme = {
	shouldUseDarkColors: false,
	on: noop,
	themeSource: "system",
};

export const session = {
	defaultSession: { webRequest: { onBeforeRequest: noop } },
	fromPartition: () => ({ webRequest: { onBeforeRequest: noop } }),
};

export class Tray {
	on = noop;
	setToolTip = noop;
	setContextMenu = noop;
	destroy = noop;
}

export class Notification {
	on = noop;
	show = noop;
	close = noop;
	static isSupported = () => false;
}

export const screen = {
	getPrimaryDisplay: () => ({ workAreaSize: { width: 1920, height: 1080 } }),
	getAllDisplays: () => [],
	on: noop,
};

export const clipboard = {
	readText: () => "",
	writeText: noop,
};

export const globalShortcut = {
	register: () => true,
	unregister: noop,
	unregisterAll: noop,
};

export const protocol = {
	registerSchemesAsPrivileged: noop,
	handle: noop,
	registerFileProtocol: noop,
};

const electron = {
	app,
	BrowserWindow,
	Menu,
	MenuItem,
	dialog,
	ipcMain,
	ipcRenderer,
	contextBridge,
	webUtils,
	shell,
	utilityProcess,
	nativeImage,
	nativeTheme,
	session,
	Tray,
	Notification,
	screen,
	clipboard,
	globalShortcut,
	protocol,
};

export default electron;
