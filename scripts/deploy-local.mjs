import { promises as fs } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

// Publishing is explicit: this script mirrors dist, commits, and pushes main.
// Every preflight must finish before any target files are removed.
const sourceDist = await fs.realpath(path.resolve("dist"));
const target = await fs.realpath(path.resolve(process.argv[2] || "../Sakauma.github.io"));
const allowedRemotes = new Set([
  "git@github.com:Sakauma/Sakauma.github.io.git",
  "git@github.com:Sakauma/Sakauma.github.io",
  "https://github.com/Sakauma/Sakauma.github.io.git",
  "https://github.com/Sakauma/Sakauma.github.io",
  "ssh://git@github.com/Sakauma/Sakauma.github.io.git",
  "ssh://git@github.com/Sakauma/Sakauma.github.io"
]);

function git(args) {
  const result = spawnSync("git", args, { cwd: target, encoding: "utf8" });
  if (result.error || result.status !== 0) {
    throw new Error(`git ${args.join(" ")} failed; publication stopped.\n${result.error?.message || result.stderr || result.stdout}`);
  }
  return result.stdout.trim();
}
function contains(parent, child) {
  const rel = path.relative(parent, child);
  return rel === "" || (!rel.startsWith(`..${path.sep}`) && rel !== ".." && !path.isAbsolute(rel));
}
async function validateTree(dir) {
  for (const ent of await fs.readdir(dir, { withFileTypes: true })) {
    if (ent.name === ".git" || ent.isSymbolicLink() || (!ent.isDirectory() && !ent.isFile())) {
      throw new Error(`Unsafe build entry: ${path.join(dir, ent.name)}`);
    }
    if (ent.isDirectory()) await validateTree(path.join(dir, ent.name));
  }
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

if (contains(sourceDist, target) || contains(target, sourceDist)) throw new Error("Build and deployment directories must not overlap.");
if (await fs.realpath(git(["rev-parse", "--show-toplevel"])) !== target) throw new Error("Target must be the root of the deployment checkout.");
for (const args of [["remote", "get-url", "--all", "origin"], ["remote", "get-url", "--push", "--all", "origin"]]) {
  const remotes = git(args).split(/\r?\n/);
  if (remotes.length !== 1 || !allowedRemotes.has(remotes[0])) throw new Error(`Refusing unexpected deployment remote: ${remotes.join(", ")}`);
}
if (git(["branch", "--show-current"]) !== "main") throw new Error("Deployment checkout must be on main (not detached).");
if (git(["status", "--porcelain", "--untracked-files=all", "--ignored"])) throw new Error("Deployment checkout has changed, untracked, or ignored files. Preserve them before publishing; nothing was deleted.");
for (const required of ["index.html", ".nojekyll"]) {
  if (!(await fs.stat(path.join(sourceDist, required))).isFile()) throw new Error(`Build is missing ${required}`);
}
await validateTree(sourceDist);
git(["fetch", "origin", "main"]);
if (git(["rev-parse", "HEAD"]) !== git(["rev-parse", "FETCH_HEAD"])) throw new Error("Deployment main differs from origin/main. Reconcile it manually before publishing; nothing was deleted.");

console.log(`Mirroring ${sourceDist} to ${target}; tracked files absent from dist will be removed.`);
for (const ent of await fs.readdir(target, { withFileTypes: true })) {
  if (ent.name !== ".git") await fs.rm(path.join(target, ent.name), { recursive: true, force: true });
}
await copyDir(sourceDist, target);
git(["add", "-A"]);
if (!git(["diff", "--cached", "--name-only"])) {
  console.log("Deployment already matches this build; no commit or push needed.");
} else {
  git(["commit", "-m", "Deploy site from source build"]);
  git(["push", "origin", "HEAD:refs/heads/main"]);
  console.log("Published build to Sakauma/Sakauma.github.io main.");
}
