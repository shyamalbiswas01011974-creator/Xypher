import React, { useEffect, useRef, useState } from 'react';
import jsQR from 'jsqr';
import QRCode from 'qrcode';
import {
  Camera,
  Check,
  Copy,
  Download,
  ImageUp,
  QrCode,
  X,
} from 'lucide-react';
import { XYPHER_COIN_ICON_PATH } from '../lib/metamask.ts';
import {
  type ParsedXypherQr,
  buildXypherQrPayload,
  parseXypherQrPayload,
} from '../lib/qrPayload.ts';
import { SYMBOL } from '../lib/xypherCrypto.ts';

interface ReceiveQrGeneratorProps {
  label: string;
  xyphAddress: string;
  evmAddress: string;
  compact?: boolean;
}

export const ReceiveQrGenerator: React.FC<ReceiveQrGeneratorProps> = ({
  label,
  xyphAddress,
  evmAddress,
  compact = false,
}) => {
  const [addressMode, setAddressMode] = useState<'xypher' | 'evm'>('xypher');
  const [requestAmount, setRequestAmount] = useState('');
  const [qrDataUrl, setQrDataUrl] = useState<string>('');
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const activeAddress = addressMode === 'evm' ? evmAddress : xyphAddress;
  const qrPayload = buildXypherQrPayload(activeAddress, requestAmount);

  useEffect(() => {
    let active = true;
    QRCode.toDataURL(qrPayload, {
      width: 240,
      margin: 2,
      errorCorrectionLevel: 'M',
      color: {
        dark: '#0B0E14',
        light: '#FFFFFF',
      },
    })
      .then((url) => {
        if (active) setQrDataUrl(url);
      })
      .catch(() => {
        if (active) setQrDataUrl('');
      });
    return () => {
      active = false;
    };
  }, [qrPayload]);

  const copyText = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId((cur) => (cur === id ? null : cur)), 1600);
  };

  const handleDownloadPng = () => {
    if (!qrDataUrl) return;
    const link = document.createElement('a');
    link.href = qrDataUrl;
    const safeLabel = label.replace(/[^a-zA-Z0-9_-]/g, '_').toLowerCase() || 'xypher';
    link.download = `xypher-receive-${safeLabel}-${addressMode}.png`;
    link.click();
  };

  return (
    <div className="space-y-4">
      {/* Address Mode Switcher */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="inline-flex p-0.5 rounded-md bg-[#0B0E14] border border-[#222A38]">
          <button
            type="button"
            onClick={() => setAddressMode('xypher')}
            className={`px-3 py-1.5 text-xs font-medium rounded transition-colors cursor-pointer whitespace-nowrap ${
              addressMode === 'xypher'
                ? 'bg-amber-500 text-[#0B0E14] font-semibold'
                : 'text-[#8B98A8] hover:text-[#E6EDF3]'
            }`}
          >
            Xypher Address
          </button>
          <button
            type="button"
            onClick={() => setAddressMode('evm')}
            className={`px-3 py-1.5 text-xs font-medium rounded transition-colors cursor-pointer whitespace-nowrap ${
              addressMode === 'evm'
                ? 'bg-amber-500 text-[#0B0E14] font-semibold'
                : 'text-[#8B98A8] hover:text-[#E6EDF3]'
            }`}
          >
            MetaMask (0x)
          </button>
        </div>

        <button
          type="button"
          onClick={handleDownloadPng}
          disabled={!qrDataUrl}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-[#E6EDF3] bg-[#1B2230] border border-[#2A3446] rounded-md hover:bg-[#232C3D] whitespace-nowrap cursor-pointer disabled:opacity-50"
        >
          <Download className="w-3.5 h-3.5" />
          Download QR
        </button>
      </div>

      {/* QR Code Card + Request Amount */}
      <div
        className={`flex flex-col ${
          compact ? 'items-center' : 'sm:flex-row sm:items-center'
        } gap-5 p-4 rounded-md border border-[#1E2533] bg-[#0B0E14]`}
      >
        <div className="shrink-0 mx-auto sm:mx-0">
          <div className="relative p-3 bg-white rounded-lg inline-block">
            {qrDataUrl ? (
              <img
                src={qrDataUrl}
                alt={`Receive ${SYMBOL} QR Code`}
                className="w-44 h-44 block"
              />
            ) : (
              <div className="w-44 h-44 flex items-center justify-center text-xs text-neutral-500">
                Generating QR...
              </div>
            )}
            <img
              src={XYPHER_COIN_ICON_PATH}
              alt={SYMBOL}
              className="w-8 h-8 rounded-full object-cover ring-2 ring-white absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2"
            />
          </div>
        </div>

        <div className="flex-1 w-full space-y-3 min-w-0">
          <div>
            <label className="block text-xs font-medium text-[#9AA6B6] mb-1">
              Request Specific Amount (Optional, {SYMBOL})
            </label>
            <input
              type="text"
              inputMode="decimal"
              value={requestAmount}
              onChange={(e) => setRequestAmount(e.target.value)}
              placeholder="e.g. 100 (leave blank for any amount)"
              className="w-full px-3 py-2 text-xs font-mono tabular-nums bg-[#121721] border border-[#2A3446] rounded-md text-[#E6EDF3] focus:outline-none focus:border-amber-500"
            />
          </div>

          <div className="space-y-1">
            <div className="flex items-center justify-between text-[11px] text-[#8B98A8]">
              <span>{addressMode === 'evm' ? 'MetaMask 0x Address' : 'Native Xypher Address'}</span>
              <button
                type="button"
                onClick={() => copyText(activeAddress, 'qr-addr')}
                className="inline-flex items-center gap-1 text-amber-400 hover:text-amber-300 cursor-pointer"
              >
                {copiedId === 'qr-addr' ? (
                  <>
                    <Check className="w-3 h-3 text-emerald-400" />
                    Copied
                  </>
                ) : (
                  <>
                    <Copy className="w-3 h-3" />
                    Copy Address
                  </>
                )}
              </button>
            </div>
            <div className="p-2.5 rounded bg-[#121721] border border-[#1E2533] font-mono text-[11px] text-[#E6EDF3] break-all">
              {activeAddress}
            </div>
          </div>

          <div className="flex items-center justify-between gap-2 text-[11px] text-[#6B7788]">
            <span className="font-mono truncate">{qrPayload}</span>
            <button
              type="button"
              onClick={() => copyText(qrPayload, 'qr-uri')}
              className="inline-flex items-center gap-1 text-[#9AA6B6] hover:text-amber-400 whitespace-nowrap shrink-0 cursor-pointer"
            >
              {copiedId === 'qr-uri' ? (
                <>
                  <Check className="w-3 h-3 text-emerald-400" />
                  Copied URI
                </>
              ) : (
                <>
                  <Copy className="w-3 h-3" />
                  Copy URI
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

interface QrScannerModalProps {
  onDetected: (parsed: ParsedXypherQr) => void;
  onClose: () => void;
}

export const QrScannerModal: React.FC<QrScannerModalProps> = ({ onDetected, onClose }) => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [cameraActive, setCameraActive] = useState(false);
  const [cameraStarting, setCameraStarting] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
  const [manualPaste, setManualPaste] = useState('');

  const stopCamera = () => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    if (streamRef.current) {
      for (const track of streamRef.current.getTracks()) {
        track.stop();
      }
      streamRef.current = null;
    }
    setCameraActive(false);
  };

  useEffect(() => {
    return () => {
      stopCamera();
    };
  }, []);

  const handleDecodedString = (raw: string): boolean => {
    const parsed = parseXypherQrPayload(raw);
    if (!parsed) {
      setScanError(
        `Scanned QR is not a valid ${SYMBOL} or MetaMask address: "${raw.slice(0, 60)}"`
      );
      return false;
    }
    stopCamera();
    onDetected(parsed);
    return true;
  };

  const startCamera = async () => {
    setScanError(null);
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setScanError(
        'Camera access is unavailable in this browser. Use "Upload QR Image" below to scan a QR screenshot.'
      );
      return;
    }
    setCameraStarting(true);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' } },
        audio: false,
      });
      streamRef.current = stream;
      setCameraActive(true);

      const video = videoRef.current;
      if (video) {
        video.srcObject = stream;
        await video.play();
      }

      const tick = () => {
        const vid = videoRef.current;
        const canvas = canvasRef.current;
        if (!vid || !canvas || !streamRef.current) return;
        if (vid.readyState === vid.HAVE_ENOUGH_DATA && vid.videoWidth > 0) {
          canvas.width = vid.videoWidth;
          canvas.height = vid.videoHeight;
          const ctx = canvas.getContext('2d', { willReadFrequently: true });
          if (ctx) {
            ctx.drawImage(vid, 0, 0, canvas.width, canvas.height);
            const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
            const code = jsQR(imgData.data, imgData.width, imgData.height, {
              inversionAttempts: 'dontInvert',
            });
            if (code && code.data) {
              if (handleDecodedString(code.data)) {
                return;
              }
            }
          }
        }
        rafRef.current = requestAnimationFrame(tick);
      };
      rafRef.current = requestAnimationFrame(tick);
    } catch (err) {
      stopCamera();
      setScanError(
        err instanceof Error
          ? `Camera unavailable (${err.message}). You can upload a QR image instead.`
          : 'Camera permission denied. Use "Upload QR Image" instead.'
      );
    } finally {
      setCameraStarting(false);
    }
  };

  const handleUploadQrImage = (e: React.ChangeEvent<HTMLInputElement>) => {
    setScanError(null);
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        if (!ctx) {
          setScanError('Could not read uploaded image.');
          return;
        }
        ctx.drawImage(img, 0, 0);
        const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const code = jsQR(imgData.data, imgData.width, imgData.height, {
          inversionAttempts: 'attemptBoth',
        });
        if (!code || !code.data) {
          setScanError('No valid QR code found in that image. Try a clearer crop of the QR code.');
          return;
        }
        handleDecodedString(code.data);
      };
      img.onerror = () => setScanError('Failed to decode uploaded image file.');
      img.src = String(reader.result || '');
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  const handleManualSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setScanError(null);
    handleDecodedString(manualPaste);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4">
      <div className="w-full max-w-md border border-[#2A3446] rounded-lg bg-[#121721] p-6 space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <QrCode className="w-4 h-4 text-amber-400" />
            <h3 className="text-base font-semibold text-[#E6EDF3]">
              Scan {SYMBOL} Receive QR Code
            </h3>
          </div>
          <button
            type="button"
            onClick={() => {
              stopCamera();
              onClose();
            }}
            className="p-1 text-[#8B98A8] hover:text-[#E6EDF3] cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <p className="text-xs text-[#8B98A8]">
          Point your camera at a {SYMBOL} receive QR code or upload a QR image to auto-fill the recipient address and requested amount.
        </p>

        {/* Camera Viewport */}
        <div className="relative rounded-md border border-[#1E2533] bg-[#0B0E14] overflow-hidden aspect-video flex items-center justify-center">
          <video
            ref={videoRef}
            playsInline
            muted
            className={`w-full h-full object-cover ${cameraActive ? 'block' : 'hidden'}`}
          />
          <canvas ref={canvasRef} className="hidden" />
          {!cameraActive && (
            <div className="text-center p-4 space-y-2.5">
              <Camera className="w-7 h-7 text-[#6B7788] mx-auto" />
              <div className="flex flex-wrap items-center justify-center gap-2">
                <button
                  type="button"
                  onClick={() => void startCamera()}
                  disabled={cameraStarting}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-[#0B0E14] bg-amber-500 rounded-md hover:bg-amber-400 whitespace-nowrap cursor-pointer disabled:opacity-50"
                >
                  <Camera className="w-3.5 h-3.5" />
                  {cameraStarting ? 'Opening Camera...' : 'Start Camera Scan'}
                </button>
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-[#E6EDF3] bg-[#1B2230] border border-[#2A3446] rounded-md hover:bg-[#232C3D] whitespace-nowrap cursor-pointer"
                >
                  <ImageUp className="w-3.5 h-3.5" />
                  Upload QR Image
                </button>
              </div>
            </div>
          )}
          {cameraActive && (
            <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
              <div className="w-44 h-44 border-2 border-amber-400/80 rounded-lg" />
            </div>
          )}
        </div>

        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          onChange={handleUploadQrImage}
          className="hidden"
        />

        {cameraActive && (
          <div className="flex items-center justify-between gap-2">
            <button
              type="button"
              onClick={stopCamera}
              className="px-3 py-1.5 text-xs font-medium text-[#C9D3DF] bg-[#1B2230] border border-[#2A3446] rounded-md hover:bg-[#232C3D] cursor-pointer"
            >
              Stop Camera
            </button>
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-amber-400 hover:text-amber-300 cursor-pointer"
            >
              <ImageUp className="w-3.5 h-3.5" />
              Or Upload QR Image
            </button>
          </div>
        )}

        {/* Paste QR URI fallback */}
        <form onSubmit={handleManualSubmit} className="pt-2 border-t border-[#1D2432] space-y-2">
          <label className="block text-[11px] font-medium text-[#8B98A8]">
            Or Paste Scanned <span className="font-mono">xypher:...</span> Payment URI
          </label>
          <div className="flex gap-2">
            <input
              type="text"
              value={manualPaste}
              onChange={(e) => setManualPaste(e.target.value)}
              placeholder="xypher:... or 0x..."
              className="flex-1 px-3 py-2 text-xs font-mono bg-[#0B0E14] border border-[#2A3446] rounded-md text-[#E6EDF3] focus:outline-none focus:border-amber-500"
            />
            <button
              type="submit"
              className="px-3.5 py-2 text-xs font-semibold text-[#0B0E14] bg-amber-500 rounded-md hover:bg-amber-400 whitespace-nowrap cursor-pointer"
            >
              Use
            </button>
          </div>
        </form>

        {scanError && (
          <div className="p-2.5 rounded-md border border-red-500/30 bg-red-500/10 text-xs text-red-300">
            {scanError}
          </div>
        )}
      </div>
    </div>
  );
};
