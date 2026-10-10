/** Checks that the `VERSION` the library exports matches the version in `package.json`. */

import { readFileSync } from "node:fs";

const PACKAGE_PATH = "package.json";
const INDEX_PATH = "src/core/index.ts";
const VERSION_PATTERN = /export const VERSION = "([^"]+)";/;

const packageVersion = JSON.parse(readFileSync(PACKAGE_PATH, "utf8")).version;
const exported = VERSION_PATTERN.exec(readFileSync(INDEX_PATH, "utf8"))?.[1];

if (exported === undefined) {
    console.error(`\n  ${INDEX_PATH} exports no VERSION literal\n`);
    process.exitCode = 1;
} else if (exported !== packageVersion) {
    console.error(`\n  VERSION is "${exported}" in ${INDEX_PATH} but "${packageVersion}" in ${PACKAGE_PATH}\n`);
    process.exitCode = 1;
} else {
    console.log(`  version ok — ${packageVersion}`);
}
