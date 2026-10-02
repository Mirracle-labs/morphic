'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ArrowUpRight, Menu, X, LayoutDashboard, LogIn } from 'lucide-react';

interface NavbarProps {
  session?: any;
}

export default function Navbar({ session }: NavbarProps) {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  return (
    <header className="fixed top-5 left-1/2 -translate-x-1/2 z-50 w-[94%] max-w-5xl transform-gpu translate-z-0">
      <div className="bg-white/95 backdrop-blur-md text-neutral-900 border border-neutral-200/80 rounded-full px-4 md:px-6 py-2.5 shadow-[0_8px_30px_rgba(0,0,0,0.06)] flex items-center justify-between transition-all duration-200">
        {/* Left: Brand Logo */}
        <Link href="/" className="flex items-center gap-2.5 group">
          <div className="w-8 h-8 rounded-full bg-neutral-950 flex items-center justify-center text-white transition-transform group-hover:scale-105 transform-gpu shadow-sm">
            <svg
              className="w-4 h-4 text-white"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <circle cx="8" cy="12" r="5" />
              <path d="M12 12h5a4 4 0 0 1 4 4v0a4 4 0 0 1-4 4h-5" />
              <path d="M12 7v5" />
            </svg>
          </div>
          <span className="font-heading font-extrabold text-lg tracking-tight text-neutral-950">
            Morphic
          </span>
        </Link>

        {/* Center: Clean Functional Navigation Links */}
        <nav className="hidden md:flex items-center gap-7 text-xs font-semibold text-neutral-600">
          <a
            href="#models"
            className="hover:text-neutral-950 transition-colors"
          >
            Katalog Model
          </a>
          <a
            href="#integration"
            className="hover:text-neutral-950 transition-colors"
          >
            Integrasi IDE
          </a>
          <a
            href="#keunggulan"
            className="hover:text-neutral-950 transition-colors"
          >
            Keunggulan
          </a>
          <a
            href="#faq"
            className="hover:text-neutral-950 transition-colors"
          >
            FAQ
          </a>
        </nav>

        {/* Right: Functional Action Buttons */}
        <div className="hidden sm:flex items-center gap-2.5">
          {session ? (
            <Link
              href="/dashboard"
              className="bg-neutral-950 text-white rounded-full px-5 py-2 text-xs font-semibold flex items-center gap-1.5 hover:bg-neutral-800 transition-all shadow-sm"
            >
              <LayoutDashboard className="h-3.5 w-3.5" />
              <span>Dashboard</span>
            </Link>
          ) : (
            <>
              <Link
                href="/login"
                className="border border-neutral-300 text-neutral-800 rounded-full px-4 py-2 text-xs font-semibold hover:bg-neutral-100 hover:border-neutral-400 transition-all flex items-center gap-1.5"
              >
                <LogIn className="h-3.5 w-3.5" />
                <span>Masuk</span>
              </Link>
              <a
                href="#models"
                className="bg-neutral-950 text-white rounded-full px-5 py-2 text-xs font-semibold flex items-center gap-1 hover:bg-neutral-800 transition-all shadow-sm"
              >
                <span>Mulai</span>
                <ArrowUpRight className="h-3.5 w-3.5" />
              </a>
            </>
          )}
        </div>

        {/* Mobile Menu Toggle Button */}
        <div className="md:hidden flex items-center gap-2">
          {session ? (
            <Link
              href="/dashboard"
              className="bg-neutral-950 text-white rounded-full px-3.5 py-1.5 text-xs font-semibold"
            >
              Dashboard
            </Link>
          ) : (
            <Link
              href="/login"
              className="bg-neutral-950 text-white rounded-full px-3.5 py-1.5 text-xs font-semibold"
            >
              Masuk
            </Link>
          )}
          <button
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            className="p-1.5 text-neutral-800 hover:text-neutral-950 rounded-lg"
            aria-label="Toggle Navigation Menu"
          >
            {mobileMenuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </div>
      </div>

      {/* Mobile Slideout Menu */}
      {mobileMenuOpen && (
        <div className="md:hidden mt-2 bg-white/95 backdrop-blur-md border border-neutral-200/80 rounded-3xl p-4 shadow-2xl text-neutral-800 flex flex-col gap-2 animate-in fade-in duration-150 transform-gpu">
          <a
            href="#models"
            onClick={() => setMobileMenuOpen(false)}
            className="px-3 py-2 rounded-xl hover:bg-neutral-100 font-semibold text-xs text-neutral-800"
          >
            Katalog Model
          </a>
          <a
            href="#integration"
            onClick={() => setMobileMenuOpen(false)}
            className="px-3 py-2 rounded-xl hover:bg-neutral-100 font-semibold text-xs text-neutral-800"
          >
            Integrasi IDE
          </a>
          <a
            href="#keunggulan"
            onClick={() => setMobileMenuOpen(false)}
            className="px-3 py-2 rounded-xl hover:bg-neutral-100 font-semibold text-xs text-neutral-800"
          >
            Keunggulan
          </a>
          <a
            href="#faq"
            onClick={() => setMobileMenuOpen(false)}
            className="px-3 py-2 rounded-xl hover:bg-neutral-100 font-semibold text-xs text-neutral-800"
          >
            FAQ
          </a>
          <div className="pt-2 border-t border-neutral-100 flex flex-col gap-2">
            {session ? (
              <Link
                href="/dashboard"
                onClick={() => setMobileMenuOpen(false)}
                className="w-full text-center bg-neutral-950 text-white rounded-full py-2.5 text-xs font-bold"
              >
                Buka Dashboard
              </Link>
            ) : (
              <Link
                href="/login"
                onClick={() => setMobileMenuOpen(false)}
                className="w-full text-center bg-neutral-950 text-white rounded-full py-2.5 text-xs font-bold"
              >
                Masuk / Daftar
              </Link>
            )}
          </div>
        </div>
      )}
    </header>
  );
}
