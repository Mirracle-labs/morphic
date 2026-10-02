import { cookies, headers } from 'next/headers';
import { id } from './locales/id';
import { en } from './locales/en';
import type { Locale, TranslationDictionary } from './types';

const DICTIONARIES: Record<Locale, TranslationDictionary> = {
  id,
  en,
};

export async function getServerTranslation(): Promise<{ locale: Locale; t: TranslationDictionary }> {
  try {
    const cookieStore = await cookies();
    const cookieVal = cookieStore.get('morphic_locale')?.value as Locale | undefined;
    if (cookieVal === 'en' || cookieVal === 'id') {
      return { locale: cookieVal, t: DICTIONARIES[cookieVal] };
    }

    const reqHeaders = await headers();
    const detected = reqHeaders.get('x-morphic-detected-locale');
    const country = (reqHeaders.get('cf-ipcountry') || reqHeaders.get('x-vercel-ip-country') || '').trim().toUpperCase();

    let locale: Locale = 'id';
    if (detected === 'en' || detected === 'id') {
      locale = detected;
    } else if (country) {
      locale = country === 'ID' ? 'id' : 'en';
    } else {
      const acceptLang = (reqHeaders.get('accept-language') || '').toLowerCase();
      locale = acceptLang.includes('id') ? 'id' : 'en';
    }

    return { locale, t: DICTIONARIES[locale] || DICTIONARIES.id };
  } catch {
    return { locale: 'id', t: DICTIONARIES.id };
  }
}

