interface CustomEvent<T = unknown> extends Event {
  /**
   * Returns any custom data event was created with. Typically used for synthetic events.
   */
  readonly detail: T;
  /** An over-ride for the buttons value to allow setting this internally. */
  initCustomEvent(
    typeArg: string,
    canBubbleArg: boolean,
    cancelableArg: boolean,
    detailArg: T
  ): void;
}

export type { CustomEvent as default };
