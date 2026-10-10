# Contributing to ContainerUI

Thank you for helping. Bug reports, fixes and documentation improvements are all welcome. For a
bug, open an [issue](https://github.com/VigeNerSl/ContainerUI/issues) with what you did, what you
expected, what happened, and the lines the library logged. For a larger change, open an issue first so
we can agree on the direction.

Contributions are accepted under the project's [MIT License](LICENSE).

## Set up

You need a current LTS release of Node.js and nothing else: the library has no runtime dependencies.

```bash
npm install
npm run verify        # build, checks, tests, smoke suites, type check, pack generation
```

`npm run verify` must pass before a change is ready. CI runs the same command on Ubuntu and Windows.
It does not run `build:release`; that is a separate command.

## Layout

```
src/
  ContainerFormData.ts  the one import: everything, the Bedrock adapter included
  jsx-runtime.ts        the JSX runtime the compiler imports
  core/                 platform-free: loads and tests without the game
    reactive/             signals, computeds, effects, ownership scopes
    logging/              the logger every diagnostic goes through
    scheduler/            coalescing and time-slicing against the tick budget
    runtime/              elements, instances, layout, render pass, commit, timers
    hooks/                hooks, animation, context, outside state
    components/           Confirm, Modal, Suspense, PagedList, QuantityPicker, Routes, StorageSlots…
    storage/              SlotStorage, key-value persistence
    host/                 the HostAdapter interface and an in-memory test host
  platform/             the Bedrock adapter: the only folder allowed to touch @minecraft/server
    surface/              the menu entity, opening and closing
    scan/                 working out what the player did
    block/                block containers
    items/                ItemStack conversion, the anti-duplication guard, shulker reading
    storage/              the player-inventory storage, the external-change watch
    world/                scores and dynamic properties
documentation/          the user guide and API reference
tools/                  layer check, pack generator, build helpers, smoke suites in smoke/
```

[ARCHITECTURE.md](ARCHITECTURE.md) explains how the pieces fit together.

## The rules that matter

- **`core/` never touches the game.** The platform reports physical facts and the core decides what they
  mean. `npm run check:layers` enforces it, so a change in `core/` cannot import `@minecraft/server` or
  `platform/`.
- **Every relative import ends in `.js`.** Bedrock's module loader needs it, and the layer check reports
  any that does not.
- **Fix a bug with a check that fails without the fix.** The smoke suites in `tools/smoke/` are where
  regressions live; `npm run smoke:core` is the fastest.
- **Keep the pack identities.** The UUIDs of the shared packs in `tools/generate-pack.mjs` and the block
  and entity names (`containerui:…`) never change, because worlds and add-ons refer to them.

## Commands

```bash
npm run build            # compile to dist/ and copy the licence and logos next to it
npm run check:layers     # core stays platform-free; relative imports end in .js; bare imports are @minecraft/* only
npm run check:version    # VERSION matches package.json
npm run check:license    # the licence banner on the entry files matches LICENSE
npm run smoke            # the copied build loads through Node's real ESM loader
npm run smoke:core       # the core runtime, surface, components, hooks, storage, lists, blocks, logging, lifecycle
npm run smoke:itemguard  # the anti-duplication guard
npm run smoke:interaction  # one gesture is exactly one trigger
npm run smoke:form       # the fluent builder emits an ordinary tree
npm run generate:pack    # write pack/BP and pack/RP, the shared packs
npm test                 # the unit tests in test/, when the checkout has them
npm run typecheck        # type-check the library
npm run build:release    # release/: the .zip for add-on authors and the .mcaddon for players
```

`npm test` needs a folder a plain checkout does not include; without it, it prints `SKIPPED` and
succeeds.

## Trying a change in a world

```bash
npm run build
npm run generate:pack
node tools/vendor.mjs <your add-on>/scripts/ContainerUI
```

copies the build into your own add-on and writes the shared packs to `pack/BP` and `pack/RP`. Copy the
packs and your add-on into the game's development pack folders, delete older copies first, and
activate them in a world.

## Writing

Code, comments and documentation are in English. `README.ru.md` is the Russian edition of the README.
Comments are library documentation (`@param`,
`@returns`, `@example`), not a history of how the code came to be. Keep commit messages and pull
requests short and specific.
