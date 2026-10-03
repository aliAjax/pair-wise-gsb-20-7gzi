// 领域规则测试：用 vite 自带的 esbuild 编译 TS 后在 Node 运行，无需额外测试框架
import { build } from "esbuild";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const outfile = path.join(root, ".tmp", "domain.test.cjs");

await build({
  entryPoints: [path.join(root, "tests", "domain.test.ts")],
  bundle: true,
  platform: "node",
  format: "cjs",
  outfile,
  logLevel: "warning",
});

await import(pathToFileURL(outfile).href);
