import { build } from "esbuild";
await build({
  entryPoints: ["src/extension.mjs"],
  outfile: "dist/extension.cjs",
  bundle: true,
  platform: "node",
  target: "node22",
  format: "cjs",
  external: ["vscode"],
  mainFields: ["module", "main"],
  logLevel: "info",
});
