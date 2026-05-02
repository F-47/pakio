import { spawn } from "child_process";
import fs from "fs";
import path from "path";

export function detectPackageManager() {
  const cwd = process.cwd();
  if (fs.existsSync(path.join(cwd, "yarn.lock"))) return "yarn";
  if (fs.existsSync(path.join(cwd, "pnpm-lock.yaml"))) return "pnpm";
  if (fs.existsSync(path.join(cwd, "package-lock.json"))) return "npm";
  return "npm";
}

export function getPMConfig(pm) {
  switch (pm) {
    case "yarn":
      return {
        command: "yarn",
        getArgs: (pkg, isDev) =>
          ["add", isDev ? "--dev" : "", pkg].filter(Boolean),
      };
    case "pnpm":
      return {
        command: "pnpm",
        getArgs: (pkg, isDev) =>
          ["add", isDev ? "-D" : "", pkg].filter(Boolean),
      };
    default:
      return {
        command: "npm",
        getArgs: (pkg, isDev) =>
          ["install", isDev ? "--save-dev" : "--save", pkg].filter(Boolean),
      };
  }
}

export function installPackageAsync(pkg, isDev) {
  const pm = detectPackageManager();
  const config = getPMConfig(pm);
  const args = config.getArgs(pkg, isDev);

  return new Promise((resolve, reject) => {
    const child = spawn(config.command, args, {
      stdio: "pipe",
      shell: true,
    });
    let stderr = "";
    child.stderr.on("data", (d) => (stderr += d.toString()));
    child.on("close", (code) => {
      if (code === 0) resolve();
      else
        reject(
          Object.assign(new Error(`Exit ${code} using ${pm}`), { stderr }),
        );
    });
  });
}
