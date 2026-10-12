<h1 align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="assets/logo-dark.svg">
    <img src="assets/logo.svg" alt="ContainerUI" width="420">
  </picture>
</h1>

<p align="center">
  Реактивные меню-сундуки для аддонов Minecraft Bedrock.<br>
  <a href="README.md">English</a>
</p>

**NOT AN OFFICIAL MINECRAFT PRODUCT. NOT APPROVED BY OR ASSOCIATED WITH MOJANG OR MICROSOFT.**
(Это не официальный продукт Minecraft и не одобрен Mojang или Microsoft.)

## Что это

ContainerUI позволяет строить меню для аддонов Minecraft Bedrock так, как строят интерфейс на React.
Вы описываете, что должно быть в меню, а библиотека рисует его, замечает действия игрока и вызывает ваши
обработчики. Неудобные части она берёт на себя: отличает клик от перетаскивания, возвращает на место
кнопки, которые игрок передвинул, не даёт унести предметы меню в инвентарь и записывает только
изменившиеся слоты, чтобы сервер укладывался в бюджет тика.

```tsx
import { openContainer, useState } from "containerui";

function Counter() {
    const [count, setCount] = useState(0);

    return (
        <row index={10}>
            <slot item={{ typeId: "minecraft:paper", name: `Clicked ${count} times` }} />
            <slot
                item={{ typeId: "minecraft:emerald", name: "§aClick me" }}
                sound="random.orb"
                onClick={() => setCount((value) => value + 1)}
            />
        </row>
    );
}

openContainer(player, () => <Counter />, { size: 27, title: "§dCounter" });
```

## Быстрый старт

Нужны две вещи: **паки ContainerUI** в мире (ставятся один раз) и **библиотека** внутри вашего аддона.

Требования:

- Minecraft Bedrock 1.26.20 или новее.
- Модуль Script API `@minecraft/server` 2.9.0 или новее. Библиотека не использует бета-API, поэтому
  эксперимент *Beta APIs* в мире включать не нужно.

### 1. Установите паки

В паках лежат сущность меню, сущность хранилища блоков, экраны и 17 плоских стеклянных блоков, скриптов в
них нет. Ресурс-пак к тому же показывает подсказку предмета при касании во всех контейнерах мира, ванильных
тоже. Установите пакет и скопируйте паки в игру:

```bash
npm install containerui
```

- `node_modules/containerui/pack/BP` → `development_behavior_packs/ContainerUI_BP`
- `node_modules/containerui/pack/RP` → `development_resource_packs/ContainerUI_RP`

Папки `development_behavior_packs` и `development_resource_packs` лежат в папке данных игры,
`com.mojang`. Для версии с лаунчером (GDK) в Windows это
`%AppData%\Minecraft Bedrock\Users\Shared\games\com.mojang`. Затем включите в мире
**ContainerUI BP** (в игре наборы поведения называются «Наборы параметров»): он сам подтянет
**ContainerUI RP**.

### 2. Добавьте библиотеку в аддон

Выберите один способ:

- **Без сборщика.** Скопируйте `node_modules/containerui/dist` в `YourBP/scripts/ContainerUI`. Файл
  `LICENSE` внутри оставьте. Пишете на обычном JavaScript через `h()` или билдер (fluent builder).
