export interface HeaderUser {
  fullName: string;
  username: string;
}

interface HeaderController {
  setUser(user: HeaderUser): void;
}

interface SetupHeaderOptions {
  title: string;
  subtitle: string;
  onSignOut: () => Promise<void> | void;
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

export function setupHeader(options: SetupHeaderOptions): HeaderController {
  const titleEl = document.getElementById("appTitle");
  const subtitleEl = document.getElementById("appSubtitle");
  const userButton = document.getElementById("userMenuButton") as HTMLButtonElement | null;
  const userButtonLabel = document.getElementById("userMenuButtonLabel");
  const userPopover = document.getElementById("userMenuPopover") as HTMLDivElement | null;
  const userFullName = document.getElementById("userFullName");
  const userName = document.getElementById("userName");
  const userAvatarCard = document.getElementById("userAvatarCard");
  const signOutBtn = document.getElementById("signOutBtn") as HTMLButtonElement | null;

  document.title = `${options.title} | ArcGIS 3D`;

  if (titleEl) {
    titleEl.textContent = options.title;
  }

  if (subtitleEl) {
    subtitleEl.textContent = options.subtitle;
  }

  if (
    !userButton ||
    !userButtonLabel ||
    !userPopover ||
    !userFullName ||
    !userName ||
    !userAvatarCard ||
    !signOutBtn
  ) {
    return {
      setUser() {
        return;
      },
    };
  }

  const closeMenu = () => {
    userPopover.hidden = true;
    userButton.setAttribute("aria-expanded", "false");
  };

  const openMenu = () => {
    userPopover.hidden = false;
    userButton.setAttribute("aria-expanded", "true");
  };

  userButton.addEventListener("click", () => {
    if (userPopover.hidden) {
      openMenu();
      return;
    }

    closeMenu();
  });

  document.addEventListener("click", (event) => {
    const target = event.target as Node | null;
    if (!target) {
      return;
    }

    if (userButton.contains(target) || userPopover.contains(target)) {
      return;
    }

    closeMenu();
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      closeMenu();
    }
  });

  signOutBtn.addEventListener("click", async () => {
    signOutBtn.disabled = true;

    try {
      await options.onSignOut();
    } finally {
      signOutBtn.disabled = false;
      closeMenu();
    }
  });

  return {
    setUser(user: HeaderUser) {
      const initials = getInitials(user.fullName || user.username);
      userFullName.textContent = user.fullName;
      userName.textContent = user.username;
      userAvatarCard.textContent = initials;
      userButtonLabel.textContent = user.fullName;
    },
  };
}
