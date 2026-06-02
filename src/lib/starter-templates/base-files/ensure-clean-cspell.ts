import { vfsWriteIfNotExists } from '../vfs';
import type { FileRoot } from '../vfs';
import type { LoggerFunction } from '../types';

const fileSrc = `import { readFile, writeFile, readdir } from 'fs/promises';
import { join, relative } from 'path';
import picomatch from 'picomatch';

const REPO_ROOT = join(import.meta.dir, '..');

// Standard binary file extensions to skip scanning
const BINARY_EXTENSIONS = new Set([
  'png',
  'jpg',
  'jpeg',
  'gif',
  'ico',
  'pdf',
  'zip',
  'gz',
  'tar',
  'tgz',
  'woff',
  'woff2',
  'ttf',
  'eot',
  'mp4',
  'mp3',
  'wav',
  'webm',
  'ogg',
  'webp',
  'map',
  'lockb',
  'cache',
  'DS_Store',
  'phpunit.result.cache',
]);

/**
 * Fast-path check: Check if a file extension matches common binary formats
 * to skip opening/reading them entirely.
 */
function isBinaryFile(filePath: string): boolean {
  const ext = filePath.split('.').pop()?.toLowerCase() || '';
  return BINARY_EXTENSIONS.has(ext);
}

/**
 * Split text into individual words, supporting camelCase/PascalCase splitting
 * and unicode letters/digits.
 */
function getWords(text: string): Set<string> {
  const words = new Set<string>();

  // 1. Split camelCase/PascalCase (e.g. AvenirFont -> Avenir Font, customWord -> custom Word)
  // Do not split digit-to-uppercase transitions, so alphanumeric words like 2FA
  // remain intact.
  const splitCamel = text.replace(/([a-z])([A-Z])/g, '$1 $2');

  // Also handle transitions between multiple uppercase letters and a lowercase letter (e.g. XMLParser -> XML Parser)
  const splitCamel2 = splitCamel.replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2');

  // 2. Match standard sequences of letters/digits (including accented unicode letters)
  // but ignore numeric-only tokens.
  const matches = splitCamel2.match(/[\\p{L}\\p{N}]+/gu);
  if (matches) {
    for (const match of matches) {
      if (/\\p{L}/u.test(match)) {
        words.add(match);

        // CSpell can surface URL-encoded fragments like %5Bstatus as Bstatus.
        const withoutLeadingDigits = match.replace(/^\\p{N}+/u, '');
        if (withoutLeadingDigits !== match && withoutLeadingDigits.length > 0) {
          words.add(withoutLeadingDigits);
        }
      }
    }
  }

  return words;
}

/**
 * Traverse directory recursively to find all non-ignored files.
 */
async function getFiles(
  dir: string,
  isIgnored: (path: string) => boolean,
): Promise<string[]> {
  const files: string[] = [];
  const entries = await readdir(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    const relPath = relative(REPO_ROOT, fullPath);

    // Always skip git directory
    if (entry.name === '.git') {
      continue;
    }

    // Skip cspell.json itself to prevent it from matching its own word list
    if (entry.name === 'cspell.json') {
      continue;
    }

    if (entry.isDirectory()) {
      // Optimize: check if the directory is ignored before descending
      // We check the directory name and also check if a file inside it would be ignored
      if (
        entry.name === 'node_modules' ||
        entry.name === 'vendor' ||
        isIgnored(relPath) ||
        isIgnored(join(relPath, 'placeholder'))
      ) {
        continue;
      }

      files.push(...(await getFiles(fullPath, isIgnored)));
    } else if (entry.isFile()) {
      // Fast-path skip for ignored files and obvious binary extensions (e.g. images)
      if (isIgnored(relPath) || isBinaryFile(entry.name)) {
        continue;
      }
      files.push(fullPath);
    }
  }

  return files;
}

async function main() {
  // Parse command line arguments
  const isFix =
    process.argv.includes('--write') || process.argv.includes('--fix');

  // ==========================================
  // STAGE 1: Load and Parse cspell.json
  // ==========================================
  console.log('🔍 Loading cspell.json...');
  const cspellPath = join(REPO_ROOT, 'cspell.json');
  let cspellContent: string;

  try {
    cspellContent = await readFile(cspellPath, 'utf-8');
  } catch (error) {
    console.error(\`❌ Failed to read cspell.json at \${cspellPath}:\`, error);
    process.exit(1);
  }

  let cspellConfig: {
    words?: string[];
    ignorePaths?: string[];
    caseSensitive?: boolean;
    [key: string]: unknown;
  };

  try {
    cspellConfig = JSON.parse(cspellContent) as typeof cspellConfig;
  } catch (error) {
    console.error('❌ Failed to parse cspell.json:', error);
    process.exit(1);
  }

  const customWords = cspellConfig.words || [];
  if (customWords.length === 0) {
    console.log('✅ No custom words found in cspell.json.');
    process.exit(0);
  }

  // Set up picomatch glob matcher using cspell's ignorePaths config
  const ignorePaths = cspellConfig.ignorePaths || [];
  const isIgnored = picomatch(ignorePaths, { dot: true });

  // ==========================================
  // STAGE 2: Scan codebase for files
  // ==========================================
  console.log('📁 Scanning codebase for files...');
  // Intentionally scan all non-ignored text files, not just the package.json
  // spellcheck glob. That glob only constrains command-line spellcheck runs;
  // when files are actively open, editor integrations use the CSpell config and
  // ignore rules, so words in other non-ignored files can still be legitimate
  // workspace dictionary entries.
  const filesToScan = await getFiles(REPO_ROOT, isIgnored);
  console.log(\`📄 Found \${filesToScan.length} text files to analyze.\`);

  // ==========================================
  // STAGE 3: Extract unique words from files
  // ==========================================
  console.log('🧠 Extracting unique words from files...');
  const codebaseWords = new Set<string>();

  for (const file of filesToScan) {
    try {
      const buffer = await readFile(file);
      // Safety-path check: If the file contains null bytes, it is a binary file
      // (handles binary files that slipped past the extension-based fast path)
      if (buffer.includes(0)) {
        continue;
      }

      const content = buffer.toString('utf-8');
      const words = getWords(content);

      for (const word of words) {
        // Add both the exact case and the lowercased version of the word.
        // This allows O(1) lookups for both case-sensitive and case-insensitive checks.
        codebaseWords.add(word);
        codebaseWords.add(word.toLowerCase());
      }
    } catch (error) {
      // Print warning but don't fail, in case it's a binary file with a text extension
      console.warn(\`⚠️ Warning: Failed to read file \${file}:\`, error);
    }
  }

  console.log(
    \`✨ Found \${codebaseWords.size} unique word forms in the codebase.\`,
  );

  // ==========================================
  // STAGE 4: Check usage of custom words
  // ==========================================
  console.log('🧪 Checking usage of custom cspell words...');
  const unusedWords: string[] = [];
  const usedWords: string[] = [];
  const isCaseSensitive = cspellConfig.caseSensitive === true;

  for (const word of customWords) {
    // Match CSpell's default case-insensitive behavior unless the config opts
    // into case-sensitive checking.
    const wordToCheck = isCaseSensitive ? word : word.toLowerCase();

    if (codebaseWords.has(wordToCheck)) {
      usedWords.push(word);
    } else {
      unusedWords.push(word);
    }
  }

  // ==========================================
  // STAGE 5: Report results / Apply fixes
  // ==========================================
  if (unusedWords.length === 0) {
    console.log('\\n✅ All custom words are currently used in the codebase.');
    process.exit(0);
  }

  console.log(
    \`\\n❌ Found \${unusedWords.length} unused custom words out of \${customWords.length} total:\`,
  );

  for (const word of unusedWords.sort()) {
    console.log(\`  • \${word}\`);
  }

  if (isFix) {
    console.log('\\n🔧 Updating cspell.json to remove unused words...');

    // Maintain original casing of used words, and sort alphabetically (natural/locale-aware order)
    const updatedWords = usedWords.sort((a, b) => a.localeCompare(b));
    cspellConfig.words = updatedWords;

    try {
      await writeFile(
        cspellPath,
        JSON.stringify(cspellConfig, null, 2) + '\\n',
        'utf-8',
      );

      console.log('✅ Successfully updated cspell.json!');
    } catch (error) {
      console.error('❌ Failed to write cspell.json:', error);
      process.exit(1);
    }

    process.exit(0);
  } else {
    console.log(
      \`\\n💡 Run \\\`bun run cspell:clean:fix\\\` or \\\`bun run scripts/clean-cspell.ts --write\\\` to remove these unused words.\`,
    );

    process.exit(1);
  }
}

main().catch((error) => {
  console.error('❌ Script failed with error:', error);
  process.exit(1);
});
`;

/**
 * Ensure scripts/clean-cspell.ts exists at the repo root.
 * Only creates the file if it doesn't exist - never overwrites.
 * @throws {Error} If file creation fails
 */
export async function ensureCleanCspell(
  repoRoot: FileRoot,
  log?: LoggerFunction,
): Promise<void> {
  try {
    const didWrite = await vfsWriteIfNotExists(
      repoRoot,
      'scripts/clean-cspell.ts',
      fileSrc,
    );

    if (didWrite && log) {
      log('info', 'Created scripts/clean-cspell.ts');
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Failed to ensure scripts/clean-cspell.ts: ${errorMessage}`,
    );
  }
}
