import { spawn } from "node:child_process";

const mode = process.argv[2] ?? "quick";
const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";

const suites = {
  quick: [
    ["typecheck", ["run", "typecheck"]],
    ["lint", ["run", "lint"]],
    ["unit", ["run", "test"]],
    ["coverage", ["run", "test:coverage"]],
    ["build", ["run", "build"]],
  ],
  full: [
    ["typecheck", ["run", "typecheck"]],
    ["lint", ["run", "lint"]],
    ["unit", ["run", "test"]],
    ["coverage", ["run", "test:coverage"]],
    ["build", ["run", "build"]],
    ["rust", ["run", "test:rust"]],
    ["e2e", ["run", "test:e2e"]],
  ],
};

const selectedSuite = suites[mode];

if (!selectedSuite) {
  console.error(`Unknown local CI mode: ${mode}`);
  console.error(`Expected one of: ${Object.keys(suites).join(", ")}`);
  process.exit(1);
}

const formatDuration = (startedAt) => `${((Date.now() - startedAt) / 1000).toFixed(1)}s`;

const runStep = ([label, args], index, total) =>
  new Promise((resolveStep, rejectStep) => {
    const startedAt = Date.now();
    console.log(`\n[local-ci] ${index + 1}/${total} ${label}: ${pnpm} ${args.join(" ")}`);

    const child = spawn(pnpm, args, {
      cwd: process.cwd(),
      env: process.env,
      stdio: "inherit",
    });

    child.on("error", rejectStep);
    child.on("exit", (code, signal) => {
      if (signal) {
        rejectStep(new Error(`${label} stopped by signal ${signal}`));
        return;
      }

      if (code !== 0) {
        rejectStep(new Error(`${label} failed with exit code ${code}`));
        return;
      }

      console.log(`[local-ci] ${label} passed in ${formatDuration(startedAt)}`);
      resolveStep();
    });
  });

const startedAt = Date.now();
console.log(`[local-ci] running ${mode} suite`);

try {
  for (const [index, step] of selectedSuite.entries()) {
    await runStep(step, index, selectedSuite.length);
  }

  console.log(`\n[local-ci] ${mode} suite passed in ${formatDuration(startedAt)}`);
} catch (error) {
  console.error(`\n[local-ci] ${mode} suite failed`);
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
