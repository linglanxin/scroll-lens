interface BrandLogoProps {
  size?: "sm" | "md" | "lg";
  showWordmark?: boolean;
  compactMobile?: boolean;
  subtitle?: string;
}

const SIZE_MAP = {
  sm: "h-7 w-7 rounded-lg",
  md: "h-9 w-9 rounded-xl",
  lg: "h-11 w-11 rounded-2xl",
};

export function BrandLogo({
  size = "sm",
  showWordmark = false,
  compactMobile = false,
  subtitle,
}: BrandLogoProps) {
  return (
    <div className="inline-flex items-center gap-2.5 select-none">
      {/* Matches android-shell ic_launcher_background (#1E3A5F) + ic_launcher_foreground */}
      <span
        className={`relative inline-flex shrink-0 items-center justify-center overflow-hidden bg-[#1E3A5F] shadow-sm ${SIZE_MAP[size]}`}
      >
        <svg
          viewBox="0 0 108 108"
          className="h-full w-full"
          aria-hidden="true"
        >
          <path
            fill="#FFFFFF"
            d="M32,30 L70,30 C74,30 77,33 77,37 L77,72 C77,76 74,79 70,79 L32,79 C28,79 25,76 25,72 L25,37 C25,33 28,30 32,30 Z M33,38 L33,71 L69,71 L69,38 Z"
          />
          <path
            fill="#93C5FD"
            d="M54,43 A11,11 0 1,0 54,65 A11,11 0 1,0 54,43 Z M54,48 A6,6 0 1,1 54,60 A6,6 0 1,1 54,48 Z"
          />
          <path
            fill="#93C5FD"
            d="M61,59 L70,68 L67,71 L58,62 Z"
          />
        </svg>
      </span>
      {showWordmark && (
        <div
          className={`min-w-0 leading-tight whitespace-nowrap ${
            compactMobile ? "hidden sm:block" : ""
          }`}
        >
          <div className="flex items-baseline gap-1.5 whitespace-nowrap">
            <span className="font-semibold tracking-tight text-ink text-sm sm:text-[15px]">
              ScrollLens
            </span>
            <span className="text-xs font-medium text-ink-muted">卷镜</span>
          </div>
          {subtitle && (
            <div className="truncate text-[11px] text-ink-secondary mt-0.5">
              {subtitle}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
