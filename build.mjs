// Builds the static site into dist/ (what GitHub Pages serves).
// `node build.mjs --serve` runs a local dev server with rebuilds.
import * as esbuild from "esbuild";
import fs from "node:fs/promises";

const serve = process.argv.includes("--serve");
await fs.rm("dist", { recursive: true, force: true });
await fs.mkdir("dist", { recursive: true });
for (const f of ["index.html", "styles.css"]) await fs.copyFile(`src/${f}`, `dist/${f}`);

const options = {
  entryPoints: ["src/app.js"],
  bundle: true,
  format: "esm",
  platform: "browser",
  target: "es2022",
  outfile: "dist/app.js",
  minify: !serve,
  sourcemap: serve,
  logLevel: "info",
};

if (serve) {
  const ctx = await esbuild.context(options);
  await ctx.watch();
  const { port } = await ctx.serve({ servedir: "dist", port: Number(process.env.PORT) || 3000 });
  console.log(`PM Practice running at http://localhost:${port} (rebuilds JS on change; restart for HTML/CSS)`);
} else {
  await esbuild.build(options);
}
