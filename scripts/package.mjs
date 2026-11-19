import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const manifest = JSON.parse(readFileSync(join(root, "manifest.json"), "utf8"));
const runtime = ["manifest.json", "shared.js", "elevation-providers.js", "page-interceptor.js", "background.js", "content.js", "styles.css",
  "options.html", "options.css", "options.js", "icons", "PRIVACY.md", "LICENSE"];
const source = [...runtime, "README.md", "package.json", "package-lock.json", "scripts", "tests", ".github", ".gitignore", "docs", "screenshots"];
const dist = join(root, "dist");
mkdirSync(dist, { recursive: true });
const temporary = mkdtempSync(join(tmpdir(), "inat-elevation-package-"));

function files(directory, prefix = "") {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const relative = join(prefix, entry.name);
    return entry.isDirectory() ? files(join(directory, entry.name), relative) : [relative];
  }).sort();
}

try {
  for (const [label, includes, nested] of [
    ["chrome-web-store", runtime, false], ["source", source, true]
  ]) {
    const stage = join(temporary, label);
    const destination = nested ? join(stage, "inaturalist-elevation") : stage;
    mkdirSync(destination, { recursive: true });
    for (const name of includes) {
      const target = join(destination, name);
      mkdirSync(dirname(target), { recursive: true });
      cpSync(join(root, name), target, { recursive: true });
    }
    const archive = join(dist, `inaturalist-elevation-v${manifest.version}-${label}.zip`);
    if (existsSync(archive)) rmSync(archive);
    execFileSync("zip", ["-X", "-q", archive, "-@"], { cwd: stage, input: files(stage).join("\n") + "\n" });
    execFileSync("unzip", ["-t", archive], { stdio: "pipe" });
    console.log(archive);
  }
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
