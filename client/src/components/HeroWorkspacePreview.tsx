import { useId } from "react";

/**
 * A vector portrait of the workspace itself — sidebar, editor and AI panel —
 * drawn from the same theme tokens the real app renders with, so it follows the
 * light/dark switch instead of going stale the way a screenshot does. It ships
 * inside the bundle rather than over the network, which is also why there is a
 * single drawing here: `crop` only moves the viewBox, so the mobile close-up
 * and the desktop wide shot cannot drift apart.
 */
type Crop = "full" | "detail";

const VIEW_BOX: Record<Crop, string> = {
  full: "0 0 1000 660",
  detail: "648 56 352 372",
};

const LABEL: Record<Crop, string> = {
  full:
    "The Notepad AI workspace: a note called “Q3 Product Kickoff” open in the editor with three sentences selected, " +
    "the AI assistant beside it summarising that selection into key points, a sidebar of folders and notes on the left, " +
    "collaborator avatars in the title bar and an end-to-end encrypted badge above the note.",
  detail:
    "The Notepad AI assistant panel summarising the selected sentences of a note into three key points, " +
    "with Insert and Copy actions.",
};

const sidebarNotes = [
  { title: "Q3 Product Kickoff", y: 246, active: true },
  { title: "Roadmap 2026", y: 272, active: false },
  { title: "Launch checklist", y: 298, active: false },
];

const collapsedFolders = [
  { name: "Research", y: 330 },
  { name: "Personal", y: 360 },
];

const bodyLines = [
  "Beta opens to 200 teams on Oct 14. Marketing needs the",
  "final pricing copy by Friday, and the migration checklist",
  "has to be signed off by design before we announce.",
];

const actionItems = [
  { label: "Confirm launch date with Maya", done: true },
  { label: "Draft pricing page copy", done: true },
  { label: "Send migration checklist to design", done: false },
];

const keyPoints = [
  "Beta opens to 200 teams on Oct 14.",
  "Pricing page copy is due Friday.",
  "Maya owns the migration checklist.",
];

const suggestionChips = [
  { label: "Improve grammar", x: 684, y: 452, w: 122 },
  { label: "Expand", x: 814, y: 452, w: 76 },
  { label: "Change tone", x: 684, y: 486, w: 104 },
  { label: "Extract action items", x: 796, y: 486, w: 150 },
];

const recentActions = [
  { label: "Summarised selection · 2 min ago", y: 556 },
  { label: "Rewrote the intro · 12 min ago", y: 578 },
];

const collaborators = [
  { initial: "M", cx: 908, fill: "var(--primary)" },
  { initial: "A", cx: 930, fill: "var(--secondary)" },
  { initial: "R", cx: 952, fill: "var(--accent)" },
];

interface HeroWorkspacePreviewProps {
  crop?: Crop;
  className?: string;
}

