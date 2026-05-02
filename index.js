#!/usr/bin/env node

const [major] = process.versions.node.split(".").map(Number);
if (major < 18) {
  console.error(
    `pakio requires Node.js 18 or higher. You are running ${process.version}.`,
  );
  process.exit(1);
}

import { intro, log, outro, spinner } from "@clack/prompts";
import { program } from "commander";
import fs from "fs";
import path from "path";
import { runInteractive } from "./lib/interactive.js";
import { installPackageAsync } from "./lib/pm.js";
import {
  getTemplate,
  loadTemplates,
  readProjectPackageJson,
  saveTemplates,
} from "./lib/store.js";
import { getTemplateDiff } from "./lib/diff.js";

async function installPackages(packages, isDev) {
  const label = isDev ? "devDependency" : "dependency";
  let failed = 0;

  for (const pkg of packages) {
    const s = spinner();
    s.start(`Installing ${label}: ${pkg}`);
    try {
      await installPackageAsync(pkg, isDev);
      s.stop(`✔ Installed ${pkg}`);
    } catch (err) {
      s.stop(`✘ Failed to install ${pkg}`);
      const stderr = err.stderr?.trim();
      if (stderr) log.error(stderr);
      failed++;
    }
  }

  return failed;
}

program
  .name("pakio")
  .description("Save, manage, and reuse npm package templates across projects")
  .version("1.0.0");

// pakio create <template-name>
program
  .command("create <name>")
  .description("Create an empty template")
  .action((name) => {
    const templates = loadTemplates();
    if (templates[name]) {
      console.error(`Error: Template "${name}" already exists.`);
      process.exit(1);
    }
    templates[name] = { dependencies: [], devDependencies: [] };
    saveTemplates(templates);
    console.log(`Template "${name}" created.`);
  });

// pakio add <template-name> <packages...>
program
  .command("add <name> <packages...>")
  .description("Add packages to a template")
  .option("-D, --dev", "Add as devDependencies")
  .action((name, packages, opts) => {
    const templates = loadTemplates();
    getTemplate(templates, name); // validates existence

    const key = opts.dev ? "devDependencies" : "dependencies";
    const existing = new Set(templates[name][key]);
    const added = [];

    for (const pkg of packages) {
      if (!existing.has(pkg)) {
        existing.add(pkg);
        added.push(pkg);
      }
    }

    templates[name][key] = [...existing];
    saveTemplates(templates);

    if (added.length) {
      console.log(`Added to "${name}" [${key}]: ${added.join(", ")}`);
    } else {
      console.log(`All packages already present in "${name}" [${key}].`);
    }
  });

// pakio apply <template-name>
program
  .command("apply <name>")
  .description("Install all packages from a template into the current project")
  .option("--dev", "Only install devDependencies")
  .option("--deps", "Only install dependencies")
  .action(async (name, opts) => {
    const templates = loadTemplates();
    const template = getTemplate(templates, name);

    readProjectPackageJson(); // ensures package.json exists

    let { dependencies = [], devDependencies = [] } = template;

    if (opts.dev) dependencies = [];
    if (opts.deps) devDependencies = [];

    if (!dependencies.length && !devDependencies.length) {
      log.warn(`No packages to install for "${name}" with current filters.`);
      return;
    }

    const total = dependencies.length + devDependencies.length;
    intro(`Applying template "${name}" — ${total} package(s) to install`);

    let totalFailed = 0;

    if (dependencies.length) {
      totalFailed += await installPackages(dependencies, false);
    }

    if (devDependencies.length) {
      totalFailed += await installPackages(devDependencies, true);
    }

    const succeeded = total - totalFailed;
    if (totalFailed === 0) {
      outro(
        `✔ Template "${name}" applied — ${succeeded}/${total} packages installed successfully.`,
      );
    } else {
      outro(
        `⚠ Template "${name}" applied with issues — ${succeeded}/${total} packages installed (${totalFailed} failed).`,
      );
    }
  });

// pakio import <template-name>
program
  .command("import <name>")
  .description("Import the current project's dependencies into a template")
  .action((name) => {
    const pkg = readProjectPackageJson();
    const templates = loadTemplates();

    const dependencies = Object.keys(pkg.dependencies || {});
    const devDependencies = Object.keys(pkg.devDependencies || {});

    if (!dependencies.length && !devDependencies.length) {
      console.log("No dependencies found in current package.json.");
      return;
    }

    if (templates[name]) {
      console.log(`Overwriting existing template "${name}".`);
    }

    templates[name] = { dependencies, devDependencies };
    saveTemplates(templates);

    console.log(`Template "${name}" imported.`);
    if (dependencies.length)
      console.log(`  dependencies:    ${dependencies.join(", ")}`);
    if (devDependencies.length)
      console.log(`  devDependencies: ${devDependencies.join(", ")}`);
  });

// pakio remove <template-name>
program
  .command("remove <name>")
  .description("Remove a template")
  .action((name) => {
    const templates = loadTemplates();
    getTemplate(templates, name);
    delete templates[name];
    saveTemplates(templates);
    console.log(`Template "${name}" removed.`);
  });

