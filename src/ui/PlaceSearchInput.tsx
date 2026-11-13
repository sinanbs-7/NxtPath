import React, { useEffect, useId, useRef, useState } from 'react';
import { MapPin, Mic, MicOff, RotateCcw, Search, X } from 'lucide-react';
import { searchPhotonPlaces, type PlaceResult } from '../map/photon';
import { useI18n } from '../i18n/I18nContext';
import { looksLikeNaturalLanguageRequest } from '../ai/geminiSchemas';
import type { Language } from '../types/firestore';

interface SpeechRecognitionAlternativeLike {
  transcript: string;
}

interface SpeechRecognitionResultLike {
  0: SpeechRecognitionAlternativeLike;
}

interface SpeechRecognitionEventLike {
  results: ArrayLike<SpeechRecognitionResultLike>;
}

interface SpeechRecognitionInstanceLike {
  lang: string;
  interimResults: boolean;
  maxAlternatives: number;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: (() => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
}

function getSpeechLocale(language: Language): string {
  if (language === 'kn') return 'kn-IN';
  if (language === 'hi') return 'hi-IN';
  return 'en-IN';
}

interface PlaceSearchInputProps {
  label: string;
  biasLat?: number | null;
  biasLng?: number | null;
  onSelectPlace: (place: PlaceResult) => void;
  onFocusInput?: () => void;
  onNaturalLanguageRequest?: (text: string) => void;
  parsingRequest?: boolean;
}

export function PlaceSearchInput({
  label,
  biasLat,
  biasLng,
  onSelectPlace,
  onFocusInput,
  onNaturalLanguageRequest,
  parsingRequest = false,
}: PlaceSearchInputProps) {
  const { t, language } = useI18n();
  const inputId = useId();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<PlaceResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasSearched, setHasSearched] = useState(false);
  const [retryCounter, setRetryCounter] = useState(0);
  const [listening, setListening] = useState(false);
  const [voiceNote, setVoiceNote] = useState<string | null>(null);
  const recognitionRef = useRef<SpeechRecognitionInstanceLike | null>(null);

  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length < 2) {
      setResults([]);
      setLoading(false);
      setError(null);
      setHasSearched(false);
      return;
    }

    const controller = new AbortController();
    setLoading(true);
    setError(null);

    const timer = window.setTimeout(async () => {
      try {
        const { results: places } = await searchPhotonPlaces(trimmed, {
          biasLat,
          biasLng,
          limit: 6,
          signal: controller.signal,
        });
        if (!controller.signal.aborted) {
          setResults(places);
          setHasSearched(true);
          setLoading(false);
        }
      } catch (err) {
        if (controller.signal.aborted) return;
        if (err instanceof DOMException && err.name === 'AbortError') return;
        setLoading(false);
        setHasSearched(true);
        setError(t.searchError);
      }
    }, 350);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [query, biasLat, biasLng, retryCounter, t.searchError]);

  useEffect(() => {
    return () => {
      recognitionRef.current?.stop();
    };
  }, []);

  const showSentenceParseBtn = Boolean(
    onNaturalLanguageRequest && looksLikeNaturalLanguageRequest(query),
  );

  const handleVoiceClick = () => {
    setVoiceNote(null);
    if (listening && recognitionRef.current) {
      recognitionRef.current.stop();
      setListening(false);
      return;
    }

    const win = window as unknown as {
      SpeechRecognition?: new () => SpeechRecognitionInstanceLike;
      webkitSpeechRecognition?: new () => SpeechRecognitionInstanceLike;
    };
    const SpeechCtor = win.SpeechRecognition || win.webkitSpeechRecognition;

    if (!SpeechCtor) {
      setVoiceNote(t.searchVoiceUnsupported);
      return;
    }

    try {
      const recognition = new SpeechCtor();
      recognition.lang = getSpeechLocale(language);
      recognition.interimResults = false;
      recognition.maxAlternatives = 1;
      recognition.onresult = (event) => {
        const transcript = event.results?.[0]?.[0]?.transcript?.trim();
        if (transcript) {
          setQuery(transcript);
          onFocusInput?.();
          if (onNaturalLanguageRequest) {
            onNaturalLanguageRequest(transcript);
          }
        }
      };
      recognition.onerror = () => {
        setListening(false);
        setVoiceNote(t.searchVoiceUnsupported);
      };
      recognition.onend = () => {
        setListening(false);
      };
      recognitionRef.current = recognition;
      setListening(true);
      recognition.start();
    } catch {
      setListening(false);
      setVoiceNote(t.searchVoiceUnsupported);
    }
  };

  return (
    <div className="space-y-2">
      <label htmlFor={inputId} className="block font-sign font-bold text-base text-[#1F2A2E]">
        {label}
      </label>

      <div className="flex items-stretch gap-2">
        <div className="relative flex-1 flex items-center">
          <Search
            className="w-5 h-5 text-[#526066] absolute left-3 pointer-events-none"
            aria-hidden="true"
          />
          <input
            id={inputId}
            type="search"
            value={query}
            onFocus={onFocusInput}
            onChange={(e) => {
              setQuery(e.target.value);
              setVoiceNote(null);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && showSentenceParseBtn && onNaturalLanguageRequest) {
                e.preventDefault();
                onNaturalLanguageRequest(query.trim());
              }
            }}
            placeholder={t.searchPlaceholder}
            autoComplete="off"
            className="w-full min-h-[56px] pl-10 pr-10 py-2 bg-[#F2F5F3] border-2 border-[#1F2A2E] rounded-xl text-base text-[#1F2A2E] placeholder:text-[#526066]"
          />
          {query.length > 0 && (
            <button
              type="button"
              onClick={() => {
                setQuery('');
                setResults([]);
                setError(null);
                setHasSearched(false);
              }}
              aria-label={t.searchClearBtn}
              className="absolute right-1.5 min-h-[44px] min-w-[44px] flex items-center justify-center text-[#1F2A2E] rounded-lg hover:bg-black/5"
            >
              <X className="w-4 h-4" aria-hidden="true" />
            </button>
          )}
        </div>

        <button
          type="button"
          onClick={handleVoiceClick}
          aria-label={listening ? t.searchVoiceListening : t.searchVoiceBtn}
          aria-pressed={listening}
          className={`min-h-[56px] min-w-[56px] px-3 rounded-xl border-2 border-[#1F2A2E] flex items-center justify-center gap-1.5 font-bold text-sm shrink-0 ${
            listening
              ? 'bg-[#FFC20E] text-[#1F2A2E]'
              : 'bg-white text-[#1F2A2E] hover:bg-[#F2F5F3]'
          }`}
        >
          {listening ? (
            <MicOff className="w-5 h-5" aria-hidden="true" />
          ) : (
            <Mic className="w-5 h-5" aria-hidden="true" />
          )}
        </button>
      </div>

      {onNaturalLanguageRequest && !showSentenceParseBtn && !query.trim() && (
        <p className="text-xs text-[#526066]">{t.searchVoiceRequestHint}</p>
      )}

      {showSentenceParseBtn && onNaturalLanguageRequest && (
        <button
          type="button"
          disabled={parsingRequest}
          onClick={() => onNaturalLanguageRequest(query.trim())}
          className="w-full min-h-[48px] px-4 rounded-xl bg-[#FFC20E] hover:bg-[#e5ae0b] text-[#1F2A2E] font-sign font-bold text-sm border-2 border-[#1F2A2E] transition-colors disabled:opacity-60"
        >
          {parsingRequest ? t.searchLoading : t.searchParseSentenceBtn}
        </button>
      )}

      {voiceNote && (
        <p role="status" className="text-sm text-[#526066]">
          {voiceNote}
        </p>
      )}

      {loading && (
        <p role="status" className="text-sm font-medium text-[#0E6B4E]">
          {t.searchLoading}
        </p>
      )}

      {error && (
        <div
          role="alert"
          className="p-3 rounded-xl border-2 border-[#D7352B] bg-[#D7352B]/10 flex items-center justify-between gap-3"
        >
          <p className="text-sm font-medium text-[#1F2A2E]">{error}</p>
          <button
            type="button"
            onClick={() => setRetryCounter((c) => c + 1)}
            className="min-h-[44px] px-3 rounded-lg bg-[#1F2A2E] text-white text-sm font-bold inline-flex items-center gap-1.5 shrink-0"
          >
            <RotateCcw className="w-4 h-4" aria-hidden="true" />
            <span>{t.retry}</span>
          </button>
        </div>
      )}

      {!loading && !error && hasSearched && results.length === 0 && !showSentenceParseBtn && (
        <p className="text-sm text-[#526066] py-1">{t.searchEmpty}</p>
      )}

      {results.length > 0 && (
        <ul
          aria-label="Place search results"
          className="divide-y divide-[#D5DDD8] border-2 border-[#1F2A2E] rounded-xl bg-white overflow-hidden"
        >
          {results.map((place) => (
            <li key={place.id}>
              <button
                type="button"
                onClick={() => {
                  onSelectPlace(place);
                  setQuery('');
                  setResults([]);
                  setHasSearched(false);
                }}
                className="w-full min-h-[56px] px-3 py-2.5 text-left flex items-start gap-3 hover:bg-[#F2F5F3] active:bg-[#FFC20E]/20 transition-colors"
              >
                <MapPin
                  className="w-5 h-5 text-[#0E6B4E] mt-0.5 shrink-0"
                  aria-hidden="true"
                />
                <span className="min-w-0">
                  <span className="block font-bold text-base text-[#1F2A2E] truncate">
                    {place.name}
                  </span>
                  {place.subtitle && (
                    <span className="block text-sm text-[#526066] truncate">
                      {place.subtitle}
                    </span>
                  )}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
