// Support contact details. A plain module so server components can read the values;
// exports from a 'use client' file reach the server only as client references.
export const SUPPORT_PHONE = process.env.NEXT_PUBLIC_SUPPORT_PHONE || '+62 889-7694-9503';
export const SUPPORT_EMAIL = 'hello@mirraclefoundation.com';
export const SUPPORT_ADDRESS = 'Taman Kenari Jagorawi Blok 10, Citeureup, Kab. Bogor';
export const SUPPORT_HOURS = 'Senin - Jumat 09:00 - 17:00 WIB';
