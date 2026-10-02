'use client';

import { useEffect, useRef } from 'react';
import Link from 'next/link';
import { ArrowUpRight, ShieldCheck } from 'lucide-react';
import Hls from 'hls.js';

interface HeroOpeningProps {
  isLoggedIn?: boolean;
}

export default function HeroOpening({ isLoggedIn = false }: HeroOpeningProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const video = videoRef.current;
    const container = containerRef.current;
    if (!video) return;

    const src = 'https://stream.mux.com/8wrHPCX2dC3msyYU9ObwqNdm00u3ViXvOSHUMRYSEe5Q.m3u8';
    let hls: Hls | null = null;

    if (Hls.isSupported()) {
      hls = new Hls({
        enableWorker: true,
        maxBufferLength: 8,
        maxMaxBufferLength: 15,
        maxBufferSize: 5 * 1024 * 1024,
        lowLatencyMode: false,
        backBufferLength: 5,
      });
      hls.loadSource(src);
      hls.attachMedia(video);
    } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = src;
    }

    let observer: IntersectionObserver | null = null;
    if (typeof IntersectionObserver !== 'undefined' && container) {
      observer = new IntersectionObserver(
        ([entry]) => {
          if (!video) return;
          if (entry.isIntersecting) {
            video.play().catch(() => {});
          } else {
            video.pause();
          }
        },
        { threshold: 0.1 },
      );
      observer.observe(container);
    }

    return () => {
      observer?.disconnect();
      if (hls) {
        hls.destroy();
      }
    };
  }, []);

  return (
    <section
      ref={containerRef}
      className="relative w-full px-4 sm:px-6 text-center overflow-hidden flex flex-col items-center justify-center will-change-transform"
      style={{ minHeight: '100svh' }}
    >
      {/* Background HLS Video with inverted hue for clean developer aesthetic */}
      <video
        ref={videoRef}
        autoPlay
        loop
        muted
        playsInline
        preload="metadata"
        className="absolute inset-0 w-full h-full object-cover z-0 opacity-70 pointer-events-none transform-gpu translate-z-0 [filter:invert(1)_hue-rotate(180deg)]"
      />

      {/* Top & Bottom gradient fades */}
      <div className="absolute top-0 left-0 right-0 z-[1] pointer-events-none h-40 bg-gradient-to-b from-[#fafafa] to-transparent" />
      <div className="absolute bottom-0 left-0 right-0 z-[1] pointer-events-none h-32 bg-gradient-to-t from-[#fafafa] to-transparent" />

      {/* Content — padded top to clear fixed navbar (~80px) */}
      <div className="relative z-10 max-w-4xl mx-auto w-full flex flex-col items-center justify-center transform-gpu pt-24 pb-16 sm:pt-28 sm:pb-20">
        {/* Clean Pill Tag */}
        <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-white/90 border border-neutral-200/90 text-neutral-800 text-xs font-semibold mb-6 shadow-sm">
          <ShieldCheck className="h-4 w-4 text-emerald-600" />
          <span>Gateway API Key AI Resmi &amp; Terpercaya</span>
        </div>

        <h1 className="text-4xl sm:text-5xl md:text-6xl lg:text-7xl font-heading font-extrabold text-neutral-950 tracking-tight leading-[1.1] sm:leading-[1.05] max-w-3xl mx-auto mb-6">
          API Key AI Termurah untuk Cursor, Cline &amp; Windsurf
        </h1>

        <p className="text-neutral-600 font-body font-normal text-sm sm:text-base md:text-lg max-w-2xl mx-auto mb-10 leading-relaxed px-2">
          Akses DeepSeek V4, R1, Qwen 2.5 Max, &amp; Kimi melalui satu endpoint OpenAI-compatible.
          Hemat hingga 70% biaya coding token dengan pembayaran QRIS lokal instan tanpa kartu kredit valas.
        </p>

        <div className="flex flex-col sm:flex-row items-center justify-center gap-3.5 sm:gap-4 w-full sm:w-auto">
          <Link
            href={isLoggedIn ? '/dashboard/keys' : '/login'}
            className="w-full sm:w-auto justify-center bg-neutral-950 text-white rounded-full px-7 py-3.5 text-xs sm:text-sm font-semibold flex items-center gap-2 hover:bg-neutral-800 transition-all font-body cursor-pointer shadow-md hover:shadow-lg"
          >
            <span>{isLoggedIn ? 'Buka Panel API Keys' : 'Dapatkan API Key Sekarang'}</span>
            <ArrowUpRight className="h-4 w-4" />
          </Link>
          <a
            href="#models"
            className="w-full sm:w-auto justify-center bg-white border border-neutral-200/90 text-neutral-900 rounded-full px-7 py-3.5 text-xs sm:text-sm font-semibold flex items-center gap-2 hover:bg-neutral-50 hover:border-neutral-300 transition-all font-body cursor-pointer shadow-sm"
          >
            <span>Eksplorasi Model AI</span>
            <ArrowUpRight className="h-4 w-4" />
          </a>
        </div>
      </div>
    </section>
  );
}
