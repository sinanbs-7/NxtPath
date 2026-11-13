import React, { useEffect, useState } from 'react';
import { AuthProvider, useAuth } from './auth/AuthContext';
import { I18nProvider } from './i18n/I18nContext';
import { useGeolocation } from './map/useGeolocation';
import { ParentTrackerScreen } from './parent/ParentTrackerScreen';
import { AdminScreen } from './screens/AdminScreen';
import { MapScreen } from './screens/MapScreen';
import { TripsScreen } from './screens/TripsScreen';
import { RequestsScreen } from './screens/RequestsScreen';
import { ProfileScreen } from './screens/ProfileScreen';
import type { Language, LatLngPoint } from './types/firestore';
import { BottomNav, type NavTab } from './ui/BottomNav';
import { DebugSimulatorBar } from './ui/DebugSimulatorBar';
import { WelcomeScreen } from './ui/WelcomeScreen';

interface ParentTrackQuery {
  tripId: string;
  student?: string;
  dest?: string;
  pickupPoint: LatLngPoint | null;
  rideCode?: string;
}

function readParentTrackQuery(): ParentTrackQuery | null {
  try {
    const params = new URLSearchParams(window.location.search);
    const tripId = params.get('track')?.trim();
    if (!tripId) return null;
    const plat = Number(params.get('plat'));
    const plng = Number(params.get('plng'));
    const hasPickup = Number.isFinite(plat) && Number.isFinite(plng) && Math.abs(plat) <= 90 && Math.abs(plng) <= 180;
    return {
      tripId,
      student: params.get('student')?.trim() || undefined,
      dest: params.get('dest')?.trim() || undefined,
      pickupPoint: hasPickup ? { lat: plat, lng: plng } : null,
      rideCode: params.get('code')?.trim() || undefined,
    };
  } catch {
    return null;
  }
}

function AppShell() {
  const { language, setLanguage, onboardingComplete, authReady, isAdmin } = useAuth();
  const geo = useGeolocation();
  const [activeTab, setActiveTab] = useState<NavTab>('map');
  const [adminOpen, setAdminOpen] = useState(false);
  const [welcomeDismissed, setWelcomeDismissed] = useState(false);

  useEffect(() => {
    document.documentElement.lang = language;
  }, [language]);

  useEffect(() => {
    if (!isAdmin && adminOpen) {
      setAdminOpen(false);
    }
  }, [isAdmin, adminOpen]);

  const showWelcome = authReady && !onboardingComplete && !welcomeDismissed;

  const handleSelectTab = (tab: NavTab) => {
    setAdminOpen(false);
    setActiveTab(tab);
  };

  return (
    <I18nProvider
      language={language}
      onChangeLanguage={(lang) => {
        void setLanguage(lang);
      }}
    >
      <div className="h-dvh w-full flex flex-col bg-[#F2F5F3] text-[#1F2A2E] overflow-hidden">
        {geo.isDebugMode && (
          <DebugSimulatorBar
            position={geo.position}
            onSetSimulated={geo.setSimulatedPosition}
            onClearSimulated={geo.clearSimulatedPosition}
          />
        )}

        <div className="relative flex-1 min-h-0 overflow-y-auto">
          {adminOpen && isAdmin ? (
            <AdminScreen onBack={() => setAdminOpen(false)} />
          ) : (
            <>
              {activeTab === 'map' && <MapScreen geo={geo} />}
              {activeTab === 'trips' && <TripsScreen onGoToMap={() => handleSelectTab('map')} />}
              {activeTab === 'requests' && (
                <RequestsScreen onGoToMap={() => handleSelectTab('map')} />
              )}
              {activeTab === 'profile' && (
                <ProfileScreen
                  geo={geo}
                  onOpenAdmin={isAdmin ? () => setAdminOpen(true) : undefined}
                />
              )}
            </>
          )}
        </div>

        <BottomNav activeTab={activeTab} onSelectTab={handleSelectTab} />

        {showWelcome && (
          <WelcomeScreen
            onFinished={() => {
              setWelcomeDismissed(true);
              geo.requestLocation();
            }}
          />
        )}
      </div>
    </I18nProvider>
  );
}

export default function App() {
  const [trackQuery, setTrackQuery] = useState<ParentTrackQuery | null>(() => readParentTrackQuery());
  const [parentLang, setParentLang] = useState<Language>('en');

  useEffect(() => {
    if (trackQuery) {
      document.documentElement.lang = parentLang;
    }
  }, [trackQuery, parentLang]);

  if (trackQuery) {
    return (
      <I18nProvider language={parentLang} onChangeLanguage={setParentLang}>
        <ParentTrackerScreen
          tripId={trackQuery.tripId}
          studentLabel={trackQuery.student}
          destLabel={trackQuery.dest}
          pickupPoint={trackQuery.pickupPoint}
          rideCode={trackQuery.rideCode}
          onExitToApp={() => {
            try {
              const url = new URL(window.location.href);
              url.search = '';
              window.history.replaceState({}, '', url.toString());
            } catch {
              // ignore history errors
            }
            setTrackQuery(null);
          }}
        />
      </I18nProvider>
    );
  }

  return (
    <AuthProvider>
      <AppShell />
    </AuthProvider>
  );
}
