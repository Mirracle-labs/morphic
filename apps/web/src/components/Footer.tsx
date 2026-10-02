import Link from 'next/link';

export default function Footer() {
  const footerLinks = [
    { label: 'Katalog Model', href: '#models' },
    { label: 'Integrasi IDE', href: '#integration' },
    { label: 'Keunggulan', href: '#keunggulan' },
    { label: 'FAQ', href: '#faq' },
    { label: 'Dashboard', href: '/dashboard' },
  ];

  return (
    <footer className="relative z-10 py-12 px-4 sm:px-6 border-t border-neutral-200/80 bg-white text-neutral-900">
      <div className="max-w-7xl mx-auto flex flex-col md:flex-row items-center justify-between gap-6">
        <div className="flex flex-col md:flex-row items-center gap-3 text-center md:text-left">
          <Link href="/" className="font-heading font-extrabold text-lg tracking-tight text-neutral-950">
            Morphic
          </Link>
          <span className="text-neutral-300 hidden md:inline">|</span>
          <p className="text-neutral-500 font-body font-normal text-xs">
            &copy; 2026 Morphic. Reseller API Key AI Terpercaya untuk Developer Indonesia.
          </p>
        </div>

        <div className="flex items-center flex-wrap justify-center gap-6">
          {footerLinks.map((link) => (
            <a
              key={link.label}
              href={link.href}
              className="text-neutral-500 hover:text-neutral-950 font-body font-normal text-xs transition-colors"
            >
              {link.label}
            </a>
          ))}
        </div>
      </div>
    </footer>
  );
}
