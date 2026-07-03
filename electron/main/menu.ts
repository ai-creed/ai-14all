import { BrowserWindow, Menu, type MenuItemConstructorOptions } from "electron";
import { buildHelpSubmenu } from "./help-menu";

export function buildApplicationMenu(mainWindow: BrowserWindow): Menu {
	const sendToRenderer = (channel: string, ...args: unknown[]) => {
		if (mainWindow.isDestroyed() || mainWindow.webContents.isDestroyed()) {
			return;
		}
		mainWindow.webContents.send(channel, ...args);
	};

	const themeMenu: MenuItemConstructorOptions = {
		label: "Theme",
		submenu: (["system", "light", "dark", "warm", "tui"] as const).map(
			(mode) => ({
				label: {
					system: "System",
					light: "Light",
					dark: "Dark",
					warm: "Warm",
					tui: "Terminal UI",
				}[mode],
				click: () => sendToRenderer("theme/set", mode),
			}),
		),
	};

	const workspaceMenu: MenuItemConstructorOptions = {
		label: "Workspace",
		submenu: [
			{
				label: "Open Workspace...",
				accelerator: "CmdOrCtrl+O",
				click: () => sendToRenderer("workspace/openPicker"),
			},
			{
				label: "Install agent integration…",
				click: () => sendToRenderer("review:openInstallModal"),
			},
			{ type: "separator" },
			themeMenu,
		],
	};

	const terminalMenu: MenuItemConstructorOptions = {
		label: "Terminal",
		submenu: [
			{
				id: "terminal-font-increase",
				label: "Increase Font Size",
				accelerator: "CmdOrCtrl+Plus",
				click: () => sendToRenderer("terminal/fontSize", "increase"),
			},
			{
				// Bind the unshifted "=" key too (the physical "+" key). Hidden so
				// the submenu shows one visible "Increase" item.
				id: "terminal-font-increase-eq",
				label: "Increase Font Size",
				accelerator: "CmdOrCtrl+=",
				visible: false,
				acceleratorWorksWhenHidden: true,
				click: () => sendToRenderer("terminal/fontSize", "increase"),
			},
			{
				id: "terminal-font-decrease",
				label: "Decrease Font Size",
				accelerator: "CmdOrCtrl+-",
				click: () => sendToRenderer("terminal/fontSize", "decrease"),
			},
			{
				id: "terminal-font-reset",
				label: "Reset Font Size",
				accelerator: "CmdOrCtrl+0",
				click: () => sendToRenderer("terminal/fontSize", "reset"),
			},
		],
	};

	// Custom View submenu that OMITS the default zoomIn/zoomOut/resetZoom items.
	// Those roles register CmdOrCtrl+Plus / +- / +0 for webContents zoom, which
	// would collide with the Terminal font-size accelerators above (and app-level
	// zoom is not meaningful here — terminal font size is this app's "zoom").
	const viewMenu: MenuItemConstructorOptions = {
		label: "View",
		submenu: [
			{ role: "reload" },
			{ role: "forceReload" },
			{ role: "toggleDevTools" },
			{ type: "separator" },
			{ role: "togglefullscreen" },
		],
	};

	const helpMenu = buildHelpSubmenu((channel) => sendToRenderer(channel));

	const template: MenuItemConstructorOptions[] =
		process.platform === "darwin"
			? [
					{ role: "appMenu" },
					workspaceMenu,
					terminalMenu,
					{ role: "editMenu" },
					viewMenu,
					{ role: "windowMenu" },
					helpMenu,
				]
			: [workspaceMenu, terminalMenu, { role: "editMenu" }, viewMenu, helpMenu];

	return Menu.buildFromTemplate(template);
}
