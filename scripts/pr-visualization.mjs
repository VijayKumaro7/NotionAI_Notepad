#!/usr/bin/env node
/**
 * Generate docs/PR_BRANCH_VISUALIZATION.md and docs/pr-branch-visualization.html
 * from the repository's pull request metadata.
 *
 *   node scripts/pr-visualization.mjs                  # fetch live from GitHub
 *   node scripts/pr-visualization.mjs --snapshot FILE  # regenerate offline
 *
 * Live mode calls the public REST API (pulls + branches). Set GITHUB_TOKEN to
 * lift the unauthenticated rate limit or to read a private repository; the
 * token is only sent as a header and never written anywhere. The repository
 * is taken from `--repo owner/name`, else from the `origin` remote.
 *
 * Live mode also rewrites docs/pr-snapshot.json, so the two outputs can be
 * rebuilt later without network access and a reviewer can see exactly which
 * data they were built from.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DOCS = join(ROOT, "docs");
const SNAPSHOT_PATH = join(DOCS, "pr-snapshot.json");

const args = process.argv.slice(2);
const flag = name => {
  const i = args.indexOf(name);
  return i === -1 ? undefined : args[i + 1];
};

// ---------------------------------------------------------------- collection

function repoFromRemote() {
  const url = execFileSync("git", ["remote", "get-url", "origin"], {
    cwd: ROOT,
    encoding: "utf8",
  }).trim();
  const m = url.match(/github\.com[:/]([^/]+\/[^/.]+?)(?:\.git)?$/);
  if (!m) throw new Error(`Cannot read owner/repo from remote: ${url}`);
  return m[1];
}

async function getAll(path) {
  const headers = { Accept: "application/vnd.github+json" };
  if (process.env.GITHUB_TOKEN) {
    headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  }
  const out = [];
  for (let page = 1; ; page++) {
    const sep = path.includes("?") ? "&" : "?";
    const res = await fetch(
      `https://api.github.com${path}${sep}per_page=100&page=${page}`,
      { headers }
    );
    if (!res.ok) {
      throw new Error(
        `GitHub API ${res.status} for ${path}: ${res.statusText}`
      );
    }
    const rows = await res.json();
    out.push(...rows);
    if (rows.length < 100) return out;
  }
}

async function collectLive(repo) {
  const [pulls, branches] = await Promise.all([
    getAll(`/repos/${repo}/pulls?state=all&sort=created&direction=asc`),
    getAll(`/repos/${repo}/branches`),
  ]);
  return {
    repo,
    collectedAt: new Date().toISOString().replace(/\.\d+Z$/, "Z"),
    source: "GitHub REST API (pulls?state=all, branches)",
    prs: pulls.map(p => ({
      number: p.number,
      title: p.title,
      state: p.state === "open" ? "open" : p.merged_at ? "merged" : "closed",
      draft: p.draft,
      author: p.user?.login ?? null,
      head: p.head.ref,
      base: p.base.ref,
      headRepo: p.head.repo?.full_name ?? null,
      url: p.html_url,
      createdAt: p.created_at,
      closedAt: p.closed_at,
      mergedAt: p.merged_at,
    })),
    branches: branches.map(b => b.name),
  };
}

// ------------------------------------------------------------------ analysis

const STATES = ["open", "merged", "closed"];
const STATE_LABEL = { open: "Open", merged: "Merged", closed: "Closed" };
const STATE_ICON = { open: "●", merged: "✔", closed: "✖" };

const groupOf = branch => {
  if (branch === "main") return "main";
  const prefix = branch.split("/")[0];
  return ["claude", "dependabot", "fix", "feat"].includes(prefix)
    ? `${prefix}/*`
    : "other";
};

function analyse(data) {
  const prs = [...data.prs].sort((a, b) => a.number - b.number);
  const existing = new Set(data.branches);
  const names = new Set([...existing]);
  for (const p of prs) {
    names.add(p.head);
    names.add(p.base);
  }
  const branches = new Map();
  for (const name of [...names].sort()) {
    branches.set(name, {
      name,
      exists: existing.has(name),
      from: [],
      to: [],
    });
  }
  for (const p of prs) {
    branches.get(p.head).from.push(p);
    branches.get(p.base).to.push(p);
  }
  return { ...data, prs, branches };
}

const count = list =>
  Object.fromEntries(
    STATES.map(s => [s, list.filter(p => p.state === s).length])
  );

// ------------------------------------------------------------------- helpers

const day = iso => (iso ? iso.slice(0, 10) : "—");

const mdText = s =>
  String(s)
    .replace(/\\/g, "\\\\")
    .replace(/[|`*_[\]<>&]/g, c => `\\${c}`)
    .replace(/\s+/g, " ")
    .trim();

const mdCode = s => `\`${String(s).replace(/`/g, "'")}\``;

function mermaidLabel(s, max = 44) {
  let t = String(s).replace(/\s+/g, " ").trim();
  if (t.length > max) t = `${t.slice(0, max - 1).trimEnd()}…`;
  return t
    .replace(/&/g, "#amp;")
    .replace(/"/g, "#quot;")
    .replace(/</g, "#lt;")
    .replace(/>/g, "#gt;")
    .replace(/`/g, "'")
    .replace(/#(?![a-z]+;|\d+;)/g, "#35;");
}

// A branch is drawn as a target (double-bordered) when any PR in the diagram
// merges into it, otherwise as a plain source.
function mermaid({ prs, branchIds }) {
  const lines = ["flowchart LR"];
  const used = new Map();
  const touch = (name, role) => {
    if (!used.has(name)) used.set(name, new Set());
    used.get(name).add(role);
  };
  for (const p of prs) {
    touch(p.head, "source");
    touch(p.base, "target");
  }
  for (const [name, roles] of used) {
    const id = branchIds.get(name);
    const label = mermaidLabel(name, 60);
    lines.push(
      roles.has("target")
        ? `  ${id}[["${label}"]]:::target`
        : `  ${id}("${label}"):::source`
    );
  }
  for (const p of prs) {
    const label = `${STATE_ICON[p.state]} PR #${p.number}: ${mermaidLabel(p.title)}`;
    const shape =
      p.state === "open"
        ? `(["${label}"])`
        : p.state === "closed"
          ? `{{"${label}"}}`
          : `["${label}"]`;
    lines.push(`  p${p.number}${shape}:::${p.state}`);
  }
  for (const p of prs) {
    lines.push(`  ${branchIds.get(p.head)} --> p${p.number}`);
    lines.push(`  p${p.number} --> ${branchIds.get(p.base)}`);
  }
  lines.push(...MERMAID_CLASSES);
  return lines.join("\n");
}

const MERMAID_CLASSES = [
  "  classDef source fill:#dbeafe,stroke:#1d4ed8,color:#0b2559",
  "  classDef target fill:#ede9fe,stroke:#6d28d9,stroke-width:3px,color:#2e1065",
  "  classDef open fill:#fef3c7,stroke:#b45309,stroke-width:2px,color:#451a03",
  "  classDef merged fill:#dcfce7,stroke:#15803d,color:#052e16",
  "  classDef closed fill:#f3f4f6,stroke:#b91c1c,stroke-dasharray:5 3,color:#111827",
];

// ------------------------------------------------------------------ markdown

function buildMarkdown(a) {
  const { prs, branches, repo } = a;
  const branchIds = new Map([...branches.keys()].map((n, i) => [n, `b${i}`]));
  const totals = count(prs);
  const mainName = branches.has("main") ? "main" : prs[0].base;
  const out = [];
  const push = (...l) => out.push(...l);
  const prLink = p => `[#${p.number}](${p.url})`;
  const prList = list => list.map(prLink).join(", ");

  // ---- derived facts
  const stacked = prs.filter(p => p.base !== mainName);
  const stackSet = new Set();
  for (const p of stacked) {
    stackSet.add(p.number);
    for (const q of branches.get(p.base).from) stackSet.add(q.number);
  }
  const stackPrs = prs.filter(p => stackSet.has(p.number));
  const openPrs = prs.filter(p => p.state === "open");
  const multi = [...branches.values()]
    .filter(b => b.from.length > 1)
    .sort(
      (x, y) => y.from.length - x.from.length || x.name.localeCompare(y.name)
    );
  const byTitle = new Map();
  for (const p of prs) {
    const k = p.title.toLowerCase().replace(/\s+/g, " ").trim();
    byTitle.set(k, [...(byTitle.get(k) ?? []), p]);
  }
  const dupTitles = [...byTitle.values()].filter(l => l.length > 1);
  const closedUnmerged = prs.filter(p => p.state === "closed");
  const authors = new Map();
  for (const p of prs) authors.set(p.author, (authors.get(p.author) ?? 0) + 1);
  const groups = new Map();
  for (const p of prs) {
    const g = groupOf(p.head);
    groups.set(g, [...(groups.get(g) ?? []), p]);
  }
  const forkHeads = prs.filter(p => p.headRepo && p.headRepo !== repo);
  const noHeadRepo = prs.filter(p => !p.headRepo);

  push(
    "# PR ↔ Branch Visualization",
    "",
    "<!-- Generated by scripts/pr-visualization.mjs — edit the script, not this file. -->",
    ""
  );

  // ---- A
  push(
    "## A. Overview",
    "",
    `This document maps every pull request in [${repo}](https://github.com/${repo}) to the branch it came from and the branch it targets, so you can tell at a glance which PRs originated from which branches, where they landed, and what state they are in.`,
    "",
    `- **${prs.length} pull requests** (${totals.merged} merged, ${totals.open} open, ${totals.closed} closed without merging)`,
    `- **${branches.size} branches** appear either in a PR or in the current branch list`,
    `- **${prs.length - stacked.length} PRs target \`${mainName}\`**; **${stacked.length}** target another branch (stacked PRs, section E)`,
    "",
    "Everything below is read straight from GitHub's PR metadata. Where a statement is an inference rather than a recorded fact, it is labelled as one.",
    "",
    `An interactive version (zoom, pan, filter, click a node for details, double-click to open the PR) is in [\`pr-branch-visualization.html\`](pr-branch-visualization.html). Open it in a browser; it loads Cytoscape.js from a CDN.`,
    ""
  );

  // ---- B
  push(
    "## B. Visualization",
    "",
    "Direction is always **source branch → PR → target branch**.",
    ""
  );
  push(
    "### Legend",
    "",
    "| Encoding | Meaning |",
    "|---|---|",
    "| Rounded blue node | Branch used only as a PR source in that diagram |",
    "| Double-bordered purple node `[[ ]]` | Branch that PRs in that diagram merge **into** (target) |",
    "| ✔ green rectangle | Merged PR |",
    "| ● amber stadium with thick border | Open PR |",
    "| ✖ grey hexagon, dashed red border | Closed without merging |",
    "",
    "Status is carried by the icon and the shape as well as the colour, so it survives greyscale and colour-blindness. GitHub does not make Mermaid nodes clickable; use the inventory table (section C) or the HTML version for links.",
    ""
  );

  // overview by group
  const targetsOf = new Map();
  for (const p of prs) {
    const key = `${groupOf(p.head)}\u0000${p.base}`;
    const e = targetsOf.get(key) ?? [];
    e.push(p);
    targetsOf.set(key, e);
  }
  const ov = ["flowchart LR"];
  const gids = new Map();
  [...groups.keys()].sort().forEach((g, i) => gids.set(g, `g${i}`));
  const tgtNames = new Set(prs.map(p => p.base));
  for (const [g, id] of gids) {
    ov.push(
      `  ${id}("${mermaidLabel(g)}<br/>${groups.get(g).length} PRs"):::source`
    );
  }
  for (const t of [...tgtNames].sort()) {
    ov.push(`  ${branchIds.get(t)}[["${mermaidLabel(t, 60)}"]]:::target`);
  }
  for (const [key, list] of targetsOf) {
    const [g, t] = key.split("\u0000");
    const c = count(list);
    const parts = STATES.filter(s => c[s]).map(s => `${c[s]} ${s}`);
    ov.push(
      `  ${gids.get(g)} -->|"${list.length} PRs: ${parts.join(", ")}"| ${branchIds.get(t)}`
    );
  }
  ov.push(...MERMAID_CLASSES);
  push(
    "### 1. Overview — branch families → target branches",
    "",
    "Source branches are grouped by name prefix (a naming convention, not metadata). Edge labels give the PR count and status split.",
    "",
    "```mermaid",
    ov.join("\n"),
    "```",
    ""
  );

  // stacked + open
  const focus = prs.filter(p => stackSet.has(p.number) || p.state === "open");
  push(
    "### 2. Stacked and open PRs",
    "",
    `PRs that target a branch other than \`${mainName}\`, the PRs that produced those branches, and every open PR. These are the relationships that are not simply "branch → ${mainName}".`,
    "",
    "```mermaid",
    mermaid({ prs: focus, branchIds }),
    "```",
    ""
  );

  // full by family
  push(
    "### 3. Every PR, by branch family",
    "",
    "One diagram per family so each stays readable. Expand a section to see it.",
    ""
  );
  for (const g of [...groups.keys()].sort()) {
    const list = groups.get(g);
    const text = mermaid({ prs: list, branchIds });
    push(
      `<details>`,
      `<summary><b>${mdText(g)}</b> — ${list.length} PRs from ${new Set(list.map(p => p.head)).size} branches</summary>`,
      "",
      "```mermaid",
      text,
      "```",
      "",
      "</details>",
      ""
    );
  }

  // ---- C
  push(
    "## C. Pull Request Inventory",
    "",
    `All ${prs.length} PRs (open, merged and closed) in ${repo}, oldest first. Nothing was filtered out; see section F for the retrieval details.`,
    "",
    "| PR | Title | Source Branch | Target Branch | Status | Author | PR Link | Created | Merged / Closed |",
    "|---|---|---|---|---|---|---|---|---|"
  );
  for (const p of prs) {
    const ended =
      p.state === "merged"
        ? `${day(p.mergedAt)} (merged)`
        : p.state === "closed"
          ? `${day(p.closedAt)} (closed)`
          : "—";
    push(
      `| #${p.number} | ${mdText(p.title)}${p.draft ? " *(draft)*" : ""} | ${mdCode(p.head)} | ${mdCode(p.base)} | ${STATE_LABEL[p.state]} | ${mdText(p.author ?? "unknown")} | [Link](${p.url}) | ${day(p.createdAt)} | ${ended} |`
    );
  }
  push("");

  // ---- D
  const sortedBranches = [...branches.values()].sort(
    (x, y) =>
      y.from.length + y.to.length - (x.from.length + x.to.length) ||
      x.name.localeCompare(y.name)
  );
  push(
    "## D. Branch Summary",
    "",
    '**Counts** are `open / merged / closed`. **On GitHub** compares the branch name with the branch list collected in section F: *exists* means it was listed, *not listed* means it was absent at collection time (usually deleted after merge — it does not mean its PRs were deleted). *Active* means the branch exists **and** has an open PR from it. Last-commit dates were not collected, so no branch is labelled merely "inactive".',
    "",
    "| Branch | PRs from it | PRs into it | On GitHub | Related PRs |",
    "|---|---|---|---|---|"
  );
  const fmt = c => `${c.open} / ${c.merged} / ${c.closed}`;
  for (const b of sortedBranches) {
    const sourceOpen = b.from.some(p => p.state === "open");
    const status = !b.exists
      ? "not listed"
      : sourceOpen
        ? "exists — active (open PR)"
        : "exists";
    const related =
      b.name === mainName
        ? `all ${b.to.length} PRs targeting it — see section C`
        : [
            b.from.length ? `from: ${prList(b.from)}` : "",
            b.to.length ? `into: ${prList(b.to)}` : "",
          ]
            .filter(Boolean)
            .join("; ") || "no PRs";
    push(
      `| ${mdCode(b.name)} | ${b.from.length} (${fmt(count(b.from))}) | ${b.to.length} (${fmt(count(b.to))}) | ${status} | ${related} |`
    );
  }
  push("");

  // ---- E
  push(
    "## E. Key Observations",
    "",
    "### Facts (read directly from the metadata)",
    ""
  );
  push(
    `- ${totals.merged} of ${prs.length} PRs merged; ${totals.open} open; ${totals.closed} closed without merging.`,
    `- ${prs.length - stacked.length} PRs target \`${mainName}\`; ${stacked.length} target other branches: ${stacked.map(p => `${prLink(p)} (${mdCode(p.head)} → ${mdCode(p.base)})`).join(", ") || "none"}.`,
    `- Authors: ${[...authors]
      .sort((x, y) => y[1] - x[1])
      .map(([n, c]) => `${mdText(n ?? "unknown")} (${c})`)
      .join(", ")}.`,
    `- Source-branch families: ${[...groups]
      .sort((x, y) => y[1].length - x[1].length)
      .map(([g, l]) => `${mdCode(g)} ${l.length}`)
      .join(", ")}.`,
    `- ${multi.length} branches are the source of more than one PR${multi.length ? `: ${multi.map(b => `${mdCode(b.name)} (${prList(b.from)})`).join("; ")}` : ""}.`,
    `- Open PRs: ${openPrs.map(p => `${prLink(p)} ${mdCode(p.head)} → ${mdCode(p.base)}, opened ${day(p.createdAt)}`).join("; ") || "none"}.`,
    `- ${closedUnmerged.length} PRs were closed without merging: ${prList(closedUnmerged) || "none"}.`
  );
  if (forkHeads.length || noHeadRepo.length) {
    push(
      `- ${forkHeads.length} PRs come from forks; ${noHeadRepo.length} have no head repository recorded (deleted fork).`
    );
  } else {
    push("- All PRs come from branches in this repository (no forks).");
  }
  push("", "### Stacked PR chains", "");
  if (stacked.length) {
    push(
      "A stacked PR merges into a feature branch that itself has a PR, so landing it only moves work into another PR. A merged stacked PR therefore does not by itself prove its work reached `" +
        mainName +
        "`.",
      "",
      "| Stacked PR | Status | Into branch | That branch's own PR(s) into somewhere | Status of those |",
      "|---|---|---|---|---|"
    );
    for (const p of stacked) {
      const own = branches.get(p.base).from;
      push(
        `| ${prLink(p)} ${mdCode(p.head)} | ${STATE_LABEL[p.state]} | ${mdCode(p.base)} | ${own.map(q => `${prLink(q)} → ${mdCode(q.base)}`).join(", ") || "none"} | ${own.map(q => STATE_LABEL[q.state]).join(", ") || "—"} |`
      );
    }
    push("");
  } else push("None.", "");

  push("### Needs human review (potential issues, not facts)", "");
  const review = [];
  for (const p of stacked) {
    const own = branches.get(p.base).from;
    if (
      p.state === "merged" &&
      own.length &&
      own.every(q => q.state !== "merged")
    ) {
      review.push(
        `${prLink(p)} merged into ${mdCode(p.base)}, but every PR from that branch is ${own.map(q => `${prLink(q)} ${STATE_LABEL[q.state].toLowerCase()}`).join(", ")}. If that was not intended, the work may not have reached ${mdCode(mainName)}.`
      );
    }
  }
  for (const p of openPrs) {
    review.push(
      `${prLink(p)} has been open since ${day(p.createdAt)} (${mdCode(p.head)} → ${mdCode(p.base)}); check whether it is waiting on review or CI.`
    );
  }
  for (const l of dupTitles) {
    review.push(
      `Identical titles — ${prList(l)}: "${mdText(l[0].title)}". Could be reruns of the same change or genuinely separate; compare the diffs.`
    );
  }
  // Reusing one branch for PRs one after another is routine; two PRs from the
  // same branch alive at the same time is the case worth a second look.
  for (const b of multi) {
    const end = p => p.closedAt ?? "9999";
    const live = b.from.filter(p =>
      b.from.some(q => q !== p && q.createdAt < end(p) && p.createdAt < end(q))
    );
    if (live.length) {
      review.push(
        `${mdCode(b.name)} had ${prList(live)} open at overlapping times; check they are not duplicating each other.`
      );
    }
  }
  if (!review.length) push("Nothing flagged.");
  for (const r of review) push(`- ${r}`);
  push("");

  // ---- F
  push(
    "## F. Data Source and Limitations",
    "",
    `- **Retrieval method:** ${a.source}.`,
    `- **Repository scope:** ${repo}, all PRs in every state (open, closed, merged) targeting any branch. ${prs.length} PRs retrieved, numbers #${prs[0].number}–#${prs.at(-1).number}; PR numbers missing from that range (${missingNumbers(prs).join(", ") || "none"}) are not pull requests in this repository's PR list (they may be issues).`,
    `- **Collected:** ${a.collectedAt} (UTC). PRs created or changed after that are not shown; regenerate with \`node scripts/pr-visualization.mjs\`.`,
    `- **Branches:** ${a.branches.length} branches listed at collection time. Branch existence in section D is checked against that list only.`,
    "- **Not retrieved:** merge-commit SHAs, per-PR commit lists, reviewers, labels and last-commit dates for branches. Those were not part of the data pulled, so they are left out instead of guessed.",
    "- **Inferred, not recorded:** the branch *family* grouping (by name prefix) and the stacked-PR reading in section E. Everything else is PR metadata as returned by GitHub.",
    "- **Permissions:** read-only access; no credentials appear in this document or the generated files.",
    "- **Reproducing:** `docs/pr-snapshot.json` is the exact data both outputs were built from. `node scripts/pr-visualization.mjs --snapshot docs/pr-snapshot.json` rebuilds them offline; without `--snapshot` the script fetches fresh data (set `GITHUB_TOKEN` to avoid unauthenticated rate limits).",
    ""
  );
  return out.join("\n");
}

function missingNumbers(prs) {
  const have = new Set(prs.map(p => p.number));
  const out = [];
  for (let n = prs[0].number; n <= prs.at(-1).number; n++) {
    if (!have.has(n)) out.push(n);
  }
  return out;
}

// ---------------------------------------------------------------------- html

function buildHtml(a) {
  const nodes = [];
  const edges = [];
  const targets = new Set(a.prs.map(p => p.base));
  for (const b of a.branches.values()) {
    if (!b.from.length && !b.to.length) continue;
    nodes.push({
      data: {
        id: `b:${b.name}`,
        label: b.name,
        kind: targets.has(b.name) ? "target" : "source",
        group: groupOf(b.name),
        exists: b.exists,
        from: b.from.length,
        to: b.to.length,
      },
    });
  }
  for (const p of a.prs) {
    nodes.push({
      data: {
        id: `p:${p.number}`,
        label: `${STATE_ICON[p.state]} #${p.number}`,
        kind: "pr",
        state: p.state,
        number: p.number,
        title: p.title,
        author: p.author,
        head: p.head,
        base: p.base,
        url: p.url,
        created: day(p.createdAt),
        ended:
          p.state === "merged"
            ? day(p.mergedAt)
            : p.state === "closed"
              ? day(p.closedAt)
              : "",
        group: groupOf(p.head),
      },
    });
    edges.push({
      data: {
        id: `e1:${p.number}`,
        source: `b:${p.head}`,
        target: `p:${p.number}`,
        state: p.state,
      },
    });
    edges.push({
      data: {
        id: `e2:${p.number}`,
        source: `p:${p.number}`,
        target: `b:${p.base}`,
        state: p.state,
      },
    });
  }
  const payload = JSON.stringify({
    repo: a.repo,
    collectedAt: a.collectedAt,
    nodes,
    edges,
  }).replace(/</g, "\\u003c");

  return `<!doctype html>
<!-- Generated by scripts/pr-visualization.mjs — edit the script, not this file. -->
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>PR Branch Visualization</title>
<style>
  :root {
    --bg: #ffffff; --fg: #111827; --muted: #4b5563; --panel: #f3f4f6; --line: #d1d5db;
    --source: #dbeafe; --source-b: #1d4ed8; --target: #ede9fe; --target-b: #6d28d9;
    --open: #fef3c7; --open-b: #b45309; --merged: #dcfce7; --merged-b: #15803d;
    --closed: #f3f4f6; --closed-b: #b91c1c; --edge: #6b7280;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --bg: #0f172a; --fg: #e5e7eb; --muted: #9ca3af; --panel: #1e293b; --line: #334155;
      --source: #1e3a8a; --source-b: #93c5fd; --target: #4c1d95; --target-b: #c4b5fd;
      --open: #78350f; --open-b: #fbbf24; --merged: #14532d; --merged-b: #86efac;
      --closed: #1f2937; --closed-b: #fca5a5; --edge: #94a3b8;
    }
  }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--bg); color: var(--fg); font: 14px/1.4 system-ui, sans-serif; display: flex; flex-direction: column; height: 100dvh; }
  header { padding: 10px 16px; border-bottom: 1px solid var(--line); display: flex; flex-wrap: wrap; gap: 8px 16px; align-items: center; }
  h1 { font-size: 16px; margin: 0; }
  header small { color: var(--muted); }
  .controls { display: flex; flex-wrap: wrap; gap: 8px 14px; align-items: center; }
  .controls label { display: inline-flex; gap: 4px; align-items: center; }
  input[type=search], select { background: var(--panel); color: var(--fg); border: 1px solid var(--line); border-radius: 6px; padding: 4px 8px; font: inherit; }
  main { flex: 1; display: flex; min-height: 0; }
  #cy { flex: 1; min-width: 0; }
  aside { width: 300px; border-left: 1px solid var(--line); padding: 12px 16px; overflow: auto; background: var(--panel); }
  aside h2 { font-size: 13px; margin: 14px 0 6px; text-transform: uppercase; letter-spacing: .04em; color: var(--muted); }
  aside h2:first-child { margin-top: 0; }
  .key { display: flex; align-items: center; gap: 8px; margin: 4px 0; }
  .sw { width: 22px; height: 14px; border: 2px solid; flex: none; }
  .sw.source { background: var(--source); border-color: var(--source-b); border-radius: 8px; }
  .sw.target { background: var(--target); border-color: var(--target-b); border-width: 4px; border-style: double; }
  .sw.merged { background: var(--merged); border-color: var(--merged-b); }
  .sw.open { background: var(--open); border-color: var(--open-b); border-radius: 8px; border-width: 3px; }
  .sw.closed { background: var(--closed); border-color: var(--closed-b); border-style: dashed; }
  #detail dl { margin: 0; display: grid; grid-template-columns: auto 1fr; gap: 2px 8px; }
  #detail dt { color: var(--muted); }
  #detail dd { margin: 0; overflow-wrap: anywhere; }
  a { color: var(--source-b); }
  #tip { position: fixed; pointer-events: none; background: var(--fg); color: var(--bg); padding: 6px 8px; border-radius: 6px; font-size: 12px; max-width: 320px; display: none; z-index: 5; }
  @media (max-width: 760px) { main { flex-direction: column; } aside { width: auto; max-height: 40%; border-left: 0; border-top: 1px solid var(--line); } }
</style>
</head>
<body>
<header>
  <h1>PR ↔ Branch Visualization</h1>
  <small id="meta"></small>
  <div class="controls">
    <label><input type="checkbox" data-state="open" checked /> Open</label>
    <label><input type="checkbox" data-state="merged" checked /> Merged</label>
    <label><input type="checkbox" data-state="closed" checked /> Closed</label>
    <label>Family
      <select id="group"><option value="">All</option></select>
    </label>
    <label>Show
      <select id="scope">
        <option value="all">All PRs</option>
        <option value="focus">Stacked and open only</option>
      </select>
    </label>
    <input id="q" type="search" placeholder="Search branch, title, author, #" aria-label="Search" />
  </div>
</header>
<main>
  <div id="cy" role="img" aria-label="Graph of pull requests between source and target branches"></div>
  <aside>
    <h2>Legend</h2>
    <div class="key"><span class="sw source"></span>Source branch</div>
    <div class="key"><span class="sw target"></span>Target branch (a PR merges into it)</div>
    <div class="key"><span class="sw merged"></span>✔ Merged PR</div>
    <div class="key"><span class="sw open"></span>● Open PR</div>
    <div class="key"><span class="sw closed"></span>✖ Closed, not merged</div>
    <div class="key">Arrows: source → PR → target</div>
    <h2>Selected</h2>
    <div id="detail">Click a node. Double-click a PR to open it on GitHub.</div>
    <h2>Controls</h2>
    <div>Scroll to zoom, drag to pan, drag a node to move it.</div>
  </aside>
</main>
<div id="tip"></div>
<script src="https://cdn.jsdelivr.net/npm/cytoscape@3.30.2/dist/cytoscape.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/dagre@0.8.5/dist/dagre.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/cytoscape-dagre@2.5.0/cytoscape-dagre.js"></script>
<script>
const DATA = ${payload};
const css = n => getComputedStyle(document.documentElement).getPropertyValue("--" + n).trim();
const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
document.getElementById("meta").textContent =
  DATA.repo + " · " + DATA.nodes.filter(n => n.data.kind === "pr").length + " PRs · collected " + DATA.collectedAt;

function style() {
  return [
    { selector: "node", style: { "font-size": 10, color: css("fg"), "text-valign": "center", "text-halign": "center", "text-wrap": "ellipsis", "text-max-width": 150, "border-width": 2 } },
    { selector: 'node[kind="source"]', style: { shape: "round-rectangle", label: "data(label)", "background-color": css("source"), "border-color": css("source-b"), width: "label", height: 24, padding: 8 } },
    { selector: 'node[kind="target"]', style: { shape: "round-rectangle", label: "data(label)", "background-color": css("target"), "border-color": css("target-b"), "border-width": 4, "border-style": "double", width: "label", height: 28, padding: 10, "font-weight": 700 } },
    { selector: 'node[state="merged"]', style: { shape: "rectangle", label: "data(label)", "background-color": css("merged"), "border-color": css("merged-b"), width: 54, height: 22 } },
    { selector: 'node[state="open"]', style: { shape: "round-rectangle", label: "data(label)", "background-color": css("open"), "border-color": css("open-b"), "border-width": 4, width: 54, height: 22 } },
    { selector: 'node[state="closed"]', style: { shape: "hexagon", label: "data(label)", "background-color": css("closed"), "border-color": css("closed-b"), "border-style": "dashed", width: 58, height: 24 } },
    { selector: "edge", style: { width: 1, "line-color": css("edge"), "target-arrow-color": css("edge"), "target-arrow-shape": "triangle", "curve-style": "bezier", opacity: 0.7 } },
    { selector: ".faded", style: { opacity: 0.12 } },
    { selector: ":selected", style: { "border-color": css("fg"), "border-width": 4 } },
  ];
}

const cy = cytoscape({ container: document.getElementById("cy"), elements: { nodes: DATA.nodes, edges: DATA.edges }, style: style(), wheelSensitivity: 0.3, minZoom: 0.05, maxZoom: 3 });

const groups = [...new Set(DATA.nodes.filter(n => n.data.kind === "pr").map(n => n.data.group))].sort();
const groupSel = document.getElementById("group");
for (const g of groups) groupSel.add(new Option(g, g));

const stackedBranches = new Set(DATA.nodes.filter(n => n.data.kind === "pr" && n.data.base !== "main").map(n => n.data.base));
const focusPrs = new Set(DATA.nodes.filter(n => n.data.kind === "pr" && (n.data.state === "open" || n.data.base !== "main" || stackedBranches.has(n.data.head))).map(n => n.data.id));

function layout() {
  cy.layout({ name: "dagre", rankDir: "LR", nodeSep: 6, rankSep: 90, animate: false }).run();
  cy.fit(undefined, 30);
}

function apply() {
  const states = new Set([...document.querySelectorAll("[data-state]")].filter(c => c.checked).map(c => c.dataset.state));
  const group = groupSel.value;
  const focus = document.getElementById("scope").value === "focus";
  const q = document.getElementById("q").value.trim().toLowerCase().replace(/^#/, "");
  cy.batch(() => {
    const keep = new Set();
    cy.nodes('[kind="pr"]').forEach(n => {
      const d = n.data();
      const hay = (d.number + " " + d.title + " " + d.author + " " + d.head + " " + d.base).toLowerCase();
      const ok = states.has(d.state) && (!group || d.group === group) && (!focus || focusPrs.has(d.id)) && (!q || hay.includes(q));
      if (ok) { keep.add(n.id()); keep.add("b:" + d.head); keep.add("b:" + d.base); }
    });
    cy.nodes().forEach(n => n.style("display", keep.has(n.id()) ? "element" : "none"));
  });
  layout();
}
document.querySelectorAll("[data-state]").forEach(c => c.addEventListener("change", apply));
groupSel.addEventListener("change", apply);
document.getElementById("scope").addEventListener("change", apply);
document.getElementById("q").addEventListener("input", apply);

const tip = document.getElementById("tip");
function tipText(d) {
  if (d.kind === "pr") return "<b>#" + d.number + "</b> " + esc(d.title) + "<br>Status: " + d.state + "<br>Author: " + esc(d.author) + "<br>" + esc(d.head) + " → " + esc(d.base) + "<br>Created " + d.created + (d.ended ? " · " + d.state + " " + d.ended : "");
  return "<b>" + esc(d.label) + "</b><br>" + d.from + " PR(s) from it · " + d.to + " into it<br>" + (d.exists ? "exists on GitHub" : "not in the branch list (likely deleted)");
}
cy.on("mouseover", "node", e => { tip.innerHTML = tipText(e.target.data()); tip.style.display = "block"; });
cy.on("mouseout", "node", () => { tip.style.display = "none"; });
cy.on("mousemove", e => { if (e.originalEvent) { tip.style.left = e.originalEvent.clientX + 12 + "px"; tip.style.top = e.originalEvent.clientY + 12 + "px"; } });

cy.on("tap", "node", e => {
  const d = e.target.data();
  cy.elements().addClass("faded");
  e.target.closedNeighborhood().removeClass("faded");
  document.getElementById("detail").innerHTML = d.kind === "pr"
    ? "<dl><dt>PR</dt><dd><a href=\\"" + esc(d.url) + "\\" target=\\"_blank\\" rel=\\"noopener\\">#" + d.number + "</a></dd><dt>Title</dt><dd>" + esc(d.title) + "</dd><dt>Status</dt><dd>" + d.state + "</dd><dt>Author</dt><dd>" + esc(d.author) + "</dd><dt>Source</dt><dd>" + esc(d.head) + "</dd><dt>Target</dt><dd>" + esc(d.base) + "</dd><dt>Created</dt><dd>" + d.created + "</dd>" + (d.ended ? "<dt>" + d.state + "</dt><dd>" + d.ended + "</dd>" : "") + "</dl>"
    : "<dl><dt>Branch</dt><dd>" + esc(d.label) + "</dd><dt>PRs from</dt><dd>" + d.from + "</dd><dt>PRs into</dt><dd>" + d.to + "</dd><dt>On GitHub</dt><dd>" + (d.exists ? "exists" : "not listed") + "</dd></dl>";
});
cy.on("tap", e => { if (e.target === cy) { cy.elements().removeClass("faded"); } });
cy.on("dblclick", 'node[kind="pr"]', e => window.open(e.target.data("url"), "_blank", "noopener"));

window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => cy.style(style()));
apply();
</script>
</body>
</html>
`;
}

// ---------------------------------------------------------------------- main

async function main() {
  let data;
  const snapshot = flag("--snapshot");
  if (snapshot) {
    data = JSON.parse(readFileSync(resolve(snapshot), "utf8"));
  } else {
    data = await collectLive(flag("--repo") ?? repoFromRemote());
    mkdirSync(DOCS, { recursive: true });
    writeFileSync(SNAPSHOT_PATH, `${JSON.stringify(data, null, 2)}\n`);
  }
  const a = analyse(data);
  mkdirSync(DOCS, { recursive: true });
  writeFileSync(
    join(DOCS, "PR_BRANCH_VISUALIZATION.md"),
    `${buildMarkdown(a)}\n`
  );
  writeFileSync(join(DOCS, "pr-branch-visualization.html"), buildHtml(a));
  const totals = count(a.prs);
  console.log(
    `${a.prs.length} PRs (${totals.merged} merged, ${totals.open} open, ${totals.closed} closed), ${a.branches.size} branches`
  );
  if (!existsSync(SNAPSHOT_PATH)) console.log("no snapshot written");
}

main().catch(err => {
  console.error(err.message);
  process.exit(1);
});
