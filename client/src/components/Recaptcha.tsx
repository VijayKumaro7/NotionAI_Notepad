import { useCallback, useEffect, useImperativeHandle, useRef, forwardRef } from 'react';

/**
 * The reCAPTCHA v2 checkbox.
 *
 * Google's script is loaded on demand rather than from index.html, so a
 * deployment without reCAPTCHA configured never fetches it — the site key
 * arrives from the server at runtime, and no widget renders without one.
 *
 * The token this produces proves nothing by itself. It is checked server-side
 * in server/recaptcha.ts, and that is where the decision is made; this
 * component only collects it.
 */

const SCRIPT_ID = 'recaptcha-script';
const SCRIPT_SRC = 'https://www.google.com/recaptcha/api.js?render=explicit';

type GrecaptchaWidget = {
  render: (
    container: HTMLElement,
    options: {
      sitekey: string;
      theme?: 'light' | 'dark';
      callback?: (token: string) => void;
      'expired-callback'?: () => void;
      'error-callback'?: () => void;
    }
  ) => number;
  reset: (widgetId?: number) => void;
  getResponse: (widgetId?: number) => string;
};

declare global {
  interface Window {
    grecaptcha?: { ready: (cb: () => void) => void } & GrecaptchaWidget;
  }
}

/** Load Google's script once per page, however many widgets ask for it. */
let scriptPromise: Promise<void> | null = null;

function loadScript(): Promise<void> {
  if (scriptPromise) return scriptPromise;

  scriptPromise = new Promise<void>((resolve, reject) => {
    if (window.grecaptcha?.render) {
      resolve();
      return;
    }

    const existing = document.getElementById(SCRIPT_ID) as HTMLScriptElement | null;
    const script = existing ?? document.createElement('script');

    if (!existing) {
      script.id = SCRIPT_ID;
      script.src = SCRIPT_SRC;
      script.async = true;
      script.defer = true;
    }

    script.addEventListener('load', () => resolve());
    // Rejecting rather than hanging: an ad blocker or an offline network should
    // surface as a message, not a checkbox that never appears.
    script.addEventListener('error', () =>
      reject(new Error('Could not load the robot check'))
    );

    if (!existing) document.head.appendChild(script);
  }).catch((error) => {
    // Cleared so a later attempt can retry instead of replaying the failure.
    scriptPromise = null;
    throw error;
  });

  return scriptPromise;
}

export type RecaptchaHandle = {
  /** The current token, or '' when the box is unticked or expired. */
  getToken: () => string;
  /** Clear the tick. Called after a failed submit so the next one is fresh. */
  reset: () => void;
};

export const Recaptcha = forwardRef<
  RecaptchaHandle,
  { siteKey: string; onError?: (message: string) => void }
>(function Recaptcha({ siteKey, onError }, ref) {
  const container = useRef<HTMLDivElement | null>(null);
  const widgetId = useRef<number | null>(null);
  const token = useRef('');

  useImperativeHandle(ref, () => ({
    getToken: () => token.current,
    reset: () => {
      token.current = '';
      if (widgetId.current !== null) window.grecaptcha?.reset(widgetId.current);
    },
  }));

  const report = useCallback(
    (message: string) => {
      onError?.(message);
    },
    [onError]
  );

  useEffect(() => {
    let cancelled = false;

    loadScript()
      .then(() => {
        // grecaptcha.ready defers until the API is genuinely usable; calling
        // render straight after load intermittently throws.
        window.grecaptcha?.ready(() => {
          if (cancelled || !container.current || widgetId.current !== null) return;

          try {
            widgetId.current = window.grecaptcha!.render(container.current, {
              sitekey: siteKey,
              callback: (value: string) => {
                token.current = value;
              },
              // A token is good for two minutes. Clearing it locally keeps the
              // form from submitting one the server will reject anyway.
              'expired-callback': () => {
                token.current = '';
              },
              'error-callback': () => {
                token.current = '';
                report('The robot check failed to load. Try again.');
              },
            });
          } catch {
            report('The robot check could not start.');
          }
        });
      })
      .catch(() => {
        if (!cancelled) report('Could not load the robot check.');
      });

    return () => {
      cancelled = true;
    };
    // siteKey does not change within a mounted form, and re-rendering the
    // widget would wipe a tick the person already made.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [siteKey]);

  return <div ref={container} className="flex justify-center" />;
});
