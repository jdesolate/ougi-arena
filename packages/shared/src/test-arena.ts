import { parseArenaMap } from "./map.js";

/**
 * Test fixture, not shipped content: a bare arena the same size as the dojo with a single crate at cell (6, 4).
 * Tests that measure a mechanic — dash distance, an Ougi's reach — use this so they never accidentally measure
 * whichever pillar the authored dojo happens to have moved since.
 */
export const OPEN_ARENA = parseArenaMap("open", "Open", [
  "1.............2",
  "...............",
  "...............",
  "...............",
  "......x........",
  "...............",
  "...............",
  "3.............4",
]);
