import { Logo } from "./Logo";

interface BrandedLoaderProps {
  message?: string;
}

export function BrandedLoader({ message }: BrandedLoaderProps) {
  return (
    <div className="flex flex-col items-center justify-center min-h-screen gap-6 bg-background">
      <div style={{ animation: "pulse 2s ease-in-out infinite" }}>
        <Logo size="lg" variant="full" />
      </div>
      <div className="flex gap-1.5">
        {[0, 1, 2].map(i => (
          <span
            key={i}
            className="w-2 h-2 rounded-full bg-primary"
            style={{
              animation: `bounce 1.2s ease-in-out ${i * 0.2}s infinite`,
            }}
          />
        ))}
      </div>
      {message && <p className="text-sm text-muted-foreground">{message}</p>}
      <style>{`
        @keyframes bounce {
          0%, 80%, 100% { transform: scale(0.8); opacity: 0.4; }
          40% { transform: scale(1.2); opacity: 1; }
        }
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.6; }
        }
      `}</style>
    </div>
  );
}
