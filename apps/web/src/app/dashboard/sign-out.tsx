'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { signOut } from '@/lib/auth-client';
import { useTranslation } from '@/lib/i18n';
import { Loader2, LogOut } from 'lucide-react';

interface SignOutButtonProps {
  className?: string;
  children?: React.ReactNode;
}

export function SignOutButton({ className, children }: SignOutButtonProps) {
  const router = useRouter();
  const { t, locale } = useTranslation();
  const [isSigningOut, setIsSigningOut] = useState(false);
  const [failed, setFailed] = useState(false);

  const handleSignOut = async () => {
    if (isSigningOut) return;
    setFailed(false);
    setIsSigningOut(true);

    try {
      const res = await signOut();
      if (res?.error) {
        console.error('Sign-out error:', res.error.code ?? res.error.status, res.error.message);
        setFailed(true);
        setIsSigningOut(false);
        return;
      }
      // replace() so the back button does not land on a dashboard page that no longer loads,
      // refresh() so the server components drop the cached signed-in tree.
      router.replace('/login');
      router.refresh();
    } catch (err) {
      console.error('Sign-out error:', err);
      setFailed(true);
      setIsSigningOut(false);
    }
  };

  const label = failed
    ? locale === 'id'
      ? 'Gagal keluar, coba lagi'
      : 'Sign out failed, try again'
    : t.dashboard.signOut;

  // The icon-only variant has no room for the failure text, so it turns rose and the reason
  // lives in the accessible label instead.
  let content: React.ReactNode;
  if (isSigningOut) {
    content = <Loader2 className="h-4 w-4 animate-spin" />;
  } else if (failed) {
    content = children ? label : <LogOut className="h-4 w-4 text-rose-600" />;
  } else {
    content = (children ?? <LogOut className="h-4 w-4" />);
  }

  return (
    <button
      type="button"
      onClick={handleSignOut}
      disabled={isSigningOut}
      title={label}
      aria-label={label}
      className={
        className ??
        'p-2 rounded-xl text-neutral-500 hover:text-rose-600 hover:bg-rose-50 disabled:opacity-60 transition-colors cursor-pointer shrink-0'
      }
    >
      {content}
    </button>
  );
}
