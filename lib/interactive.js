import * as p from "@clack/prompts";
import search from "@inquirer/search";
import fs from "fs";
import path from "path";
import { installPackageAsync } from "./pm.js";
import {
  loadTemplates,
  readProjectPackageJson,
  saveTemplates,
} from "./store.js";

export async function runInteractive() {
  p.intro("pakio — npm package template manager");

  while (true) {
    const action = await p.select({
      message: "What do you want to do?",
      options: [
        { value: "create", label: "Create a new template" },
        { value: "add", label: "Add packages to a template" },
        { value: "edit", label: "Edit a template" },
        { value: "apply", label: "Apply a template to this project" },
        { value: "view", label: "View templates" },
        { value: "transfer", label: "Import / Export" },
        { value: "remove", label: "Remove a template" },
        { value: "exit", label: "Exit" },
      ],
    });

    if (p.isCancel(action) || action === "exit") {
      p.outro("Bye!");
      break;
    }

    try {
      if (action === "create") await handleCreate();
      else if (action === "add") await handleAdd();
      else if (action === "edit") await handleEdit();
      else if (action === "apply") await handleApply();
      else if (action === "view") handleView();
      else if (action === "transfer") await handleTransfer();
      else if (action === "remove") await handleRemove();
    } catch (err) {
      p.log.error(err.message);
    }
  }
}

async function pickTemplate(message) {
  const templates = loadTemplates();
  const names = Object.keys(templates);

  if (!names.length) {
    p.log.warn("No templates yet. Create one first.");
    return null;
  }

  const choice = await p.select({
    message,
    options: names.map((n) => ({ value: n, label: n })),
  });

  if (p.isCancel(choice)) return null;

  return { templates, name: choice };
}

// Extracts base package name from a versioned string.
// Handles scoped packages: @scope/pkg@1.0.0 → @scope/pkg
function baseName(pkg) {
  if (pkg.startsWith("@")) {
    const rest = pkg.slice(1);
    const at = rest.indexOf("@");
    return at === -1 ? pkg : "@" + rest.slice(0, at);
  }
  return pkg.split("@")[0];
}

function handleView() {
  const templates = loadTemplates();
  const names = Object.keys(templates);

  if (!names.length) {
    p.log.warn("No templates saved yet.");
    return;
  }

  for (const name of names) {
    const { dependencies = [], devDependencies = [] } = templates[name];
    const lines = [
      ...dependencies.map((d) => `  dep  · ${d}`),
      ...devDependencies.map((d) => `  dev  · ${d}`),
    ];
    p.note(lines.length ? lines.join("\n") : "  (empty)", name);
  }
}

async function handleCreate() {
  const templates = loadTemplates();

  const name = await p.text({
    message: "Template name:",
    validate: (v) => {
      if (!v.trim()) return "Name cannot be empty.";
      if (templates[v.trim()]) return `"${v.trim()}" already exists.`;
    },
  });

  if (p.isCancel(name)) return;

  const trimmed = name.trim();
  templates[trimmed] = { dependencies: [], devDependencies: [] };
  saveTemplates(templates);
  p.log.success(`Template "${trimmed}" created.`);

  await handleAdd(trimmed);
}

async function handleAdd(preselected = null) {
  let templates, name;

  if (preselected) {
    templates = loadTemplates();
    name = preselected;
  } else {
    const result = await pickTemplate("Which template?");
    if (!result) return;
    ({ templates, name } = result);
  }

  const source = await p.select({
    message: "How do you want to add packages?",
    options: [
      { value: "manual", label: "Add manually" },
      { value: "import", label: "Import from current project's package.json" },
    ],
  });

  if (p.isCancel(source)) return;

  if (source === "manual") {
    await addManually(templates, name);
  } else {
    await addFromProject(templates, name);
  }
}

function debounce(fn, ms) {
  let timer;
  return (...args) =>
    new Promise((resolve, reject) => {
      clearTimeout(timer);
      timer = setTimeout(
        () =>
          fn(...args)
            .then(resolve)
            .catch(reject),
        ms,
      );
    });
}

