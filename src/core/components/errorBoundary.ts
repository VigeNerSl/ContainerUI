/** Error boundaries: a fallback in place of children that throw while rendering. */

import { reportScopeError } from "../reactive/owner.js";
import type { Child } from "../runtime/element.js";
import { useRef, useSignal } from "../hooks/hooks.js";
import { findAncestor, findErrorBoundary, requireActiveInstance, type ComponentInstance } from "../runtime/instance.js";

/** A caught render error. */
export interface RenderFailure {
    readonly error: unknown;
    /** What threw: a component, or a slot's item source. */
    readonly component: string;
    /** Clears the failure and renders the children again with fresh state. */
    reset(): void;
}

/** Props of {@link ErrorBoundary}. */
export interface ErrorBoundaryProps {
    /** Shown instead of the children after one throws. */
    fallback: Child | ((failure: RenderFailure) => Child);
    /** Called once per caught failure. */
    onError?: (failure: RenderFailure) => void;
    children?: Child;
}

/**
 * Whether an error comes from the failed children, rather than from the fallback that replaced them.
 * Before the fallback shows (`children` is `null`) every error comes from the children.
 */
const isFromChildren = ({
    boundary,
    source,
    children,
}: {
    boundary: ComponentInstance;
    source: ComponentInstance | undefined;
    children: ReadonlySet<ComponentInstance> | null;
}): boolean => {
    if (children === null) return true;
    const topLevel = findAncestor(source ?? null, (candidate) => candidate.parentInstance === boundary);
    return topLevel !== null && children.has(topLevel);
};

/**
 * Shows `fallback` once a child throws while rendering, until `reset()`. Errors thrown while the
 * fallback shows go to the next boundary up; those of other children that failed in the same pass
 * stay here. Handler errors are not caught; they report as
 * `handler-error`.
 *
 * @example
 * <ErrorBoundary fallback={(failure) => <slot index={13} item={retry} onClick={failure.reset} />}>
 *     <Shop player={player} />
 * </ErrorBoundary>
 */
export const ErrorBoundary = (props: ErrorBoundaryProps): Child => {
    const instance = requireActiveInstance("ErrorBoundary");
    const failure = useSignal<RenderFailure | null>(null);
    const onError = useRef(props.onError);
    onError.current = props.onError;

    // The children that were mounted when the fallback went up; `null` while it is not showing.
    const failedChildren = useRef<ReadonlySet<ComponentInstance> | null>(null);

    instance.catchRenderError ??= (error, component, source) => {
        if (failure.peek()) {
            // A sibling of the child that failed first stays here; only the fallback's own errors go up.
            if (isFromChildren({ boundary: instance, source, children: failedChildren.current })) return;
            findErrorBoundary(instance.parentInstance)?.catchRenderError?.(error, component, source);
            return;
        }
        const caught: RenderFailure = { error, component, reset: () => failure.set(null) };
        failure.set(caught);
        try {
            onError.current?.(caught);
        } catch (handlerError) {
            reportScopeError(handlerError);
        }
    };

    const current = failure.value;
    if (!current) {
        failedChildren.current = null;
        return props.children ?? null;
    }
    failedChildren.current ??= new Set(instance.children.values());
    return typeof props.fallback === "function" ? props.fallback(current) : props.fallback;
};
