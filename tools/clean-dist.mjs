/**
 * Empties `dist/` before a build. The compiler only adds and overwrites files, so a module deleted
 * from `src/` would otherwise stay in `dist/` and ship in the package and the packs.
 *
 * Usage: node tools/clean-dist.mjs
 */

import { rmSync } from "node:fs";

rmSync("dist", { recursive: true, force: true });
