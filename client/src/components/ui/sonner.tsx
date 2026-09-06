import { useTheme } from "@/contexts/ThemeContext";
import { Toaster as Sonner, type ToasterProps } from "sonner";

// The theme comes from this app's ThemeContext, not from next-themes.
//
// shadcn ships this file wired to next-themes, which is right for a Next.js
// project. Here it was wired to nothing: no next-themes provider is mounted
// anywhere, so its useTheme() returned no theme, the default "system" applied,
// and sonner resolved that from the operating system while the rest of the app
// followed the in-app toggle.
//
// That was invisible rather than broken. The --normal-* properties below map
// sonner's colours onto this app's CSS variables, which already track the
// `dark` class, so they win at paint time whatever sonner believes its theme
// is. Measured with the app dark and the OS light: only the toaster's
// data-sonner-theme attribute changed, not one computed colour.
//
// Worth fixing anyway. That override is the only thing holding it together,
// and anything stepping outside it — richColors, a sonner upgrade that styles
// something new — would land on the OS theme with no obvious cause.
const Toaster = ({ ...props }: ToasterProps) => {
  const { theme } = useTheme();

  return (
    <Sonner
      theme={theme}
      // Not sonner's default bottom-right, which is where this app keeps the
      // AI column. Measured at 1400x1000: a toast covers the Voice Memo
      // panel's Start Recording button outright, and it covers Transcribe and
      // Stop transcribing while a transcription runs — so the control someone
      // reaches for after reading the toast is the one the toast is sitting
      // on, for the four seconds it takes to dismiss itself.
      //
      // Bottom-centre puts it over the editor's status strip instead, which is
      // a character count and a formatting tip: nothing to click.
      position="bottom-center"
      className="toaster group"
      style={
        {
          "--normal-bg": "var(--popover)",
          "--normal-text": "var(--popover-foreground)",
          "--normal-border": "var(--border)",
        } as React.CSSProperties
      }
      {...props}
    />
  );
};

export { Toaster };