const searchNpm = debounce(async (input) => {
  let res;
  try {
    res = await fetch(
      `https://registry.npmjs.org/-/v1/search?text=${encodeURIComponent(input)}&size=10`,
    );
  } catch {
    return [
      {
        name: "(npm unreachable — check your connection)",
        value: null,
        disabled: true,
      },
    ];
  }
  if (!res.ok) return [];
  const data = await res.json();
  return data.objects ?? [];
}, 300);

async function addManually(templates, name) {
  const type = await p.select({
    message: "Dependency type?",
    options: [
      { value: "dependencies", label: "dependencies" },
      { value: "devDependencies", label: "devDependencies" },
    ],
  });

  if (p.isCancel(type)) return;

  const pin = await p.select({
    message: "Version preference?",
    options: [
      {
        value: true,
        label: "Pin to latest",
        hint: "e.g. axios@1.7.9 — reproducible",
      },
      {
        value: false,
        label: "Latest only",
        hint: "e.g. axios — always installs newest",
      },
    ],
  });

  if (p.isCancel(pin)) return;

  const existing = new Set(templates[name][type]);
  const added = [];

  while (true) {
    let pkg;
    try {
      pkg = await search({
        message: added.length
          ? `Search npm (${added.length} added — Ctrl+C to finish):`
          : "Search npm (Ctrl+C to finish):",
        source: async (input) => {
          if (!input?.trim()) return [];
          const objects = await searchNpm(input.trim());
          return objects.map(({ package: pkg }) => ({
            name: `${pkg.name}@${pkg.version}${pkg.description ? ` — ${pkg.description}` : ""}`,
            value: pin ? `${pkg.name}@${pkg.version}` : pkg.name,
            disabled: [...existing].some((e) => baseName(e) === pkg.name)
              ? "already added"
              : false,
          }));
        },
      });
    } catch {
      break; // Ctrl+C — user is done
    }

    if (!pkg) continue;

    if ([...existing].some((e) => baseName(e) === baseName(pkg))) {
      p.log.warn(`"${baseName(pkg)}" is already in this template.`);
      continue;
    }

    existing.add(pkg);
    added.push(pkg);
    p.log.success(`+ ${pkg}`);
  }

  if (!added.length) {
    p.log.info("No packages added.");
    return;
  }

  templates[name][type] = [...existing];
  saveTemplates(templates);
  p.log.success(`Saved ${added.length} package(s) to "${name}" [${type}].`);
}

async function addFromProject(templates, name) {
  let pkg;
  try {
    pkg = readProjectPackageJson();
  } catch {
    p.log.error("No package.json found in current directory.");
    return;
  }

  const deps = Object.entries(pkg.dependencies || {});
  const devDeps = Object.entries(pkg.devDependencies || {});

  if (!deps.length && !devDeps.length) {
    p.log.warn("No dependencies found in current package.json.");
    return;
  }

  const options = [
    ...deps.map(([n, v]) => ({
      value: `dep:${n}@${v}`,
      label: n,
      hint: `dependency  ${v}`,
    })),
    ...devDeps.map(([n, v]) => ({
      value: `devDep:${n}@${v}`,
      label: n,
      hint: `devDependency  ${v}`,
    })),
  ];

  const selected = await p.multiselect({
    message: "Select packages to import (space to deselect):",
    options,
    initialValues: options.map((o) => o.value),
  });

  if (p.isCancel(selected) || !selected.length) {
    p.log.info("Cancelled.");
    return;
  }

  const selectedDeps = selected
    .filter((v) => v.startsWith("dep:"))
    .map((v) => v.slice(4));
  const selectedDevDeps = selected
    .filter((v) => v.startsWith("devDep:"))
    .map((v) => v.slice(7));

  const existingDeps = new Set(templates[name].dependencies);
  const existingDevDeps = new Set(templates[name].devDependencies);

  selectedDeps.forEach((d) => existingDeps.add(d));
  selectedDevDeps.forEach((d) => existingDevDeps.add(d));

  templates[name].dependencies = [...existingDeps];
  templates[name].devDependencies = [...existingDevDeps];
  saveTemplates(templates);

  p.log.success(`Merged ${selected.length} package(s) into "${name}".`);
}

async function handleEdit() {
  const result = await pickTemplate("Which template to edit?");
  if (!result) return;

  const { templates, name } = result;

  const action = await p.select({
    message: `Editing "${name}"`,
    options: [
      { value: "manage", label: "Manage packages" },
      { value: "rename", label: "Rename" },
    ],
  });

  if (p.isCancel(action)) return;

  if (action === "manage") await editManagePackages(templates, name);
  else await editRename(templates, name);
}

