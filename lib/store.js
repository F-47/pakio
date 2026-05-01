import fs from 'fs';
import path from 'path';
import os from 'os';

const STORE_DIR = path.join(os.homedir(), '.pakio');
const STORE_PATH = path.join(STORE_DIR, 'templates.json');

export function loadTemplates() {
  if (!fs.existsSync(STORE_DIR)) {
    fs.mkdirSync(STORE_DIR, { recursive: true });
  }
  if (!fs.existsSync(STORE_PATH)) {
    fs.writeFileSync(STORE_PATH, '{}', 'utf8');
    return {};
  }
  try {
    return JSON.parse(fs.readFileSync(STORE_PATH, 'utf8'));
  } catch {
    throw new Error(`Failed to parse ${STORE_PATH}. File may be corrupted.`);
  }
}

export function saveTemplates(templates) {
  if (!fs.existsSync(STORE_DIR)) {
    fs.mkdirSync(STORE_DIR, { recursive: true });
  }
  fs.writeFileSync(STORE_PATH, JSON.stringify(templates, null, 2), 'utf8');
}

export function getTemplate(templates, name) {
  if (!templates[name]) {
    throw new Error(`Template "${name}" does not exist. Run: mycli list`);
  }
  return templates[name];
}

export function readProjectPackageJson() {
  const pkgPath = path.join(process.cwd(), 'package.json');
  if (!fs.existsSync(pkgPath)) {
    throw new Error('No package.json found in current directory.');
  }
  try {
    return JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  } catch {
    throw new Error('Failed to parse package.json in current directory.');
  }
}
