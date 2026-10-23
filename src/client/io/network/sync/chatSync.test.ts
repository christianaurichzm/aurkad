import { afterEach, describe, expect, it, vi } from 'vitest';
import { enqueueChatMessage } from './chatSync';
import { useUIStore } from '../../../stores/uiStore';

afterEach(() => vi.restoreAllMocks());

describe('a hidden tab', () => {
  // No frame runs to drain the queue while the tab is in the background.
  it('shows each line as it arrives', () => {
    vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);

    enqueueChatMessage({
      type: 'chat',
      scope: 'global',
      message: 'said while away',
      username: 'Alice',
    });

    expect(useUIStore.getState().chat.messages).toContainEqual(
      expect.objectContaining({ message: 'said while away' }),
    );
  });
});
