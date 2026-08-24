// Pure draft-reconciliation rules for the CRM lead detail panel.
//
// Background polling must never overwrite an unsaved local edit, while clean
// fields keep following the server. This module encodes that decision so it
// can be unit-tested independently of React. The component owns the flags;
// this function only decides which fields may accept incoming server values.

export interface ProfileDraft {
  first_name: string;
  last_name: string;
  title: string;
  company: string;
  company_size: string;
  industry_segment: string;
  source: string;
  email: string;
  linkedin_url: string;
  score: string;
}

/** Per-field dirty/edit-in-progress state owned by the component. */
export interface DetailDraftFlags {
  /** Notes editor is open — notesValue is a live draft. */
  editingNotes: boolean;
  /** Profile editor is open — profileDraft is a live draft. */
  editingProfile: boolean;
  /** User changed nextAction since the last confirmed save/server sync. */
  nextActionDirty: boolean;
}

/** Subset of Lead consumed for draft synchronization. */
export interface DraftServerLead {
  notes?: string | null;
  next_action_at?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  title?: string | null;
  company?: string | null;
  company_size?: string | null;
  industry_segment?: string | null;
  source?: string | null;
  email?: string | null;
  linkedin_url?: string | null;
  score?: number | string | null;
}

/** Fields to push into component state; omitted fields stay untouched. */
export interface DetailDraftUpdates {
  notesValue?: string;
  nextAction?: string;
  profileDraft?: ProfileDraft;
}

export const EMPTY_PROFILE_DRAFT: ProfileDraft = {
  first_name: '',
  last_name: '',
  title: '',
  company: '',
  company_size: '',
  industry_segment: '',
  source: '',
  email: '',
  linkedin_url: '',
  score: '',
};

function profileDraftFromLead(lead: DraftServerLead): ProfileDraft {
  return {
    first_name: lead.first_name || '',
    last_name: lead.last_name || '',
    title: lead.title || '',
    company: lead.company || '',
    company_size: lead.company_size || '',
    industry_segment: lead.industry_segment || '',
    source: lead.source || '',
    email: lead.email || '',
    linkedin_url: lead.linkedin_url || '',
    score: typeof lead.score === 'number' ? String(lead.score) : '',
  };
}

/**
 * Decide whether a confirmed-successful save may finalize a field
 * (close its editor / clear its dirty flag).
 *
 * True only when the local value is still exactly what was submitted.
 * If the user kept editing while the request was in flight, the newer
 * edit wins: the field stays open/dirty and polling keeps protecting it.
 */
export function shouldClearDirtyAfterSave(submittedValue: string, currentValue: string): boolean {
  return currentValue === submittedValue;
}

/**
 * Decide which draft fields may accept a freshly polled server lead.
 *
 * - CLEAN field (not being edited / not dirty): follow the server.
 * - DIRTY field: the server value is ignored; the local draft survives.
 *
 * Pure and order-independent: applying stale or out-of-order poll results
 * through this function can never resurrect server values over a draft.
 */
export function reconcileDetailDraft(
  flags: DetailDraftFlags,
  lead: DraftServerLead,
): DetailDraftUpdates {
  const updates: DetailDraftUpdates = {};

  if (!flags.editingNotes && lead.notes !== undefined) {
    updates.notesValue = lead.notes || '';
  }

  if (!flags.nextActionDirty && lead.next_action_at) {
    updates.nextAction = lead.next_action_at.split('T')[0];
  }

  if (!flags.editingProfile) {
    updates.profileDraft = profileDraftFromLead(lead);
  }

  return updates;
}
