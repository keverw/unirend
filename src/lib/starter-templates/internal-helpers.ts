import type { MonorepoConfig } from "./types";

export function createMonorepoConfigObject(name: string): MonorepoConfig {
  return {
    version: "1.0",
    name,
    created: new Date().toISOString(),
    projects: {},
  };
}

export function addProjectToMonorepo(
  config: MonorepoConfig,
  projectName: string,
  templateID: string,
  relativePath: string,
): MonorepoConfig {
  return {
    ...config,
    projects: {
      ...config.projects,
      [projectName]: {
        templateID,
        path: relativePath,
        createdAt: new Date().toISOString(),
      },
    },
  };
}
