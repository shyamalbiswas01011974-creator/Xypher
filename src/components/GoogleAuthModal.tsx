import React, { useState } from 'react';
import type { User } from 'firebase/auth';
import { Check, Copy, LogOut, ShieldCheck, UserCheck, X } from 'lucide-react';
import type { LinkedWalletDoc } from '../lib/firebase.ts';
import { XYPHER_COIN_ICON_PATH } from '../lib/metamask.ts';
import type { AddressInfo } from '../lib/types.ts';
import { SYMBOL, formatXYPH, truncateHash } from '../lib/xypherCrypto.ts';

interface GoogleAuthModalProps {
  user: User | null;
  linkedWallets: LinkedWalletDoc[];
  balances?: Record<string, AddressInfo>;
  authBusy: boolean;
  authError: string | null;
  initialMode?: 'signin' | 'signup';
  onGoogleAuth: () => Promise<void>;
  onSignOut: () => Promise<void>;
  onClose: () => void;
}

const GoogleLogoSvg: React.FC<{ className?: string }> = ({ className = 'w-4 h-4' }) => (
  <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
    <path
      fill="#4285F4"
      d="M23.49 12.27c0-.79-.07-1.54-.2-2.27H12v4.51h6.45a5.52 5.52 0 0 1-2.39 3.62v3h3.86c2.26-2.08 3.57-5.15 3.57-8.86z"
    />
    <path
      fill="#34A853"
      d="M12 24c3.24 0 5.95-1.07 7.93-2.9l-3.86-3c-1.07.72-2.44 1.14-4.07 1.14-3.13 0-5.78-2.11-6.73-4.96H1.28v3.09A12 12 0 0 0 12 24z"
    />
    <path
      fill="#FBBC05"
      d="M5.27 14.28A7.22 7.22 0 0 1 4.89 12c0-.79.14-1.56.38-2.28V6.63H1.28a12 12 0 0 0 0 10.74l3.99-3.09z"
    />
    <path
      fill="#EA4335"
      d="M12 4.77c1.76 0 3.34.61 4.58 1.8l3.44-3.44C17.95 1.19 15.24 0 12 0A12 12 0 0 0 1.28 6.63l3.99 3.09c.95-2.85 3.6-4.95 6.73-4.95z"
    />
  </svg>
);

