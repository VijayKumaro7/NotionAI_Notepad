import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";

/**
 * Every third-party GitHub Action is pinned to a commit.
 *
 * A tag such as `@v7` is a pointer its owner can move, and a workflow that
 * follows it runs whatever the tag names on the next CI run, with this
 * repository's token. A full commit SHA cannot be moved. The trailing comment
 * says which release the SHA is, so a reader (and Dependabot, which updates
 * both together) can tell what it is.
 */

const DIR = join(resolve(process.cwd()), ".github", "workflows");

const uses = readdirSync(DIR)
  .filter(name => /\.ya?ml$/.test(name))
  .flatMap(name =>
    readFileSync(join(DIR, name), "utf8")
      .split("\n")
      .map((line, i) => ({ file: name, line: i + 1, text: line }))
      .filter(l => /^\s*(-\s+)?uses:\s/.test(l.text))
  );

describe("workflow action pins", () => {
  it("finds the actions this repository uses", () => {
    // Guards the guard: a regex that matched nothing would pass vacuously.
    expect(uses.length).toBeGreaterThan(0);
  });

  it.each(uses.map(u => [`${u.file}:${u.line}`, u.text] as const))(
    "%s pins its action to a commit SHA",
    (_where, text) => {
      const ref = text.replace(/^\s*(-\s+)?uses:\s*/, "").trim();
      // Local actions and container images are not fetched by tag.
      if (ref.startsWith("./") || ref.startsWith("docker://")) return;
      expect(ref).toMatch(/^[\w.-]+\/[\w./-]+@[0-9a-f]{40}\s+#\s*\S+/);
    }
  );
});
