/**
 * The licence comment at the top of each entry file of the library. It carries the copyright line and
 * the whole MIT permission notice, so a bundle that keeps only legal comments still has both. The text
 * comes from `LICENSE`, so the two cannot differ.
 */

import { readFileSync } from "node:fs";
import { REPOSITORY_URL } from "./pack-manifest.mjs";

/** The entry files of the library, which each start with the banner. */
export const BANNER_FILES = ["src/ContainerFormData.ts", "src/core/index.ts", "src/jsx-runtime.ts"];

/** The banner comment for the current `LICENSE`, without a trailing newline. */
export const licenseBanner = () => {
    const [, , ...notice] = readFileSync(new URL("../LICENSE", import.meta.url), "utf8").replace(/\r\n/g, "\n").trimEnd().split("\n");
    const lines = [
        `/*! ContainerUI | ${REPOSITORY_URL}`,
        " * SPDX-License-Identifier: MIT",
        " *",
        ...notice.map((line) => (line === "" ? " *" : ` * ${line}`)),
        " */",
    ];
    return lines.join("\n");
};
