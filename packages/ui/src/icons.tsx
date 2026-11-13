/**
 * Small inline SVG icons, drawn in `currentColor` so they follow the text colour and the tokens.
 *
 * They replace emoji and text glyphs (📍 ✕ ↗ ⚠) used as icons: an emoji is drawn by the operating
 * system, so it changes shape and colour between Windows, macOS and Android and ignores the navy/gold
 * palette. Every icon is decorative (`aria-hidden`): the control it sits in carries the accessible name.
 */

import type { ReactNode, SVGProps } from 'react';

type IconProps = Omit<SVGProps<SVGSVGElement>, 'children'> & { size?: number };

function Svg({ size = 16, children, ...rest }: IconProps & { children: ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      {children}
    </svg>
  );
}

/** A map pin. */
export function PinIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 0 1 16 0Z" />
      <circle cx="12" cy="10" r="3" />
    </Svg>
  );
}

/** A cross, for closing. */
export function CloseIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M18 6 6 18M6 6l12 12" />
    </Svg>
  );
}

/** An arrow leaving a box: the link opens in another tab. */
export function ExternalLinkIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M15 3h6v6M10 14 21 3M18 14v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h5" />
    </Svg>
  );
}

/** A triangle with an exclamation mark. */
export function WarningIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="m21.7 18-8-14a2 2 0 0 0-3.4 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.7-3Z" />
      <path d="M12 9v4M12 17h.01" />
    </Svg>
  );
}

/** A four-point sparkle: the assistant. */
export function SparkleIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9L12 3Z" />
      <path d="M19 15l.7 1.8L21.5 17.5l-1.8.7L19 20l-.7-1.8-1.8-.7 1.8-.7L19 15Z" />
    </Svg>
  );
}

/** A paper plane: send. */
export function SendIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M22 2 11 13M22 2l-7 20-4-9-9-4 20-7Z" />
    </Svg>
  );
}

/** A microphone: dictate. */
export function MicIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="9" y="2" width="6" height="12" rx="3" />
      <path d="M19 10v1a7 7 0 0 1-14 0v-1M12 18v4" />
    </Svg>
  );
}

/** A chevron; `direction` is where it points. */
export function ChevronIcon({ direction = 'right', ...props }: IconProps & { direction?: 'left' | 'right' | 'up' | 'down' }) {
  const path = { right: 'm9 18 6-6-6-6', left: 'm15 18-6-6 6-6', up: 'm18 15-6-6-6 6', down: 'm6 9 6 6 6-6' }[direction];
  return (
    <Svg {...props}>
      <path d={path} />
    </Svg>
  );
}

/** A receipt: the price breakdown. */
export function ReceiptIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M4 2v20l3-2 3 2 2-2 2 2 3-2 3 2V2l-3 2-3-2-2 2-2-2-3 2-3-2Z" />
      <path d="M8 9h8M8 13h8" />
    </Svg>
  );
}
