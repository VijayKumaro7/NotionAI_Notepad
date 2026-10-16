interface LogoProps {
  size?: "sm" | "md" | "lg";
  variant?: "icon" | "full";
  className?: string;
}

const sizes = {
  sm: { icon: 24, text: "text-base", gap: "gap-1.5" },
  md: { icon: 32, text: "text-xl", gap: "gap-2" },
  lg: { icon: 48, text: "text-3xl", gap: "gap-3" },
};

export function Logo({
  size = "md",
  variant = "full",
  className = "",
}: LogoProps) {
  const { icon: iconSize, text, gap } = sizes[size];

  return (
    <div className={`flex items-center ${gap} ${className}`}>
      <svg
        width={iconSize}
        height={iconSize}
        viewBox="0 0 32 32"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        aria-hidden="true"
      >
        {/* Notepad body */}
        <rect x="3" y="4" width="22" height="26" rx="2" fill="var(--primary)" />
        {/* Binding edge */}
        <rect
          x="3"
          y="4"
          width="4"
          height="26"
          rx="1"
          fill="var(--primary-foreground)"
          opacity="0.18"
        />
        {/* Lines */}
        <rect
          x="10"
          y="11"
          width="11"
          height="2"
          rx="1"
          fill="var(--primary-foreground)"
          opacity="0.75"
        />
        <rect
          x="10"
          y="16"
          width="11"
          height="2"
          rx="1"
          fill="var(--primary-foreground)"
          opacity="0.5"
        />
        <rect
          x="10"
          y="21"
          width="7"
          height="2"
          rx="1"
          fill="var(--primary-foreground)"
          opacity="0.35"
        />
        {/* AI sparkle — 4-point star in brushed gold */}
        <g transform="translate(22, 6)">
          <path
            d="M4 0 L4.8 3.2 L8 4 L4.8 4.8 L4 8 L3.2 4.8 L0 4 L3.2 3.2 Z"
            fill="#b09a62"
          />
        </g>
      </svg>

      {variant === "full" && (
        <span
          className={`font-display font-semibold tracking-tight ${text} leading-none text-foreground`}
        >
          Notepad <em className="font-normal text-accent">AI</em>
        </span>
      )}
    </div>
  );
}
