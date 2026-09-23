/**
 * Client-only test setup.
 *
 * Separate from `vitest.setup.ts` because that one runs for the server project
 * too, on node, where importing anything that touches the DOM fails outright.
 *
 * The cleanup is not optional here. Testing Library unmounts automatically only
 * when the test framework exposes `afterEach` as a global, and this repo runs
 * vitest without `globals: true` — tests import `describe`/`it`/`expect` by
 * hand. Without this, every rendered component stays in the document and the
 * next test queries a page holding all of its predecessors.
 */

import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

afterEach(() => cleanup());