async function editManagePackages(templates, name) {
  const { dependencies = [], devDependencies = [] } = templates[name];

  if (!dependencies.length && !devDependencies.length) {
    p.log.warn("This template has no packages.");
    return;
  }

  const options = [
    ...dependencies.map((d) => ({
      value: `dep:${d}`,
      label: baseName(d),
      hint: `dependency  ${d.includes("@") ? d.split("@").pop() : ""}`,
    })),
    ...devDependencies.map((d) => ({
      value: `devDep:${d}`,
      label: baseName(d),
      hint: `devDependency  ${d.includes("@") ? d.split("@").pop() : ""}`,
    })),
  ];

  const selected = await p.multiselect({
    message: "Manage packages (deselect to remove, enter to confirm):",
    options,
    initialValues: options.map((o) => o.value),
  });

  if (p.isCancel(selected)) return;

  const keptDeps = selected
    .filter((v) => v.startsWith("dep:"))
    .map((v) => v.slice(4));
  const keptDevDeps = selected
    .filter((v) => v.startsWith("devDep:"))
    .map((v) => v.slice(7));
  const removed = options.length - selected.length;

  templates[name].dependencies = keptDeps;
  templates[name].devDependencies = keptDevDeps;
  saveTemplates(templates);

  if (removed > 0) {
    p.log.success(`Removed ${removed} package(s) from "${name}".`);
  } else {
    p.log.info("No changes made.");
  }
}

async function editRename(templates, name) {
  const newName = await p.text({
    message: "New name:",
    initialValue: name,
    validate: (v) => {
      if (!v.trim()) return "Name cannot be empty.";
      if (v.trim() === name) return "That is the same name.";
      if (templates[v.trim()]) return `"${v.trim()}" already exists.`;
    },
  });

  if (p.isCancel(newName)) return;

  const trimmed = newName.trim();
  templates[trimmed] = templates[name];
  delete templates[name];
  saveTemplates(templates);

  p.log.success(`Renamed "${name}" → "${trimmed}".`);
}

async function installWithProgress(packages, isDev) {
  const label = isDev ? "devDependency" : "dependency";
  let failed = 0;

  for (const pkg of packages) {
    const s = p.spinner();
    s.start(`Installing ${label}: ${pkg}`);
    try {
      await installPackageAsync(pkg, isDev);
      s.stop(`✔ Installed ${pkg}`);
    } catch (err) {
      s.stop(`✘ Failed to install ${pkg}`);
      const stderr = err.stderr?.trim();
      if (stderr) p.log.error(stderr);
      failed++;
    }
  }

  return failed;
}

async function handleApply() {
  try {
    readProjectPackageJson();
  } catch {
    p.log.error("No package.json found in current directory.");
    return;
  }

  const result = await pickTemplate("Which template to apply?");
  if (!result) return;

  const { templates, name } = result;
  const { dependencies = [], devDependencies = [] } = templates[name];

  if (!dependencies.length && !devDependencies.length) {
    p.log.warn(`Template "${name}" has no packages to install.`);
    return;
  }

  const preview = [
    ...dependencies.map((d) => `  dep  · ${d}`),
    ...devDependencies.map((d) => `  dev  · ${d}`),
  ].join("\n");
  p.note(preview, name);

  const confirmed = await p.confirm({ message: "Install these packages now?" });
  if (p.isCancel(confirmed) || !confirmed) {
    p.log.info("Cancelled.");
    return;
  }

  const total = dependencies.length + devDependencies.length;
  let totalFailed = 0;

  if (dependencies.length)
    totalFailed += await installWithProgress(dependencies, false);
  if (devDependencies.length)
    totalFailed += await installWithProgress(devDependencies, true);

  const succeeded = total - totalFailed;
  if (totalFailed === 0) {
    p.log.success(
      `Template "${name}" applied — ${succeeded}/${total} packages installed.`,
    );
  } else {
    p.log.warn(
      `Template "${name}" applied with issues — ${succeeded}/${total} installed, ${totalFailed} failed.`,
    );
  }
}

