/** The Guest page's line icons: 24px grid, 1.75px stroke (override §4). Decorative unless labelled. */

type IconProps = { className?: string };

function Svg({ className, children }: IconProps & { children: React.ReactNode }) {
  return (
    <svg className={`g-icon${className ? ` ${className}` : ''}`} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      {children}
    </svg>
  );
}

export const IconCheck = (p: IconProps) => (
  <Svg {...p}>
    <path d="M5 12.5l4.5 4.5L19 7.5" />
  </Svg>
);

export const IconChevronLeft = (p: IconProps) => (
  <Svg {...p}>
    <path d="M14.5 6l-6 6 6 6" />
  </Svg>
);

export const IconChevronRight = (p: IconProps) => (
  <Svg {...p}>
    <path d="M9.5 6l6 6-6 6" />
  </Svg>
);

export const IconUser = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="12" cy="8.5" r="3.5" />
    <path d="M5 19.5c1.2-3.3 3.8-5 7-5s5.8 1.7 7 5" />
  </Svg>
);

export const IconDevice = (p: IconProps) => (
  <Svg {...p}>
    <rect x="3.5" y="4.5" width="17" height="11.5" rx="1.5" />
    <path d="M8.5 19.5h7M12 16v3.5" />
  </Svg>
);

export const IconRestart = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4.5 12a7.5 7.5 0 1 0 2.2-5.3" />
    <path d="M4.5 4.5v4h4" />
  </Svg>
);

// ---------------------------------------------------------------- building types (tab ①)
// The admin picks one of these per type (`config.icon`); new icons need a new enum value first.

export const IconShed = (p: IconProps) => (
  <Svg {...p}>
    <path d="M2.5 20V9.5L12 4.5l9.5 5V20" />
    <path d="M2.5 20h19" />
    <path d="M7 20v-7.5h10V20" />
    <path d="M7 15h10M7 17.5h10" />
  </Svg>
);

export const IconGarage = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 20v-9.5l8-5.5 8 5.5V20" />
    <path d="M3 20h18" />
    <path d="M8 20v-6h8v6" />
    <path d="M8 17h8" />
  </Svg>
);

export const IconCarport = (p: IconProps) => (
  <Svg {...p}>
    <path d="M2.5 9.5L12 4.5l9.5 5" />
    <path d="M5 8.2V20M19 8.2V20" />
    <path d="M3 20h18" />
  </Svg>
);

export const IconSkillion = (p: IconProps) => (
  <Svg {...p}>
    <path d="M3 20V9l18-4.5V20" />
    <path d="M2.5 20h19" />
    <path d="M8 20v-6h6v6" />
  </Svg>
);

/** A wide factory with a saw-tooth roof — "industrial". */
export const IconIndustrial = (p: IconProps) => (
  <Svg {...p}>
    <path d="M2.5 20V11l4-2.5 4 2.5 4-2.5 4 2.5 3-1.5V20" />
    <path d="M2.5 20h19" />
    <path d="M7 20v-5h3v5M14 20v-5h3v5" />
  </Svg>
);

/** A long covered arena: low roof, open sides, a horse-riding silhouette in the middle. */
export const IconArena = (p: IconProps) => (
  <Svg {...p}>
    <path d="M2.5 9.5L12 4.5l9.5 5V20" />
    <path d="M2.5 20h19" />
    <path d="M4.5 20V10M19.5 20V10" />
    <path d="M9 15.5h6" />
    <path d="M11 15.5v3M13 15.5v3" />
  </Svg>
);

/** A big hangar: tall walls, a very wide door. */
export const IconHangar = (p: IconProps) => (
  <Svg {...p}>
    <path d="M2.5 20V10L12 4.5 21.5 10v10" />
    <path d="M2.5 20h19" />
    <path d="M7 20v-7.5h10V20" />
    <path d="M7 15.5h10" />
  </Svg>
);

/** A house with a pitched roof and a chimney — the Class 1 enquiry card. */
export const IconHouse = (p: IconProps) => (
  <Svg {...p}>
    <path d="M2.5 11.5L12 4l9.5 7.5" />
    <path d="M4.5 10.5V20h15v-9.5" />
    <path d="M2.5 20h19" />
    <path d="M9.5 20v-5h5v5" />
    <path d="M16.5 6V3.5h2V7.5" />
  </Svg>
);

// ---------------------------------------------------------------- address (tab ②)

