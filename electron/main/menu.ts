import { BrowserWindow, Menu, type MenuItemConstructorOptions } from "electron";

export function buildApplicationMenu(mainWindow: BrowserWindow): Menu {
	const workspaceMenu: MenuItemConstructorOptions = {
		label: "Workspace",
		submenu: [
			{
				label: "Open Workspace...",
				accelerator: "CmdOrCtrl+O",
				click: () => {
					if (mainWindow.isDestroyed() || mainWindow.webContents.isDestroyed()) {
						return;
					}
					mainWindow.webContents.send("workspace/openPicker");
				},
			},
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
			: [workspaceMenu, { role: "editMenu" }, { role: "viewMenu" }, { role: "help" }];

	return Menu.buildFromTemplate(template);
}
