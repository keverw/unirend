import { describe, test, expect } from 'bun:test';
import {
  parseCLIArgs,
  formatCommandLine,
  generateHelpText,
} from './cli-helpers';

describe('parseCLIArgs', () => {
  describe('help command', () => {
    test('should return help for empty args', () => {
      const result = parseCLIArgs([]);
      expect(result).toEqual({ command: 'help' });
    });

    test('should return help for --help flag', () => {
      const result = parseCLIArgs(['--help']);
      expect(result).toEqual({ command: 'help' });
    });

    test('should return help for -h flag', () => {
      const result = parseCLIArgs(['-h']);
      expect(result).toEqual({ command: 'help' });
    });

    test('should return help for --help with other args', () => {
      const result = parseCLIArgs(['create', 'ssg', 'my-blog', '--help']);
      expect(result).toEqual({ command: 'help' });
    });

    test('should return help for help command', () => {
      const result = parseCLIArgs(['help']);
      expect(result).toEqual({ command: 'help' });
    });
  });

  describe('version command', () => {
    test('should return version for --version flag', () => {
      const result = parseCLIArgs(['--version']);
      expect(result).toEqual({ command: 'version' });
    });

    test('should return version for -v flag', () => {
      const result = parseCLIArgs(['-v']);
      expect(result).toEqual({ command: 'version' });
    });

    test('should return version for --version with other args', () => {
      const result = parseCLIArgs(['create', 'ssg', 'my-blog', '--version']);
      expect(result).toEqual({ command: 'version' });
    });

    test('should return version for version command', () => {
      const result = parseCLIArgs(['version']);
      expect(result).toEqual({ command: 'version' });
    });
  });

  describe('list command', () => {
    test('should parse list command', () => {
      const result = parseCLIArgs(['list']);
      expect(result).toEqual({ command: 'list' });
    });
  });

  describe('init-repo command', () => {
    test('should parse init-repo with no arguments', () => {
      const result = parseCLIArgs(['init-repo']);

      expect(result).toEqual({
        command: 'init-repo',
        repoPath: undefined,
        repoName: undefined,
      });
    });

    test('should parse init-repo with path', () => {
      const result = parseCLIArgs(['init-repo', './my-workspace']);

      expect(result).toEqual({
        command: 'init-repo',
        repoPath: './my-workspace',
        repoName: undefined,
      });
    });

    test('should parse init-repo with --name flag', () => {
      const result = parseCLIArgs(['init-repo', '--name', 'my-workspace']);

      expect(result).toEqual({
        command: 'init-repo',
        repoPath: undefined,
        repoName: 'my-workspace',
      });
    });

    test('should parse init-repo with path and --name flag', () => {
      const result = parseCLIArgs([
        'init-repo',
        './projects',
        '--name',
        'my-workspace',
      ]);

      expect(result).toEqual({
        command: 'init-repo',
        repoPath: './projects',
        repoName: 'my-workspace',
      });
    });

    test('should parse init-repo with --name flag before path', () => {
      const result = parseCLIArgs([
        'init-repo',
        '--name',
        'my-workspace',
        './projects',
      ]);

      expect(result).toEqual({
        command: 'init-repo',
        repoPath: './projects',
        repoName: 'my-workspace',
      });
    });

    test('should handle --name without path', () => {
      const result = parseCLIArgs(['init-repo', '--name', 'my-workspace']);

      expect(result).toEqual({
        command: 'init-repo',
        repoPath: undefined,
        repoName: 'my-workspace',
      });
    });

    test('should handle path after --name flag', () => {
      const result = parseCLIArgs([
        'init-repo',
        '--name',
        'my-workspace',
        './some-path',
      ]);

      expect(result).toEqual({
        command: 'init-repo',
        repoPath: './some-path',
        repoName: 'my-workspace',
      });
    });
  });

  describe('create command', () => {
    test('should parse create with type and name only', () => {
      const result = parseCLIArgs(['create', 'ssg', 'my-blog']);

      expect(result).toEqual({
        command: 'create',
        projectType: 'ssg',
        projectName: 'my-blog',
        repoPath: undefined,
        target: undefined,
      });
    });

    test('should parse create with type, name, and path', () => {
      const result = parseCLIArgs(['create', 'ssg', 'my-blog', './projects']);

      expect(result).toEqual({
        command: 'create',
        projectType: 'ssg',
        projectName: 'my-blog',
        repoPath: './projects',
        target: undefined,
      });
    });

    test('should parse create with ssr template', () => {
      const result = parseCLIArgs(['create', 'ssr', 'my-app']);

      expect(result).toEqual({
        command: 'create',
        projectType: 'ssr',
        projectName: 'my-app',
        repoPath: undefined,
        target: undefined,
      });
    });

    test('should parse create with api template', () => {
      const result = parseCLIArgs(['create', 'api', 'my-api-server']);
      expect(result).toEqual({
        command: 'create',
        projectType: 'api',
        projectName: 'my-api-server',
        repoPath: undefined,
        target: undefined,
      });
    });

    test('should handle create with missing arguments', () => {
      const result = parseCLIArgs(['create']);
      expect(result).toEqual({
        command: 'create',
        projectType: undefined,
        projectName: undefined,
        repoPath: undefined,
        target: undefined,
      });
    });

    test('should handle create with only type', () => {
      const result = parseCLIArgs(['create', 'ssg']);
      expect(result).toEqual({
        command: 'create',
        projectType: 'ssg',
        projectName: undefined,
        repoPath: undefined,
        target: undefined,
      });
    });

    test('should parse create with --target node flag after path', () => {
      const result = parseCLIArgs([
        'create',
        'ssg',
        'my-blog',
        './projects',
        '--target',
        'node',
      ]);
      expect(result).toEqual({
        command: 'create',
        projectType: 'ssg',
        projectName: 'my-blog',
        repoPath: './projects',
        target: 'node',
      });
    });

    test('should parse create with --target bun flag before path', () => {
      const result = parseCLIArgs([
        'create',
        'ssg',
        'my-blog',
        '--target',
        'bun',
        './projects',
      ]);
      expect(result).toEqual({
        command: 'create',
        projectType: 'ssg',
        projectName: 'my-blog',
        repoPath: './projects',
        target: 'bun',
      });
    });
  });

  describe('unknown command', () => {
    test('should return unknown for unrecognized command', () => {
      const result = parseCLIArgs(['invalid-command']);

      expect(result).toEqual({
        command: 'unknown',
        unknownCommand: 'invalid-command',
      });
    });

    test('should return unknown for typo in command', () => {
      // A typo in the command should be treated as an unknown command
      const result = parseCLIArgs(['crate', 'ssg', 'my-blog']);

      expect(result).toEqual({
        command: 'unknown',
        unknownCommand: 'crate',
      });
    });
  });

  describe('edge cases', () => {
    test('should handle args with special characters', () => {
      const result = parseCLIArgs(['create', 'ssg', 'my-blog-2024']);

      expect(result).toEqual({
        command: 'create',
        projectType: 'ssg',
        projectName: 'my-blog-2024',
        repoPath: undefined,
      });
    });

    test('should handle paths with special characters', () => {
      const result = parseCLIArgs([
        'create',
        'ssg',
        'my-blog',
        './my-projects/2024',
      ]);

      expect(result).toEqual({
        command: 'create',
        projectType: 'ssg',
        projectName: 'my-blog',
        repoPath: './my-projects/2024',
      });
    });

    test('should handle absolute paths', () => {
      const result = parseCLIArgs(['init-repo', '/absolute/path/to/workspace']);

      expect(result).toEqual({
        command: 'init-repo',
        repoPath: '/absolute/path/to/workspace',
        repoName: undefined,
      });
    });

    test('should handle names with underscores', () => {
      const result = parseCLIArgs(['init-repo', '--name', 'my_workspace_name']);

      expect(result).toEqual({
        command: 'init-repo',
        repoPath: undefined,
        repoName: 'my_workspace_name',
      });
    });
  });
});

