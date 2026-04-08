interface ClockElements {
  root: HTMLElement;
  hourHand: HTMLElement;
  minuteHand: HTMLElement;
  digitalTime: HTMLElement;
  timezoneLabel: HTMLElement;
}

export interface ClockUpdate {
  timezone?: string;
}

export interface LocationClockController {
  update(update: ClockUpdate): void;
  destroy(): void;
}

function readTimeParts(now: Date, timeZone?: string) {
  const mathFormatter = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });

  const displayFormatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });

  const values = Object.fromEntries(
    mathFormatter.formatToParts(now).map((part) => [part.type, part.value])
  );

  return {
    hours24: Number(values.hour ?? "0"),
    minutes: Number(values.minute ?? "0"),
    digital: displayFormatter.format(now),
  };
}

function sanitizeTimeZone(timeZone?: string): string | undefined {
  if (!timeZone) {
    return undefined;
  }

  try {
    new Intl.DateTimeFormat("en-US", { timeZone }).format(new Date());
    return timeZone;
  } catch {
    return undefined;
  }
}

function formatTimeZoneLabel(timeZone?: string): string {
  if (!timeZone) {
    return "Browser time";
  }

  return timeZone.replace(/_/g, " ");
}

export function createLocationClockController(
  elements: ClockElements
): LocationClockController {
  let currentTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  let timerId: number | null = null;

  const render = () => {
    const now = new Date();
    const parts = readTimeParts(now, currentTimeZone);
    const hourRotation = (parts.hours24 % 12) * 30 + parts.minutes * 0.5;
    const minuteRotation = parts.minutes * 6;

    elements.hourHand.style.transform = `translateX(-50%) rotate(${hourRotation}deg)`;
    elements.minuteHand.style.transform = `translateX(-50%) rotate(${minuteRotation}deg)`;
    elements.digitalTime.textContent = parts.digital;
    elements.timezoneLabel.textContent = formatTimeZoneLabel(currentTimeZone);
  };

  const start = () => {
    if (timerId !== null) {
      window.clearTimeout(timerId);
    }

    render();

    const msUntilNextMinute = 60000 - (Date.now() % 60000) + 50;
    timerId = window.setTimeout(start, msUntilNextMinute);
  };

  start();

  return {
    update(update) {
      currentTimeZone = sanitizeTimeZone(update.timezone) || currentTimeZone;
      start();
    },
    destroy() {
      if (timerId !== null) {
        window.clearTimeout(timerId);
      }
    },
  };
}
