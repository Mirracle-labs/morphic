'use client';

import Image from 'next/image';
import { Cpu } from 'lucide-react';

interface LogoProps {
  className?: string;
}

// Unmodified LobeHub SVGs; sources and MIT license are in public/logos.
export function ClaudeLogo({ className = 'w-4 h-4' }: LogoProps) {
  return <Image src="/logos/claude-color.svg" alt="Claude" width={24} height={24} unoptimized className={className} />;
}

export function OpenAILogo({ className = 'w-4 h-4' }: LogoProps) {
  return <Image src="/logos/openai.svg" alt="OpenAI" width={24} height={24} unoptimized className={className} />;
}

export function DeepSeekLogo({ className = 'w-4 h-4' }: LogoProps) {
  return <Image src="/logos/deepseek-color.svg" alt="DeepSeek" width={24} height={24} unoptimized className={className} />;
}

export function QwenLogo({ className = 'w-4 h-4' }: LogoProps) {
  return <Image src="/logos/qwen-color.svg" alt="Qwen" width={24} height={24} unoptimized className={className} />;
}

export function KimiLogo({ className = 'w-4 h-4' }: LogoProps) {
  return <Image src="/logos/kimi-color.svg" alt="Kimi" width={24} height={24} unoptimized className={className} />;
}

export function ZhipuLogo({ className = 'w-4 h-4' }: LogoProps) {
  return <Image src="/logos/zhipu-color.svg" alt="Zhipu" width={24} height={24} unoptimized className={className} />;
}

export function YiLogo({ className = 'w-4 h-4' }: LogoProps) {
  return <Image src="/logos/yi.svg" alt="Yi" width={24} height={24} unoptimized className={className} />;
}

export function MiniMaxLogo({ className = 'w-4 h-4' }: LogoProps) {
  return <Image src="/logos/minimax-color.svg" alt="MiniMax" width={24} height={24} unoptimized className={className} />;
}

export function GrokLogo({ className = 'w-4 h-4' }: LogoProps) {
  return <Image src="/logos/grok.svg" alt="Grok" width={24} height={24} unoptimized className={className} />;
}

export function ModelProviderLogo({ provider = '', className = 'w-4 h-4' }: { provider?: string; className?: string }) {
  const p = (provider || '').toLowerCase();
  if (p.includes('claude') || p.includes('anthropic')) {
    return <ClaudeLogo className={className} />;
  }
  if (p.includes('openai') || p.includes('gpt')) {
    return <OpenAILogo className={className} />;
  }
  if (p.includes('deepseek')) {
    return <DeepSeekLogo className={className} />;
  }
  if (p.includes('qwen') || p.includes('alibaba')) {
    return <QwenLogo className={className} />;
  }
  if (p.includes('kimi') || p.includes('moonshot')) {
    return <KimiLogo className={className} />;
  }
  if (p.includes('grok') || p.includes('xai')) {
    return <GrokLogo className={className} />;
  }
  if (p.includes('zhipu') || p.includes('glm')) {
    return <ZhipuLogo className={className} />;
  }
  if (p.includes('minimax')) {
    return <MiniMaxLogo className={className} />;
  }
  if (p.includes('01.ai') || /\byi\b/.test(p)) {
    return <YiLogo className={className} />;
  }
  return <Cpu className={`${className} text-neutral-500`} role="img" aria-label="Unknown provider" />;
}

/** Logo of an upstream gateway provider (from providerBrand), generic chip when unknown. */
export function GatewayProviderLogo({ brand, className = 'w-4 h-4' }: { brand: { label: string; logo: string | null }; className?: string }) {
  return brand.logo ? (
    <Image src={brand.logo} alt="" width={24} height={24} unoptimized className={className} />
  ) : (
    <Cpu className={`${className} text-neutral-600`} aria-hidden="true" />
  );
}
