'use client';

import { useEffect, useId, useRef, useState } from 'react';
import Link from 'next/link';
import { ChevronDown } from 'lucide-react';

export interface NavMenuItem {
  href: string;
  label: string;
}

/** Top-nav dropdown: opens on hover or click, closes on Escape, outside click or navigation. */
export default function NavMenu({
  items,
  buttonClassName,
  children,
  onPointerEnter,
}: {
  items: NavMenuItem[];
  buttonClassName: string;
  /** Button content (label, plus any hover decoration the host nav draws). */
  children: React.ReactNode;
  onPointerEnter?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const id = useId();

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    const onDown = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    window.addEventListener('keydown', onKey);
    window.addEventListener('pointerdown', onDown);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('pointerdown', onDown);
    };
  }, [open]);

  return (
    <div
      ref={ref}
      className="relative"
      onMouseEnter={() => {
        onPointerEnter?.();
        setOpen(true);
      }}
      onMouseLeave={() => setOpen(false)}
    >
      <button type="button" aria-expanded={open} aria-controls={id} onClick={() => setOpen((v) => !v)} className={buttonClassName}>
        {children}
        <ChevronDown aria-hidden="true" className={`relative h-3.5 w-3.5 transition-transform duration-200 ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div id={id} className="absolute left-1/2 top-full z-50 -translate-x-1/2 pt-2">
          <ul className="w-36 rounded-2xl border border-neutral-200 bg-white p-1.5 shadow-[0_16px_40px_rgba(0,0,0,0.08)]">
            {items.map((item) => (
              <li key={item.href}>
                <Link
                  href={item.href}
                  onClick={() => setOpen(false)}
                  className="block rounded-xl px-3 py-2 text-sm font-medium text-neutral-950 hover:bg-neutral-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-950"
                >
                  {item.label}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

export const analyticsItems = (en: boolean): NavMenuItem[] => [
  { href: '/analytics/models', label: en ? 'Models' : 'Model' },
  { href: '/analytics/apps', label: en ? 'Apps' : 'Aplikasi' },
];
