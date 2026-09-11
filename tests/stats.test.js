import { describe, expect, it } from "vitest";
import { CHART_DAYS, DAYS_KEPT, dayKey, emptyStats, mergeStats, record, summarise } from "../src/shared/stats.js";

/** A fixed local noon, so a day key never depends on the hour the suite runs. */
const at = (y, m, d, h = 12) => new Date(y, m - 1, d, h).getTime();
const DAY = at(2026, 9, 11);

/** Count a run of events from empty, for the tests that only care about the total. */
const from = (events, now = DAY) => events.reduce((s, e) => record(s, e, now), emptyStats());

const closed = { type: "expired", action: "close" };

describe("emptyStats", () => {
  it("starts every count at zero and knows of no first day", () => {
    const s = emptyStats();
    expect(s.closed).toBe(0);
    expect(s.since).toBeNull();
    expect(s.days).toEqual({});
  });
});

describe("record", () => {
  it("counts a closed tab", () => {
    expect(record(emptyStats(), closed, DAY).closed).toBe(1);
  });

  it("counts each on-expiry action on its own tally", () => {
    const s = from([closed, closed, { type: "expired", action: "discard" }, { type: "expired", action: "reload" }]);
    expect([s.closed, s.discarded, s.reloaded]).toEqual([2, 1, 1]);
  });

  // "none" leaves the tab alone, so there is nothing to have counted.
  it("counts nothing for an expiry that did nothing", () => {
    const s = emptyStats();
    expect(record(s, { type: "expired", action: "none" }, DAY)).toBe(s);
    expect(record(s, { type: "expired" }, DAY)).toBe(s);
  });

  it("counts a snooze and the time it bought", () => {
    const s = from([{ type: "snoozed", seconds: 180 }, { type: "snoozed", seconds: 120 }]);
    expect(s.snoozes).toBe(2);
    expect(s.snoozeSeconds).toBe(300);
  });

  it("counts a timer restart", () => {
    expect(from([{ type: "reset" }, { type: "reset" }]).resets).toBe(2);
  });

  it("stamps `since` from the first thing counted and never moves it", () => {
    const first = record(emptyStats(), closed, DAY);
    expect(first.since).toBe(DAY);
    expect(record(first, closed, DAY + 86_400_000).since).toBe(DAY);
  });

  it("does not mutate what it is given", () => {
    const s = emptyStats();
    const before = structuredClone(s);
    record(s, closed, DAY);
    expect(s).toEqual(before);
  });

  it("ignores an event it does not know", () => {
    const s = emptyStats();
    expect(record(s, { type: "nonsense" }, DAY)).toBe(s);
    expect(record(s, null, DAY)).toBe(s);
  });

  describe("the open-tab high-water mark", () => {
    it("takes a new record", () => {
      const s = record(emptyStats(), { type: "tabs", open: 42 }, DAY);
      expect(s.peakTabs).toBe(42);
      expect(s.peakAt).toBe(DAY);
    });

    // The contract the background leans on: a tick reports the count every
    // pass, and an unchanged tally must not cost a write to disk.
    it("hands back the very same object when the record stands", () => {
      const s = record(emptyStats(), { type: "tabs", open: 42 }, DAY);
      expect(record(s, { type: "tabs", open: 41 }, DAY + 1000)).toBe(s);
      expect(record(s, { type: "tabs", open: 42 }, DAY + 1000)).toBe(s);
    });

    it("keeps the moment the record was set", () => {
      const s = record(record(emptyStats(), { type: "tabs", open: 10 }, DAY), { type: "tabs", open: 99 }, DAY + 5000);
      expect(s.peakAt).toBe(DAY + 5000);
    });

    it("shrugs off a count that is not one", () => {
      const s = emptyStats();
      expect(record(s, { type: "tabs", open: -3 }, DAY)).toBe(s);
      expect(record(s, { type: "tabs", open: "many" }, DAY)).toBe(s);
    });
  });

  describe("the per-day tally", () => {
    it("counts against the local day, not UTC", () => {
      // Late enough that UTC has already rolled over in this timezone or not,
      // depending where the suite runs; either way the key is the local one.
      const late = at(2026, 9, 11, 23);
      expect(Object.keys(record(emptyStats(), closed, late).days)).toEqual([dayKey(late)]);
    });

    it("keeps each day apart", () => {
      let s = record(emptyStats(), closed, DAY);
      s = record(s, closed, DAY);
      s = record(s, closed, at(2026, 9, 12));
      expect(s.days[dayKey(DAY)]).toBe(2);
      expect(s.days[dayKey(at(2026, 9, 12))]).toBe(1);
    });

    it("drops a day once it falls out of the window", () => {
      const old = at(2026, 9, 11);
      const later = at(2026, 9, 11) + DAYS_KEPT * 86_400_000;
      let s = record(emptyStats(), closed, old);
      expect(s.days[dayKey(old)]).toBe(1);
      s = record(s, closed, later);
      expect(s.days[dayKey(old)]).toBeUndefined();
      expect(s.days[dayKey(later)]).toBe(1);
      // The running totals are a life story, not a window: they keep counting.
      expect(s.closed).toBe(2);
    });
  });
});

