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

const pngPath = new URL("../assets/ai-14all-icon.png", import.meta.url);
const icnsPath = new URL("../assets/ai-14all-icon.icns", import.meta.url);

const outputs = [
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

const renderHtml = `<!doctype html>
<html>
	<head>
		<style>
			html, body {
				margin: 0;
				background: transparent;
				overflow: hidden;
			}
		</style>
	</head>
	<body>
		<canvas id="icon" width="1024" height="1024"></canvas>
		<script>
			const canvas = document.getElementById("icon");
			const ctx = canvas.getContext("2d");

			function roundedRect(x, y, w, h, r, fill, stroke, lineWidth = 4) {
				ctx.beginPath();
				ctx.moveTo(x + r, y);
				ctx.arcTo(x + w, y, x + w, y + h, r);
				ctx.arcTo(x + w, y + h, x, y + h, r);
				ctx.arcTo(x, y + h, x, y, r);
				ctx.arcTo(x, y, x + w, y, r);
				ctx.closePath();
				if (fill) {
					ctx.fillStyle = fill;
					ctx.fill();
				}
				if (stroke) {
					ctx.lineWidth = lineWidth;
					ctx.strokeStyle = stroke;
					ctx.stroke();
				}
			}

			const scale = 768 / 864;
			const offset = 128 - (80 * scale);
			ctx.clearRect(0, 0, 1024, 1024);
			ctx.save();
			ctx.translate(offset, offset);
			ctx.scale(scale, scale);

			const bg = ctx.createLinearGradient(80, 64, 900, 940);
			bg.addColorStop(0, "#fafcfe");
			bg.addColorStop(1, "#edf3f7");
			roundedRect(80, 80, 864, 864, 168, bg, "#b7c4cf", 16);

			ctx.strokeStyle = "#67d4b0";
			ctx.lineWidth = 28;
			ctx.lineCap = "round";
			ctx.beginPath();
			ctx.moveTo(512, 166);
			ctx.lineTo(512, 244);
			ctx.moveTo(512, 166);
			ctx.lineTo(438, 206);
			ctx.moveTo(512, 166);
			ctx.lineTo(586, 206);
			ctx.moveTo(438, 206);
			ctx.lineTo(438, 300);
			ctx.moveTo(586, 206);
			ctx.lineTo(586, 300);
			ctx.stroke();

			ctx.fillStyle = "#67d4b0";
			ctx.beginPath();
			ctx.arc(438, 320, 26, 0, Math.PI * 2);
			ctx.arc(586, 320, 26, 0, Math.PI * 2);
			ctx.fill();
			ctx.fillStyle = "#f0c37a";
			ctx.beginPath();
			ctx.arc(512, 258, 26, 0, Math.PI * 2);
			ctx.fill();

			const shell = ctx.createLinearGradient(280, 240, 744, 768);
			shell.addColorStop(0, "#18242d");
			shell.addColorStop(1, "#0e171d");
			ctx.beginPath();
			ctx.moveTo(512, 288);
			ctx.bezierCurveTo(680, 288, 780, 398, 780, 540);
			ctx.bezierCurveTo(780, 644, 716, 738, 624, 786);
			ctx.lineTo(592, 878);
			ctx.lineTo(512, 812);
			ctx.lineTo(432, 878);
			ctx.lineTo(400, 786);
			ctx.bezierCurveTo(308, 738, 244, 644, 244, 540);
			ctx.bezierCurveTo(244, 398, 344, 288, 512, 288);
			ctx.closePath();
			ctx.fillStyle = shell;
			ctx.fill();
			ctx.lineWidth = 16;
			ctx.strokeStyle = "#3b4f5c";
			ctx.stroke();

			const visor = ctx.createLinearGradient(300, 368, 724, 688);
			visor.addColorStop(0, "#1f3a38");
			visor.addColorStop(1, "#0f1f20");
			roundedRect(324, 378, 376, 322, 68, visor, "#345767", 16);

			ctx.fillStyle = "#eef7fa";
			ctx.beginPath();
			ctx.moveTo(378, 482);
			ctx.lineTo(456, 446);
			ctx.lineTo(440, 548);
			ctx.lineTo(362, 578);
			ctx.closePath();
			ctx.fill();

			ctx.beginPath();
			ctx.moveTo(628, 450);
			ctx.bezierCurveTo(676, 450, 724, 486, 724, 540);
			ctx.bezierCurveTo(724, 604, 672, 650, 594, 650);
			ctx.lineTo(572, 650);
			ctx.bezierCurveTo(580, 540, 592, 450, 628, 450);
			ctx.closePath();
			ctx.fill();

			ctx.fillStyle = "#0b1116";
			ctx.beginPath();
			ctx.arc(616, 510, 18, 0, Math.PI * 2);
			ctx.fill();

			ctx.strokeStyle = "#67d4b0";
			ctx.lineWidth = 30;
			ctx.beginPath();
			ctx.moveTo(390, 678);
			ctx.quadraticCurveTo(512, 764, 634, 678);
			ctx.stroke();

			ctx.strokeStyle = "#f0c37a";
			ctx.lineWidth = 20;
			ctx.beginPath();
			ctx.moveTo(426, 682);
			ctx.lineTo(470, 646);
			ctx.moveTo(570, 682);
			ctx.lineTo(626, 682);
			ctx.stroke();

			ctx.fillStyle = "#f0c37a";
			ctx.beginPath();
			ctx.moveTo(260, 410);
			ctx.lineTo(226, 394);
			ctx.lineTo(248, 364);
			ctx.lineTo(238, 326);
			ctx.lineTo(272, 342);
			ctx.lineTo(302, 320);
			ctx.lineTo(300, 360);
			ctx.lineTo(330, 384);
			ctx.lineTo(292, 394);
			ctx.lineTo(278, 428);
			ctx.closePath();
			ctx.fill();

			ctx.fillStyle = "#67d4b0";
			ctx.beginPath();
			ctx.moveTo(744, 742);
			ctx.lineTo(770, 754);
			ctx.lineTo(754, 778);
			ctx.lineTo(762, 808);
			ctx.lineTo(736, 794);
			ctx.lineTo(714, 814);
			ctx.lineTo(718, 784);
			ctx.lineTo(694, 766);
			ctx.lineTo(724, 754);
			ctx.lineTo(734, 724);
			ctx.closePath();
			ctx.fill();
			ctx.restore();
		</script>
	</body>
</html>`;

app.whenReady().then(async () => {
	try {
		const browserWindow = new BrowserWindow({
			width: 1024,
			height: 1024,
			show: false,
			frame: false,
			transparent: true,
			backgroundColor: "#00000000",
			webPreferences: {
				backgroundThrottling: false,
			},
		});

		await browserWindow.loadURL(
			`data:text/html;charset=utf-8,${encodeURIComponent(renderHtml)}`,
		);
		const captured = await browserWindow.webContents.capturePage();
		const baseImage = nativeImage.createFromBuffer(captured.toPNG());
		browserWindow.destroy();

		for (const [filename, size] of outputs) {
			writeFileSync(
				join(iconsetDir, filename),
				baseImage.resize({ width: size, height: size }).toPNG(),
			);
		}

		writeFileSync(pngPath, readFileSync(join(iconsetDir, "icon_512x512.png")));

		execFileSync(
			"/usr/bin/iconutil",
			["-c", "icns", iconsetDir, "-o", icnsPath.pathname],
			{
				stdio: "ignore",
			},
		);

		console.log(
			`Generated icons in ${new URL("../assets/", import.meta.url).pathname}`,
		);
		app.quit();
	} catch (error) {
		console.error(error);
		app.exit(1);
	} finally {
		rmSync(iconsetDir, { recursive: true, force: true });
	}
});
