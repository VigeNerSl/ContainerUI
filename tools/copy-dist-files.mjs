/**
 * Copies the files that travel with the library into `dist/`: the licence, and the SVG logos in
 * `dist/logo/`. A copy of the build in an add-on then carries the licence next to
 * `ContainerFormData.js`, which is what the licence asks to be kept with the library.
 *
 * Usage: node tools/copy-dist-files.mjs
 */

import { copyFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const LOGOS = ["logo.svg", "logo-dark.svg", "avatar.svg"];
const LOGO_FOLDER = join("dist", "logo");

copyFileSync("LICENSE", join("dist", "LICENSE"));
mkdirSync(LOGO_FOLDER, { recursive: true });
for (const logo of LOGOS) copyFileSync(join("assets", logo), join(LOGO_FOLDER, logo));
console.log(`  copied LICENSE and ${LOGOS.length} logos into dist/`);
