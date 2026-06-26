import { copyFile, mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";

const sourceRoot = path.resolve(
  "temp/file-icon-candidates/sources/catppuccin-vscode-icons/icons/mocha",
);
const outputRoot = path.resolve("public/file-icons/catppuccin");

const icons = [
  "_file",
  "_folder",
  "_folder_open",
  "angular",
  "apache",
  "astro",
  "asciidoc",
  "babel",
  "bash",
  "batch",
  "c",
  "c-header",
  "cargo",
  "certificate",
  "changelog",
  "clojure",
  "cmake",
  "config",
  "cpp",
  "cpp-header",
  "csharp",
  "css",
  "csv",
  "dart",
  "database",
  "diff",
  "docker",
  "docker-compose",
  "docker-ignore",
  "editorconfig",
  "elixir",
  "env",
  "erlang",
  "eslint",
  "binary",
  "fsharp",
  "git",
  "go",
  "go-mod",
  "gradle",
  "graphql",
  "haskell",
  "html",
  "http",
  "image",
  "java",
  "javascript",
  "javascript-config",
  "javascript-react",
  "javascript-test",
  "jinja",
  "json",
  "json-schema",
  "julia",
  "key",
  "kotlin",
  "latex",
  "less",
  "license",
  "liquid",
  "lock",
  "log",
  "lua",
  "makefile",
  "markdown",
  "markdown-mdx",
  "mermaid",
  "nginx",
  "nim",
  "nix",
  "npm-lock",
  "package-json",
  "perl",
  "php",
  "pdf",
  "plantuml",
  "pnpm-lock",
  "postcss",
  "powershell",
  "prettier",
  "properties",
  "proto",
  "pug",
  "python",
  "r",
  "readme",
  "ruby",
  "rust",
  "sass",
  "scala",
  "svelte",
  "svg",
  "swift",
  "tailwind",
  "tauri",
  "terraform",
  "text",
  "todo",
  "toml",
  "twig",
  "typst",
  "typescript",
  "typescript-def",
  "typescript-react",
  "typescript-test",
  "url",
  "vite",
  "vitest",
  "vscode",
  "vue",
  "xml",
  "yaml",
  "yarn-lock",
  "zig",
  "zip",
];

async function main() {
  await rm(outputRoot, { force: true, recursive: true });
  await mkdir(outputRoot, { recursive: true });

  const missing = [];
  for (const icon of icons) {
    try {
      await copyFile(path.join(sourceRoot, `${icon}.svg`), path.join(outputRoot, `${icon}.svg`));
    } catch {
      missing.push(icon);
    }
  }

  if (missing.length > 0) {
    throw new Error(`Missing Catppuccin icons:\n${missing.join("\n")}`);
  }

  await writeFile(
    path.join(outputRoot, "README.md"),
    `# Catppuccin File Icons

Runtime subset copied from Catppuccin VSCode Icons.

- Source: https://github.com/catppuccin/vscode-icons
- License: MIT
- Variant: mocha

Regenerate this subset with:

\`\`\`bash
node scripts/sync-catppuccin-file-icons.mjs
\`\`\`
`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
