import React from 'react';
import { XYPHER_COIN_ICON_PATH } from '../lib/metamask.ts';
import type { SupportedCoinSymbol } from '../lib/supportedCoins.ts';

interface CoinLogoProps {
  symbol: SupportedCoinSymbol;
  size?: number;
  className?: string;
}

/**
 * Renders crisp, official-grade brand logos for all 9 supported exchange coins
 * without external CDN dependencies that can break in sandboxed environments.
 */
export const CoinLogo: React.FC<CoinLogoProps> = ({ symbol, size = 28, className = '' }) => {
  if (symbol === 'XYPH') {
    return (
      <img
        src={XYPHER_COIN_ICON_PATH}
        alt="Xypher (XYPH)"
        width={size}
        height={size}
        referrerPolicy="no-referrer"
        style={{ width: size, height: size }}
        className={`rounded-full object-cover ring-1 ring-amber-400/30 shrink-0 ${className}`}
      />
    );
  }

  switch (symbol) {
    case 'ETH':
      return (
        <svg
          width={size}
          height={size}
          viewBox="0 0 32 32"
          fill="none"
          aria-label="Ethereum (ETH)"
          className={`shrink-0 ${className}`}
        >
          <circle cx="16" cy="16" r="16" fill="#627EEA" />
          <path d="M16.498 4v8.87l7.497 3.35L16.498 4z" fill="#FFFFFF" fillOpacity="0.65" />
          <path d="M16.498 4L9 16.22l7.498-3.35V4z" fill="#FFFFFF" />
          <path d="M16.498 21.968v6.027L24 17.616l-7.502 4.352z" fill="#FFFFFF" fillOpacity="0.65" />
          <path d="M16.498 27.995v-6.028L9 17.616l7.498 10.379z" fill="#FFFFFF" />
          <path d="M16.498 20.573l7.497-4.353-7.497-3.348v7.701z" fill="#FFFFFF" fillOpacity="0.25" />
          <path d="M9 16.22l7.498 4.353v-7.701L9 16.22z" fill="#FFFFFF" fillOpacity="0.65" />
        </svg>
      );

    case 'SOL':
      return (
        <svg
          width={size}
          height={size}
          viewBox="0 0 32 32"
          fill="none"
          aria-label="Solana (SOL)"
          className={`shrink-0 ${className}`}
        >
          <defs>
            <linearGradient id="sol-grad-mark" x1="6" y1="26" x2="26" y2="6" gradientUnits="userSpaceOnUse">
              <stop offset="0%" stopColor="#9945FF" />
              <stop offset="50%" stopColor="#19FB9B" />
              <stop offset="100%" stopColor="#00D1FF" />
            </linearGradient>
          </defs>
          <circle cx="16" cy="16" r="16" fill="#0B0F1A" />
          <circle cx="16" cy="16" r="15.25" stroke="#253047" strokeWidth="1.5" />
          <path
            d="M9.6 20.45a.7.7 0 0 1 .49-.2h13.55c.31 0 .47.37.25.59l-2.49 2.51a.7.7 0 0 1-.49.2H7.36c-.31 0-.47-.37-.25-.59l2.49-2.51z"
            fill="url(#sol-grad-mark)"
          />
          <path
            d="M9.6 8.65a.72.72 0 0 1 .49-.2h13.55c.31 0 .47.37.25.59l-2.49 2.51a.7.7 0 0 1-.49.2H7.36c-.31 0-.47-.37-.25-.59l2.49-2.51z"
            fill="url(#sol-grad-mark)"
          />
          <path
            d="M21.4 14.52a.7.7 0 0 0-.49-.2H7.36c-.31 0-.47.37-.25.59l2.49 2.51c.13.13.31.2.49.2h13.55c.31 0 .47-.37.25-.59l-2.49-2.51z"
            fill="url(#sol-grad-mark)"
          />
        </svg>
      );

    case 'BTC':
      return (
        <svg
          width={size}
          height={size}
          viewBox="0 0 32 32"
          fill="none"
          aria-label="Bitcoin (BTC)"
          className={`shrink-0 ${className}`}
        >
          <circle cx="16" cy="16" r="16" fill="#F7931A" />
          <path
            d="M22.5 14.12c.31-2.08-1.27-3.2-3.44-3.95l.7-2.82-1.72-.43-.68 2.75c-.45-.11-.92-.22-1.38-.32l.69-2.77-1.72-.43-.7 2.82c-.37-.09-.74-.17-1.1-.26l-2.37-.59-.46 1.84s1.27.29 1.25.31c.7.17.82.63.8 1l-.8 3.22c.05.01.11.03.18.06l-.18-.05-1.12 4.51c-.09.21-.3.53-.79.41.02.02-1.25-.31-1.25-.31l-.85 1.97 2.24.56c.42.1.82.21 1.22.31l-.71 2.85 1.72.43.7-2.82c.47.13.92.24 1.37.35l-.7 2.81 1.72.43.71-2.85c2.93.55 5.13.33 6.06-2.32.75-2.13-.04-3.36-1.58-4.16 1.12-.26 1.97-1 2.2-2.52zm-3.94 5.53c-.53 2.13-4.12.98-5.29.69l.94-3.78c1.17.29 4.9.87 4.35 3.09zm.53-5.56c-.49 1.94-3.48.95-4.45.71l.85-3.42c.97.24 4.1.69 3.6 2.71z"
            fill="#FFFFFF"
          />
        </svg>
      );

    case 'TRX':
      return (
        <svg
          width={size}
          height={size}
          viewBox="0 0 32 32"
          fill="none"
          aria-label="Tron (TRX)"
          className={`shrink-0 ${className}`}
        >
          <circle cx="16" cy="16" r="16" fill="#EF0027" />
          <path
            d="M8.5 9.1l15.4 2.75-8.95 12.6L8.5 9.1zm2.35 1.75l4.3 9.75 1.2-6.7-5.5-3.05zm6.6 3.55l-1.1 6.05 5.65-7.95-4.55 1.9zm-.4-1.35l4.25-1.78-8.35-1.47 4.1 3.25z"
            fill="#FFFFFF"
          />
        </svg>
      );

    case 'BNB':
      return (
        <svg
          width={size}
          height={size}
          viewBox="0 0 32 32"
          fill="none"
          aria-label="BNB"
          className={`shrink-0 ${className}`}
        >
          <circle cx="16" cy="16" r="16" fill="#F3BA2F" />
          <path
            d="M12.116 14.404L16 10.52l3.886 3.886 2.26-2.26L16 6l-6.144 6.144 2.26 2.26zM6 16l2.26-2.26L10.52 16l-2.26 2.26L6 16zm6.116 1.596L16 21.48l3.886-3.886 2.26 2.259L16 26l-6.144-6.144 2.26-2.26zM21.48 16l2.26-2.26L26 16l-2.26 2.26L21.48 16zm-3.188-.002h.002V16L16 18.294l-2.291-2.29-.004-.004.004-.003.401-.402.195-.195L16 13.706l2.293 2.293z"
            fill="#FFFFFF"
          />
        </svg>
      );

    case 'POL':
      return (
        <svg
          width={size}
          height={size}
          viewBox="0 0 32 32"
          fill="none"
          aria-label="Polygon (POL)"
          className={`shrink-0 ${className}`}
        >
          <circle cx="16" cy="16" r="16" fill="#8247E5" />
          <path
            d="M21.2 12.65a1.55 1.55 0 0 0-1.52 0l-3.55 2.05-2.4 1.38-3.54 2.05a1.55 1.55 0 0 1-1.52 0l-2.76-1.6a1.55 1.55 0 0 1-.76-1.33v-3.17c0-.54.29-1.05.76-1.32l2.76-1.6a1.55 1.55 0 0 1 1.52 0l2.76 1.6c.47.27.76.78.76 1.32v2.05l2.4-1.39v-2.06c0-.54-.29-1.05-.76-1.32l-5.15-2.98a1.55 1.55 0 0 0-1.52 0L6.76 9.3A1.55 1.55 0 0 0 6 10.63v5.96c0 .54.29 1.05.76 1.32l5.15 2.98a1.55 1.55 0 0 0 1.52 0l3.54-2.05 2.4-1.39 3.55-2.05a1.55 1.55 0 0 1 1.52 0l2.76 1.6c.47.27.76.78.76 1.32v3.17c0 .54-.29 1.05-.76 1.32l-2.76 1.6a1.55 1.55 0 0 1-1.52 0l-2.76-1.6a1.55 1.55 0 0 1-.76-1.32v-2.05l-2.4 1.39v2.05c0 .54.29 1.05.76 1.32l5.15 2.98a1.55 1.55 0 0 0 1.52 0l5.15-2.98c.47-.27.76-.78.76-1.32v-5.96c0-.54-.29-1.05-.76-1.32l-5.15-2.98z"
            fill="#FFFFFF"
            transform="scale(0.86) translate(2.6, 2.2)"
          />
        </svg>
      );

    case 'MON':
      return (
        <svg
          width={size}
          height={size}
          viewBox="0 0 32 32"
          fill="none"
          aria-label="Monad (MON)"
          className={`shrink-0 ${className}`}
        >
          <circle cx="16" cy="16" r="16" fill="#836EF9" />
          <path
            d="M16 6.8c2.68 0 9.2 6.52 9.2 9.2 0 2.68-6.52 9.2-9.2 9.2-2.68 0-9.2-6.52-9.2-9.2 0-2.68 6.52-9.2 9.2-9.2zm0 3.7c-1.5 0-5.5 4-5.5 5.5 0 1.5 4 5.5 5.5 5.5 1.5 0 5.5-4 5.5-5.5 0-1.5-4-5.5-5.5-5.5z"
            fill="#FFFFFF"
          />
        </svg>
      );

    case 'XLM':
      return (
        <svg
          width={size}
          height={size}
          viewBox="0 0 32 32"
          fill="none"
          aria-label="Stellar (XLM)"
          className={`shrink-0 ${className}`}
        >
          <circle cx="16" cy="16" r="16" fill="#0F172A" />
          <circle cx="16" cy="16" r="15.25" stroke="#38BDF8" strokeOpacity="0.45" strokeWidth="1.5" />
          <path
            d="M23.7 10.1l-1.9.98-11.2 5.75a5.5 5.5 0 0 1 8.95-4.9l1.36-.7a7.1 7.1 0 0 0-11.86 5.26c0 .44.04.88.12 1.3l-1.62.83.75 1.47 1.7-.87 13.7-7.03-.75-1.46-.75-.63h1.5z"
            fill="#FFFFFF"
          />
          <path
            d="M24.45 12.96l-1.7.87-13.7 7.03.75 1.47 1.9-.98 11.2-5.75a5.5 5.5 0 0 1-8.95 4.9l-1.36.7a7.1 7.1 0 0 0 11.86-5.26c0-.44-.04-.88-.12-1.3l1.62-.83-.75-1.47-.75.62z"
            fill="#FFFFFF"
          />
        </svg>
      );
  }
};
