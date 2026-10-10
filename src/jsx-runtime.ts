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
 * The automatic JSX runtime.
 *
 * @example
 * // tsconfig.json
 * { "jsx": "react-jsx", "jsxImportSource": "containerui" }
 */

import { Fragment, type Child, type ElementPropsMap, type ElementType, type Key, type VNode } from "./core/runtime/element.js";

export { Fragment };

/** Creates an element with at most one child. Called by the compiler. */
export const jsx = (type: ElementType, props: Record<string, unknown> | null, key?: Key): VNode => {
    return { type, props: props ?? {}, key: key ?? null };
};

/** Creates an element with several children. Called by the compiler. */
export const jsxs = jsx;

/** Development build of {@link jsx}; same output. */
export const jsxDEV = jsx;

type WithChildren<P> = P & { children?: Child; key?: Key };

/** The types the TypeScript compiler checks JSX against. */
export namespace JSX {
    /** What a JSX expression evaluates to. */
    export type Element = VNode;

    /** What may be used as a tag. Lets components return any `Child` (TypeScript 5.1+). */
    export type ElementType = keyof IntrinsicElements | ((props: any) => Child);

    /** The prop that nested JSX children are passed in. */
    export interface ElementChildrenAttribute {
        children: unknown;
    }

    /** Attributes every element accepts. */
    export interface IntrinsicAttributes {
        key?: Key;
    }

    /** The built-in tags and their props. */
    export interface IntrinsicElements {
        slot: WithChildren<ElementPropsMap["slot"]>;
        input: WithChildren<ElementPropsMap["input"]>;
        box: WithChildren<ElementPropsMap["box"]>;
        row: WithChildren<ElementPropsMap["row"]>;
        column: WithChildren<ElementPropsMap["column"]>;
        grid: WithChildren<ElementPropsMap["grid"]>;
    }

    /** The property whose type gives a component's props. */
    export interface ElementAttributesProperty {
        props: unknown;
    }
}