async function handleTransfer() {
  const action = await p.select({
    message: "Import / Export",
    options: [
      { value: "export", label: "Export templates to a file" },
      { value: "import", label: "Import templates from a file" },
    ],
  });

  if (p.isCancel(action)) return;

  if (action === "export") await handleExport();
  else await handleImportFile();
}

async function handleExport() {
  const templates = loadTemplates();
  const names = Object.keys(templates);

  if (!names.length) {
    p.log.warn("No templates saved yet. Create one first.");
    return;
  }

  const selected = await p.multiselect({
    message: "Select templates to export (space to select, enter to confirm):",
    options: names.map((n) => ({ value: n, label: n })),
    initialValues: names,
  });

  if (p.isCancel(selected) || !selected.length) {
    p.log.info("Cancelled.");
    return;
  }

  const defaultName =
    selected.length === 1 ? `${selected[0]}.json` : "pakio-export.json";

  const filename = await p.text({
    message: "Output filename:",
    initialValue: defaultName,
    validate: (v) => (v.trim() ? undefined : "Filename cannot be empty."),
  });

  if (p.isCancel(filename)) return;

  const output = {};
  selected.forEach((n) => (output[n] = templates[n]));

  const dest = path.resolve(process.cwd(), filename.trim());
  fs.writeFileSync(dest, JSON.stringify(output, null, 2), "utf8");
  p.log.success(`Exported ${selected.length} template(s) to ${dest}`);
}

async function handleImportFile() {
  const filepath = await p.text({
    message: "Path to JSON file:",
    placeholder: "./pakio-export.json",
    validate: (v) => {
      if (!v.trim()) return "Path cannot be empty.";
      if (!fs.existsSync(path.resolve(process.cwd(), v.trim())))
        return "File not found.";
    },
  });

  if (p.isCancel(filepath)) return;

  let incoming;
  try {
    const raw = fs.readFileSync(
      path.resolve(process.cwd(), filepath.trim()),
      "utf8",
    );
    incoming = JSON.parse(raw);
  } catch {
    p.log.error(
      "Could not read or parse the file. Make sure it is a valid pakio JSON export.",
    );
    return;
  }

  const incomingNames = Object.keys(incoming);
  if (!incomingNames.length) {
    p.log.warn("No templates found in that file.");
    return;
  }

  const selected = await p.multiselect({
    message: "Select templates to import (space to select, enter to confirm):",
    options: incomingNames.map((n) => ({
      value: n,
      label: n,
      hint: [
        incoming[n].dependencies?.length &&
          `${incoming[n].dependencies.length} dep`,
        incoming[n].devDependencies?.length &&
          `${incoming[n].devDependencies.length} devDep`,
      ]
        .filter(Boolean)
        .join(", "),
    })),
    initialValues: incomingNames,
  });

  if (p.isCancel(selected) || !selected.length) {
    p.log.info("Cancelled.");
    return;
  }

  const templates = loadTemplates();
  const conflicts = selected.filter((n) => templates[n]);

  if (conflicts.length) {
    const overwrite = await p.confirm({
      message: `${conflicts.map((n) => `"${n}"`).join(", ")} already exist. Overwrite?`,
      initialValue: false,
    });
    if (p.isCancel(overwrite) || !overwrite) {
      p.log.info("Cancelled.");
      return;
    }
  }

  selected.forEach((n) => (templates[n] = incoming[n]));
  saveTemplates(templates);
  p.log.success(`Imported: ${selected.join(", ")}`);
}

async function handleRemove() {
  const templates = loadTemplates();
  const names = Object.keys(templates);

  if (!names.length) {
    p.log.warn("No templates saved yet. Create one first.");
    return;
  }

  const selected = await p.multiselect({
    message: "Select templates to remove (space to select, enter to confirm):",
    options: names.map((n) => ({ value: n, label: n })),
  });

  if (p.isCancel(selected) || !selected.length) {
    p.log.info("Cancelled.");
    return;
  }

  const confirmed = await p.confirm({
    message: `Remove ${selected.length === 1 ? `"${selected[0]}"` : `${selected.length} templates`}?`,
    initialValue: false,
  });

  if (p.isCancel(confirmed) || !confirmed) {
    p.log.info("Cancelled.");
    return;
  }

  selected.forEach((n) => delete templates[n]);
  saveTemplates(templates);
  p.log.success(`Removed: ${selected.join(", ")}`);
}
