/**
 * Checks the invariants that keep the library loadable in Bedrock:
 *
 * 1. Only `src/platform/` imports `@minecraft/server`, and `src/core/` never imports
 *    `src/platform/`. Only the root `src/ContainerFormData.ts` joins the two.
 * 2. Every import specifier has a form Bedrock can resolve: relative specifiers end in `.js`, and
 *    the only bare specifiers are the `@minecraft/*` modules a manifest can declare.
 * 3. No player messaging. Diagnostics go to the console, in the library and the tools.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";

const SOURCE_ROOT = "src";
const PLATFORM_PREFIX = join("src", "platform") + sep;
const CORE_PREFIX = join("src", "core") + sep;
const ALLOWED_BARE_PREFIX = "@minecraft/";
/** Folders checked for banned APIs besides `src`; each is optional. */
const CHECKED_ROOTS = ["tools", "test"];

const IMPORT_PATTERN = /(?:^|\n)\s*(?:import|export)[\s\S]*?from\s*["']([^"']+)["']/g;
const SIDE_EFFECT_IMPORT_PATTERN = /(?:^|\n)\s*import\s*["']([^"']+)["']/g;

/** APIs banned everywhere. The action-bar hint is a UI affordance, not a log, so `onScreenDisplay` is allowed. */
const BANNED_APIS = [
    {
        label: "sendMessage()",
        pattern: /\.sendMessage\s*\(/,
        reason: "player messaging is banned — diagnostics must go to console.info/warn/error, which reaches the content log and works in read-only windows",
    },
];

const isSource = (entry) => entry.endsWith(".ts") && !entry.endsWith(".d.ts");
const isScript = (entry) => /\.(ts|tsx|js|mjs)$/.test(entry) && !entry.endsWith(".d.ts");

/** Files under `directory` that `accepts` keeps. Vendored copies of the build are skipped. */
const collectFiles = (directory, accepts) =>
    readdirSync(directory).flatMap((entry) => {
        if (entry === "ContainerUI") return [];
        const path = join(directory, entry);
        if (statSync(path).isDirectory()) return collectFiles(path, accepts);
        return accepts(entry) ? [path] : [];
    });

const collectOptionalScripts = (root) => {
    try {
        return collectFiles(root, isScript);
    } catch {
        return [];
    }
};

const extractSpecifiers = (contents) => [
    ...new Set([IMPORT_PATTERN, SIDE_EFFECT_IMPORT_PATTERN].flatMap((pattern) => [...contents.matchAll(pattern)].map((match) => match[1]))),
];

const bannedApiViolations = (file) => {
    const contents = readFileSync(file, "utf8");
    return BANNED_APIS.filter((banned) => banned.pattern.test(contents)).map((banned) => ({ file, detail: `uses ${banned.label}`, reason: banned.reason }));
};

const importViolations = (file) => {
    const isPlatformFile = file.startsWith(PLATFORM_PREFIX);
    const isCoreFile = file.startsWith(CORE_PREFIX);

    return extractSpecifiers(readFileSync(file, "utf8")).flatMap((specifier) => {
        const violation = (reason) => ({ file, detail: `imports "${specifier}"`, reason });

        if (specifier.startsWith(".")) {
            const reasons = [];
            if (!specifier.endsWith(".js")) reasons.push("relative imports must end in .js — Bedrock does not resolve extensionless paths");
            if (isCoreFile && join(dirname(file), specifier).startsWith(PLATFORM_PREFIX)) {
                reasons.push("src/core/ may not import src/platform/ — the core must load without the game");
            }
            return reasons.map(violation);
        }
        if (specifier.startsWith(ALLOWED_BARE_PREFIX)) {
            return isPlatformFile ? [] : [violation("only src/platform/ may depend on the Minecraft API — the core must stay platform-agnostic")];
        }
        return [violation("bare specifiers other than @minecraft/* cannot resolve in Bedrock (there is no node_modules)")];
    });
};

const sourceFiles = collectFiles(SOURCE_ROOT, isSource);
const checkedFiles = [...sourceFiles, ...CHECKED_ROOTS.flatMap(collectOptionalScripts)];
const violations = [...checkedFiles.flatMap(bannedApiViolations), ...sourceFiles.flatMap(importViolations)];

if (violations.length > 0) {
    console.error(`\n  ${violations.length} layering violation(s):\n`);
    for (const violation of violations) {
        console.error(`  ${relative(".", violation.file)}`);
        console.error(`    ${violation.detail}`);
        console.error(`    ${violation.reason}\n`);
    }
    process.exitCode = 1;
} else {
    console.log("  layers ok — core is platform-free, every specifier is one Bedrock can resolve, no player messaging");
}
