import { chmodSync as defaultChmodSync, existsSync as defaultExistsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

function defaultResolvePackageJson() {
  const require = createRequire(import.meta.url);
  return require.resolve("node-pty/package.json");
}

export function getNodePtySpawnHelperPath({
  platform = process.platform,
  arch = process.arch,
  resolvePackageJson = defaultResolvePackageJson,
} = {}) {
  if (platform !== "darwin") {
    return null;
  }

  const packageJsonPath = resolvePackageJson();
  return join(
    dirname(packageJsonPath),
    "prebuilds",
    `darwin-${arch}`,
    "spawn-helper",
  );
}

export function ensureNodePtySpawnHelperExecutable({
  platform = process.platform,
  arch = process.arch,
  resolvePackageJson = defaultResolvePackageJson,
  existsSync = defaultExistsSync,
  chmodSync = defaultChmodSync,
} = {}) {
  const helperPath = getNodePtySpawnHelperPath({
    platform,
    arch,
    resolvePackageJson,
  });

  if (helperPath === null || !existsSync(helperPath)) {
    return false;
  }

  chmodSync(helperPath, 0o755);
  return true;
}

const isMainModule = process.argv[1] === fileURLToPath(import.meta.url);

if (isMainModule) {
  try {
    ensureNodePtySpawnHelperExecutable();
  } catch (error) {
    console.warn(
      "[postinstall] Failed to update node-pty spawn-helper permissions:",
      error,
    );
  }
}
