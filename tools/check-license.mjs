/** Checks that every entry file of the library starts with the licence banner built from `LICENSE`. */

import { readFileSync } from "node:fs";
import { BANNER_FILES, licenseBanner } from "./license-banner.mjs";

const banner = licenseBanner();
const stale = BANNER_FILES.filter((path) => !readFileSync(path, "utf8").replace(/\r\n/g, "\n").startsWith(`${banner}\n`));

if (stale.length > 0) {
    console.error(`\n  the licence banner is missing or out of date in: ${stale.join(", ")}\n`);
    process.exitCode = 1;
} else {
    console.log(`  licence banner ok — ${BANNER_FILES.length} entry files`);
}
