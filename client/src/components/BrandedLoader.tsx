import { Logo } from './Logo';

interface BrandedLoaderProps {
  message?: string;
}

export function BrandedLoader({ message }: BrandedLoaderProps) {
  return (
    <div
      className="flex flex-col items-center justify-center min-h-screen gap-6"
      style={{ backgroundColor: '#0a0e27' }}
    >
      <div style={{ animation: 'pulse-glow 2s ease-in-out infinite' }}>
        <Logo size="lg" variant="full" />
      </div>
      <div className="flex gap-1.5">
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className="w-2 h-2 rounded-full"
            style={{
              backgroundColor: '#6366f1',
              animation: `bounce 1.2s ease-in-out ${i * 0.2}s infinite`,
            }}
          />
        ))}
      </div>
      {message && (
        <p className="text-sm" style={{ color: '#64748b', fontFamily: 'Sora, sans-serif' }}>
          {message}
        </p>
      )}
      <style>{`
        @keyframes bounce {
          0%, 80%, 100% { transform: scale(0.8); opacity: 0.4; }
          40% { transform: scale(1.2); opacity: 1; }
        }
        @keyframes pulse-glow {
          0%, 100% { filter: drop-shadow(0 0 8px #6366f180); }
          50% { filter: drop-shadow(0 0 20px #8b5cf6aa); }
        }
      `}</style>
    </div>
  );
}
