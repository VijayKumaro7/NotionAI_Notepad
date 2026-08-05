import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';

interface OtpauthQrCodeProps {
  /** The otpauth:// URI to encode. */
  value: string;
  size?: number;
}

/**
 * The enrolment QR code.
 *
 * The encoder is loaded on demand rather than imported at the top. This panel
 * is opened once in an account's lifetime; bundling a QR encoder into the main
 * chunk would make every page load pay for it. Same arrangement as the PDF
 * export.
 *
 * Rendered light-on-white in both themes and given a white surround. That is
 * not an oversight about dark mode: phone cameras expect dark modules on a
 * light field, and an inverted code with no quiet zone is one many scanners
 * simply will not read.
 */
export function OtpauthQrCode({ value, size = 176 }: OtpauthQrCodeProps) {
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let active = true;
    setDataUrl(null);
    setFailed(false);

    (async () => {
      try {
        const { toDataURL } = await import('qrcode');
        const url = await toDataURL(value, {
          width: size,
          margin: 2,
          errorCorrectionLevel: 'M',
          color: { dark: '#000000', light: '#ffffff' },
        });
        if (active) setDataUrl(url);
      } catch {
        // The setup key below this is the real fallback, and it is always
        // shown — so a failure here costs a convenience, not the enrolment.
        if (active) setFailed(true);
      }
    })();

    return () => {
      active = false;
    };
  }, [value, size]);

  if (failed) return null;

  return (
    <div
      className="flex items-center justify-center rounded-lg bg-white p-3"
      style={{ width: size + 24, height: size + 24 }}
    >
      {dataUrl ? (
        <img
          src={dataUrl}
          width={size}
          height={size}
          alt="QR code for setting up two-step verification"
        />
      ) : (
        <Loader2 className="w-5 h-5 animate-spin text-slate-400" />
      )}
    </div>
  );
}
