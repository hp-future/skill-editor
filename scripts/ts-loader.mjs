/**
 * Node module-resolution hooks that let plain `node` (no bundler, no ts-node)
 * import this project's TypeScript sources.
 *
 * The sources use bundler-style "extensionless" relative imports (`./foo`),
 * which Node's ESM resolver rejects. These hooks append `.ts`/`.tsx` when a
 * relative specifier has no extension, so `scripts/inspect-zip.mts` can run the
 * exact same pipeline the browser does.
 *
 * Registered through `--import ./scripts/ts-loader.mjs`.
 */
import { access } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const CANDIDATE_EXTENSIONS = ['.ts', '.tsx'];

async function exists(url) {
  try {
    await access(fileURLToPath(url));
    return true;
  } catch {
    return false;
  }
}

export async function resolve(specifier, context, nextResolve) {
  // `@/…` is a small alias for the project's `src/` folder, used by scripts
  // that need the test-only ZIP builder.
  if (specifier.startsWith('@/')) {
    const candidate = new URL(`../src/${specifier.slice(2)}`, import.meta.url);
    for (const extension of CANDIDATE_EXTENSIONS) {
      const withExtension = new URL(candidate.href + extension);
      if (await exists(withExtension)) {
        return { url: withExtension.href, shortCircuit: true };
      }
    }
    if (await exists(candidate)) {
      return { url: candidate.href, shortCircuit: true };
    }
  }

  if (
    (specifier.startsWith('./') || specifier.startsWith('../')) &&
    !/\.[cm]?[jt]sx?$/.test(specifier)
  ) {
    try {
      const resolved = await nextResolve(specifier, context);
      if (await exists(resolved.url)) return resolved;
    } catch {
      // Fall through to the extension candidates below.
    }
    for (const extension of CANDIDATE_EXTENSIONS) {
      const candidate = new URL(specifier + extension, context.parentURL);
      if (await exists(candidate)) {
        // Omit `format` so Node's own type-stripping still applies to `.ts`.
        return { url: candidate.href, shortCircuit: true };
      }
    }
  }
  return nextResolve(specifier, context);
}
