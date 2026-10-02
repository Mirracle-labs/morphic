'use client';

import Image from 'next/image';
import { useEffect, useRef } from 'react';

interface ParallaxBackgroundProps {
  sectionRef: React.RefObject<HTMLElement | null>;
}

/**
 * Atmospheric background artwork with subtle depth parallax,
 * free of AI-slop blueprint grids, blurred orbs, and geometric debris.
 */
export default function ParallaxBackground({ sectionRef }: ParallaxBackgroundProps) {
  const bgLayerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (
      typeof window === 'undefined' ||
      (typeof window.matchMedia === 'function' &&
        window.matchMedia('(prefers-reduced-motion: reduce)').matches)
    ) {
      return;
    }

    const section = sectionRef.current;
    if (!section) return;

    let mouseTargetX = 0;
    let mouseTargetY = 0;
    let mouseCurrentX = 0;
    let mouseCurrentY = 0;

    let scrollTarget = 0;
    let scrollCurrent = 0;

    let rafId = 0;
    let isRunning = true;
    let isVisible = true;
    // The loop only runs while something is easing; it parks itself once settled and is
    // woken by mouse/scroll input, so an idle page costs zero frames.
    let looping = false;
    const wake = () => {
      if (!looping && isRunning && isVisible) {
        looping = true;
        rafId = requestAnimationFrame(loop);
      }
    };

    let observer: IntersectionObserver | null = null;
    if (typeof IntersectionObserver !== 'undefined') {
      observer = new IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            isVisible = entry.isIntersecting;
          }
          wake();
        },
        { threshold: 0 }
      );
      observer.observe(section);
    }

    const onVisibilityChange = () => {
      isVisible = !document.hidden;
      wake();
    };
    document.addEventListener('visibilitychange', onVisibilityChange);

    const handleMouseMove = (e: MouseEvent) => {
      if (!isVisible) return;
      const { innerWidth, innerHeight } = window;
      mouseTargetX = (e.clientX / innerWidth - 0.5) * 2;
      mouseTargetY = (e.clientY / innerHeight - 0.5) * 2;
      wake();
    };

    const handleScroll = () => {
      const rect = section.getBoundingClientRect();
      if (rect.bottom < -100 || rect.top > window.innerHeight + 100) {
        isVisible = false;
        return;
      }
      isVisible = true;
      scrollTarget = Math.max(0, -rect.top);
      wake();
    };

    function loop() {
      if (!isRunning || !isVisible) {
        looping = false;
        return;
      }

      {
        mouseCurrentX += (mouseTargetX - mouseCurrentX) * 0.05;
        mouseCurrentY += (mouseTargetY - mouseCurrentY) * 0.05;
        scrollCurrent += (scrollTarget - scrollCurrent) * 0.08;

        if (bgLayerRef.current) {
          const x = mouseCurrentX * -8;
          const y = mouseCurrentY * -6 + scrollCurrent * 0.12;
          bgLayerRef.current.style.transform = `translate3d(${x.toFixed(2)}px, ${y.toFixed(2)}px, 0)`;
        }
      }

      const settled =
        Math.abs(mouseTargetX - mouseCurrentX) < 0.001 &&
        Math.abs(mouseTargetY - mouseCurrentY) < 0.001 &&
        Math.abs(scrollTarget - scrollCurrent) < 0.1;
      if (settled) {
        looping = false;
        return;
      }
      rafId = requestAnimationFrame(loop);
    }

    window.addEventListener('mousemove', handleMouseMove, { passive: true });
    window.addEventListener('scroll', handleScroll, { passive: true });
    window.addEventListener('resize', handleScroll, { passive: true });

    handleScroll();

    return () => {
      isRunning = false;
      cancelAnimationFrame(rafId);
      if (observer) observer.disconnect();
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('scroll', handleScroll);
      window.removeEventListener('resize', handleScroll);
    };
  }, [sectionRef]);

  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none select-none" aria-hidden="true">
      {/* Clean Atmospheric Artwork with Soft Ambient Light */}
      <div
        ref={bgLayerRef}
        className="absolute inset-x-0 -top-[8%] h-[125%] will-change-transform"
        style={{
          WebkitMaskImage:
            'radial-gradient(120% 90% at 50% 25%, rgba(0,0,0,1) 40%, transparent 100%)',
          maskImage:
            'radial-gradient(120% 90% at 50% 25%, rgba(0,0,0,1) 40%, transparent 100%)',
        }}
      >
        <div className="absolute inset-0">
          <Image
            src="/images/bg-continuous.jpg"
            alt=""
            fill
            priority
            sizes="100vw"
            className="object-cover object-center opacity-25 contrast-[1.02] grayscale-[0.3]"
          />
          <div className="absolute inset-0 bg-[#fafafa]/60 mix-blend-screen" />
        </div>

        {/* Soft, calm monochrome ambient illumination */}
        <div
          className="absolute inset-0"
          style={{
            background:
              'radial-gradient(85% 55% at 50% 0%, rgba(240,242,246,0.6) 0%, transparent 70%)',
          }}
        />
      </div>

      {/* Seamless blend into neutral page surface */}
      <div className="absolute bottom-0 left-0 right-0 h-44 bg-gradient-to-t from-[#fafafa] via-[#fafafa]/80 to-transparent" />
    </div>
  );
}