describe('formatCommandLine', () => {
  test('should format single-line description with default width', () => {
    // Default width is 24
    const result = formatCommandLine('  ', 'foo', 'Do something');
    expect(result).toEqual(['  foo                     Do something']);
  });

  test('should format single-line description with custom width', () => {
    const result = formatCommandLine('  ', 'bar', 'Execute bar', 10);
    expect(result).toEqual(['  bar       Execute bar']);
  });

  test('should format multi-line description', () => {
    const result = formatCommandLine(
      '  ',
      'baz',
      ['Run baz command', '- arg1: first argument', '- arg2: second argument'],
      20,
    );

    expect(result).toEqual([
      '  baz                 Run baz command',
      '                      - arg1: first argument',
      '                      - arg2: second argument',
    ]);
  });

  test('should handle long command names', () => {
    const result = formatCommandLine(
      '  ',
      'super-long-command-name',
      'Some description',
      30,
    );

    expect(result).toEqual([
      '  super-long-command-name       Some description',
    ]);
  });

  test('should align multi-line descriptions correctly', () => {
    const result = formatCommandLine(
      '    ',
      'qux',
      ['First line', 'Second line', 'Third line'],
      10,
    );

    expect(result).toEqual([
      '    qux       First line',
      '              Second line',
      '              Third line',
    ]);
  });

  test('should handle empty description array', () => {
    const result = formatCommandLine('  ', 'empty', []);

    // Empty array shows a professional placeholder message
    expect(result).toEqual(['  empty                   (no description)']);
  });

  test('should handle different indentation levels', () => {
    const result = formatCommandLine('', 'xyz', 'Generic text', 8);

    expect(result).toEqual(['xyz     Generic text']);
  });
});