export const GoogleAuthModal: React.FC<GoogleAuthModalProps> = ({
  user,
  linkedWallets,
  balances = {},
  authBusy,
  authError,
  initialMode = 'signin',
  onGoogleAuth,
  onSignOut,
  onClose,
}) => {
  const [mode, setMode] = useState<'signin' | 'signup'>(initialMode);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const copyText = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId((cur) => (cur === id ? null : cur)), 1500);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4">
      <div className="w-full max-w-md border border-[#2A3446] rounded-lg bg-[#121721] overflow-hidden">
        {/* Header */}
        <div className="px-6 py-4 border-b border-[#222A38] flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <img
              src={XYPHER_COIN_ICON_PATH}
              alt="Xypher"
              className="w-6 h-6 rounded-full object-cover ring-1 ring-white/15 shrink-0"
            />
            <h3 className="text-base font-semibold text-[#E6EDF3]">
              {user ? 'Google Account' : mode === 'signup' ? 'Create Xypher Account' : 'Sign In to Xypher'}
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 text-[#8B98A8] hover:text-[#E6EDF3] cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-6 space-y-5">
          {!user ? (
            <>
              {/* Sign In / Sign Up Tab Switcher */}
              <div className="grid grid-cols-2 p-1 rounded-md bg-[#0B0E14] border border-[#1E2533]">
                <button
                  type="button"
                  onClick={() => setMode('signin')}
                  className={`py-2 text-xs font-medium rounded transition-colors cursor-pointer ${
                    mode === 'signin'
                      ? 'bg-[#1D2534] text-[#E6EDF3]'
                      : 'text-[#8B98A8] hover:text-[#E6EDF3]'
                  }`}
                >
                  Sign In
                </button>
                <button
                  type="button"
                  onClick={() => setMode('signup')}
                  className={`py-2 text-xs font-medium rounded transition-colors cursor-pointer ${
                    mode === 'signup'
                      ? 'bg-[#1D2534] text-[#E6EDF3]'
                      : 'text-[#8B98A8] hover:text-[#E6EDF3]'
                  }`}
                >
                  Sign Up
                </button>
              </div>

              <div className="space-y-1.5">
                <p className="text-xs text-[#C9D3DF]">
                  {mode === 'signup'
                    ? `Create your verified Xypher (${SYMBOL}) profile in one click using your Google account.`
                    : `Sign in with Google to access your verified Xypher (${SYMBOL}) profile and synced public wallet bookmarks.`}
                </p>
                <p className="text-[11px] text-[#8B98A8]">
                  Private keys (WIF) always stay strictly local in your browser or MetaMask — only public addresses and profile info sync to your private account.
                </p>
              </div>

              <button
                type="button"
                onClick={() => void onGoogleAuth()}
                disabled={authBusy}
                className="w-full inline-flex items-center justify-center gap-2.5 px-4 py-2.5 text-sm font-semibold text-[#0B0E14] bg-white rounded-md hover:bg-neutral-100 transition-colors cursor-pointer disabled:opacity-60"
              >
                <GoogleLogoSvg className="w-4 h-4 shrink-0" />
                {authBusy
                  ? 'Connecting Google...'
                  : mode === 'signup'
                  ? 'Sign Up with Google'
                  : 'Sign In with Google'}
              </button>

              {authError && (
                <div className="p-3 rounded-md border border-red-500/30 bg-red-500/10 text-xs text-red-300">
                  {authError}
                </div>
              )}

              <div className="pt-3 border-t border-[#1D2432] flex items-center gap-2 text-[11px] text-[#8B98A8]">
                <ShieldCheck className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                <span>Secured by Google OAuth 2.0 &amp; Firebase Authentication</span>
              </div>
            </>
          ) : (
            <>
              {/* Signed-In User Profile Card */}
              <div className="p-4 rounded-md border border-[#1E2533] bg-[#0B0E14] flex items-center gap-3.5">
                {user.photoURL ? (
                  <img
                    src={user.photoURL}
                    alt={user.displayName || 'Google User'}
                    referrerPolicy="no-referrer"
                    className="w-11 h-11 rounded-full object-cover ring-1 ring-white/15 shrink-0"
                  />
                ) : (
                  <div className="w-11 h-11 rounded-full bg-amber-500/15 border border-amber-500/30 flex items-center justify-center shrink-0">
                    <UserCheck className="w-5 h-5 text-amber-400" />
                  </div>
                )}
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-[#E6EDF3] truncate">
                    {user.displayName || 'Xypher Member'}
                  </div>
                  <div className="text-xs text-[#8B98A8] truncate">{user.email}</div>
                  <div className="text-[11px] text-emerald-400 mt-0.5">
                    {user.emailVerified ? 'Verified Google Account' : 'Signed In via Google'}
                  </div>
                </div>
              </div>

              {/* Synced Public Wallet Bookmarks */}
              <div className="space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-medium text-[#C9D3DF]">
                    Synced Public Wallet Bookmarks ({linkedWallets.length})
                  </span>
                  <span className="text-[11px] text-[#6B7788]">Owner-only Firestore</span>
                </div>
                {linkedWallets.length === 0 ? (
                  <div className="p-3.5 rounded-md border border-[#1E2533] bg-[#0B0E14] text-xs text-[#8B98A8]">
                    Your active public wallet addresses are synced automatically as you use Xypher.
                  </div>
                ) : (
                  <div className="divide-y divide-[#1D2432] border border-[#1E2533] rounded-md bg-[#0B0E14] max-h-44 overflow-y-auto">
                    {linkedWallets.map((lw) => (
                      <div
                        key={lw.walletId}
                        className="px-3.5 py-2.5 flex items-center justify-between gap-2 text-xs"
                      >
                        <div className="min-w-0">
                          <div className="text-[#E6EDF3] font-medium truncate">
                            {lw.label}{' '}
                            <span className="text-[10px] font-mono text-amber-400 uppercase ml-1">
                              {lw.walletType}
                            </span>
                          </div>
                          <div className="font-mono text-[11px] text-[#8B98A8] truncate">
                            {truncateHash(lw.xyphAddress, 12, 8)}
                          </div>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          {lw.walletType !== 'solana' && balances[lw.xyphAddress] && (
                            <span className="font-mono text-[11px] font-semibold text-emerald-400 tabular-nums whitespace-nowrap">
                              {formatXYPH(balances[lw.xyphAddress].spendable, 4)} {SYMBOL}
                            </span>
                          )}
                          <button
                            type="button"
                            onClick={() => copyText(lw.xyphAddress, lw.walletId)}
                            className="p-1 text-[#8B98A8] hover:text-amber-400 shrink-0 cursor-pointer"
                            title="Copy address"
                          >
                            {copiedId === lw.walletId ? (
                              <Check className="w-3.5 h-3.5 text-emerald-400" />
                            ) : (
                              <Copy className="w-3.5 h-3.5" />
                            )}
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {authError && (
                <div className="p-3 rounded-md border border-red-500/30 bg-red-500/10 text-xs text-red-300">
                  {authError}
                </div>
              )}

              <div className="flex items-center justify-between pt-2 border-t border-[#1D2432]">
                <button
                  type="button"
                  onClick={() => void onSignOut()}
                  disabled={authBusy}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-red-300 bg-red-500/10 border border-red-500/30 rounded-md hover:bg-red-500/20 cursor-pointer disabled:opacity-50"
                >
                  <LogOut className="w-3.5 h-3.5" />
                  Sign Out
                </button>
                <button
                  type="button"
                  onClick={onClose}
                  className="px-4 py-2 text-xs font-semibold text-[#0B0E14] bg-amber-500 rounded-md hover:bg-amber-400 cursor-pointer"
                >
                  Done
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
};
