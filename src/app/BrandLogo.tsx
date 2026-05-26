export function BrandLogo() {
  return (
    <span className="brand-logo-frame" aria-hidden="true">
      <svg className="brand-logo" viewBox="0 0 64 64" role="img">
        <path d="M17 19 32 32 17 45" fill="none" stroke="currentColor" strokeWidth="8" strokeLinecap="round" strokeLinejoin="round" />
        <rect className="brand-logo-cursor" x="36" y="39" width="15" height="8" rx="2" />
      </svg>
    </span>
  );
}
