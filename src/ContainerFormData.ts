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
 * ContainerUI: the whole library from one import, the Bedrock adapter included. Code that runs
 * outside the game, such as tests, imports `./core/index.js` instead.
 *
 * @example
 * import { ContainerFormData } from "./ContainerUI/ContainerFormData.js";
 *
 * new ContainerFormData(27)
 *     .title("Shop")
 *     .button(13, { typeId: "minecraft:diamond", name: "Buy" }, () => console.info("[shop] bought"))
 *     .open(player);
 *
 * @packageDocumentation
 */

export * from "./core/index.js";
export * from "./platform/index.js";
