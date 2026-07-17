import { readFile, writeFile, readdir } from 'fs/promises';
import { join, relative } from 'path';
import picomatch from 'picomatch';

/**
 * Unused-cspell-word cleaner for scaffolded repos, exported via
 * `unirend/repo-tools`.
 *
 * Scans every non-ignored text file in the repo, extracts the words that
 * actually appear (with camelCase/PascalCase splitting), and compares them
 * against the custom `words` list in `cspell.json`. Words no longer used
 * anywhere are reported, and with `fix: true` removed from the config.
 *
 * The function acts as a main: it prints its own progress and report through
 * the injectable loggers and returns a result instead of exiting, so the
 * scaffolded `scripts/clean-cspell.ts` stays a thin wrapper that parses
 * `--fix`/`--write` and sets the exit code (and is the place to customize).
 * Keeping the logic here means repos pick up fixes by upgrading unirend
 * instead of re-scaffolding a frozen script.
 */

/** Options for {@link cleanCspell}. */
export interface CleanCspellOptions {
  /** Repo root containing cspell.json. Defaults to process.cwd(). */
  rootDir?: string;
  /** Remove unused words from cspell.json instead of just reporting them. */
  fix?: boolean;
  /** Sink for progress output. Defaults to console.log. */
  log?: (message: string) => void;
  /** Sink for non-fatal warnings. Defaults to console.warn. */
  logWarn?: (message: string) => void;
}

/** Result of {@link cleanCspell}. */
export interface CleanCspellResult {
  /**
   * True when the word list is clean — either no unused words were found, or
   * `fix` removed them all.
   */
  success: boolean;
  /** Custom words not found anywhere in the scanned files. */
  unusedWords: string[];
  /** Custom words that are still used. */
  usedWords: string[];
  /** True when `fix` rewrote cspell.json. */
  fixed: boolean;
}

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
  const matches = splitCamel2.match(/[\p{L}\p{N}]+/gu);
  if (matches) {
    for (const match of matches) {
      if (/\p{L}/u.test(match)) {
        words.add(match);

        // CSpell can surface URL-encoded fragments like %5Bstatus as Bstatus.
        const withoutLeadingDigits = match.replace(/^\p{N}+/u, '');
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
  rootDir: string,
  dir: string,
  isIgnored: (path: string) => boolean,
): Promise<string[]> {
  const files: string[] = [];
  const entries = await readdir(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    const relPath = relative(rootDir, fullPath);

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

      files.push(...(await getFiles(rootDir, fullPath, isIgnored)));
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

/**
 * Scan the repo for usage of every custom cspell word and report (or, with
 * `fix`, remove) the unused ones. Prints its report through the injected
 * loggers and returns the outcome instead of exiting — the caller decides
 * the exit code.
 *
 * @throws When cspell.json cannot be read, parsed, or (with `fix`) written.
 */
export async function cleanCspell(
  options?: CleanCspellOptions,
): Promise<CleanCspellResult> {
  const rootDir = options?.rootDir ?? process.cwd();
  const isFix = options?.fix ?? false;
  // eslint-disable-next-line no-console
  const log = options?.log ?? console.log;
  // eslint-disable-next-line no-console
  const logWarn = options?.logWarn ?? console.warn;

  // ==========================================
  // STAGE 1: Load and Parse cspell.json
  // ==========================================
  log('🔍 Loading cspell.json...');
  const cspellPath = join(rootDir, 'cspell.json');
  let cspellContent: string;

  try {
    cspellContent = await readFile(cspellPath, 'utf-8');
  } catch (error) {
    throw new Error(
      `Failed to read cspell.json at ${cspellPath}: ${String(error)}`,
    );
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
    throw new Error(`Failed to parse cspell.json: ${String(error)}`);
  }

  const customWords = cspellConfig.words || [];
  if (customWords.length === 0) {
    log('✅ No custom words found in cspell.json.');
    return { success: true, unusedWords: [], usedWords: [], fixed: false };
  }

  // Set up picomatch glob matcher using cspell's ignorePaths config
  const ignorePaths = cspellConfig.ignorePaths || [];
  const isIgnored = picomatch(ignorePaths, { dot: true });

  // ==========================================
  // STAGE 2: Scan codebase for files
  // ==========================================
  log('📁 Scanning codebase for files...');
  // Intentionally scan all non-ignored text files, not just the package.json
  // spellcheck glob. That glob only constrains command-line spellcheck runs;
  // when files are actively open, editor integrations use the CSpell config and
  // ignore rules, so words in other non-ignored files can still be legitimate
  // workspace dictionary entries.
  const filesToScan = await getFiles(rootDir, rootDir, isIgnored);
  log(`📄 Found ${filesToScan.length} text files to analyze.`);

  // ==========================================
  // STAGE 3: Extract unique words from files
  // ==========================================
  log('🧠 Extracting unique words from files...');
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
      logWarn(`⚠️ Warning: Failed to read file ${file}: ${String(error)}`);
    }
  }

  log(`✨ Found ${codebaseWords.size} unique word forms in the codebase.`);

  // ==========================================
  // STAGE 4: Check usage of custom words
  // ==========================================
  log('🧪 Checking usage of custom cspell words...');
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
    log('\n✅ All custom words are currently used in the codebase.');
    return { success: true, unusedWords: [], usedWords, fixed: false };
  }

  log(
    `\n❌ Found ${unusedWords.length} unused custom words out of ${customWords.length} total:`,
  );

  for (const word of unusedWords.sort()) {
    log(`  • ${word}`);
  }

  if (isFix) {
    log('\n🔧 Updating cspell.json to remove unused words...');

    // Maintain original casing of used words, and sort alphabetically (natural/locale-aware order)
    const updatedWords = usedWords.sort((a, b) => a.localeCompare(b));
    cspellConfig.words = updatedWords;

    try {
      await writeFile(
        cspellPath,
        JSON.stringify(cspellConfig, null, 2) + '\n',
        'utf-8',
      );
    } catch (error) {
      throw new Error(`Failed to write cspell.json: ${String(error)}`);
    }

    log('✅ Successfully updated cspell.json!');
    return { success: true, unusedWords, usedWords, fixed: true };
  }

  log(
    `\n💡 Run \`bun run cspell:clean:fix\` or \`bun run scripts/clean-cspell.ts --write\` to remove these unused words.`,
  );

  return { success: false, unusedWords, usedWords, fixed: false };
}
