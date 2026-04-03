// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { FileService } from "../../../../services/files/file-service.js";

describe("FileService", () => {
  let service: FileService;
  let worktreeDir: string;

  beforeEach(() => {
    service = new FileService();
    worktreeDir = mkdtempSync(join(tmpdir(), "ofa-file-test-"));
    mkdirSync(join(worktreeDir, "src"), { recursive: true });
    writeFileSync(join(worktreeDir, "src", "index.ts"), "console.log('hello');");
  });

  afterEach(() => {
    rmSync(worktreeDir, { recursive: true });
  });

  describe("readFile", () => {
    it("returns content for a valid text file", async () => {
      const result = await service.readFile(worktreeDir, "src/index.ts");
      expect(result.content).toBe("console.log('hello');");
      expect(result.path).toBe("src/index.ts");
      expect(result.language).toBe("typescript");
    });

    it("rejects when the path is a directory", async () => {
      await expect(service.readFile(worktreeDir, "src")).rejects.toThrow();
    });

    it("rejects when the path escapes the worktree", async () => {
      await expect(
        service.readFile(worktreeDir, "../../etc/passwd")
      ).rejects.toThrow();
    });
  });

  describe("listFiles", () => {
    it("returns relative paths for files in the worktree", async () => {
      const files = await service.listFiles(worktreeDir);
      expect(files).toContain("src/index.ts");
    });
  });
});
