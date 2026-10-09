import { useEffect, useState } from 'react';

/** What the content window hands each editor to guard unsaved edits. */
export interface EditorGuardProps {
  onDirtyChange: (dirty: boolean) => void;
  requestDiscard: () => Promise<boolean>;
}

/**
 * Which entry a content editor has open, with the rule every editor follows:
 * the window hears about unsaved edits, and nothing replaces them unasked.
 */
export function useEntrySelection(
  isDirty: boolean,
  { onDirtyChange, requestDiscard }: EditorGuardProps,
  resetForm: () => void,
) {
  const [selectedId, setSelectedId] = useState('');

  useEffect(() => {
    onDirtyChange(isDirty);
  }, [isDirty, onDirtyChange]);

  // Clears without asking: it follows a save or delete, so the dropped
  // edits were just written.
  const clear = () => {
    setSelectedId('');
    resetForm();
  };

  return {
    selectedId,
    clear,
    /** Resolves false when the edits in progress were kept. */
    open: async (id: string) => {
      if (!(await requestDiscard())) return false;
      setSelectedId(id);
      return true;
    },
    startNew: async () => {
      if (await requestDiscard()) clear();
    },
  };
}
