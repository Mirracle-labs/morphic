import { requireUser, redeemCode } from '@/lib/actions';
import { RedeemForm } from './redeem-form';

export default async function RedeemPage() {
  await requireUser();
  return (
    <div className="flex flex-col gap-6 max-w-xl">
      <h1 className="text-2xl font-bold">Redeem Code</h1>
      <p className="text-sm text-[var(--muted)]">
        Enter a promotional code to receive credits or a model package.
      </p>
      <RedeemForm action={redeemCode} />
    </div>
  );
}
