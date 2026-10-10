# tools

Scripts that build, check and package ContainerUI. They are for people who work on the library: using
it needs none of them. Everything runs through `npm run <name>`; the commands are listed in
[CONTRIBUTING.md](../CONTRIBUTING.md#commands). `npm run verify` runs the build, the checks, the smoke
suites, the type check, the pack generation and the vendor step; `build:testpack` and `build:release`
are separate.

## Build and package

| File | What it does |
|---|---|
| `generate-pack.mjs` | Generates the shared ContainerUI packs: the menu and storage entities, the screens, the flat glass blocks and the manifests. `npm run generate:pack`. |
| `flat-glass.mjs` | The seventeen flat glass blocks of those packs: block definitions, model, names. The textures are the PNGs in `glass-textures/`. |
| `pack-manifest.mjs` | What every pack manifest shares: version, author, licence and repository link. |
| `png.mjs`, `files.mjs` | Small helpers for the generators: writing PNG images and writing files. |
| `copy-dist-files.mjs` | After a build, copies `LICENSE` and the logos into `dist/`. |
| `vendor.mjs` | Copies the build into a pack's script folder, which is how an add-on carries the library. |
| `build-release.mjs`, `zip.mjs` | Build the release files in `release/`: the `.zip` for add-on authors and the `.mcaddon` for players. `npm run build:release`. |
| `build-test-pack.mjs` | Builds `testpack/`: the shared packs and the diagnostic add-on from [`examples/diagnostics`](../examples/diagnostics/README.md). `npm run build:testpack`. |

## Checks

| File | What it checks |
|---|---|
| `check-layers.mjs` | `src/core/` never touches `@minecraft/server`, relative imports end in `.js`, and the only bare imports are `@minecraft/*` modules. |
| `check-version.mjs` | The `VERSION` the library exports equals the version in `package.json`. |
| `check-license.mjs`, `license-banner.mjs` | The licence banner at the top of each entry file matches `LICENSE`. |
| `optional.mjs` | Runs a task that needs a folder this repository does not include (`test/`, `examples/shop`, `examples/plain-js`). Without the folder the task prints `SKIPPED` and succeeds; `typecheck` then type-checks the library instead. |

## smoke/

Automated checks that run without the game, against a copy of the build and a small stand-in for
`@minecraft/server`. They are what CI runs.

| Folder or file | What it covers |
|---|---|
| `core/` | The core runtime, surface, components, hooks, storage, lists, block containers, logging, lifecycle and regressions. |
| `interaction/` | How the platform turns what the player did into one trigger: clicks, takes, insertions, swaps, late events. |
| `itemguard.mjs` | The anti-duplication guard: a menu item is destroyed once it reaches the world, and a real item is never touched. |
| `containerform.mjs` | The fluent builder produces an ordinary element tree. |
| `vendored.mjs` | A copy of the build loads through Node's own module loader, as a pack without a bundler would load it. |
| `harness.mjs`, `engines/` | The shared runner, and the stand-ins for `@minecraft/server`. |

When you fix a bug, add a check here that fails without the fix. `npm run smoke:core` is the fastest
suite to run on its own.
