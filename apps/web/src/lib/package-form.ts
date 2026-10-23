// Validation for the admin package create/edit form. Pure so it can be unit tested.

export function parsePackageForm(formData: FormData, en = true) {
  const str = (k: string) => String(formData.get(k) ?? '').trim();
  const optInt = (k: string) => (str(k) === '' ? null : Number(str(k)));
  const kinds = ['balance', 'tokens', 'unlimited'] as const;
  const kind = kinds.find((k) => k === str('kind')) ?? 'tokens';
  const values = {
    name: str('name'),
    kind,
    description: str('description') || null,
    creditAllowance: Number(str('creditAllowance')),
    modelId: str('modelId') || null,
    durationHours: optInt('durationHours'),
    priceCents: optInt('priceCents'),
    status: (str('status') === 'inactive' ? 'inactive' : 'active') as 'active' | 'inactive',
  };
  if (!values.name) return { error: en ? 'Package name is required.' : 'Nama paket wajib diisi.' };
  if (values.name.length > 100) return { error: en ? 'Package name can be at most 100 characters.' : 'Nama paket maksimal 100 karakter.' };
  if (!Number.isSafeInteger(values.creditAllowance) || values.creditAllowance <= 0)
    return { error: en ? 'Credit allowance must be a whole number above 0.' : 'Jumlah kredit harus bilangan bulat lebih dari 0.' };
  if (kind === 'unlimited' && !values.modelId)
    return { error: en ? 'An unlimited pass needs a model.' : 'Paket unlimited wajib pilih model.' };
  if (kind !== 'unlimited' && values.modelId)
    return { error: en ? 'Only unlimited passes are tied to a model; pick "All models".' : 'Hanya paket unlimited yang terikat model; pilih "Semua model".' };
  if (values.durationHours !== null && (!Number.isSafeInteger(values.durationHours) || values.durationHours <= 0))
    return { error: en ? 'Duration must be a whole number of hours above 0, or empty.' : 'Durasi harus bilangan bulat jam lebih dari 0, atau dikosongkan.' };
  if (values.priceCents !== null && (!Number.isSafeInteger(values.priceCents) || values.priceCents < 0))
    return { error: en ? 'Price must be a whole number, 0 or more, or empty.' : 'Harga harus bilangan bulat 0 atau lebih, atau dikosongkan.' };
  return { values };
}