describe("mergeStats", () => {
  it("makes an empty tally of nothing at all", () => {
    expect(mergeStats(undefined)).toEqual(emptyStats());
    expect(mergeStats(null)).toEqual(emptyStats());
    expect(mergeStats("not a tally")).toEqual(emptyStats());
  });

  it("keeps counts it recognises", () => {
    expect(mergeStats({ closed: 7, snoozes: 2 }).closed).toBe(7);
  });

  it("floors a count rather than trusting it", () => {
    const s = mergeStats({ closed: 2.7, discarded: -5, reloaded: "lots", snoozes: NaN, resets: Infinity });
    expect([s.closed, s.discarded, s.reloaded, s.snoozes, s.resets]).toEqual([2, 0, 0, 0, 0]);
  });

  it("drops a key the stored object invented", () => {
    expect(mergeStats({ closed: 1, mystery: 9 }).mystery).toBeUndefined();
  });

  it("throws away a day key that is not a date", () => {
    const s = mergeStats({ days: { "2026-09-11": 3, yesterday: 5, "2026-9-1": 2, "2026-09-12": 0 } });
    expect(s.days).toEqual({ "2026-09-11": 3 });
  });

  it("refuses a timestamp that is not one", () => {
    expect(mergeStats({ since: 0 }).since).toBeNull();
    expect(mergeStats({ since: "yesterday" }).since).toBeNull();
    expect(mergeStats({ since: DAY }).since).toBe(DAY);
  });
});

describe("summarise", () => {
  it("says so while there is nothing to say", () => {
    expect(summarise(emptyStats(), DAY).empty).toBe(true);
  });

  it("stops being empty as soon as anything happens", () => {
    expect(summarise(from([{ type: "reset" }]), DAY).empty).toBe(false);
    expect(summarise(from([{ type: "tabs", open: 3 }]), DAY).empty).toBe(false);
  });

  it("adds the three expiry actions into one total", () => {
    const s = from([closed, { type: "expired", action: "discard" }, { type: "expired", action: "reload" }]);
    expect(summarise(s, DAY).expired).toBe(3);
  });

  it("returns a dense run of days, oldest first, ending today", () => {
    const days = summarise(emptyStats(), DAY).days;
    expect(days).toHaveLength(CHART_DAYS);
    expect(days[days.length - 1].date).toBe(dayKey(DAY));
    expect(days.every((d) => d.count === 0)).toBe(true);
  });

  // A chart that skipped the quiet days would misrepresent the busy ones.
  it("keeps the zeros between two busy days", () => {
    let s = record(emptyStats(), closed, at(2026, 9, 9));
    s = record(s, closed, at(2026, 9, 11));
    const counts = summarise(s, at(2026, 9, 11)).days.slice(-3).map((d) => d.count);
    expect(counts).toEqual([1, 0, 1]);
  });

  it("finds the busiest day", () => {
    let s = record(emptyStats(), closed, at(2026, 9, 9));
    for (const _ of [1, 2, 3]) s = record(s, closed, at(2026, 9, 10));
    expect(summarise(s, at(2026, 9, 11)).busiest).toEqual({ date: "2026-09-10", count: 3 });
  });

  it("gives a tie to the day that got there first", () => {
    let s = record(emptyStats(), closed, at(2026, 9, 9));
    s = record(s, closed, at(2026, 9, 10));
    expect(summarise(s, at(2026, 9, 11)).busiest.date).toBe("2026-09-09");
  });

  it("has no busiest day before there is a day", () => {
    expect(summarise(emptyStats(), DAY).busiest).toBeNull();
  });

  it("counts today as the first day tracked", () => {
    expect(summarise(record(emptyStats(), closed, DAY), DAY).daysTracked).toBe(1);
  });

  it("averages over the days since the first one", () => {
    let s = record(emptyStats(), closed, DAY);
    s = record(s, closed, DAY + 86_400_000);
    const out = summarise(s, DAY + 86_400_000);
    expect(out.daysTracked).toBe(2);
    expect(out.perDay).toBe(1);
  });

  it("does not divide by a day that never started", () => {
    expect(summarise(emptyStats(), DAY).perDay).toBe(0);
    expect(summarise(emptyStats(), DAY).daysTracked).toBe(0);
  });
});
