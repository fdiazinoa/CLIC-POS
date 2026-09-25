type PreventableEvent = { preventDefault: () => void };
type RowKeyEvent = PreventableEvent & { key: string; isRowTarget: boolean };

/** Keeps a long touch's synthetic click from reopening the same line editor. */
export const createSupermarketLineInteraction = (
  onEditLine: (cartId: string) => void,
  now: () => number = Date.now,
) => {
  let lastContextMenu: { cartId: string; at: number } | null = null;

  return {
    click(cartId: string) {
      if (lastContextMenu?.cartId === cartId && now() - lastContextMenu.at < 700) return;
      onEditLine(cartId);
    },
    contextMenu(cartId: string, event: PreventableEvent) {
      event.preventDefault();
      lastContextMenu = { cartId, at: now() };
      onEditLine(cartId);
    },
    keyDown(cartId: string, event: RowKeyEvent) {
      if (!event.isRowTarget || (event.key !== 'Enter' && event.key !== ' ')) return;
      event.preventDefault();
      onEditLine(cartId);
    },
  };
};
