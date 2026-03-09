/** @type {import("prettier").Config} */
export default {
  // Intentionally minimal: rely on Prettier 3 defaults except:
  singleQuote: true, // Use single quotes in JS/TS
  jsxSingleQuote: false, // Keep double quotes in JSX (HTML convention)

  // PHP support via @prettier/plugin-php
  plugins: ['@prettier/plugin-php'],
  phpVersion: '8.1',
  trailingCommaPHP: true,
};
