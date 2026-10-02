'use client';

import { useRouter } from 'next/navigation';
import { signOut } from '@/lib/auth-client';

export function SignOutButton() {
  const router = useRouter();
  return (
    <button
      className="text-xs text-[var(--muted)] hover:text-[var(--foreground)] mt-1"
      onClick={() =>
        signOut({
          fetchOptions: {
            onSuccess: () => {
              router.push('/login');
              router.refresh();
            },
          },
        })
      }
    >
      Sign out
    </button>
  );
}
