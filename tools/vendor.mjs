/**
 * Copies the build into a pack's script folder.
 * Every import in the build is relative and ends in `.js`, so the copy runs in the game as it is.
 *
 * Usage: node tools/vendor.mjs <destination>
 */

import { cpSync, mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";

/** How many `.js` modules `directory` holds. */
const countModules = (directory) =>
    readdirSync(directory).reduce((count, entry) => {
        const path = join(directory, entry);
        if (statSync(path).isDirectory()) return count + countModules(path);
        return count + (entry.endsWith(".js") ? 1 : 0);
    }, 0);

const destination = process.argv[2];
if (!destination) {
    console.error("  usage: node tools/vendor.mjs <destination>");
    process.exit(1);
}

rmSync(destination, { recursive: true, force: true });
mkdirSync(destination, { recursive: true });
cpSync("dist", destination, { recursive: true });
console.log(`  vendored ${countModules(destination)} module(s) into ${destination}`);
