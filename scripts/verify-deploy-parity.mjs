import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";

const distRoot = path.resolve("dist");
const publishRoot = path.resolve(process.argv[2] || "../Sakauma.github.io");

async function exists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function hashFile(filePath) {
  const buffer = await fs.readFile(filePath);
  return createHash("sha256").update(buffer).digest("hex");
}

async function collectFiles(root, directory = root, map = new Map()) {
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    if (entry.name === ".git") continue;
    const current = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      await collectFiles(root, current, map);
    } else {
      const relativePath = path.relative(root, current).split(path.sep).join("/");
      const stat = await fs.stat(current);
      map.set(relativePath, {
        hash: await hashFile(current),
        size: stat.size
      });
    }
  }
  return map;
}

function sample(values) {
  return values.slice(0, 20);
}

if (!(await exists(distRoot))) {
  throw new Error("Missing dist/. Run npm run build first.");
}

if (!(await exists(publishRoot))) {
  throw new Error(`Missing publish repository: ${publishRoot}`);
}

const distFiles = await collectFiles(distRoot);
const publishFiles = await collectFiles(publishRoot);
const distPaths = [...distFiles.keys()].sort();
const publishPaths = [...publishFiles.keys()].sort();
const publishSet = new Set(publishPaths);
const distSet = new Set(distPaths);
const distOnly = distPaths.filter((filePath) => !publishSet.has(filePath));
const publishOnly = publishPaths.filter((filePath) => !distSet.has(filePath));
const different = distPaths.filter((filePath) => {
  const publishFile = publishFiles.get(filePath);
  return publishFile && publishFile.hash !== distFiles.get(filePath).hash;
});

const requiredRoutes = [
  "recent-updates/index.html",
  "archives/page/7/index.html",
  "tags/翻译/page/7/index.html",
  "categories/列托夫、苏联和地下朋克的一切/index.html"
];

const missingRequiredRoutes = requiredRoutes.filter((filePath) => !distFiles.has(filePath));
const report = {
  distFiles: distFiles.size,
  publishFiles: publishFiles.size,
  commonFiles: distPaths.length - distOnly.length,
  distOnly: distOnly.length,
  publishOnly: publishOnly.length,
  different: different.length,
  missingRequiredRoutes
};

console.log(JSON.stringify(report, null, 2));

if (distOnly.length || publishOnly.length || different.length || missingRequiredRoutes.length) {
  console.error("Deployment parity check failed.");
  if (distOnly.length) console.error("dist-only sample:", sample(distOnly));
  if (publishOnly.length) console.error("publish-only sample:", sample(publishOnly));
  if (different.length) console.error("different sample:", sample(different));
  if (missingRequiredRoutes.length) console.error("missing required routes:", missingRequiredRoutes);
  process.exit(1);
}

console.log("Deployment parity check passed: dist/ is byte-identical to the publish repository.");
