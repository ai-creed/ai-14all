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
		submenu: (["system", "light", "dark", "warm"] as const).map((mode) => ({
			label: {
				system: "System",
				light: "Light",
				dark: "Dark",
				warm: "Warm",
			}[mode],
			click: () => sendToRenderer("theme/set", mode),
		})),
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

	const template: MenuItemConstructorOptions[] =
		process.platform === "darwin"
			? [
					{ role: "appMenu" },
					workspaceMenu,
					{ role: "editMenu" },
					{ role: "viewMenu" },
					{ role: "windowMenu" },
					{ role: "help" },
				]
			: [
					workspaceMenu,
					{ role: "editMenu" },
					{ role: "viewMenu" },
					{ role: "help" },
				];

	return Menu.buildFromTemplate(template);
}
