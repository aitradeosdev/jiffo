import type { ReactNode } from 'react';

/** Line icons in the apps' style: 24-unit grid, round joins, drawn in the text colour. */
function Icon({ children, size = 20 }: { children: ReactNode; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.85}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

export const OverviewIcon = () => (
  <Icon>
    <rect x="4" y="4" width="7" height="7" rx="1.5" />
    <rect x="13" y="4" width="7" height="4" rx="1.5" />
    <rect x="13" y="10" width="7" height="10" rx="1.5" />
    <rect x="4" y="13" width="7" height="7" rx="1.5" />
  </Icon>
);

export const TeamIcon = () => (
  <Icon>
    <circle cx="9" cy="8.5" r="3.2" />
    <path d="M3.5 19a5.5 5.5 0 0 1 11 0" />
    <path d="M15.5 5.6a3.2 3.2 0 0 1 0 5.8M17.5 14.2A5.5 5.5 0 0 1 20.5 19" />
  </Icon>
);

export const AuditIcon = () => (
  <Icon>
    <path d="M7 3.5h10a1.5 1.5 0 0 1 1.5 1.5v14A1.5 1.5 0 0 1 17 20.5H7A1.5 1.5 0 0 1 5.5 19V5A1.5 1.5 0 0 1 7 3.5z" />
    <path d="M9 8h6M9 12h6M9 16h3" />
  </Icon>
);

export const SignOutIcon = () => (
  <Icon size={18}>
    <path d="M14 4h4a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-4M10 16l-4-4 4-4M6 12h10" />
  </Icon>
);

export const AlertIcon = () => (
  <Icon size={18}>
    <path d="M12 3.5l9 16H3z" />
    <path d="M12 10v4M12 17h.01" />
  </Icon>
);

export const CheckIcon = () => (
  <Icon size={18}>
    <path d="M20 6L9 17l-5-5" />
  </Icon>
);

export const ErrandsIcon = () => (
  <Icon>
    <path d="M5 8h14l-1 12H6z" />
    <path d="M9 8V6.5a3 3 0 0 1 6 0V8" />
  </Icon>
);

export const DisputesIcon = () => (
  <Icon>
    <path d="M5 21V4.5" />
    <path d="M5 5h11.5l-2 4 2 4H5" />
  </Icon>
);
