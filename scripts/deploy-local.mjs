import { promises as fs } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const sourceDist = path.resolve("dist");
const target = path.resolve(process.argv[2] || "../Sakauma.github.io");
const keep = new Set([".git"]);

async function exists(p) {
  try { await fs.access(p); return true; } catch { return false; }
}

async function copyDir(src, dest) {
  await fs.mkdir(dest, { recursive: true });
  for (const ent of await fs.readdir(src, { withFileTypes: true })) {
    const s = path.join(src, ent.name);
    const d = path.join(dest, ent.name);
    if (ent.isDirectory()) await copyDir(s, d);
    else await fs.copyFile(s, d);
  }
}

if (!(await exists(sourceDist))) throw new Error("dist/ does not exist. Run npm run build first.");
if (!(await exists(path.join(target, ".git")))) throw new Error(`Target is not a git repository: ${target}`);
const remote = spawnSync("git", ["remote", "get-url", "origin"], { cwd: target, encoding: "utf8" }).stdout.trim();
if (!/Sakauma\/Sakauma\.github\.io|Sakauma\.github\.io\.git/.test(remote)) {
  throw new Error(`Refusing to deploy to unexpected remote: ${remote}`);
}
for (const ent of await fs.readdir(target, { withFileTypes: true })) {
  if (!keep.has(ent.name)) await fs.rm(path.join(target, ent.name), { recursive: true, force: true });
}
await copyDir(sourceDist, target);
spawnSync("git", ["add", "-A"], { cwd: target, stdio: "inherit" });
spawnSync("git", ["commit", "-m", "Deploy site from source build"], { cwd: target, stdio: "inherit" });
spawnSync("git", ["push", "origin", "main"], { cwd: target, stdio: "inherit" });
