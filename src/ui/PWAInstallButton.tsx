import React, { useState } from 'react';
import { Download, Smartphone, X } from 'lucide-react';
import { useI18n } from '../i18n/I18nContext';
import { usePWAInstall } from './usePWAInstall';

export function PWAInstallButton() {
  const { t } = useI18n();
  const { isInstallable, isInstalled, isIOS, install } = usePWAInstall();
  const [showIOSGuide, setShowIOSGuide] = useState(false);

  if (isInstalled) {
    return null;
  }

  if (isInstallable) {
    return (
      <section className="bg-white border-2 border-[#1F2A2E] rounded-2xl p-4 space-y-3">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-xl bg-[#0E6B4E]/10 border border-[#0E6B4E] flex items-center justify-center shrink-0">
            <Smartphone className="w-5 h-5 text-[#0E6B4E]" aria-hidden="true" />
          </div>
          <div className="min-w-0">
            <h2 className="font-sign font-bold text-base text-[#1F2A2E]">{t.pwaInstallTitle}</h2>
            <p className="text-sm text-[#526066] mt-0.5">{t.pwaInstallHint}</p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => void install()}
          className="w-full min-h-[52px] px-4 rounded-xl bg-[#0E6B4E] hover:bg-[#0A523B] text-white font-sign font-bold text-base inline-flex items-center justify-center gap-2 transition-colors"
        >
          <Download className="w-5 h-5 shrink-0" aria-hidden="true" />
          <span>{t.pwaInstallBtn}</span>
        </button>
      </section>
    );
  }

  if (isIOS) {
    return (
      <>
        <section className="bg-white border-2 border-[#1F2A2E] rounded-2xl p-4 space-y-3">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-xl bg-[#0E6B4E]/10 border border-[#0E6B4E] flex items-center justify-center shrink-0">
              <Smartphone className="w-5 h-5 text-[#0E6B4E]" aria-hidden="true" />
            </div>
            <div className="min-w-0">
              <h2 className="font-sign font-bold text-base text-[#1F2A2E]">{t.pwaInstallTitle}</h2>
              <p className="text-sm text-[#526066] mt-0.5">{t.pwaInstallHint}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setShowIOSGuide(true)}
            className="w-full min-h-[52px] px-4 rounded-xl bg-[#FFC20E] hover:bg-[#e5ae0b] text-[#1F2A2E] border-2 border-[#1F2A2E] font-sign font-bold text-base inline-flex items-center justify-center gap-2 transition-colors"
          >
            <Download className="w-5 h-5 shrink-0" aria-hidden="true" />
            <span>{t.pwaIosInstallBtn}</span>
          </button>
        </section>

        {showIOSGuide && (
          <div
            role="dialog"
            aria-modal="true"
            aria-label={t.pwaIosModalTitle}
            className="fixed inset-0 z-[950] flex items-center justify-center bg-black/50 p-4"
          >
            <div className="w-full max-w-sm rounded-2xl bg-white border-2 border-[#1F2A2E] p-5 space-y-3 shadow-xl">
              <div className="flex items-center justify-between gap-2">
                <h3 className="font-sign font-bold text-lg text-[#1F2A2E]">
                  {t.pwaIosModalTitle}
                </h3>
                <button
                  type="button"
                  onClick={() => setShowIOSGuide(false)}
                  aria-label={t.pwaCloseBtn}
                  className="h-10 w-10 rounded-lg border border-[#D5DDD8] flex items-center justify-center text-[#1F2A2E]"
                >
                  <X className="w-5 h-5" aria-hidden="true" />
                </button>
              </div>
              <div className="space-y-1.5 text-sm text-[#1F2A2E]">
                <p>{t.pwaIosStep1}</p>
                <p>{t.pwaIosStep2}</p>
              </div>
              <button
                type="button"
                onClick={() => setShowIOSGuide(false)}
                className="w-full min-h-[48px] rounded-xl bg-[#1F2A2E] text-white font-bold text-sm"
              >
                {t.pwaCloseBtn}
              </button>
            </div>
          </div>
        )}
      </>
    );
  }

  return null;
}
