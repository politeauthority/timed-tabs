import { describe, expect, it } from "vitest";
import { DEFAULT_TAB_SORT, sortTabs, TAB_SORTS } from "../src/shared/tab-sort.js";

/** A row shaped like the ones the background reports for the overview. */
const tab = (index, remainingSeconds, lifetimeSeconds, extra = {}) => ({
  index,
  remainingSeconds,
  lifetimeSeconds,
  title: `tab ${index}`,
  ...extra,
});

const order = (tabs, mode) => sortTabs(tabs, mode).map((t) => t.index);

describe("sortTabs", () => {
  const tabs = [
    tab(0, 600, 1800), // a third of a long life left
    tab(1, 60, 120), // half of a short life left
    tab(2, 30, 1800), // nearly out
  ];

  it("defaults to tab order, and falls back to it for an unknown mode", () => {
    expect(order([...tabs].reverse(), DEFAULT_TAB_SORT)).toEqual([0, 1, 2]);
    expect(order([...tabs].reverse(), "nonsense")).toEqual([0, 1, 2]);
    expect(order([...tabs].reverse(), undefined)).toEqual([0, 1, 2]);
  });

  it("orders by actual time left, soonest first", () => {
    expect(order(tabs, "time-left")).toEqual([2, 1, 0]);
  });

  it("orders by share of life left, which ranks differently", () => {
    // Tab 1 has the least actual time of the two long ones but half its life.
    expect(order(tabs, "percent-left")).toEqual([2, 0, 1]);
  });

  it("leaves the caller's array alone", () => {
    const input = [...tabs].reverse();
    const copy = [...input];
    sortTabs(input, "time-left");
    expect(input).toEqual(copy);
  });

  it("sinks tabs that cannot expire to the bottom, in tab order", () => {
    const mixed = [
      tab(0, 5, 100, { pinned: true }),
      tab(1, 900, 1800),
      tab(2, 10, 1800, { neverExpire: true }),
      tab(3, 60, 1800),
    ];
    expect(order(mixed, "time-left")).toEqual([3, 1, 0, 2]);
    expect(order(mixed, "percent-left")).toEqual([3, 1, 0, 2]);
  });

  it("treats a rule's never-expire the same as the tab's own", () => {
    const mixed = [
      tab(0, 10, 1800, { effective: { neverExpire: true } }),
      tab(1, 900, 1800),
    ];
    expect(order(mixed, "time-left")).toEqual([1, 0]);
  });

  it("breaks ties by tab order so rows do not shuffle between ticks", () => {
    const same = [tab(2, 60, 1800), tab(0, 60, 1800), tab(1, 60, 1800)];
    expect(order(same, "time-left")).toEqual([0, 1, 2]);
    expect(order(same, "percent-left")).toEqual([0, 1, 2]);
  });

  it("survives a tab with no lifetime to divide by", () => {
    const odd = [tab(0, 0, 0), tab(1, 60, 1800)];
    expect(order(odd, "percent-left")).toEqual([0, 1]);
  });
});

describe("TAB_SORTS", () => {
  it("offers the three orders, with tab order as the default", () => {
    expect(TAB_SORTS.map((o) => o.id)).toEqual([
      "tab-order",
      "time-left",
      "percent-left",
    ]);
    expect(DEFAULT_TAB_SORT).toBe("tab-order");
  });
});
