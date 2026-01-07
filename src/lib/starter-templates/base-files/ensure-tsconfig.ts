import { vfsWriteIfNotExists, type FileRoot } from '../vfs';
import type { Logger } from '../types';

const fileSrc = `{
  "compilerOptions": {
    "target": "ES2020",
    "useDefineForClassFields": true,
    "lib": ["ES2020", "DOM", "DOM.Iterable"],
    "types": ["node"],
    "module": "ESNext",
    "skipLibCheck": true,

    /* Bundler mode */
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noEmit": true,
    "jsx": "react-jsx",

    /* Linting */
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true,
    "esModuleInterop": true,
    "forceConsistentCasingInFileNames": true,

    /* Path Aliases */
    "baseUrl": ".",
    "paths": {
      "@/*": ["./src/*"]
    }
  },
  "include": ["src", "scripts/**/*", "**/*.ts", "**/*.tsx"],
  "exclude": ["node_modules", "dist"]
}`;

/**
 * Ensure tsconfig.json exists at the repo root.
 * Only creates the file if it doesn't exist - never overwrites.
 * @throws {Error} If file creation fails
 */
export async function ensureTsConfig(
  repoRoot: FileRoot,
  log?: Logger,
): Promise<void> {
  try {
    const didWrite = await vfsWriteIfNotExists(
      repoRoot,
      'tsconfig.json',
      fileSrc,
    );

    if (didWrite && log) {
      log('info', 'Created repo root tsconfig.json');
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to ensure tsconfig.json: ${errorMessage}`);
  }
}
