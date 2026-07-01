import { app, BrowserWindow, nativeImage } from "electron";
import {
	readFileSync,
	mkdtempSync,
	mkdirSync,
	writeFileSync,
	rmSync,
} from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";

// Source of truth for the brand mark: the imported 2D vector-style mark
// (charcoal fill, transparent background). Everything below is derived from it:
//   - ai-14all-icon.png / .icns : the app / window / dock icon — the mark on a
//     light rounded tile (the OS icon is a single full-bleed tile).
//   - ai-14all-mark-light.png   : a light-fill variant of the mark for dark
//     backgrounds, produced by inverting the mark's greyscale while preserving
//     the gold accent (a raster recolor — see the per-pixel pass below).
// The dark (charcoal) variant used on light backgrounds is the source itself,
// committed as assets/ai-14all-mark-dark.png.
const markDarkPath = new URL(
	"../assets/ai-14all-mark-dark.png",
	import.meta.url,
);
const iconPngPath = new URL("../assets/ai-14all-icon.png", import.meta.url);
const icnsPath = new URL("../assets/ai-14all-icon.icns", import.meta.url);
const markLightPath = new URL(
	"../assets/ai-14all-mark-light.png",
	import.meta.url,
);

const iconOutputs = [
	["icon_16x16.png", 16],
	["icon_16x16@2x.png", 32],
	["icon_32x32.png", 32],
	["icon_32x32@2x.png", 64],
	["icon_128x128.png", 128],
	["icon_128x128@2x.png", 256],
	["icon_256x256.png", 256],
	["icon_256x256@2x.png", 512],
	["icon_512x512.png", 512],
	["icon_512x512@2x.png", 1024],
];

const iconsetDir = join(
	mkdtempSync(join(tmpdir(), "ai14all-iconset-")),
	"icon.iconset",
);
mkdirSync(iconsetDir, { recursive: true });

/**
 * Runs in the headless renderer. Loads the mark, then returns two PNG data URLs:
 *  - `icon`: 1024² app icon = light rounded tile + the mark centered.
 *  - `mark`: 1024² transparent light-fill mark (greyscale inverted, gold kept).
 */
function buildRenderScript(markDataUrl) {
	return `(async () => {
		const S = 1024;
		const img = new Image();
		img.src = "${markDataUrl}";
		await img.decode();

		function roundedRect(ctx, x, y, w, h, r) {
			ctx.beginPath();
			ctx.moveTo(x + r, y);
			ctx.arcTo(x + w, y, x + w, y + h, r);
			ctx.arcTo(x + w, y + h, x, y + h, r);
			ctx.arcTo(x, y + h, x, y, r);
			ctx.arcTo(x, y, x + w, y, r);
			ctx.closePath();
		}

		// --- App icon: mark on a light rounded tile ---
		const a = document.createElement("canvas");
		a.width = S;
		a.height = S;
		const ac = a.getContext("2d");
		const bg = ac.createLinearGradient(80, 64, 900, 940);
		bg.addColorStop(0, "#fafcfe");
		bg.addColorStop(1, "#edf3f7");
		roundedRect(ac, 80, 80, 864, 864, 168);
		ac.fillStyle = bg;
		ac.fill();
		ac.lineWidth = 16;
		ac.strokeStyle = "#b7c4cf";
		ac.stroke();
		// Center the mark inside the tile with breathing room.
		const box = 620;
		const off = (S - box) / 2;
		ac.drawImage(img, off, off, box, box);

		// --- Light-fill mark variant (for dark backgrounds) ---
		const m = document.createElement("canvas");
		m.width = S;
		m.height = S;
		const mc = m.getContext("2d");
		mc.drawImage(img, 0, 0, S, S);
		const id = mc.getImageData(0, 0, S, S);
		const d = id.data;
		for (let i = 0; i < d.length; i += 4) {
			const r = d[i];
			const g = d[i + 1];
			const b = d[i + 2];
			if (d[i + 3] < 8) continue; // transparent — leave it
			// Preserve the warm gold accent; invert everything greyscale so the
			// charcoal facets go light and the light separator lines go dark.
			const isGold = r > 150 && g > 110 && g < 215 && b < 140 && r - b > 45;
			if (isGold) continue;
			const v = 255 - ((r + g + b) / 3) | 0;
			d[i] = d[i + 1] = d[i + 2] = v;
		}
		mc.putImageData(id, 0, 0);

		return { icon: a.toDataURL("image/png"), mark: m.toDataURL("image/png") };
	})()`;
}

function pngFromDataUrl(dataUrl) {
	return Buffer.from(dataUrl.split(",")[1], "base64");
}

app.whenReady().then(async () => {
	let browserWindow;
	try {
		browserWindow = new BrowserWindow({
			width: 1024,
			height: 1024,
			show: false,
			frame: false,
			transparent: true,
			backgroundColor: "#00000000",
			webPreferences: { backgroundThrottling: false },
		});
		await browserWindow.loadURL(
			"data:text/html;charset=utf-8," +
				encodeURIComponent("<!doctype html><meta charset=utf-8><body></body>"),
		);

		const markDataUrl =
			"data:image/png;base64," + readFileSync(markDarkPath).toString("base64");
		const result = await browserWindow.webContents.executeJavaScript(
			buildRenderScript(markDataUrl),
		);

		const iconImage = nativeImage.createFromBuffer(pngFromDataUrl(result.icon));
		for (const [filename, size] of iconOutputs) {
			writeFileSync(
				join(iconsetDir, filename),
				iconImage.resize({ width: size, height: size }).toPNG(),
			);
		}
		writeFileSync(iconPngPath, readFileSync(join(iconsetDir, "icon_512x512.png")));
		execFileSync(
			"/usr/bin/iconutil",
			["-c", "icns", iconsetDir, "-o", icnsPath.pathname],
			{ stdio: "ignore" },
		);

		// Light-fill mark variant at 512² (favicon / splash / dark-bg use).
		const markLight = nativeImage
			.createFromBuffer(pngFromDataUrl(result.mark))
			.resize({ width: 512, height: 512 });
		writeFileSync(markLightPath, markLight.toPNG());

		browserWindow.destroy();
		console.log(
			`Generated icons + mark variants in ${new URL("../assets/", import.meta.url).pathname}`,
		);
		app.quit();
	} catch (error) {
		console.error(error);
		if (browserWindow) browserWindow.destroy();
		app.exit(1);
	} finally {
		rmSync(iconsetDir, { recursive: true, force: true });
	}
});