// pakio rename <old-name> <new-name>
program
  .command("rename <oldName> <newName>")
  .description("Rename a template")
  .action((oldName, newName) => {
    const templates = loadTemplates();
    getTemplate(templates, oldName);

    if (templates[newName]) {
      console.error(`Error: Template "${newName}" already exists.`);
      process.exit(1);
    }

    templates[newName] = templates[oldName];
    delete templates[oldName];
    saveTemplates(templates);
    console.log(`Template "${oldName}" renamed to "${newName}".`);
  });

// pakio remove-pkg <template-name> <packages...>
program
  .command("remove-pkg <name> <packages...>")
  .description("Remove packages from a template")
  .action((name, packages) => {
    const templates = loadTemplates();
    const template = getTemplate(templates, name);

    let removed = 0;
    ["dependencies", "devDependencies"].forEach((key) => {
      const originalCount = template[key].length;
      template[key] = template[key].filter((p) => !packages.includes(p));
      removed += originalCount - template[key].length;
    });

    if (removed > 0) {
      saveTemplates(templates);
      console.log(`Removed ${removed} package(s) from "${name}".`);
    } else {
      console.log(`None of the specified packages were found in "${name}".`);
    }
  });

// pakio diff <template-name>
program
  .command("diff <name>")
  .description("Compare a template with the current project's dependencies")
  .action((name) => {
    const templates = loadTemplates();
    const template = getTemplate(templates, name);
    const projectPkg = readProjectPackageJson();

    const diff = getTemplateDiff(template, projectPkg);
    const hasDiff =
      diff.missingDeps.length ||
      diff.missingDevDeps.length ||
      diff.mismatches.length;

    if (!hasDiff) {
      log.success(`Project is up to date with template "${name}".`);
      return;
    }

    intro(`Diff for template "${name}"`);

    if (diff.missingDeps.length) {
      log.step("Missing dependencies:");
      diff.missingDeps.forEach((p) => log.info(`+ ${p}`));
    }

    if (diff.missingDevDeps.length) {
      if (diff.missingDeps.length) console.log("");
      log.step("Missing devDependencies:");
      diff.missingDevDeps.forEach((p) => log.info(`+ ${p}`));
    }

    if (diff.mismatches.length) {
      if (diff.missingDeps.length || diff.missingDevDeps.length)
        console.log("");
      log.step("Different versions:");
      diff.mismatches.forEach((m) =>
        log.info(`~ ${m.name} (current: ${m.current}, template: ${m.template})`),
      );
    }

    outro("Run `pakio apply <name>` to sync.");
  });

// pakio export <templates...> --output <file>
program
  .command("export [names...]")
  .description("Export templates to a JSON file")
  .option("-o, --output <file>", "Output filename", "pakio-export.json")
  .action((names, opts) => {
    const templates = loadTemplates();
    const toExport = names.length ? names : Object.keys(templates);

    if (!toExport.length) {
      console.error("No templates saved.");
      process.exit(1);
    }

    toExport.forEach((n) => getTemplate(templates, n));

    const output = {};
    toExport.forEach((n) => (output[n] = templates[n]));

    const dest = path.resolve(process.cwd(), opts.output);
    fs.writeFileSync(dest, JSON.stringify(output, null, 2), "utf8");
    console.log(`Exported ${toExport.length} template(s) to ${dest}`);
  });

// pakio import-file <file>
program
  .command("import-file <file>")
  .description("Import templates from a JSON file")
  .action((file) => {
    const src = path.resolve(process.cwd(), file);
    if (!fs.existsSync(src)) {
      console.error(`File not found: ${src}`);
      process.exit(1);
    }

    let incoming;
    try {
      incoming = JSON.parse(fs.readFileSync(src, "utf8"));
    } catch {
      console.error(
        "Could not parse file. Make sure it is a valid pakio JSON export.",
      );
      process.exit(1);
    }

    const templates = loadTemplates();
    const names = Object.keys(incoming);

    names.forEach((n) => (templates[n] = incoming[n]));
    saveTemplates(templates);
    console.log(`Imported: ${names.join(", ")}`);
  });

// pakio list
program
  .command("list")
  .description("List all saved templates")
  .action(() => {
    const templates = loadTemplates();
    const names = Object.keys(templates);

    if (!names.length) {
      console.log("No templates saved. Run: pakio create <name>");
      return;
    }

    console.log(`Saved templates (${names.length}):\n`);
    for (const name of names) {
      const { dependencies = [], devDependencies = [] } = templates[name];
      console.log(`  ${name}`);
      if (dependencies.length)
        console.log(`    dependencies:    ${dependencies.join(", ")}`);
      if (devDependencies.length)
        console.log(`    devDependencies: ${devDependencies.join(", ")}`);
      if (!dependencies.length && !devDependencies.length)
        console.log("    (empty)");
    }
  });

const hasSubcommand = process.argv.slice(2).length > 0;

if (hasSubcommand) {
  try {
    program.parse();
  } catch (err) {
    console.error(`Error: ${err.message}`);
    process.exit(1);
  }
} else {
  runInteractive().catch((err) => {
    console.error(`Error: ${err.message}`);
    process.exit(1);
  });
}
