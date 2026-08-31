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
        <defs>
          <linearGradient id="logo-grad" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#6366f1" />
            <stop offset="100%" stopColor="#8b5cf6" />
          </linearGradient>
        </defs>
        {/* Notepad body */}
        <rect
          x="3"
          y="4"
          width="22"
          height="26"
          rx="4"
          fill="url(#logo-grad)"
        />
        {/* Binding edge */}
        <rect
          x="3"
          y="4"
          width="4"
          height="26"
          rx="2"
          fill="#4f46e5"
          opacity="0.6"
        />
        {/* Lines */}
        <rect
          x="10"
          y="11"
          width="11"
          height="2"
          rx="1"
          fill="white"
          opacity="0.7"
        />
        <rect
          x="10"
          y="16"
          width="11"
          height="2"
          rx="1"
          fill="white"
          opacity="0.5"
        />
        <rect
          x="10"
          y="21"
          width="7"
          height="2"
          rx="1"
          fill="white"
          opacity="0.35"
        />
        {/* AI sparkle — 4-point star in cyan */}
        <g transform="translate(22, 6)">
          <path
            d="M4 0 L4.8 3.2 L8 4 L4.8 4.8 L4 8 L3.2 4.8 L0 4 L3.2 3.2 Z"
            fill="#06b6d4"
          />
        </g>
      </svg>

      {variant === "full" && (
        <span
          className={`font-bold ${text} leading-none`}
          style={{ fontFamily: "Sora, sans-serif" }}
        >
          <span style={{ color: "#6366f1" }}>Notepad</span>{" "}
          <span style={{ color: "#06b6d4" }}>AI</span>
        </span>
      )}
    </div>
  );
}