export function HeroWorkspacePreview({
  crop = "full",
  className = "",
}: HeroWorkspacePreviewProps) {
  // React's generated ids contain colons, which url(#…) references choke on.
  const uid = useId().replace(/:/g, "");
  const brand = `${uid}-brand`;
  const clip = `${uid}-clip`;

  return (
    <svg
      viewBox={VIEW_BOX[crop]}
      className={`w-full h-auto ${className}`}
      role="img"
      aria-label={LABEL[crop]}
      focusable="false"
      style={{ fontFamily: "Sora, sans-serif" }}
    >
      <title>{LABEL[crop]}</title>

      <defs>
        <linearGradient id={brand} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="var(--primary)" />
          <stop offset="100%" stopColor="var(--secondary)" />
        </linearGradient>
        <clipPath id={clip}>
          <rect x="0" y="0" width="1000" height="660" rx="18" />
        </clipPath>
      </defs>

      <g clipPath={`url(#${clip})`}>
        {/* Surfaces: background, sidebar, AI panel, title bar */}
        <rect x="0" y="0" width="1000" height="660" fill="var(--background)" />
        <rect x="0" y="44" width="228" height="616" fill="var(--sidebar)" />
        <rect x="660" y="44" width="340" height="616" fill="var(--card)" />
        <rect x="0" y="0" width="1000" height="44" fill="var(--card)" />
        <path
          d="M0 44h1000M228 44v616M660 44v616M228 84h432"
          stroke="var(--border)"
          strokeWidth="1"
        />

        {/* Title bar */}
        <g>
          <circle
            cx="22"
            cy="22"
            r="4.5"
            fill="var(--muted-foreground)"
            opacity="0.35"
          />
          <circle
            cx="40"
            cy="22"
            r="4.5"
            fill="var(--muted-foreground)"
            opacity="0.35"
          />
          <circle
            cx="58"
            cy="22"
            r="4.5"
            fill="var(--muted-foreground)"
            opacity="0.35"
          />
          <text x="84" y="26" fontSize="11.5" fill="var(--muted-foreground)">
            Workspace / Product / Q3 Product Kickoff
          </text>
          {collaborators.map(person => (
            <g key={person.initial}>
              <circle
                cx={person.cx}
                cy="22"
                r="11"
                fill={person.fill}
                stroke="var(--card)"
                strokeWidth="2"
              />
              <text
                x={person.cx}
                y="26"
                fontSize="10"
                fontWeight="600"
                fill="#ffffff"
                textAnchor="middle"
              >
                {person.initial}
              </text>
            </g>
          ))}
          <circle
            cx="974"
            cy="22"
            r="11"
            fill="var(--muted)"
            stroke="var(--card)"
            strokeWidth="2"
          />
          <text
            x="974"
            y="26"
            fontSize="9.5"
            fontWeight="600"
            fill="var(--muted-foreground)"
            textAnchor="middle"
          >
            +2
          </text>
        </g>

        {/* Sidebar */}
        <g>
          <path
            d="M24 66 L25.6 71.4 L31 73 L25.6 74.6 L24 80 L22.4 74.6 L17 73 L22.4 71.4 Z"
            fill="var(--accent)"
          />
          <text
            x="38"
            y="77"
            fontSize="14"
            fontWeight="700"
            fill="var(--foreground)"
          >
            Workspace
          </text>

          <rect
            x="16"
            y="92"
            width="196"
            height="34"
            rx="9"
            fill={`url(#${brand})`}
          />
          <path
            d="M64 109h12M70 103v12"
            stroke="#ffffff"
            strokeWidth="1.8"
            strokeLinecap="round"
          />
          <text
            x="84"
            y="113.5"
            fontSize="12.5"
            fontWeight="600"
            fill="#ffffff"
          >
            New note
          </text>

          <rect
            x="16"
            y="138"
            width="196"
            height="30"
            rx="8"
            fill="var(--input)"
            stroke="var(--border)"
          />
          <circle
            cx="32"
            cy="151"
            r="4.5"
            fill="none"
            stroke="var(--muted-foreground)"
            strokeWidth="1.4"
          />
          <path
            d="M35.5 154.5 L39 158"
            stroke="var(--muted-foreground)"
            strokeWidth="1.4"
            strokeLinecap="round"
          />
          <text x="48" y="157" fontSize="11.5" fill="var(--muted-foreground)">
            Search notes…
          </text>

          <text
            x="20"
            y="196"
            fontSize="9.5"
            fontWeight="600"
            letterSpacing="1"
            fill="var(--muted-foreground)"
          >
            FOLDERS
          </text>

          {/* Open folder with its notes */}
          <path
            d="M23 216 L29 222 L35 216"
            fill="none"
            stroke="var(--muted-foreground)"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path
            d="M42 213h7l2 3h9a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H42a2 2 0 0 1-2-2v-11a2 2 0 0 1 2-2z"
            fill="var(--accent)"
            opacity="0.85"
          />
          <text
            x="70"
            y="224"
            fontSize="12"
            fontWeight="600"
            fill="var(--foreground)"
          >
            Product
          </text>

          {sidebarNotes.map(note => (
            <g key={note.title}>
              {note.active && (
                <>
                  <rect
                    x="34"
                    y={note.y - 13}
                    width="178"
                    height="26"
                    rx="7"
                    fill="var(--primary)"
                    fillOpacity="0.14"
                  />
                  <rect
                    x="34"
                    y={note.y - 9}
                    width="3"
                    height="18"
                    rx="1.5"
                    fill="var(--primary)"
                  />
                </>
              )}
              <path
                d={`M46 ${note.y - 7}h9l4 4v10a1.5 1.5 0 0 1-1.5 1.5h-11.5a1.5 1.5 0 0 1-1.5-1.5v-12.5a1.5 1.5 0 0 1 1.5-1.5z`}
                fill="none"
                stroke={
                  note.active ? "var(--primary)" : "var(--muted-foreground)"
                }
                strokeWidth="1.3"
                strokeLinejoin="round"
              />
              <text
                x="70"
                y={note.y + 4}
                fontSize="11.5"
                fontWeight={note.active ? "600" : "400"}
                fill={
                  note.active ? "var(--primary)" : "var(--muted-foreground)"
                }
              >
                {note.title}
              </text>
            </g>
          ))}

          {collapsedFolders.map(folder => (
            <g key={folder.name}>
              <path
                d={`M25 ${folder.y - 6} L31 ${folder.y} L25 ${folder.y + 6}`}
                fill="none"
                stroke="var(--muted-foreground)"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <path
                d={`M42 ${folder.y - 9}h7l2 3h9a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H42a2 2 0 0 1-2-2v-11a2 2 0 0 1 2-2z`}
                fill="var(--accent)"
                opacity="0.55"
              />
              <text
                x="70"
                y={folder.y + 2}
                fontSize="12"
                fill="var(--foreground)"
              >
                {folder.name}
              </text>
            </g>
          ))}

          <text
            x="20"
            y="404"
            fontSize="9.5"
            fontWeight="600"
            letterSpacing="1"
            fill="var(--muted-foreground)"
          >
            TAGS
          </text>
          <rect
            x="16"
            y="414"
            width="62"
            height="22"
            rx="11"
            fill="var(--primary)"
            fillOpacity="0.12"
          />
          <text
            x="28"
            y="429"
            fontSize="10.5"
            fontWeight="600"
            fill="var(--primary)"
          >
            launch
          </text>
          <rect
            x="84"
            y="414"
            width="60"
            height="22"
            rx="11"
            fill="var(--secondary)"
            fillOpacity="0.12"
          />
          <text
            x="95"
            y="429"
            fontSize="10.5"
            fontWeight="600"
            fill="var(--secondary)"
          >
            design
          </text>
          <rect
            x="150"
            y="414"
            width="40"
            height="22"
            rx="11"
            fill="var(--accent)"
            fillOpacity="0.14"
          />
          <text
            x="161"
            y="429"
            fontSize="10.5"
            fontWeight="600"
            fill="var(--accent)"
          >
            q3
          </text>

          <path d="M0 596h228" stroke="var(--border)" strokeWidth="1" />
          <path
            d="M21 618h14M23 618v10a1.5 1.5 0 0 0 1.5 1.5h7a1.5 1.5 0 0 0 1.5-1.5v-10M25.5 618v-2.5h5v2.5"
            fill="none"
            stroke="var(--muted-foreground)"
            strokeWidth="1.3"
            strokeLinecap="round"
          />
          <text x="46" y="627" fontSize="11" fill="var(--muted-foreground)">
            Recently deleted
          </text>
        </g>

        {/* Editor toolbar */}
        <g>
          <rect x="228" y="44" width="432" height="40" fill="var(--card)" />
          {[244, 272, 300, 340, 368, 396].map(x => (
            <rect
              key={x}
              x={x}
              y="52"
              width="24"
              height="24"
              rx="6"
              fill="var(--muted)"
              fillOpacity="0.5"
            />
          ))}
          <text
            x="256"
            y="69"
            fontSize="12"
            fontWeight="700"
            fill="var(--foreground)"
            textAnchor="middle"
          >
            B
          </text>
          <text
            x="284"
            y="69"
            fontSize="12"
            fontStyle="italic"
            fill="var(--foreground)"
            textAnchor="middle"
          >
            I
          </text>
          <text
            x="312"
            y="69"
            fontSize="12"
            fill="var(--foreground)"
            textAnchor="middle"
          >
            U
          </text>
          <path d="M328 54v20" stroke="var(--border)" strokeWidth="1" />
          <path
            d="M346 60h12M346 64h12M346 68h8"
            stroke="var(--foreground)"
            strokeWidth="1.4"
            strokeLinecap="round"
          />
          <path
            d="M374 60h12M374 64h12M374 68h12M370 60h1M370 64h1M370 68h1"
            stroke="var(--foreground)"
            strokeWidth="1.4"
            strokeLinecap="round"
          />
          <path
            d="M402 60l-4 4 4 4M410 60l4 4-4 4"
            fill="none"
            stroke="var(--foreground)"
            strokeWidth="1.4"
            strokeLinecap="round"
            strokeLinejoin="round"
          />

          <rect
            x="490"
            y="53"
            width="96"
            height="22"
            rx="11"
            fill="var(--accent)"
            fillOpacity="0.14"
          />
          <path
            d="M504 63h9v7h-9zM505.5 63v-2.5a3 3 0 0 1 6 0V63"
            fill="none"
            stroke="var(--accent)"
            strokeWidth="1.3"
            strokeLinejoin="round"
          />
          <text
            x="520"
            y="68"
            fontSize="10"
            fontWeight="600"
            fill="var(--accent)"
          >
            Encrypted
          </text>
        </g>

        {/* Note */}
        <g>
          <text
            x="256"
            y="134"
            fontSize="26"
            fontWeight="700"
            fill="var(--foreground)"
          >
            Q3 Product Kickoff
          </text>
          <text x="256" y="158" fontSize="11" fill="var(--muted-foreground)">
            Edited 2 min ago · Maya and Arun are editing · Saved
          </text>

          {/* The selection the AI panel is working from */}
          <rect
            x="250"
            y="176"
            width="396"
            height="76"
            rx="6"
            fill="var(--primary)"
            fillOpacity="0.12"
          />
          {bodyLines.map((line, idx) => (
            <text
              key={line}
              x="258"
              y={198 + idx * 24}
              fontSize="12.5"
              fill="var(--foreground)"
              opacity="0.9"
            >
              {line}
            </text>
          ))}

          {/* A collaborator's live cursor, as LiveCursors draws it */}
          <rect
            x="545"
            y="230"
            width="2"
            height="20"
            rx="1"
            fill="var(--secondary)"
          />
          <rect
            x="545"
            y="254"
            width="42"
            height="16"
            rx="4"
            fill="var(--secondary)"
          />
          <text
            x="566"
            y="265"
            fontSize="9.5"
            fontWeight="600"
            fill="#ffffff"
            textAnchor="middle"
          >
            Maya
          </text>

          <text
            x="256"
            y="292"
            fontSize="13.5"
            fontWeight="700"
            fill="var(--foreground)"
          >
            Action items
          </text>
          {actionItems.map((item, idx) => {
            const y = 316 + idx * 28;
            return (
              <g key={item.label}>
                <rect
                  x="256"
                  y={y - 10}
                  width="13"
                  height="13"
                  rx="3.5"
                  fill={item.done ? "var(--accent)" : "none"}
                  stroke={
                    item.done ? "var(--accent)" : "var(--muted-foreground)"
                  }
                  strokeWidth="1.3"
                />
                {item.done && (
                  <path
                    d={`M259 ${y - 4} L261.6 ${y - 1} L266 ${y - 7}`}
                    fill="none"
                    stroke="#ffffff"
                    strokeWidth="1.6"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                )}
                <text
                  x="280"
                  y={y}
                  fontSize="12"
                  fill="var(--foreground)"
                  opacity={item.done ? 0.6 : 0.9}
                  textDecoration={item.done ? "line-through" : "none"}
                >
                  {item.label}
                </text>
              </g>
            );
          })}

          <path d="M256 424h380" stroke="var(--border)" strokeWidth="1" />
          <rect
            x="256"
            y="444"
            width="380"
            height="70"
            rx="8"
            fill="var(--muted)"
            fillOpacity="0.35"
          />
          <text x="272" y="470" fontSize="11.5" fill="var(--muted-foreground)">
            &gt; Decision: hold the announcement until the
          </text>
          <text x="272" y="492" fontSize="11.5" fill="var(--muted-foreground)">
            &gt; migration checklist is signed off.
          </text>

          <text x="256" y="628" fontSize="10.5" fill="var(--muted-foreground)">
            412 words · 2 min read · version 14
          </text>
        </g>

        {/* AI assistant panel */}
        <g>
          <path
            d="M691 64 L692.8 69.2 L698 71 L692.8 72.8 L691 78 L689.2 72.8 L684 71 L689.2 69.2 Z"
            fill="var(--primary)"
          />
          <text
            x="708"
            y="76"
            fontSize="13.5"
            fontWeight="700"
            fill="var(--foreground)"
          >
            AI Assistant
          </text>
          <path
            d="M954 74 L960 68 L966 74"
            fill="none"
            stroke="var(--muted-foreground)"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <text x="684" y="98" fontSize="10.5" fill="var(--muted-foreground)">
            Working from 3 selected sentences
          </text>

          <rect
            x="684"
            y="110"
            width="292"
            height="32"
            rx="8"
            fill="var(--input)"
            stroke="var(--border)"
          />
          <text
            x="700"
            y="131"
            fontSize="11.5"
            fontWeight="500"
            fill="var(--foreground)"
          >
            Summarize
          </text>
          <path
            d="M952 126 L958 132 L964 126"
            fill="none"
            stroke="var(--muted-foreground)"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />

          <rect
            x="684"
            y="154"
            width="292"
            height="200"
            rx="10"
            fill="var(--background)"
            stroke="var(--border)"
          />
          <text
            x="700"
            y="178"
            fontSize="9.5"
            fontWeight="600"
            letterSpacing="1"
            fill="var(--muted-foreground)"
          >
            KEY POINTS
          </text>
          {keyPoints.map((point, idx) => (
            <g key={point}>
              <circle cx="704" cy={200 + idx * 34} r="3" fill="var(--accent)" />
              <text
                x="718"
                y={204 + idx * 34}
                fontSize="11"
                fill="var(--foreground)"
                opacity="0.9"
              >
                {point}
              </text>
            </g>
          ))}
          <path d="M700 302h260" stroke="var(--border)" strokeWidth="1" />
          <text x="700" y="324" fontSize="10.5" fill="var(--muted-foreground)">
            Tone kept professional · 68 → 21 words
          </text>
          <text x="700" y="342" fontSize="10.5" fill="var(--muted-foreground)">
            Generated on the server, never stored
          </text>

          <rect
            x="684"
            y="376"
            width="140"
            height="34"
            rx="9"
            fill={`url(#${brand})`}
          />
          <text
            x="754"
            y="397"
            fontSize="12"
            fontWeight="600"
            fill="#ffffff"
            textAnchor="middle"
          >
            Insert
          </text>
          <rect
            x="836"
            y="376"
            width="140"
            height="34"
            rx="9"
            fill="var(--input)"
            stroke="var(--border)"
          />
          <text
            x="906"
            y="397"
            fontSize="12"
            fontWeight="600"
            fill="var(--foreground)"
            textAnchor="middle"
          >
            Copy
          </text>

          <text
            x="684"
            y="440"
            fontSize="9.5"
            fontWeight="600"
            letterSpacing="1"
            fill="var(--muted-foreground)"
          >
            TRY NEXT
          </text>
          {suggestionChips.map(chip => (
            <g key={chip.label}>
              <rect
                x={chip.x}
                y={chip.y}
                width={chip.w}
                height="26"
                rx="13"
                fill="none"
                stroke="var(--border)"
              />
              <text
                x={chip.x + chip.w / 2}
                y={chip.y + 17}
                fontSize="10.5"
                fill="var(--muted-foreground)"
                textAnchor="middle"
              >
                {chip.label}
              </text>
            </g>
          ))}

          <text
            x="684"
            y="532"
            fontSize="9.5"
            fontWeight="600"
            letterSpacing="1"
            fill="var(--muted-foreground)"
          >
            RECENT
          </text>
          {recentActions.map(item => (
            <g key={item.label}>
              <circle
                cx="690"
                cy={item.y - 4}
                r="4.5"
                fill="none"
                stroke="var(--muted-foreground)"
                strokeWidth="1.2"
              />
              <path
                d={`M690 ${item.y - 6.5}v2.5h2`}
                fill="none"
                stroke="var(--muted-foreground)"
                strokeWidth="1.2"
                strokeLinecap="round"
              />
              <text
                x="706"
                y={item.y}
                fontSize="10.5"
                fill="var(--muted-foreground)"
              >
                {item.label}
              </text>
            </g>
          ))}

          <path d="M660 600h340" stroke="var(--border)" strokeWidth="1" />
          <path
            d="M685 622h10v8h-10zM686.5 622v-2.5a3.5 3.5 0 0 1 7 0V622"
            fill="none"
            stroke="var(--accent)"
            strokeWidth="1.3"
            strokeLinejoin="round"
          />
          <text x="706" y="629" fontSize="10" fill="var(--muted-foreground)">
            End-to-end encrypted on this device
          </text>
        </g>
      </g>

      <rect
        x="0.5"
        y="0.5"
        width="999"
        height="659"
        rx="18"
        fill="none"
        stroke="var(--border)"
      />
    </svg>
  );
}
