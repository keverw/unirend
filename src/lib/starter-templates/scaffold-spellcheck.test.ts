import { describe, expect, test } from 'bun:test';
import { mkdtemp, mkdir, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { dirname, join } from 'path';
import { createProject, TEMPLATE_IDS } from '../../starter-templates';
import type { InMemoryDir } from './vfs';

/**
 * A scaffolded repo runs `bun run spellcheck` as part of its own `check`
 * script, so the generated cspell.json has to cover the words the generated
 * files use. Nothing else catches the drift: adding an acronym to the
 * naming-convention regexes in eslint.config.js, or wording to any template,
 * fails only in the user's fresh repo, and only after they scaffold it.
 *
 * This scaffolds every template into one repo (in memory, no install and no
 * formatting), writes it to a temp dir, and runs the real cspell CLI over it
 * with the generated config, which is what `bun run spellcheck` does there.
 */
describe('scaffolded repo spellcheck', () => {
  test('generated files pass the generated cspell.json', async () => {
    const repoRoot: InMemoryDir = {};

    for (const templateID of TEMPLATE_IDS) {
      const result = await createProject({
        templateID,
        projectName: `demo-${templateID}`,
        repoRoot,
        serverBuildTarget: 'node',
        initGit: false,
        installDependencies: false,
        autoFormat: false,
      });

      expect(result.success).toBe(true);
    }

    const dir = await mkdtemp(join(tmpdir(), 'unirend-spellcheck-'));

    try {
      for (const [path, content] of Object.entries(repoRoot)) {
        const target = join(dir, path);
        await mkdir(dirname(target), { recursive: true });
        await writeFile(target, content);
      }

      // Same glob the generated `spellcheck` script uses. `--config` is
      // explicit so cspell cannot walk up out of the temp dir and pick up
      // another config.
      // This repo's own cspell binary, by path: the temp dir has no
      // node_modules, so `bunx cspell` there would go to the network for a
      // copy (and drop a lockfile into the tree being scanned).
      const cspellBin = join(
        import.meta.dirname,
        '../../../node_modules/.bin/cspell',
      );

      const proc = Bun.spawn(
        [
          cspellBin,
          'lint',
          '--config',
          join(dir, 'cspell.json'),
          '--no-progress',
          '**/*.{ts,tsx,js,jsx,md,html,css,json}',
        ],
        { cwd: dir, stdout: 'pipe', stderr: 'pipe' },
      );

      const [stdout, stderr, exitCode] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
        proc.exited,
      ]);

      expect(`${stdout}${stderr}`.trim()).not.toContain('Unknown word');
      expect(exitCode).toBe(0);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, 120_000);
});
