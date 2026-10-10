/** Writing generated files. */

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

/** Writes `contents` to `root/relativePath`, creating folders, and logs the path. */
export const writeOutput = ({ root, relativePath, contents }) => {
    const path = join(root, relativePath);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, contents);
    console.log(`  wrote ${path}`);
};

/** Writes `value` as JSON indented by four spaces, with a trailing newline. */
export const writeJsonOutput = ({ root, relativePath, value }) => {
    writeOutput({ root, relativePath, contents: `${JSON.stringify(value, null, 4)}\n` });
};
