import { GenerateBuildInfo } from '../../src/build-info';

// Runs from the project root so GenerateBuildInfo picks up the version
// from the root package.json. Invoked via ssr:generate:build-info,
// which is called by ssr:build as part of the overall build process.
// Output (demos/ssr/current-build-info.ts) is gitignored.

async function main() {
  const generator = new GenerateBuildInfo();

  const { warnings } = await generator.saveTS(
    'demos/ssr/current-build-info.ts',
  );

  if (warnings.length > 0) {
    // eslint-disable-next-line no-console
    console.warn('Build info warnings:\n' + warnings.join('\n'));
  }
}

main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error('Failed to generate SSR build info:', error);
  process.exit(1);
});
