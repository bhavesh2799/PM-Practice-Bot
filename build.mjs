// Builds the static site into dist/ (what GitHub Pages serves).
// `node build.mjs --serve` runs a local dev server with rebuilds.
import * as esbuild from "esbuild";
import fs from "node:fs/promises";
import crypto from "node:crypto";

const serve = process.argv.includes("--serve");
await fs.rm("dist", { recursive: true, force: true });
await fs.mkdir("dist", { recursive: true });
await fs.copyFile("src/styles.css", "dist/styles.css");

const options = {
  entryPoints: ["src/app.js"],
  bundle: true,
  format: "esm",
  platform: "browser",
  target: "es2022",
  outfile: "dist/app.js",
  minify: !serve,
  define: { __BUILD__: JSON.stringify(new Date().toISOString().slice(0, 16).replace("T", " ") + " UTC") },
  sourcemap: serve,
  logLevel: "info",
};

// GitHub Pages lets browsers cache files for 10 minutes. Adding a content hash
// to the asset URLs makes every deploy show up on the next page load.
async function writeHtml() {
  const hash = async (f) => crypto.createHash("sha256").update(await fs.readFile(f)).digest("hex").slice(0, 10);
  const html = (await fs.readFile("src/index.html", "utf8"))
    .replace('href="./styles.css"', `href="./styles.css?v=${await hash("dist/styles.css")}"`)
    .replace('src="./app.js"', `src="./app.js?v=${await hash("dist/app.js")}"`);
  await fs.writeFile("dist/index.html", html);
}

if (serve) {
  const ctx = await esbuild.context(options);
  await ctx.rebuild();
  await writeHtml();
  await ctx.watch();
  const { port } = await ctx.serve({ servedir: "dist", port: Number(process.env.PORT) || 3000 });
  console.log(`PM Practice running at http://localhost:${port} (rebuilds JS on change; restart for HTML/CSS)`);
} else {
  await esbuild.build(options);
  await writeHtml();
}
