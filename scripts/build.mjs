import { promises as fs } from "node:fs";
import path from "node:path";

const root = process.cwd();
const dist = path.join(root, "dist");
const snapshotRoot = path.join(root, "src", "publish-snapshot");

async function exists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function copyDir(source, target) {
  await fs.mkdir(target, { recursive: true });
  for (const entry of await fs.readdir(source, { withFileTypes: true })) {
    if (entry.name === ".git") continue;
    const from = path.join(source, entry.name);
    const to = path.join(target, entry.name);
    if (entry.isDirectory()) {
      await copyDir(from, to);
    } else {
      await fs.copyFile(from, to);
    }
  }
}

async function countFiles(directory) {
  let count = 0;
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    const current = path.join(directory, entry.name);
    if (entry.isDirectory()) count += await countFiles(current);
    else count += 1;
  }
  return count;
}

if (!(await exists(snapshotRoot))) {
  throw new Error("Missing src/publish-snapshot. This repository builds from the current Sakauma.github.io snapshot so output stays deployment-identical.");
}

await fs.rm(dist, { recursive: true, force: true });
await copyDir(snapshotRoot, dist);

const files = await countFiles(dist);
console.log(`Built deployment-identical snapshot into dist/ (${files} files).`);
console.log("Existing blog sources live in content/posts; add-new-post indexing can be layered on top after the snapshot parity baseline is stable.");
