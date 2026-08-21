/**
 * The Harmoneeze mark: an eighth note zooming, with motion lines.
 *
 * Inlined rather than loaded from `src/imgs/logo-mark.svg` as an <img>, so it
 * inherits `currentColor` from whatever it sits in — the source file is drawn
 * with `fill="currentColor"` precisely so it can be tinted by CSS, and an
 * <img> tag would sever that.
 *
 * The artwork is drawn low and right inside its 512 square, so the viewBox is
 * tightened to the rotated group's real bounds. Without that it renders small
 * and off-centre at topbar sizes.
 */

interface Props {
  /** Rendered size in pixels. */
  size?: number;
  className?: string;
}

export function Logo({ size = 24, className }: Props) {
  return (
    <svg
      className={className}
      viewBox="68 139 372 304"
      width={size}
      height={size * (304 / 372)}
      role="img"
      aria-label="Harmoneeze"
      fill="currentColor"
    >
      <g transform="translate(168 44) rotate(-13 140 220)">
        <g stroke="currentColor" strokeWidth="16" strokeLinecap="round">
          <line x1="-16" y1="168" x2="66" y2="168" />
          <line x1="-72" y1="238" x2="58" y2="238" />
          <line x1="-30" y1="302" x2="48" y2="302" />
        </g>

        <ellipse cx="120" cy="300" rx="43" ry="29" transform="rotate(-21 120 300)" />
        <rect x="155" y="126" width="13" height="172" rx="5" />
        <path
          d="M168 126
             C 220 150, 244 186, 231 236
             C 233 196, 208 170, 168 180 Z"
        />
      </g>
    </svg>
  );
}
