'use client';

import { Zap, Shield, Activity } from 'lucide-react';

export default function AiRobotVisual() {
  return (
    <div className="relative w-full max-w-md mx-auto aspect-square flex items-center justify-center select-none">
      {/* Outer ambient glow rings - GPU accelerated & pointer-events disabled */}
      <div className="absolute inset-0 rounded-full bg-gradient-to-tr from-neutral-200/50 via-neutral-100/30 to-transparent blur-3xl pointer-events-none" />
      <div className="absolute w-72 h-72 rounded-full border border-neutral-200/80 animate-[spin_40s_linear_infinite] pointer-events-none transform-gpu translate-z-0 will-change-transform" />
      <div className="absolute w-84 h-84 rounded-full border border-dashed border-neutral-200/80 animate-[spin_50s_linear_infinite_reverse] pointer-events-none transform-gpu translate-z-0 will-change-transform" />

      {/* Futuristic Cybernetic Robot Avatar Container */}
      <div className="relative z-10 w-64 h-64 md:w-72 md:h-72 rounded-3xl bg-white/95 border border-neutral-200/90 p-6 flex flex-col items-center justify-center shadow-[0_20px_50px_rgba(0,0,0,0.06)] group hover:border-neutral-300 hover:shadow-xl transition-all duration-300 transform-gpu backdrop-blur-md">
        {/* Holographic Robot Head SVG */}
        <div className="relative w-28 h-28 mb-4 flex items-center justify-center">
          {/* Cybernetic Aura */}
          <div className="absolute inset-0 bg-neutral-200/50 rounded-full blur-xl animate-pulse pointer-events-none" />

          {/* High-Tech Robot Helmet & Visor SVG */}
          <svg
            className="w-24 h-24 text-neutral-900 relative z-10 drop-shadow-[0_4px_12px_rgba(0,0,0,0.08)] transform-gpu"
            viewBox="0 0 100 100"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
          >
            {/* Outer Helmet Armor */}
            <path
              d="M20 38C20 22.5 33.4 10 50 10C66.6 10 80 22.5 80 38V60C80 73.8 68.8 85 55 85H45C31.2 85 20 73.8 20 60V38Z"
              fill="#ffffff"
              stroke="#09090b"
              strokeWidth="2"
            />
            {/* Side Ear Antennas / Audio Sensors */}
            <rect
              x="12"
              y="42"
              width="6"
              height="18"
              rx="3"
              fill="#f4f4f5"
              stroke="#09090b"
              strokeWidth="1.5"
            />
            <rect
              x="82"
              y="42"
              width="6"
              height="18"
              rx="3"
              fill="#f4f4f5"
              stroke="#09090b"
              strokeWidth="1.5"
            />
            <circle cx="15" cy="51" r="1.5" fill="#09090b" />
            <circle cx="85" cy="51" r="1.5" fill="#09090b" />

            {/* Glowing Visor (Eye Screen) */}
            <rect
              x="27"
              y="36"
              width="46"
              height="18"
              rx="9"
              fill="#09090b"
              stroke="#09090b"
              strokeWidth="1.5"
            />
            {/* Dual Cybernetic Optic Eyes */}
            <circle cx="41" cy="45" r="4" fill="white" className="animate-pulse" />
            <circle cx="59" cy="45" r="4" fill="white" className="animate-pulse" />
            <circle cx="41" cy="45" r="1.5" fill="#09090b" />
            <circle cx="59" cy="45" r="1.5" fill="#09090b" />

            {/* Forehead Neural Core */}
            <path d="M46 22H54L52 28H48L46 22Z" fill="#09090b" opacity="0.8" />
            <line x1="50" y1="12" x2="50" y2="20" stroke="#09090b" strokeWidth="1.5" />

            {/* Lower Chin / Vocal Grid */}
            <line x1="38" y1="68" x2="62" y2="68" stroke="#09090b" strokeWidth="1.5" opacity="0.3" />
            <line x1="42" y1="73" x2="58" y2="73" stroke="#09090b" strokeWidth="1.5" opacity="0.3" />
            <line x1="46" y1="78" x2="54" y2="78" stroke="#09090b" strokeWidth="1.5" opacity="0.3" />
          </svg>
        </div>

        {/* Robot Identity & Live Status */}
        <div className="text-center">
          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-50 border border-emerald-200 text-[11px] font-semibold text-emerald-800 mb-1.5 shadow-sm">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-ping" />
            <span>AI AGENT ONLINE</span>
          </div>
          <div className="text-xs font-bold text-neutral-900 tracking-wide">Autonomous Coding Engine</div>
          <div className="text-[10px] text-neutral-500 font-mono mt-0.5">
            Ready: DeepSeek V4 · Qwen · Kimi
          </div>
        </div>

        {/* Floating Telemetry Chips Around Robot */}
        <div className="absolute -top-4 -left-4 px-3 py-1.5 rounded-xl bg-white/95 border border-neutral-200/90 backdrop-blur-md text-[11px] font-mono text-neutral-800 shadow-[0_8px_30px_rgb(0,0,0,0.08)] flex items-center gap-1.5 animate-bounce [animation-duration:4s] transform-gpu">
          <Zap className="h-3 w-3 text-amber-500" />
          <span>180 RPM Limit</span>
        </div>

        <div className="absolute -bottom-3 -right-4 px-3 py-1.5 rounded-xl bg-white/95 border border-neutral-200/90 backdrop-blur-md text-[11px] font-mono text-neutral-800 shadow-[0_8px_30px_rgb(0,0,0,0.08)] flex items-center gap-1.5 animate-bounce [animation-duration:5s] transform-gpu">
          <Shield className="h-3 w-3 text-emerald-600" />
          <span>Key: mp-live-active</span>
        </div>

        <div className="absolute -top-3 -right-5 px-3 py-1.5 rounded-xl bg-white/95 border border-neutral-200/90 backdrop-blur-md text-[11px] font-mono text-neutral-800 shadow-[0_8px_30px_rgb(0,0,0,0.08)] flex items-center gap-1.5 transform-gpu">
          <Activity className="h-3 w-3 text-blue-600" />
          <span>99.9% Uptime</span>
        </div>
      </div>
    </div>
  );
}
