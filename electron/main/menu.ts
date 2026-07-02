import { BrowserWindow, Menu, type MenuItemConstructorOptions } from "electron";

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

	const template: MenuItemConstructorOptions[] =
		process.platform === "darwin"
			? [
					{ role: "appMenu" },
					workspaceMenu,
					terminalMenu,
					{ role: "editMenu" },
					{ role: "viewMenu" },
					{ role: "windowMenu" },
					{ role: "help" },
				]
			: [
					workspaceMenu,
					terminalMenu,
					{ role: "editMenu" },
					{ role: "viewMenu" },
					{ role: "help" },
				];

	return Menu.buildFromTemplate(template);
}
