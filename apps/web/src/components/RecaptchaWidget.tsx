'use client';

import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from 'react';

declare global {
  interface Window {
    grecaptcha?: {
      ready: (cb: () => void) => void;
      render: (
        container: HTMLElement | string,
        parameters: {
          sitekey: string;
          theme?: 'light' | 'dark';
          size?: 'normal' | 'compact';
          callback?: (token: string) => void;
          'expired-callback'?: () => void;
          'error-callback'?: () => void;
        },
      ) => number;
      reset: (opt_widget_id?: number) => void;
      getResponse: (opt_widget_id?: number) => string;
    };
    __recaptchaLoadedCallbacks?: Array<() => void>;
    __onRecaptchaApiLoaded?: () => void;
  }
}

export interface RecaptchaWidgetRef {
  reset: () => void;
  getResponse: () => string;
}

interface RecaptchaWidgetProps {
  siteKey?: string;
  onVerify: (token: string) => void;
  onExpire?: () => void;
  onError?: () => void;
  theme?: 'light' | 'dark';
  hl?: string;
  className?: string;
}

export const RecaptchaWidget = forwardRef<RecaptchaWidgetRef, RecaptchaWidgetProps>(
  function RecaptchaWidget(
    {
      siteKey = process.env.NEXT_PUBLIC_RECAPTCHA_SITE_KEY,
      onVerify,
      onExpire,
      onError,
      theme = 'light',
      hl = 'en',
      className = '',
    },
    ref,
  ) {
    const containerRef = useRef<HTMLDivElement>(null);
    const widgetIdRef = useRef<number | null>(null);
    const [isScriptReady, setIsScriptReady] = useState(false);

    useImperativeHandle(
      ref,
      () => ({
        reset: () => {
          if (widgetIdRef.current !== null && window.grecaptcha?.reset) {
            try {
              window.grecaptcha.reset(widgetIdRef.current);
            } catch (err) {
              console.warn('[reCAPTCHA] Failed to reset widget:', err);
            }
          }
        },
        getResponse: () => {
          if (widgetIdRef.current !== null && window.grecaptcha?.getResponse) {
            try {
              return window.grecaptcha.getResponse(widgetIdRef.current);
            } catch {
              return '';
            }
          }
          return '';
        },
      }),
      [],
    );

    // Load reCAPTCHA script once
    useEffect(() => {
      if (!siteKey) return;

      if (window.grecaptcha?.render) {
        setIsScriptReady(true);
        return;
      }

      if (!window.__recaptchaLoadedCallbacks) {
        window.__recaptchaLoadedCallbacks = [];
        window.__onRecaptchaApiLoaded = () => {
          window.__recaptchaLoadedCallbacks?.forEach((cb) => cb());
          window.__recaptchaLoadedCallbacks = [];
        };
      }

      window.__recaptchaLoadedCallbacks.push(() => {
        setIsScriptReady(true);
      });

      const scriptId = 'google-recaptcha-v2-script';
      if (!document.getElementById(scriptId)) {
        const script = document.createElement('script');
        script.id = scriptId;
        script.src = `https://www.google.com/recaptcha/api.js?onload=__onRecaptchaApiLoaded&render=explicit&hl=${encodeURIComponent(hl)}`;
        script.async = true;
        script.defer = true;
        document.head.appendChild(script);
      }
    }, [siteKey, hl]);

    // Render widget when script & container are ready
    useEffect(() => {
      if (!siteKey || !isScriptReady || !containerRef.current) return;
      if (widgetIdRef.current !== null) return; // already rendered

      try {
        const id = window.grecaptcha?.render(containerRef.current, {
          sitekey: siteKey,
          theme,
          callback: (token: string) => {
            onVerify(token);
          },
          'expired-callback': () => {
            onExpire?.();
          },
          'error-callback': () => {
            onError?.();
          },
        });

        if (typeof id === 'number') {
          widgetIdRef.current = id;
        }
      } catch (err) {
        console.error('[reCAPTCHA] Render error:', err);
      }
    }, [siteKey, isScriptReady, theme, onVerify, onExpire, onError]);

    if (!siteKey) {
      if (process.env.NODE_ENV === 'development') {
        return (
          <div className="p-2.5 rounded-xl border border-dashed border-amber-300 bg-amber-50/70 text-[11px] text-amber-800 text-center leading-relaxed">
            <span className="font-bold">Dev Note:</span> reCAPTCHA tidak aktif
            karena <code className="font-mono text-[10px] bg-amber-100 px-1 py-0.5 rounded">NEXT_PUBLIC_RECAPTCHA_SITE_KEY</code> belum diisi di .env. Form dapat disubmit tanpa captcha.
          </div>
        );
      }
      return null;
    }

    return (
      <div
        className={`flex justify-center items-center min-h-[78px] overflow-hidden my-2 ${className}`}
      >
        <div ref={containerRef} className="recaptcha-container" />
      </div>
    );
  },
);

RecaptchaWidget.displayName = 'RecaptchaWidget';
export default RecaptchaWidget;
