/*! ContainerUI | https://github.com/VigeNerSl/ContainerUI
 * SPDX-License-Identifier: MIT
 *
 * Copyright (c) 2026 vigenersl
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */

/**
 * The platform-free core: reactivity, components, hooks and the host boundary. It loads without
 * the game; a platform supplies a `HostAdapter`.
 *
 * @packageDocumentation
 */

// ── Reactivity ──────────────────────────────────────────────────────────────
export {
    signal,
    readonlySignal,
    computed,
    untrack,
    createRoot,
    createScope,
    disposeScope,
    getActiveScope,
    onCleanup,
    runWithScope,
    setErrorReporter,
    type Signal,
    type ReadonlySignal,
    type Computed,
    type Equals,
    type EffectBody,
    type Dispose,
    type Scope,
} from "./reactive/index.js";
export { effect, batch, flushSync } from "./runtime/effects.js";

// ── Logging ─────────────────────────────────────────────────────────────────
export { setLogger, consoleLogger, type Logger, type LogRecord, type LogLevel, type LogSource } from "./logging/logger.js";

// ── Scheduling ──────────────────────────────────────────────────────────────
export {
    Scheduler,
    createMicrotaskSchedulerHost,
    createManualSchedulerHost,
    type SchedulerHost,
    type SchedulerOptions,
    type SchedulerTask,
    type ManualSchedulerHost,
} from "./scheduler/scheduler.js";

export { configureRuntime, getRuntimeScheduler, hasRuntimeScheduler, setRuntimeScheduler, resetRuntime } from "./runtime/context.js";

// ── Elements & JSX ──────────────────────────────────────────────────────────
export {
    h,
    createElement,
    fragment,
    Fragment,
    isVNode,
    isEmptyChild,
    isIntrinsicType,
    type VNode,
    type Child,
    type Key,
    type ElementType,
    type IntrinsicType,
    type ComponentType,
    type ElementPropsMap,
    type SlotProps,
    type InputProps,
    type LayoutProps,
    type GridProps,
    type LayerProps,
    type SlotEvent,
    type InputEvent,
    type ItemSource,
} from "./runtime/element.js";

// ── Hooks ───────────────────────────────────────────────────────────────────
export {
    useState,
    useSignal,
    useMemo,
    useComputed,
    useRef,
    useId,
    useCallback,
    useReducer,
    useEffect,
    onUnmount,
} from "./hooks/hooks.js";
export { useTicker, useReveal, useTween, type Ticker, type TweenOptions } from "./hooks/animationHooks.js";

// ── Time & animation ────────────────────────────────────────────────────────
export {
    configureTimeSource,
    getTimeSource,
    hasTimeSource,
    resetTimeSource,
    createManualTimeSource,
    type TimeSource,
    type ManualTimeSource,
} from "./runtime/time.js";

export {
    createReveal,
    revealSteps,
    type Reveal,
    type RevealOptions,
    type RevealOrder,
    type RevealState,
} from "./hooks/reveal.js";

// ── Error boundaries ────────────────────────────────────────────────────────
export { ErrorBoundary, type ErrorBoundaryProps, type RenderFailure } from "./components/errorBoundary.js";

// ── Layers and modals ───────────────────────────────────────────────────────
export { Layer, Modal, type ModalProps } from "./components/layers.js";
export { Confirm, type ConfirmButton, type ConfirmProps, type Watched } from "./components/confirm.js";

// ── Suspense ────────────────────────────────────────────────────────────────
export { Suspense, useResource, type Resource, type SuspenseProps } from "./components/suspense.js";

// ── Context ─────────────────────────────────────────────────────────────────
export {
    createContext,
    provideContext,
    useContext,
    useContextSelector,
    useRequiredContext,
    type Context,
} from "./hooks/componentContext.js";

// ── Fluent authoring ────────────────────────────────────────────────────────
export {
    ContainerFormBuilder,
    type InputOptions,
    type Area,
    type StorageOptions,
} from "./components/containerForm.js";

// ── Storage mirroring ───────────────────────────────────────────────────────
export { createMemoryStorage, type SlotStorage, type MemoryStorage } from "./storage/slotStorage.js";
export { StorageSlots, type StorageSlotsProps } from "./components/storageSlots.js";
export { StorageView, type StorageViewProps } from "./components/storageView.js";
export type { StorageRangeProps } from "./components/storageRange.js";

// ── Persistence ─────────────────────────────────────────────────────────────
export {
    ChunkedStore,
    JsonStore,
    createMemoryBackend,
    DEFAULT_CHUNK_SIZE,
    type KeyValueBackend,
    type MemoryBackend,
    type BackendWrite,
    type ChunkedStoreOptions,
    type JsonStoreOptions,
    type JsonMigration,
} from "./storage/keyValue.js";

// ── Navigation ──────────────────────────────────────────────────────────────
export {
    createRouter,
    useRouter,
    useRouteState,
    Routes,
    type Router,
    type RouteMatch,
    type RouteConfig,
    type RouteTable,
    type RouteProps,
    type RoutesProps,
} from "./components/router.js";

// ── Lists, quantities and outside state ─────────────────────────────────────
export {
    usePagination,
    PagedList,
    type Pagination,
    type PaginationOptions,
    type PageState,
    type PageControl,
    type PagedListProps,
} from "./components/pagination.js";
export { QuantityPicker, type QuantityPickerProps, type QuantityStep } from "./components/quantityPicker.js";
export { useExternal, type ExternalOptions, type ExternalSubscribe } from "./hooks/externalStore.js";

// ── Layout helpers ──────────────────────────────────────────────────────────
export {
    LayoutFrame,
    SURFACE_WIDTH,
    borderIndices,
    rectIndices,
    toCoordinates,
    toIndex,
    type LayoutKind,
    type LayoutFrameOptions,
    type RectOptions,
} from "./runtime/layout.js";

// ── Rendering ───────────────────────────────────────────────────────────────
export { mount, type App, type MountOptions, type Diagnostic } from "./runtime/app.js";
export {
    runRenderPass,
    resolveItemSource,
    type ResolvedSlot,
    type SlotMap,
    type SlotKind,
    type RenderPassOptions,
    type RenderPassResult,
} from "./runtime/renderer.js";

// ── Host boundary ───────────────────────────────────────────────────────────
export {
    areItemsEqual,
    areEnchantmentsEqual,
    isSameItem,
    cloneItemView,
    toDisplayView,
    type HostAdapter,
    type HostInteraction,
    type InteractionKind,
    type CloseReason,
    type ItemView,
    type ItemEnchantment,
    type ItemPotion,
} from "./host/host.js";

export { createTestHost, type TestHost, type TestHostOptions, type WriteRecord } from "./host/testHost.js";

/** The library version. */
export const VERSION = "1.0.0-beta.4";
