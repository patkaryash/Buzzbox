import assert from "node:assert/strict";
import { test } from "node:test";
import {
  EMPTY_PROFILE_DRAFT,
  reconcileDetailDraft,
  shouldClearDirtyAfterSave,
} from "./crm-detail-draft";
import type { DetailDraftFlags } from "./crm-detail-draft";

function flags(overrides: Partial<DetailDraftFlags> = {}): DetailDraftFlags {
  return {
    editingNotes: false,
    editingProfile: false,
    nextActionDirty: false,
    ...overrides,
  };
}

// ─── Notes ────────────────────────────────────────────────

test("clean notes: polling updates the local value", () => {
  const updates = reconcileDetailDraft(flags(), { notes: "server note" });
  assert.equal(updates.notesValue, "server note");
});

test("dirty notes: polling never overwrites the unsaved draft", () => {
  const updates = reconcileDetailDraft(flags({ editingNotes: true }), {
    notes: "server note",
  });
  assert.equal(updates.notesValue, undefined);
});

test("null notes on a clean field still syncs to empty string", () => {
  const updates = reconcileDetailDraft(flags(), { notes: null });
  assert.equal(updates.notesValue, "");
});

// ─── Next action ──────────────────────────────────────────

test("clean next action: polling updates the date input from the ISO value", () => {
  const updates = reconcileDetailDraft(flags(), {
    next_action_at: "2026-09-01T00:00:00.000Z",
  });
  assert.equal(updates.nextAction, "2026-09-01");
});

test("dirty next action: polling never overwrites the unsaved date", () => {
  const updates = reconcileDetailDraft(flags({ nextActionDirty: true }), {
    next_action_at: "2026-09-01T00:00:00.000Z",
  });
  assert.equal(updates.nextAction, undefined);
});

test("cleared next action on the server leaves the field untouched (existing semantics)", () => {
  const updates = reconcileDetailDraft(flags(), { next_action_at: null });
  assert.equal(updates.nextAction, undefined);
});

// ─── Save success / failure ───────────────────────────────

test("save success clears the flag, so later polling can update the field again", () => {
  // Before confirmation the draft is protected…
  let f = flags({ editingNotes: true });
  assert.equal(reconcileDetailDraft(f, { notes: "saved" }).notesValue, undefined);

  // …only a confirmed success lets the component clear the flag…
  f = flags(); // component does setEditingNotes(false) after patchLead resolves ok

  // …and afterwards polling flows through again.
  assert.equal(reconcileDetailDraft(f, { notes: "saved" }).notesValue, "saved");

  // A failed save keeps the flag untouched: the component never receives
  // permission from reconcileDetailDraft to clear anything.
});

test("reconcile is pure: flags are never flipped by incoming server data", () => {
  const f = flags({ editingNotes: true, nextActionDirty: true });
  reconcileDetailDraft(f, {
    notes: "x",
    next_action_at: "2026-01-01T00:00:00.000Z",
  });
  assert.deepEqual(f, {
    editingNotes: true,
    editingProfile: false,
    nextActionDirty: true,
  });
});

// ─── In-flight save completion ────────────────────────────

test("in-flight save: a successful save of the older value must not discard a newer local edit", () => {
  const submitted = "Original + first edit";
  const newerLocal = "Original + first edit + second edit";

  // Save of `submitted` resolves successfully, but the local value moved on.
  assert.equal(shouldClearDirtyAfterSave(submitted, newerLocal), false);
});

test("in-flight notes regression: draft B survives and polling cannot overwrite it", () => {
  // Editor is open; user typed B while the save of A was in flight, so the
  // component keeps editingNotes=true after the success decision.
  const dirtyDuringFlight = flags({ editingNotes: true });

  // While in flight (and after), polls are ignored for notes…
  assert.equal(reconcileDetailDraft(dirtyDuringFlight, { notes: "A" }).notesValue, undefined);

  // …the older save succeeds but must NOT finalize…
  assert.equal(shouldClearDirtyAfterSave("A", "B"), false);

  // …so the field stays dirty and B remains protected from polling.
  assert.equal(reconcileDetailDraft(dirtyDuringFlight, { notes: "A" }).notesValue, undefined);
});

