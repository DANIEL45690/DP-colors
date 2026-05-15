
const esbuild = require("esbuild");

esbuild
  .build({
    entryPoints: ["extension.js"],
    bundle: true,
    outfile: "dist/extension.js",
    external: ["vscode"],
    format: "cjs",
    platform: "node",
    target: "node14",
    minify: true,
  })
  .catch(() => process.exit(1));
