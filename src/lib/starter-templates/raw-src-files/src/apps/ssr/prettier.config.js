import baseConfig from '../../../prettier.config.js';

/** @type {import("prettier").Config & import("prettier-plugin-tailwindcss").PluginOptions} */
export default {
  ...baseConfig,
  plugins: ['prettier-plugin-tailwindcss'],
  // Tailwind CSS v4 requires specifying the stylesheet path
  tailwindStylesheet: './index.css',
};