export const IconWind = (p: IconProps) => (
  <Svg {...p}>
    <path d="M3 8.5h10.5a2.75 2.75 0 1 0-2.75-2.75" />
    <path d="M3 12.5h15a3 3 0 1 1-3 3" />
    <path d="M3 16.5h7" />
  </Svg>
);

export const IconPin = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11z" />
    <circle cx="12" cy="10" r="2.25" />
  </Svg>
);

export const IconSearch = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="11" cy="11" r="6.5" />
    <path d="M20 20l-4.4-4.4" />
  </Svg>
);

// ---------------------------------------------------------------- tab ③ (design)

export const IconPlus = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 5v14M5 12h14" />
  </Svg>
);

export const IconMinus = (p: IconProps) => (
  <Svg {...p}>
    <path d="M5 12h14" />
  </Svg>
);

export const IconTrash = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4.5 7h15M9.5 7V4.5h5V7" />
    <path d="M6.5 7l1 12.5h9l1-12.5" />
    <path d="M10 10.5v6M14 10.5v6" />
  </Svg>
);

export const IconZoomIn = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="11" cy="11" r="6.5" />
    <path d="M20 20l-4.4-4.4M8.5 11h5M11 8.5v5" />
  </Svg>
);

export const IconZoomOut = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="11" cy="11" r="6.5" />
    <path d="M20 20l-4.4-4.4M8.5 11h5" />
  </Svg>
);

export const IconFit = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4.5 9V4.5H9M15 4.5h4.5V9M19.5 15v4.5H15M9 19.5H4.5V15" />
  </Svg>
);

export const IconLock = (p: IconProps) => (
  <Svg {...p}>
    <rect x="5" y="10.5" width="14" height="9.5" rx="2" />
    <path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5" />
  </Svg>
);

export const IconChevronDown = (p: IconProps) => (
  <Svg {...p}>
    <path d="M6 9.5l6 6 6-6" />
  </Svg>
);

export const IconList = (p: IconProps) => (
  <Svg {...p}>
    <path d="M9 6.5h11M9 12h11M9 17.5h11" />
    <path d="M4.5 6.5h.01M4.5 12h.01M4.5 17.5h.01" strokeWidth="2.5" />
  </Svg>
);

/** A ruler laid on the diagonal, with tick marks — the rail's "Size & structure". */
export const IconRuler = (p: IconProps) => (
  <Svg {...p}>
    <path d="M3.5 16.5L16.5 3.5l4 4-13 13z" />
    <path d="M7 13l2 2M10 10l1.5 1.5M13 7l2 2" />
  </Svg>
);

/** A paint roller: roller, handle frame and grip — the rail's "Colours". */
export const IconPaintRoller = (p: IconProps) => (
  <Svg {...p}>
    <rect x="3.5" y="3.5" width="14" height="5" rx="1.5" />
    <path d="M17.5 6h2v5.5H11V15" />
    <rect x="9.5" y="15" width="3" height="5.5" rx="1" />
  </Svg>
);

/** A door ajar in its frame, with a handle — the rail's "Doors & windows". */
export const IconDoor = (p: IconProps) => (
  <Svg {...p}>
    <path d="M5 20.5V3.5h14v17" />
    <path d="M3 20.5h18" />
    <path d="M5 3.5l8 2.5v14.5" />
    <path d="M10.5 12.5v.01" strokeWidth="2.5" />
  </Svg>
);

/** Sparkles — the "AI Assistant" dock. */
export const IconSparkle = (p: IconProps) => (
  <Svg {...p}>
    <path d="M10 4l1.6 4.4L16 10l-4.4 1.6L10 16l-1.6-4.4L4 10l4.4-1.6z" />
    <path d="M18 14.5l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7z" />
  </Svg>
);

/** A microphone: capsule, yoke and stand. Used by the assistant's voice button. */
export const IconMic = (p: IconProps) => (
  <Svg {...p}>
    <rect x="9" y="3.5" width="6" height="10.5" rx="3" />
    <path d="M5.5 11.5a6.5 6.5 0 0 0 13 0" />
    <path d="M12 18v2.5" />
  </Svg>
);

/** A stop square, for finishing a recording without sending. */
export const IconStop = (p: IconProps) => (
  <Svg {...p}>
    <rect x="7" y="7" width="10" height="10" rx="2" />
  </Svg>
);