test("normal save with no further edit finalizes and polling flows again", () => {
  // Save A, nothing else typed: finalize is allowed…
  assert.equal(shouldClearDirtyAfterSave("A", "A"), true);

  // …the component then closes the editor / clears the flag…
  const afterFinalize = flags();

  // …and subsequent polling can update the field normally.
  assert.equal(reconcileDetailDraft(afterFinalize, { notes: "A" }).notesValue, "A");
});

test("next action follows the same save-completion rule", () => {
  // Older save succeeded while a newer date was set locally.
  assert.equal(shouldClearDirtyAfterSave("2026-01-01", "2026-02-02"), false);
  // No further edit: normal finalize.
  assert.equal(shouldClearDirtyAfterSave("2026-01-01", "2026-01-01"), true);
});

// ─── Lead switching ───────────────────────────────────────

test("lead switch: fresh state initializes from lead B without inheriting lead A drafts", () => {
  // Component remounts per lead (key={selectedLead}), so every lead starts
  // from the same pristine flags — model that here.
  const freshFlags = flags();
  const updatesA = reconcileDetailDraft(
    flags({ editingNotes: true }),
    { notes: "lead A unsaved" },
  );
  assert.equal(updatesA.notesValue, undefined); // A's draft stays local to A

  const updatesB = reconcileDetailDraft(freshFlags, {
    notes: "lead B server notes",
    next_action_at: "2026-10-10T00:00:00.000Z",
  });
  assert.equal(updatesB.notesValue, "lead B server notes");
  assert.equal(updatesB.nextAction, "2026-10-10");
  assert.ok(!JSON.stringify(updatesB).includes("lead A"));
});

// ─── Polling continuity ───────────────────────────────────

test("clean fields keep receiving successive server updates across polls", () => {
  const f = flags();
  assert.equal(reconcileDetailDraft(f, { notes: "v1" }).notesValue, "v1");
  assert.equal(reconcileDetailDraft(f, { notes: "v2" }).notesValue, "v2");
  assert.equal(
    reconcileDetailDraft(f, { next_action_at: "2026-02-02T00:00:00.000Z" }).nextAction,
    "2026-02-02",
  );
  assert.equal(
    reconcileDetailDraft(f, { next_action_at: "2026-03-03T00:00:00.000Z" }).nextAction,
    "2026-03-03",
  );
});

test("stale poll results arriving out of order cannot resurrect server values over drafts", () => {
  const dirty = flags({ editingNotes: true, nextActionDirty: true });
  // Newer response first, stale response second — both must be ignored.
  assert.equal(reconcileDetailDraft(dirty, { notes: "newer" }).notesValue, undefined);
  assert.equal(reconcileDetailDraft(dirty, { notes: "stale" }).notesValue, undefined);
});

// ─── Profile regression ───────────────────────────────────

test("profile draft syncs when not editing, mapping values exactly as before", () => {
  const updates = reconcileDetailDraft(flags(), {
    first_name: "Ada",
    last_name: null,
    company: "Analytical Engines",
    score: 87,
  });
  assert.deepEqual(updates.profileDraft, {
    ...EMPTY_PROFILE_DRAFT,
    first_name: "Ada",
    company: "Analytical Engines",
    score: "87",
  });
});

test("editing profile blocks profileDraft sync while other fields stay governed by their own flags", () => {
  const updates = reconcileDetailDraft(
    flags({ editingProfile: true, editingNotes: true }),
    { notes: "n", next_action_at: "2026-05-05T00:00:00.000Z", first_name: "Ignored" },
  );
  assert.equal(updates.profileDraft, undefined);
  assert.equal(updates.notesValue, undefined); // own guard still applies
  assert.equal(updates.nextAction, "2026-05-05"); // clean field still follows server
});
