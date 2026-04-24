import { readFileSync, writeFileSync } from "node:fs";
import { rewriteManifest } from "../shared/update/rewriteManifest.js";

function main(): void {
	const [, , input, output, version] = process.argv;
	if (!input || !output || !version) {
		console.error(
			"usage: tsx scripts/rewrite-manifest.ts <input-yml> <output-yml> <version>",
		);
		process.exit(2);
	}
	const raw = readFileSync(input, "utf8");
	const rewritten = rewriteManifest(raw, version);
	writeFileSync(output, rewritten);
	process.stdout.write(`wrote ${output}\n`);
}

main();
