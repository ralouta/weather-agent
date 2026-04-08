export interface HeaderUser {
  fullName: string;
  username: string;
}

interface HeaderElements {
  title: HTMLElement;
  subtitle: HTMLElement;
  userButton: HTMLButtonElement;
  userButtonLabel: HTMLElement;
  userPopover: HTMLDivElement;
  userFullName: HTMLElement;
  userName: HTMLElement;
  userAvatarCard: HTMLElement;
  signOutButton: HTMLButtonElement;
}

interface CreateHeaderControllerOptions {
  title: string;
  subtitle: string;
  onSignOut: () => Promise<void> | void;
}

export interface HeaderController {
  setUser(user: HeaderUser): void;
  destroy(): void;
}

function getInitials(name: string): string {
  const parts = name
    .split(/\s+/)
    .map((part) => part.trim())
    .filter(Boolean)
    .slice(0, 2);

  if (!parts.length) {
    return "AG";
  }

  return parts.map((part) => part[0]?.toUpperCase() ?? "").join("");
}

export function createHeaderController(
  elements: HeaderElements,
  options: CreateHeaderControllerOptions
): HeaderController {
  document.title = `${options.title} | ArcGIS 3D`;
  elements.title.textContent = options.title;
  elements.subtitle.textContent = options.subtitle;

  const closeMenu = () => {
    elements.userPopover.hidden = true;
    elements.userButton.setAttribute("aria-expanded", "false");
  };

  const openMenu = () => {
    elements.userPopover.hidden = false;
    elements.userButton.setAttribute("aria-expanded", "true");
  };

  const onButtonClick = () => {
    if (elements.userPopover.hidden) {
      openMenu();
      return;
    }

    closeMenu();
  };

  const onDocumentClick = (event: Event) => {
    const target = event.target as Node | null;

    if (!target) {
      return;
    }

    if (elements.userButton.contains(target) || elements.userPopover.contains(target)) {
      return;
    }

    closeMenu();
  };

  const onEscape = (event: KeyboardEvent) => {
    if (event.key === "Escape") {
      closeMenu();
    }
  };

  const onSignOutClick = async () => {
    elements.signOutButton.disabled = true;

    try {
      await options.onSignOut();
    } finally {
      elements.signOutButton.disabled = false;
      closeMenu();
    }
  };

  elements.userButton.addEventListener("click", onButtonClick);
  document.addEventListener("click", onDocumentClick);
  document.addEventListener("keydown", onEscape);
  elements.signOutButton.addEventListener("click", onSignOutClick);

  return {
    setUser(user) {
      const initials = getInitials(user.fullName || user.username);
      elements.userFullName.textContent = user.fullName;
      elements.userName.textContent = user.username;
      elements.userAvatarCard.textContent = initials;
      elements.userButtonLabel.textContent = user.fullName;
    },
    destroy() {
      elements.userButton.removeEventListener("click", onButtonClick);
      document.removeEventListener("click", onDocumentClick);
      document.removeEventListener("keydown", onEscape);
      elements.signOutButton.removeEventListener("click", onSignOutClick);
    },
  };
}
