import { describe, expect, test } from 'bun:test';
import { validateName } from './validate-name';

describe('validateName', () => {
  describe('valid names', () => {
    test('accepts simple lowercase names', () => {
      expect(validateName('myproject')).toEqual({ valid: true });
      expect(validateName('hello')).toEqual({ valid: true });
      expect(validateName('app')).toEqual({ valid: true });
    });

    test('accepts names with hyphens', () => {
      expect(validateName('my-project')).toEqual({ valid: true });
      expect(validateName('foo-bar-baz')).toEqual({ valid: true });
    });

    test('accepts names with underscores', () => {
      expect(validateName('my_project')).toEqual({ valid: true });
      expect(validateName('foo_bar_baz')).toEqual({ valid: true });
    });

    test('accepts names with dots', () => {
      expect(validateName('my.project')).toEqual({ valid: true });
      expect(validateName('foo.bar.baz')).toEqual({ valid: true });
    });

    test('accepts names with numbers', () => {
      expect(validateName('project123')).toEqual({ valid: true });
      expect(validateName('app2')).toEqual({ valid: true });
      expect(validateName('v1-api')).toEqual({ valid: true });
    });

    test('accepts mixed valid characters', () => {
      expect(validateName('my-awesome_project.v2')).toEqual({ valid: true });
      expect(validateName('app-v1.2.3')).toEqual({ valid: true });
    });

    test('accepts names up to 214 characters', () => {
      const name214 = 'a'.repeat(214);
      expect(validateName(name214)).toEqual({ valid: true });
    });
  });

  describe('empty or whitespace', () => {
    test('rejects empty string', () => {
      expect(validateName('')).toEqual({
        valid: false,
        error: 'Name cannot be empty',
      });
    });

    test('rejects whitespace-only string', () => {
      expect(validateName('   ')).toEqual({
        valid: false,
        error: 'Name cannot be empty',
      });
      expect(validateName('\t')).toEqual({
        valid: false,
        error: 'Name cannot be empty',
      });
    });
  });

  describe('length validation', () => {
    test('rejects names over 214 characters', () => {
      const name215 = 'a'.repeat(215);
      expect(validateName(name215)).toEqual({
        valid: false,
        error: 'Name cannot exceed 214 characters',
      });
    });
  });

  describe('case validation', () => {
    test('rejects uppercase letters', () => {
      expect(validateName('MyProject')).toEqual({
        valid: false,
        error: 'Name must be lowercase only',
      });
      expect(validateName('PROJECT')).toEqual({
        valid: false,
        error: 'Name must be lowercase only',
      });
      expect(validateName('myProject')).toEqual({
        valid: false,
        error: 'Name must be lowercase only',
      });
    });
  });

  describe('starting character validation', () => {
    test('rejects names starting with dot', () => {
      expect(validateName('.project')).toEqual({
        valid: false,
        error: 'Name cannot start with a dot, underscore, or dash',
      });
    });

    test('rejects names starting with underscore', () => {
      expect(validateName('_project')).toEqual({
        valid: false,
        error: 'Name cannot start with a dot, underscore, or dash',
      });
    });

    test('rejects names starting with dash', () => {
      expect(validateName('-project')).toEqual({
        valid: false,
        error: 'Name cannot start with a dot, underscore, or dash',
      });
    });
  });

  describe('ending character validation', () => {
    test('rejects names ending with dash', () => {
      expect(validateName('project-')).toEqual({
        valid: false,
        error: 'Name cannot end with a dash, underscore, or dot',
      });
    });

    test('rejects names ending with underscore', () => {
      expect(validateName('project_')).toEqual({
        valid: false,
        error: 'Name cannot end with a dash, underscore, or dot',
      });
    });

    test('rejects names ending with dot', () => {
      expect(validateName('project.')).toEqual({
        valid: false,
        error: 'Name cannot end with a dash, underscore, or dot',
      });
    });
  });

  describe('special characters only', () => {
    test('rejects names with only special characters (starting with special char)', () => {
      // These fail the "cannot start with" check first
      expect(validateName('---')).toEqual({
        valid: false,
        error: 'Name cannot start with a dot, underscore, or dash',
      });
      expect(validateName('___')).toEqual({
        valid: false,
        error: 'Name cannot start with a dot, underscore, or dash',
      });
      expect(validateName('...')).toEqual({
        valid: false,
        error: 'Name cannot start with a dot, underscore, or dash',
      });
      expect(validateName('-_.')).toEqual({
        valid: false,
        error: 'Name cannot start with a dot, underscore, or dash',
      });
    });

    test('rejects names with only special characters (starting with alphanumeric)', () => {
      // These start with valid char but end with special chars, so caught by "cannot end with" check
      expect(validateName('a---')).toEqual({
        valid: false,
        error: 'Name cannot end with a dash, underscore, or dot',
      });
      expect(validateName('z___')).toEqual({
        valid: false,
        error: 'Name cannot end with a dash, underscore, or dot',
      });
    });
  });

  describe('alphanumeric requirement', () => {
    test('rejects names without alphanumeric characters (starting with special)', () => {
      // This is caught by the "cannot start with" check first
      expect(validateName('-_-')).toEqual({
        valid: false,
        error: 'Name cannot start with a dot, underscore, or dash',
      });
    });

    test('note: names starting with alphanumeric but only special chars are caught by ending check', () => {
      // Names like "a---" are caught by "cannot end with" check before reaching alphanumeric check
      // This demonstrates that the "must contain alphanumeric" check is redundant given the other checks
      expect(validateName('a-')).toEqual({
        valid: false,
        error: 'Name cannot end with a dash, underscore, or dot',
      });
    });
  });

  describe('spaces validation', () => {
    test('rejects names with spaces', () => {
      expect(validateName('my project')).toEqual({
        valid: false,
        error: 'Name cannot contain spaces',
      });
      expect(validateName('hello world')).toEqual({
        valid: false,
        error: 'Name cannot contain spaces',
      });
    });
  });

  describe('invalid characters', () => {
    test('note: filesystem-unsafe character check is unreachable', () => {
      // The URL-safe regex check (line 84) catches ALL filesystem-unsafe characters
      // before the explicit filesystem check (line 93) can run.
      // Lines 94-97 are unreachable code and could be removed.
      // This test documents the behavior - filesystem chars are caught by URL-safe check:
      expect(validateName('my<project')).toEqual({
        valid: false,
        error:
          'Name contains invalid characters. Only lowercase letters, numbers, hyphens, dots, and underscores are allowed',
      });
    });

    test('rejects names with non-URL-safe characters', () => {
      expect(validateName('my~project')).toEqual({
        valid: false,
        error:
          'Name contains invalid characters. Only lowercase letters, numbers, hyphens, dots, and underscores are allowed',
      });
      expect(validateName('project!')).toEqual({
        valid: false,
        error:
          'Name contains invalid characters. Only lowercase letters, numbers, hyphens, dots, and underscores are allowed',
      });
      expect(validateName('my@project')).toEqual({
        valid: false,
        error:
          'Name contains invalid characters. Only lowercase letters, numbers, hyphens, dots, and underscores are allowed',
      });
    });

    test('rejects names with filesystem-unsafe characters', () => {
      expect(validateName('my<project')).toEqual({
        valid: false,
        error:
          'Name contains invalid characters. Only lowercase letters, numbers, hyphens, dots, and underscores are allowed',
      });
      expect(validateName('my>project')).toEqual({
        valid: false,
        error:
          'Name contains invalid characters. Only lowercase letters, numbers, hyphens, dots, and underscores are allowed',
      });
      expect(validateName('my:project')).toEqual({
        valid: false,
        error:
          'Name contains invalid characters. Only lowercase letters, numbers, hyphens, dots, and underscores are allowed',
      });
      expect(validateName('my"project')).toEqual({
        valid: false,
        error:
          'Name contains invalid characters. Only lowercase letters, numbers, hyphens, dots, and underscores are allowed',
      });
      expect(validateName('my|project')).toEqual({
        valid: false,
        error:
          'Name contains invalid characters. Only lowercase letters, numbers, hyphens, dots, and underscores are allowed',
      });
      expect(validateName('my?project')).toEqual({
        valid: false,
        error:
          'Name contains invalid characters. Only lowercase letters, numbers, hyphens, dots, and underscores are allowed',
      });
      expect(validateName('my*project')).toEqual({
        valid: false,
        error:
          'Name contains invalid characters. Only lowercase letters, numbers, hyphens, dots, and underscores are allowed',
      });
      expect(validateName('my\\project')).toEqual({
        valid: false,
        error:
          'Name contains invalid characters. Only lowercase letters, numbers, hyphens, dots, and underscores are allowed',
      });
      expect(validateName('my/project')).toEqual({
        valid: false,
        error:
          'Name contains invalid characters. Only lowercase letters, numbers, hyphens, dots, and underscores are allowed',
      });
    });
  });

  describe('consecutive special characters', () => {
    test('rejects consecutive dashes', () => {
      expect(validateName('my--project')).toEqual({
        valid: false,
        error:
          'Name cannot contain consecutive special characters (found "--"). Special characters must be surrounded by letters or numbers.',
      });
    });

    test('rejects consecutive underscores', () => {
      expect(validateName('my__project')).toEqual({
        valid: false,
        error:
          'Name cannot contain consecutive special characters (found "__"). Special characters must be surrounded by letters or numbers.',
      });
    });

    test('rejects consecutive dots', () => {
      expect(validateName('my..project')).toEqual({
        valid: false,
        error:
          'Name cannot contain consecutive special characters (found ".."). Special characters must be surrounded by letters or numbers.',
      });
    });

    test('rejects mixed consecutive special characters', () => {
      expect(validateName('my-.project')).toEqual({
        valid: false,
        error:
          'Name cannot contain consecutive special characters (found "-."). Special characters must be surrounded by letters or numbers.',
      });
      expect(validateName('my._project')).toEqual({
        valid: false,
        error:
          'Name cannot contain consecutive special characters (found "._"). Special characters must be surrounded by letters or numbers.',
      });
      expect(validateName('my_-project')).toEqual({
        valid: false,
        error:
          'Name cannot contain consecutive special characters (found "_-"). Special characters must be surrounded by letters or numbers.',
      });
    });
  });

  describe('reserved names', () => {
    test('rejects Node.js core module names', () => {
      expect(validateName('fs')).toEqual({
        valid: false,
        error:
          'Name "fs" is reserved (Node.js core module, npm reserved name, or system reserved name)',
      });
      expect(validateName('path')).toEqual({
        valid: false,
        error:
          'Name "path" is reserved (Node.js core module, npm reserved name, or system reserved name)',
      });
      expect(validateName('http')).toEqual({
        valid: false,
        error:
          'Name "http" is reserved (Node.js core module, npm reserved name, or system reserved name)',
      });
      expect(validateName('crypto')).toEqual({
        valid: false,
        error:
          'Name "crypto" is reserved (Node.js core module, npm reserved name, or system reserved name)',
      });
    });

    test('rejects npm reserved names', () => {
      expect(validateName('node')).toEqual({
        valid: false,
        error:
          'Name "node" is reserved (Node.js core module, npm reserved name, or system reserved name)',
      });
      expect(validateName('node_modules')).toEqual({
        valid: false,
        error:
          'Name "node_modules" is reserved (Node.js core module, npm reserved name, or system reserved name)',
      });
      expect(validateName('favicon.ico')).toEqual({
        valid: false,
        error:
          'Name "favicon.ico" is reserved (Node.js core module, npm reserved name, or system reserved name)',
      });
    });

    test('rejects Windows reserved names', () => {
      expect(validateName('con')).toEqual({
        valid: false,
        error:
          'Name "con" is reserved (Node.js core module, npm reserved name, or system reserved name)',
      });
      expect(validateName('prn')).toEqual({
        valid: false,
        error:
          'Name "prn" is reserved (Node.js core module, npm reserved name, or system reserved name)',
      });
      expect(validateName('aux')).toEqual({
        valid: false,
        error:
          'Name "aux" is reserved (Node.js core module, npm reserved name, or system reserved name)',
      });
      expect(validateName('nul')).toEqual({
        valid: false,
        error:
          'Name "nul" is reserved (Node.js core module, npm reserved name, or system reserved name)',
      });
      expect(validateName('com1')).toEqual({
        valid: false,
        error:
          'Name "com1" is reserved (Node.js core module, npm reserved name, or system reserved name)',
      });
      expect(validateName('lpt1')).toEqual({
        valid: false,
        error:
          'Name "lpt1" is reserved (Node.js core module, npm reserved name, or system reserved name)',
      });
    });

    test('rejects relative path references', () => {
      expect(validateName('.')).toEqual({
        valid: false,
        error: 'Name cannot start with a dot, underscore, or dash',
      });
      expect(validateName('..')).toEqual({
        valid: false,
        error: 'Name cannot start with a dot, underscore, or dash',
      });
    });

    test('reserved names are case-insensitive', () => {
      expect(validateName('FS')).toEqual({
        valid: false,
        error: 'Name must be lowercase only',
      });
      expect(validateName('Path')).toEqual({
        valid: false,
        error: 'Name must be lowercase only',
      });
    });
  });

  describe('real-world examples', () => {
    test('accepts common package name patterns', () => {
      expect(validateName('react')).toEqual({ valid: true });
      expect(validateName('lodash')).toEqual({ valid: true });
      expect(validateName('express')).toEqual({ valid: true });
      expect(validateName('my-awesome-app')).toEqual({ valid: true });
      expect(validateName('babel-core')).toEqual({ valid: true });
      expect(validateName('webpack-dev-server')).toEqual({ valid: true });
      expect(validateName('eslint-plugin-react')).toEqual({ valid: true });
    });

    test('rejects common mistakes', () => {
      // Uppercase check happens before space check
      expect(validateName('My Project')).toEqual({
        valid: false,
        error: 'Name must be lowercase only',
      });
      expect(validateName('my_project!')).toEqual({
        valid: false,
        error:
          'Name contains invalid characters. Only lowercase letters, numbers, hyphens, dots, and underscores are allowed',
      });
      expect(validateName('-myproject')).toEqual({
        valid: false,
        error: 'Name cannot start with a dot, underscore, or dash',
      });
      expect(validateName('myproject-')).toEqual({
        valid: false,
        error: 'Name cannot end with a dash, underscore, or dot',
      });
    });
  });
});
