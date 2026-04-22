import { describe, it, expect } from "vitest";
import { matchFiles } from "../../../shared/files/match-files";

describe("matchFiles", () => {
    it("returns all paths in alphabetical order when query is empty", () => {
        const result = matchFiles("", ["src/b.ts", "src/a.ts"]);
        expect(result.map((r) => r.path)).toEqual(["src/a.ts", "src/b.ts"]);
    });

    it("returns all paths in alphabetical order when query is whitespace-only", () => {
        const result = matchFiles("   ", ["src/b.ts", "src/a.ts"]);
        expect(result.map((r) => r.path)).toEqual(["src/a.ts", "src/b.ts"]);
    });

    it("filters out paths that do not match the query as a subsequence", () => {
        const result = matchFiles("xyz", ["src/foo.ts", "src/bar.ts"]);
        expect(result).toEqual([]);
    });

    it("matches basename substring", () => {
        const result = matchFiles("foo", ["src/a.ts", "src/foo.ts"]);
        expect(result.map((r) => r.path)).toEqual(["src/foo.ts"]);
    });

    it("is case-insensitive", () => {
        const result = matchFiles("FOO", ["src/Foo.ts"]);
        expect(result.map((r) => r.path)).toEqual(["src/Foo.ts"]);
    });

    it("ranks basename-prefix matches above basename-substring matches", () => {
        const paths = ["src/afoo.ts", "src/foobar.ts"];
        const result = matchFiles("foo", paths);
        expect(result.map((r) => r.path)).toEqual(["src/foobar.ts", "src/afoo.ts"]);
    });

    it("ranks basename matches above directory-only matches", () => {
        const paths = ["foo/bar.ts", "src/foo.ts"];
        const result = matchFiles("foo", paths);
        expect(result.map((r) => r.path)).toEqual(["src/foo.ts", "foo/bar.ts"]);
    });

    it("ranks substring matches above subsequence-only matches", () => {
        const paths = ["src/far-off-other.ts", "src/foo.ts"];
        const result = matchFiles("foo", paths);
        expect(result.map((r) => r.path)).toEqual(["src/foo.ts", "src/far-off-other.ts"]);
    });

    it("accepts subsequence matches across segments", () => {
        const result = matchFiles("app", ["src/app/App.tsx", "src/other.ts"]);
        expect(result.map((r) => r.path)).toEqual(["src/app/App.tsx"]);
    });

    it("breaks ties by shorter path", () => {
        const paths = ["src/deeply/nested/foo.ts", "src/foo.ts"];
        const result = matchFiles("foo", paths);
        expect(result.map((r) => r.path)).toEqual(["src/foo.ts", "src/deeply/nested/foo.ts"]);
    });

    it("breaks remaining ties alphabetically", () => {
        const paths = ["src/b-foo.ts", "src/a-foo.ts"];
        const result = matchFiles("foo", paths);
        expect(result.map((r) => r.path)).toEqual(["src/a-foo.ts", "src/b-foo.ts"]);
    });

    it("returns scores >= 0 for matches", () => {
        const result = matchFiles("foo", ["src/foo.ts"]);
        expect(result[0].score).toBeGreaterThanOrEqual(0);
    });

    it("handles empty paths array", () => {
        expect(matchFiles("", [])).toEqual([]);
        expect(matchFiles("foo", [])).toEqual([]);
    });
});