describe('generateHelpText', () => {
  // Helper to create test commands and examples with generic dummy data
  const createTestData = () => {
    const commands = [
      {
        command: 'foo <arg1> <arg2> [arg3]',
        description: [
          'Do something with foo',
          '- <arg1>: First argument (option1, option2, option3)',
          '- <arg2>: Second argument',
          '- [arg3]: Optional third argument',
        ],
      },
      { command: 'bar', description: 'Execute bar command' },
      {
        command: 'baz [option]',
        description: [
          'Run baz with optional config',
          '- [option]: Config option',
          '- --flag: Custom flag',
        ],
      },
      { command: 'help, -h, --help', description: 'Show help' },
      { command: 'version, -v, --version', description: 'Show version' },
    ];

    const examples = [
      'mycli foo opt1 value1',
      'mycli foo opt2 value2 ./custom',
      'mycli bar',
      'mycli baz',
      'mycli baz ./config',
      'mycli baz --flag custom',
      'mycli help',
      'mycli version',
    ];

    return { commands, examples };
  };

  test('should generate help text without error message', () => {
    const { commands, examples } = createTestData();
    const result = generateHelpText({
      title: 'Test CLI Tool',
      commands,
      examples,
    });

    expect(result).toContain('Test CLI Tool');
    expect(result).toContain('Commands:');
    expect(result).toContain('foo <arg1> <arg2> [arg3]');
    expect(result).toContain('bar');
    expect(result).toContain('baz [option]');
    expect(result).toContain('help, -h, --help');
    expect(result).toContain('version, -v, --version');
    expect(result).toContain('Examples:');
    expect(result).toContain('mycli foo opt1 value1');
  });

  test('should include error message when provided', () => {
    const { commands, examples } = createTestData();
    const result = generateHelpText(
      { title: 'Test CLI Tool', commands, examples },
      'Unknown command',
    );

    expect(result).toContain('❌ Error: Unknown command');
    expect(result).toContain('Test CLI Tool');
  });

  test('should preserve all text in multi-line descriptions', () => {
    const { commands, examples } = createTestData();
    const result = generateHelpText({ title: 'Test CLI', commands, examples });

    // Verify that multi-line description content is preserved
    expect(result).toContain('Optional third argument');
    expect(result).toContain('Config option');
    expect(result).toContain('Custom flag');
  });

  test('should include all example commands', () => {
    const { commands, examples } = createTestData();
    const result = generateHelpText({ title: 'Test CLI', commands, examples });

    expect(result).toContain('mycli foo opt1 value1');
    expect(result).toContain('mycli foo opt2 value2 ./custom');
    expect(result).toContain('mycli bar');
    expect(result).toContain('mycli baz');
    expect(result).toContain('mycli baz ./config');
    expect(result).toContain('mycli baz --flag custom');
    expect(result).toContain('mycli help');
    expect(result).toContain('mycli version');
  });

  test('should format multi-line command descriptions', () => {
    const { commands, examples } = createTestData();
    const result = generateHelpText({ title: 'Test CLI', commands, examples });

    // Check that foo command has multi-line description with all lines present
    expect(result).toContain('Do something with foo');
    expect(result).toContain(
      '- <arg1>: First argument (option1, option2, option3)',
    );
    expect(result).toContain('- <arg2>: Second argument');
    expect(result).toContain('- [arg3]: Optional third argument');

    // Check that baz command has multi-line description with all lines present
    expect(result).toContain('Run baz with optional config');
    expect(result).toContain('- [option]: Config option');
    expect(result).toContain('- --flag: Custom flag');
  });

  test('should return string with newlines', () => {
    const { commands, examples } = createTestData();
    const result = generateHelpText({ title: 'Test CLI', commands, examples });

    expect(typeof result).toBe('string');
    expect(result.includes('\n')).toBe(true);
  });

  test('should work without examples (optional)', () => {
    const { commands } = createTestData();
    const result = generateHelpText({ title: 'Test CLI', commands });

    expect(result).toContain('Test CLI');
    expect(result).toContain('Commands:');
    expect(result).toContain('foo <arg1> <arg2> [arg3]');

    // Should not have Examples section
    expect(result).not.toContain('Examples:');
  });
});
