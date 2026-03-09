import { build } from "esbuild";
import { cpSync } from "fs";

const shared = {
  bundle: true,
  platform: "node",
  target: "node20",
  format: "cjs",
};

await Promise.all([
  build({
    ...shared,
    entryPoints: ["src/mcp-server/index.ts"],
    outfile: "dist/mcp-server/index.js",
  }),
  build({
    ...shared,
    entryPoints: ["src/hooks/check-active-teams.ts"],
    outfile: "dist/hooks/check-active-teams.js",
  }),
  build({
    ...shared,
    entryPoints: ["src/hooks/nudge-messages.ts"],
    outfile: "dist/hooks/nudge-messages.js",
  }),
]);

// Copy WASM sidecar for node-sqlite3-wasm
cpSync(
  "node_modules/node-sqlite3-wasm/dist/node-sqlite3-wasm.wasm",
  "dist/mcp-server/node-sqlite3-wasm.wasm"
);
cpSync(
  "node_modules/node-sqlite3-wasm/dist/node-sqlite3-wasm.wasm",
  "dist/hooks/node-sqlite3-wasm.wasm"
);
