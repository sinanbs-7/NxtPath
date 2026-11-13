import React, { useState } from 'react';
import { Navigation } from 'lucide-react';
import { useI18n } from '../i18n/I18nContext';
import type { GpsReading } from '../map/useGeolocation';

interface DebugSimulatorBarProps {
  position: GpsReading | null;
  onSetSimulated: (lat: number, lng: number) => void;
  onClearSimulated: () => void;
}

export function DebugSimulatorBar({
  position,
  onSetSimulated,
  onClearSimulated,
}: DebugSimulatorBarProps) {
  const { t } = useI18n();
  const [latInput, setLatInput] = useState(() =>
    position ? position.lat.toFixed(5) : '12.52180',
  );
  const [lngInput, setLngInput] = useState(() =>
    position ? position.lng.toFixed(5) : '76.89510',
  );

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const lat = Number(latInput);
    const lng = Number(lngInput);
    if (Number.isFinite(lat) && Number.isFinite(lng) && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180) {
      onSetSimulated(lat, lng);
    }
  };

  const nudge = (dLat: number, dLng: number) => {
    const baseLat = position ? position.lat : Number(latInput) || 12.5218;
    const baseLng = position ? position.lng : Number(lngInput) || 76.8951;
    const nextLat = Number((baseLat + dLat).toFixed(5));
    const nextLng = Number((baseLng + dLng).toFixed(5));
    setLatInput(String(nextLat));
    setLngInput(String(nextLng));
    onSetSimulated(nextLat, nextLng);
  };

  return (
    <form
      onSubmit={handleSubmit}
      aria-label="Developer GPS simulator"
      className="bg-[#FFC20E] text-[#1F2A2E] border-b-2 border-[#1F2A2E] px-3 py-2 flex flex-wrap items-center gap-2 text-sm"
    >
      <span className="px-2 py-0.5 bg-[#1F2A2E] text-[#FFC20E] font-sign font-extrabold rounded text-xs tracking-wider">
        {t.simulatedBadge}
      </span>
      <span className="text-xs font-medium hidden sm:inline">{t.simulatedGpsHelp}</span>

      <label className="inline-flex items-center gap-1 text-xs font-bold">
        <span>Lat</span>
        <input
          type="number"
          step="0.0001"
          value={latInput}
          onChange={(e) => setLatInput(e.target.value)}
          className="w-24 px-2 py-1 rounded bg-white border border-[#1F2A2E] text-xs tabular-nums"
        />
      </label>

      <label className="inline-flex items-center gap-1 text-xs font-bold">
        <span>Lng</span>
        <input
          type="number"
          step="0.0001"
          value={lngInput}
          onChange={(e) => setLngInput(e.target.value)}
          className="w-24 px-2 py-1 rounded bg-white border border-[#1F2A2E] text-xs tabular-nums"
        />
      </label>

      <button
        type="submit"
        className="px-2.5 py-1 rounded bg-[#1F2A2E] text-white text-xs font-bold inline-flex items-center gap-1"
      >
        <Navigation className="w-3.5 h-3.5" aria-hidden="true" />
        <span>{t.simulatedSetBtn}</span>
      </button>

      <div className="inline-flex items-center gap-1">
        <button
          type="button"
          onClick={() => nudge(0.002, 0)}
          className="px-2 py-1 rounded bg-white border border-[#1F2A2E] text-xs font-bold"
        >
          +N
        </button>
        <button
          type="button"
          onClick={() => nudge(-0.002, 0)}
          className="px-2 py-1 rounded bg-white border border-[#1F2A2E] text-xs font-bold"
        >
          +S
        </button>
        <button
          type="button"
          onClick={() => nudge(0, 0.002)}
          className="px-2 py-1 rounded bg-white border border-[#1F2A2E] text-xs font-bold"
        >
          +E
        </button>
        {position?.isSimulated && (
          <button
            type="button"
            onClick={onClearSimulated}
            className="px-2 py-1 rounded bg-white border border-[#1F2A2E] text-xs font-bold"
          >
            Reset
          </button>
        )}
      </div>
    </form>
  );
}