- **Со сборщиком** (TypeScript, JSX). Импортируйте из `"containerui"` и соберите точку входа в
  `BP/scripts/main.js` через esbuild или rollup, пометив `@minecraft/server` внешним. Для JSX укажите в
  `tsconfig.json` `"jsx": "react-jsx"` и `"jsxImportSource": "containerui"`.
  [Как это настроить](documentation/getting-started/installation.md#option-2-bundle-the-package) (на английском).

### 3. Укажите зависимость от паков

В `manifest.json` вашего набора поведения:

```jsonc
"dependencies": [
    { "uuid": "2d2c35a3-017c-42cd-a910-9c64d55bcc25", "version": [1, 0, 0] },
    { "module_name": "@minecraft/server", "version": "2.9.0" }
]
```

Этот UUID обозначает ContainerUI BP и никогда не меняется. Игра загружает паки вместе с вашим аддоном.

### 4. Откройте меню

```js
import { world } from "@minecraft/server";
import { h, installBedrockRuntime, openContainer } from "./ContainerUI/ContainerFormData.js";

installBedrockRuntime();

world.afterEvents.itemUse.subscribe((vigenersl) => {
    const { source, itemStack } = vigenersl;
    if (itemStack.typeId !== "minecraft:stick") return;
    openContainer(source, () => h("slot", { index: 13, item: { typeId: "minecraft:diamond", name: "§bIt works" } }), {
        size: 27,
        title: "Hello",
    });
});
```

Используйте палку, и откроется меню из одного предмета. (`vigenersl` — это подпись автора для параметров
событий в примерах; свои называйте как хотите.) Дальше [Ваше первое меню](documentation/getting-started/first-menu.md)
шаг за шагом строит счётчик и небольшой магазин (документация на английском).

## Что вы получаете

- **Реактивные меню.** Состояние — это сигналы и хуки (`useState`, `useMemo`, …). Записываются только
  изменившиеся слоты, не чаще одного раза за тик; большое обновление может занять несколько тиков.
  [Reactivity](documentation/guides/reactivity.md), [Hooks](documentation/guides/hooks.md)
- **JSX, обычный JavaScript или билдер (fluent builder).** Одно и то же меню тремя способами.
  [Components](documentation/guides/components.md), [The fluent builder](documentation/guides/fluent-builder.md)
- **Раскладка.** `row`, `column`, `grid` и абсолютные индексы.
  [Elements and layout](documentation/guides/elements-and-layout.md)
- **Клики, которые работают.** Кнопки, слоты, которые заполняет игрок, мышь и сенсорный экран. Предметы меню
  нельзя вынести из меню. [Interaction](documentation/guides/interaction.md), [Items](documentation/guides/items.md)
- **Экраны, диалоги и загрузка.** Роутер, `Modal` и `Confirm`, `Suspense`, `ErrorBoundary`.
  [Navigation](documentation/guides/navigation.md), [Layers and modals](documentation/guides/layers-and-modals.md),
  [Async data](documentation/guides/async-data.md)
- **Магазины и списки.** Постраничный вывод и выбор количества.
  [Lists and quantities](documentation/guides/lists-and-quantities.md)
- **Настоящее хранилище.** Сундуки и блоки-машины, инвентари игроков, чтение шалкеров, сохранённые данные.
  [Block containers](documentation/guides/block-containers.md),
  [Storage](documentation/guides/storage-and-mirroring.md), [Persistence](documentation/guides/persistence.md)
- **Настоящие предметы.** Зачарования, прочность, зелья, состояния блоков и невидимые теги.
- **Плоское стекло.** Семнадцать бесшовных стеклянных плиток для рамок и фонов.
  [Flat glass](documentation/guides/flat-glass.md)
- **Анимация.** Поочерёдное появление и плавные изменения как обычное состояние.
  [Animation](documentation/guides/animation.md)
- **Тесты без игры.** Хост в памяти, который считает каждую запись. [Testing](documentation/guides/testing.md)
- **Диагностика.** О каждой проблеме сообщается названием, по которому понятно, что делать.
  [Errors, diagnostics and logging](documentation/guides/errors-and-diagnostics.md)

## Документация

- **[documentation/](documentation/README.md)** — это руководство пользователя: установка, первое меню, раздел
  по каждой возможности, справочник API и решение проблем (на английском). Начинайте с неё.
- [Troubleshooting](documentation/troubleshooting.md), если меню не открывается.
- [ARCHITECTURE.md](ARCHITECTURE.md) (на английском) объясняет, как библиотека устроена внутри: для
  любопытных и для тех, кто хочет помогать проекту.
- [CHANGELOG.md](CHANGELOG.md) (на английском) перечисляет, что изменилось в каждом релизе.

## Статус

`1.0.0-beta.2` — текущий релиз, первым публичным был `1.0.0-beta.1`. Меню, блоки-контейнеры, модальные
окна, состояния загрузки, страницы и выбор количества проверены в живом мире на компьютере и на
телефоне, а ядро и логика взаимодействия покрыты автоматическими проверками. Это бета: API может
измениться до версии 1.0, и каждое ломающее изменение будет записано в списке изменений.

Известные ограничения:

- **Два игрока меняют один слот хранилища в одном тике.** Побеждает первое изменение, второе откатывается;
  редкий случай, который не удалось разрешить, передаётся строкой трассировки `conflict-unresolved` в
  параметр `onTrace` меню.
- **Нет свечения чар и полоски прочности у предметов, которые их не поддерживают.** `enchantments` и
  `durability` применяются там, где это позволяет движок, а в остальных случаях один раз на тип предмета
  выводят предупреждение; для остального сделайте свой предмет.

## Участие в проекте

Сообщения об ошибках и pull request'ы приветствуются: см. [CONTRIBUTING.md](CONTRIBUTING.md) (на английском).

## Лицензия

MIT © vigenersl: можно использовать, менять, продавать и распространять ContainerUI в любом аддоне,
бесплатном или платном. Сохраняйте уведомление об авторских правах и текст лицензии вместе с библиотекой:
для этого рядом с `ContainerFormData.js` лежит файл `LICENSE`. Полный текст в [LICENSE](LICENSE).

Название «ContainerUI» и логотип не покрываются лицензией MIT: см. [TRADEMARKS.md](TRADEMARKS.md). Коротко:
можно писать, что ваш аддон сделан на ContainerUI, но нельзя называть так свой проект.

ContainerUI — это неофициальная библиотека. **NOT AN OFFICIAL MINECRAFT PRODUCT. NOT APPROVED BY OR ASSOCIATED WITH
MOJANG OR MICROSOFT.** Условия EULA и Usage Guidelines Minecraft по-прежнему действуют для каждого аддона,
сделанного на ней.

Вопросы и сообщения об ошибках: [GitHub Issues](https://github.com/VigeNerSl/ContainerUI/issues).
