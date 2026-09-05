// Inline SVG icons. Each takes the size from its parent via 1em so buttons and
// chips control it with fontSize; color comes from currentColor.
import * as stylex from "@stylexjs/stylex";

type IconProps = { size?: number; style?: stylex.StyleXStyles };

const base = stylex.create({
  svg: { width: "1.125em", height: "1.125em", flexShrink: 0 },
});

function Svg({ size, style, children }: IconProps & { children: React.ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
      width={size}
      height={size}
      {...stylex.props(base.svg, style)}
    >
      {children}
    </svg>
  );
}

/** Citrus wedge: the like mark. Fill and segment stroke are styled by the parent via `wedge` / `segs` classes. */
export function WedgeIcon({ filled, ...p }: IconProps & { filled?: boolean }) {
  return (
    <Svg {...p}>
      <path d="M3 8 A9 9 0 0 0 21 8 Z" fill={filled ? "#D4551B" : "transparent"} stroke="currentColor" strokeWidth="2" />
      <path
        d="M12 8 V17 M12 8 L16.5 15.8 M12 8 L7.5 15.8"
        fill="none"
        stroke={filled ? "#E8C547" : "currentColor"}
        strokeWidth="1.5"
      />
    </Svg>
  );
}

export function GitHubIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path
        fill="currentColor"
        d="M12 .5C5.7.5.5 5.7.5 12c0 5.1 3.3 9.4 7.9 10.9.6.1.8-.2.8-.6v-2c-3.2.7-3.9-1.4-3.9-1.4-.5-1.3-1.3-1.7-1.3-1.7-1-.7.1-.7.1-.7 1.2.1 1.8 1.2 1.8 1.2 1 1.8 2.7 1.3 3.4 1 .1-.8.4-1.3.7-1.6-2.6-.3-5.3-1.3-5.3-5.7 0-1.3.4-2.3 1.2-3.1-.1-.3-.5-1.5.1-3.1 0 0 1-.3 3.2 1.2a11 11 0 0 1 5.8 0c2.2-1.5 3.2-1.2 3.2-1.2.6 1.6.2 2.8.1 3.1.8.8 1.2 1.8 1.2 3.1 0 4.4-2.7 5.4-5.3 5.7.4.4.8 1.1.8 2.2v3.2c0 .3.2.7.8.6 4.6-1.5 7.9-5.8 7.9-10.9C23.5 5.7 18.3.5 12 .5z"
      />
    </Svg>
  );
}

export function MoreIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <circle cx="5" cy="12" r="2.2" fill="currentColor" />
      <circle cx="12" cy="12" r="2.2" fill="currentColor" />
      <circle cx="19" cy="12" r="2.2" fill="currentColor" />
    </Svg>
  );
}

const stroke = { fill: "none", stroke: "currentColor", strokeWidth: 2.2, strokeLinecap: "round", strokeLinejoin: "round" } as const;

export function TrashIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path {...stroke} d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" />
    </Svg>
  );
}

export function LogOutIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path {...stroke} d="M10 4H5v16h5M14 8l5 4-5 4M19 12H9" />
    </Svg>
  );
}

export function UserIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <circle cx="12" cy="8" r="4" {...stroke} />
      <path {...stroke} d="M4 20c1.5-4 5-5.5 8-5.5s6.5 1.5 8 5.5" />
    </Svg>
  );
}

export function HomeIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path {...stroke} d="M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z" />
    </Svg>
  );
}

export function SunIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <circle cx="12" cy="12" r="4" {...stroke} />
      <path {...stroke} d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
    </Svg>
  );
}

export function MoonIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path {...stroke} d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z" />
    </Svg>
  );
}

export function MonitorIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <rect x="3" y="4" width="18" height="12" rx="2" {...stroke} />
      <path {...stroke} d="M8 20h8M12 16v4" />
    </Svg>
  );
}

export function ReplyIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path {...stroke} d="M20 12a8 8 0 0 1-8 8H8l-4 3v-3.5A8 8 0 1 1 20 12z" />
    </Svg>
  );
}

export function SearchIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <circle cx="11" cy="11" r="6.5" {...stroke} />
      <path {...stroke} d="M16 16l5 5" />
    </Svg>
  );
}

export function ArrowLeftIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path {...stroke} d="M19 12H5M11 6l-6 6 6 6" />
    </Svg>
  );
}

export function PlusIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path {...stroke} strokeWidth="2.8" d="M12 5v14M5 12h14" />
    </Svg>
  );
}
