# Starter Templates API

The same engine that powers the `unirend` CLI is exported as a library, so other
tools can scaffold Unirend projects directly into a real directory or an
in-memory filesystem, without shelling out to the CLI.

```typescript
import { createProject, initRepo } from 'unirend/starter-templates';
```

For the available template IDs, what each one generates, the workspace model, and
the CLI equivalents, see [Starter Templates & CLI](starter-templates.md). This
doc covers the programmatic surface only.

> **Runtime note:** The generated scripts use Bun commands (`bun build`, `bun run`, etc.). Bun is the build and dev toolchain. `serverBuildTarget` controls the production bundle target, and it is required because this layer has no default.

<!-- toc -->

- [File Roots: Filesystem vs. In-Memory](#file-roots-filesystem-vs-in-memory)
- [`createProject(options): Promise<CreateProjectResult>`](#createprojectoptions-promisecreateprojectresult)
  - [Options (`StarterTemplateOptions`)](#options-startertemplateoptions)
  - [Result (`CreateProjectResult`)](#result-createprojectresult)
  - [In-Memory Example](#in-memory-example)
- [`initRepo(dirPath, options?): Promise<InitRepoResult>`](#initrepodirpath-options-promiseinitreporesult)
  - [Options (`InitRepoOptions`)](#options-initrepooptions)
  - [Result (`InitRepoResult`)](#result-initreporesult)
- [Template Introspection](#template-introspection)
- [Reading Workspace Config](#reading-workspace-config)
- [Name Validation](#name-validation)
- [Logging](#logging)
- [Constants](#constants)
- [Exported Types](#exported-types)

<!-- tocstop -->

## File Roots: Filesystem vs. In-Memory

Every function takes a **file root** (`FileRoot`), which is either:

- a **filesystem path** (`string`), where files are written to disk, and the API
  functions (`createProject` and `initRepo`) can additionally run `git init`, `bun install`, and Prettier
- an **in-memory directory** (`InMemoryDir`, i.e. `Record<string, FileContent>`), where
  files are written into the object instead of disk. The filesystem-only steps
  (git/install/format) are skipped.

```typescript
type FileContent = string | Uint8Array; // text (UTF-8) or binary
type InMemoryDir = Record<string, FileContent>; // normalized rel path → content
type FileRoot = string | InMemoryDir;
```

In-memory mode is what makes the generator easy to drive from another tool or a
test: hand it `{}`, call `createProject`, and read the populated object back.

## `createProject(options): Promise<CreateProjectResult>`

Scaffolds a project from a template. Mirrors the CLI's `create` command,
including auto-initializing the workspace if `unirend-repo.json` is missing.

```typescript
import { createProject } from 'unirend/starter-templates';

const result = await createProject({
  templateID: 'ssr',
  projectName: 'my-app',
  repoRoot: '/path/to/workspace',
  serverBuildTarget: 'node',
  logger: (level, message) => console.log(`[${level}] ${message}`),
});

if (result.success) {
  console.log('Created', result.metadata.projectName);
} else {
  console.error('Failed:', result.error);
}
```

### Options (`StarterTemplateOptions`)

| Option                | Type                                 | Required | Description                                                                                                        |
| --------------------- | ------------------------------------ | -------- | ------------------------------------------------------------------------------------------------------------------ |
| `templateID`          | `TemplateID` (`'ssg'\|'ssr'\|'api'`) | yes      | Which template to generate.                                                                                        |
| `projectName`         | `string`                             | yes      | Kebab-case name that becomes `src/apps/<name>` and the script prefix.                                              |
| `repoRoot`            | `FileRoot`                           | yes      | Workspace root: a filesystem path or an in-memory directory object.                                                |
| `serverBuildTarget`   | `'bun' \| 'node'`                    | yes      | Target runtime for the emitted server scripts and bundle. No default at this layer (the CLI defaults to `'node'`). |
| `logger`              | `LoggerFunction`                     | no       | `(level, message) => void`. Defaults to a no-op.                                                                   |
| `installDependencies` | `boolean`                            | no       | Run `bun install` (filesystem mode only). Default `true`.                                                          |
| `autoFormat`          | `boolean`                            | no       | Run Prettier if installed (filesystem mode only). Default `true`.                                                  |
| `initGit`             | `boolean`                            | no       | Run `git init` if needed (filesystem mode only). Default `true`.                                                   |
| `starterFiles`        | `StarterFiles`                       | no       | Extra files grouped by path base: `repoRoot` for workspace-root paths, `projectRoot` for generated project paths.  |

`serverBuildTarget` is intentionally required at the library boundary so every
consumer makes a conscious choice. The bundled CLI is the one that applies the
`'node'` default before calling in.

`starterFiles` uses explicit path bases:

```typescript
await createProject({
  templateID: 'ssr',
  projectName: 'web',
  repoRoot: '/path/to/workspace',
  serverBuildTarget: 'node',
  starterFiles: {
    repoRoot: {
      'README.md': '# Workspace',
    },
    projectRoot: {
      'server/plugins/example.ts': 'export const example = true;\n',
    },
  },
});
```

`repoRoot` entries are written relative to the workspace root.
`projectRoot` entries are written relative to `src/apps/<projectName>`.
Avoid using `starterFiles` paths that match files emitted by the generator.
Generated files are processed after `starterFiles`, and depending on the file,
the generator may overwrite, merge with, or skip an existing custom file.

### Result (`CreateProjectResult`)

A discriminated union on `success`:

```typescript
// success
{
  success: true;
  metadata: {
    templateID: TemplateID;
    projectName: string;
    repoPath: string;
  }
}

// failure
{
  success: false;
  error: string;
  metadata: {
    templateID: string;
    projectName: string;
    repoPath: string;
  }
}
```

On the failure branch `metadata.templateID` is widened to `string` because a JS
caller can reach it with an unknown template identifier. On success, it's the
runtime-validated `TemplateID`.

`createProject` resolves to a failure result (rather than throwing) for expected
problems: invalid name, unknown template, existing project directory, invalid
`unirend-repo.json` / `package.json`, or a script-name collision.

### In-Memory Example

```typescript
import { createProject } from 'unirend/starter-templates';
import type { InMemoryDir } from 'unirend/starter-templates';

const root: InMemoryDir = {};

await createProject({
  templateID: 'api',
  projectName: 'my-api',
  repoRoot: root,
  serverBuildTarget: 'node',
  // git/install/format are skipped automatically for in-memory roots
});

console.log(Object.keys(root)); // every generated file path
```

## `initRepo(dirPath, options?): Promise<InitRepoResult>`

Initializes a workspace repo without creating a project. Mirrors the CLI's
`init-repo`. The directory must be empty or contain only `.git`/`.gitignore`.

```typescript
import { initRepo } from 'unirend/starter-templates';

const result = await initRepo('/path/to/workspace', { name: 'my-workspace' });

if (result.success) {
  console.log(result.config.name);
} else {
  console.error(result.error); // InitRepoErrorCode
}
```

### Options (`InitRepoOptions`)

| Option                | Type             | Description                                              |
| --------------------- | ---------------- | -------------------------------------------------------- |
| `name`                | `string`         | Workspace name. Default `unirend-projects`.              |
| `logger`              | `LoggerFunction` | Optional logger. Defaults to a no-op.                    |
| `initGit`             | `boolean`        | `git init` if needed (filesystem only). Default `true`.  |
| `installDependencies` | `boolean`        | `bun install` (filesystem only). Default `true`.         |
| `autoFormat`          | `boolean`        | Prettier if installed (filesystem only). Default `true`. |

### Result (`InitRepoResult`)

```typescript
// success
{ success: true; config: RepoConfig }

// failure
{ success: false; error: InitRepoErrorCode; errorMessage?: string }

type InitRepoErrorCode =
  | 'invalid_name'
  | 'write_error'
  | 'already_exists'
  | 'parse_error'
  | 'read_error'
  | 'unsafe_directory';

interface RepoConfig {
  version: string;           // config schema version
  name: string;              // workspace name
  created: string;           // ISO timestamp
  projects: Record<string, ProjectEntry>;
}

interface ProjectEntry {
  templateID: TemplateID;    // 'ssg' | 'ssr' | 'api'
  path: string;              // relative path to the project
  createdAt: string;         // ISO timestamp
}
```

> You usually don't need `initRepo`: `createProject` auto-initializes the
> workspace when it's missing. Reach for `initRepo` when you want to set the
> workspace name explicitly or initialize as a distinct step.

## Template Introspection

```typescript
import {
  listAvailableTemplates,
  listAvailableTemplatesWithInfo,
  getTemplateInfo,
  templateExists,
} from 'unirend/starter-templates';
```

| Function                           | Returns            | Description                                                   |
| ---------------------------------- | ------------------ | ------------------------------------------------------------- |
| `listAvailableTemplates()`         | `TemplateID[]`     | The available template IDs.                                   |
| `listAvailableTemplatesWithInfo()` | `TemplateInfo[]`   | Each template's `{ templateID, name, description }`.          |
| `getTemplateInfo(id)`              | `TemplateInfo`     | Info for one template. Caller must pass a valid `TemplateID`. |
| `templateExists(id)`               | `id is TemplateID` | Type guard that narrows a raw `string` to `TemplateID`.       |

```typescript
const id: string = userInput;

if (templateExists(id)) {
  // id is now TemplateID
  const info = getTemplateInfo(id);
  console.log(info.name, '—', info.description);
}
```

## Reading Workspace Config

```typescript
import { readRepoConfig } from 'unirend/starter-templates';

const status = await readRepoConfig('/path/to/workspace');

switch (status.status) {
  case 'found':
    console.log(status.config.name, status.config.projects);
    break;
  case 'not_found':
    // no unirend-repo.json here
    break;
  case 'parse_error':
  case 'read_error':
    console.error(status.errorMessage);
    break;
}
```

`RepoConfigResult` is a discriminated union on `status`
(`'found' | 'not_found' | 'parse_error' | 'read_error'`). Only `found` carries a
`config: RepoConfig`, and the error cases carry an optional `errorMessage`.

## Name Validation

```typescript
import { validateName } from 'unirend/starter-templates';

const r = validateName('my-app'); // { valid: boolean; error?: string }
```

The same rules `createProject`/`initRepo` enforce: kebab-case, starts with a
letter, ends with a letter or number, no consecutive hyphens, not a reserved
system name (for example, http, stream, fs, path, etc).

## Logging

All long-running helpers accept a `LoggerFunction`:

```typescript
type LogLevel = 'info' | 'warning' | 'error' | 'success';
type LoggerFunction = (level: LogLevel, message: string) => void;
```

If omitted, all log output is suppressed. The default is a no-op `() => {}`.
Pass your own to route messages into your tool's logging. The CLI uses this to
wire in its color-coded console output.

## Constants

```typescript
import {
  STARTER_TEMPLATES, // Record<TemplateID, TemplateInfo>
  TEMPLATE_IDS, // readonly ['ssg', 'ssr', 'api']
  REPO_CONFIG_FILE, // 'unirend-repo.json'
  DEFAULT_REPO_NAME, // 'unirend-projects'
} from 'unirend/starter-templates';
```

## Exported Types

Available via `import type { ... } from 'unirend/starter-templates'`:

- `TemplateID`, `TemplateInfo`, `ServerBuildTarget`
- `StarterTemplateOptions`, `CreateProjectResult`
- `InitRepoOptions`, `InitRepoResult`, `InitRepoSuccess`, `InitRepoFailure`, `InitRepoErrorCode`
- `RepoConfig`, `ProjectEntry`, `RepoConfigResult`
- `NameValidationResult`
- `LogLevel`, `LoggerFunction`
- `FileRoot`, `InMemoryDir`, `FileContent`
