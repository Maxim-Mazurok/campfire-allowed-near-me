import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("playwright version consistency", () => {
  it("update-forest-data workflow container image tag matches installed playwright version", () => {
    const packageJsonPath = resolve(import.meta.dirname, "../../package.json");
    const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf-8")) as {
      devDependencies?: Record<string, string>;
      dependencies?: Record<string, string>;
    };

    const playwrightVersion =
      packageJson.devDependencies?.["playwright"] ??
      packageJson.dependencies?.["playwright"] ??
      null;

    expect(playwrightVersion).not.toBeNull();

    const cleanVersion = playwrightVersion!.replace(/^[\^~>=<]*/, "");

    const workflowPath = resolve(
      import.meta.dirname,
      "../../.github/workflows/update-forest-data.yml"
    );
    const workflowContent = readFileSync(workflowPath, "utf-8");

    const imageMatch = /mcr\.microsoft\.com\/playwright:v([\d.]+)-/.exec(
      workflowContent
    );

    expect(
      imageMatch,
      "update-forest-data.yml must use mcr.microsoft.com/playwright container image"
    ).not.toBeNull();

    const imageVersion = imageMatch![1];

    expect(
      imageVersion,
      `Playwright container image tag (v${imageVersion}) must match package.json version (${cleanVersion}). ` +
        `Update the container image in .github/workflows/update-forest-data.yml to v${cleanVersion}-noble`
    ).toBe(cleanVersion);
  });
});
