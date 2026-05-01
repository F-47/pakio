# pakio

Save, manage, and reuse npm package templates across projects.

Instead of remembering which packages you install on every new project, pakio lets you define named templates and apply them in one command.

## Install

```bash
npm install -g pakio
```

## Usage

Run without arguments for the interactive menu:

```bash
pakio
```

Or use commands directly:

```bash
pakio create <name>
pakio add <name> <packages...>
pakio apply <name>
pakio list
pakio remove <name>
pakio export [names...] --output <file>
pakio import-file <file>
```

## Interactive menu

```
◆  pakio — npm package template manager
│
◆  What do you want to do?
│  ❯ Create a new template
│    Add packages to a template
│    Edit a template
│    Apply a template to this project
│    View templates
│    Import / Export
│    Remove a template
│    Exit
└
```

## Commands

### Create a template

```bash
pakio create react-base
```

### Add packages

```bash
# dependencies
pakio add react-base axios zustand

# devDependencies
pakio add react-base -D eslint prettier typescript
```

In interactive mode, packages are searched live from npm — results include name, version, and description.

### Apply a template

Run inside a project that already has a `package.json`:

```bash
pakio apply react-base
```

Installs all dependencies and devDependencies from the template using npm.

### Import from a project

Save the current project's dependencies into a template:

```bash
pakio import react-base
```

### List templates

```bash
pakio list
```

### Export and import

Share templates between machines or teammates:

```bash
# export
pakio export react-base --output react-base.json
pakio export                          # exports all → pakio-export.json

# import
pakio import-file ./react-base.json
```

### Remove a template

```bash
pakio remove react-base
```

## Storage

Templates are stored locally in `~/.pakio/templates.json`.

```json
{
  "react-base": {
    "dependencies": ["axios@1.7.9", "zustand@5.0.3"],
    "devDependencies": ["eslint@9.0.0", "prettier@3.4.2", "typescript@5.7.3"]
  }
}
```

Packages are stored with their exact version at the time of adding, so installs are reproducible across machines.

## Requirements

Node.js 18 or higher.

## License

MIT
