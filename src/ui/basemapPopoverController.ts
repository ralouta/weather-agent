interface BasemapPopoverElements {
  button: HTMLElement;
  popover: HTMLDivElement;
}

export interface BasemapPopoverController {
  destroy(): void;
}

export function createBasemapPopoverController(
  elements: BasemapPopoverElements
): BasemapPopoverController {
  const closePopover = () => {
    elements.popover.hidden = true;
    elements.button.setAttribute("aria-expanded", "false");
  };

  const openPopover = () => {
    elements.popover.hidden = false;
    elements.button.setAttribute("aria-expanded", "true");
  };

  const onButtonClick = (event: Event) => {
    event.stopPropagation();

    if (elements.popover.hidden) {
      openPopover();
      return;
    }

    closePopover();
  };

  const onPopoverClick = (event: Event) => {
    event.stopPropagation();
  };

  const onDocumentClick = () => {
    closePopover();
  };

  const onEscape = (event: KeyboardEvent) => {
    if (event.key === "Escape") {
      closePopover();
    }
  };

  elements.button.addEventListener("click", onButtonClick);
  elements.popover.addEventListener("click", onPopoverClick);
  document.addEventListener("click", onDocumentClick);
  document.addEventListener("keydown", onEscape);

  return {
    destroy() {
      elements.button.removeEventListener("click", onButtonClick);
      elements.popover.removeEventListener("click", onPopoverClick);
      document.removeEventListener("click", onDocumentClick);
      document.removeEventListener("keydown", onEscape);
    },
  };
}
