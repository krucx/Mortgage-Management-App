import { useState } from 'react'

/**
 * A form's draft of `saved`: starts from it once it arrives, and starts again from it
 * whenever what is saved changes (e.g. to what saving returned). Null until then.
 */
export function useDraft<Saved, Draft>(
  saved: Saved | undefined,
  toDraft: (saved: Saved) => Draft,
): [Draft | null, (draft: Draft) => void] {
  const [draftOf, setDraftOf] = useState<{ from: Saved; draft: Draft } | null>(null)
  // (Set while rendering, as React allows for a component's own state.)
  if (saved !== undefined && draftOf?.from !== saved) {
    setDraftOf({ from: saved, draft: toDraft(saved) })
  }
  const current = saved !== undefined && draftOf?.from === saved ? draftOf.draft : null
  return [current, (draft) => saved !== undefined && setDraftOf({ from: saved, draft })]
}
