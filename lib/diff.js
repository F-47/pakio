/**
 * Parses a package string like "axios@1.7.9" or "@scope/pkg@1.0.0"
 * into { name, version }.
 */
function parsePkg(str) {
  if (str.startsWith('@')) {
    const rest = str.slice(1);
    const at = rest.indexOf('@');
    if (at === -1) return { name: str, version: 'latest' };
    return { name: '@' + rest.slice(0, at), version: rest.slice(at + 1) };
  }
  const at = str.indexOf('@');
  if (at === -1) return { name: str, version: 'latest' };
  return { name: str.slice(0, at), version: str.slice(at + 1) };
}

/**
 * Compares a template with the current project's package.json.
 */
export function getTemplateDiff(template, projectPkg) {
  const diff = {
    missingDeps: [],
    missingDevDeps: [],
    mismatches: [],
  };

  const projectDeps = projectPkg.dependencies || {};
  const projectDevDeps = projectPkg.devDependencies || {};
  const allProjectDeps = { ...projectDeps, ...projectDevDeps };

  template.dependencies.forEach((tPkgStr) => {
    const { name, version } = parsePkg(tPkgStr);
    const current = allProjectDeps[name];

    if (!current) {
      diff.missingDeps.push(tPkgStr);
    } else if (version !== 'latest' && current !== version) {
      // Remove prefixes like ^ or ~ for a simpler comparison if needed,
      // but for now we do exact match as the tool aims for reproducibility.
      diff.mismatches.push({ name, current, template: version });
    }
  });

  template.devDependencies.forEach((tPkgStr) => {
    const { name, version } = parsePkg(tPkgStr);
    const current = allProjectDeps[name];

    if (!current) {
      diff.missingDevDeps.push(tPkgStr);
    } else if (version !== 'latest' && current !== version) {
      diff.mismatches.push({ name, current, template: version });
    }
  });

  return diff;
}
