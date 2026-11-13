import React from 'react';
import { Bell, Map as MapIcon, Route, User } from 'lucide-react';
import { useI18n } from '../i18n/I18nContext';

export type NavTab = 'map' | 'trips' | 'requests' | 'profile';

interface BottomNavProps {
  activeTab: NavTab;
  onSelectTab: (tab: NavTab) => void;
}

export function BottomNav({ activeTab, onSelectTab }: BottomNavProps) {
  const { t } = useI18n();

  const items: Array<{ id: NavTab; label: string; Icon: React.ComponentType<{ className?: string }> }> =
    [
      { id: 'map', label: t.navMap, Icon: MapIcon },
      { id: 'trips', label: t.navTrips, Icon: Route },
      { id: 'requests', label: t.navRequests, Icon: Bell },
      { id: 'profile', label: t.navProfile, Icon: User },
    ];

  return (
    <nav
      aria-label="Primary navigation"
      className="fixed bottom-0 left-0 right-0 z-[700] h-16 bg-white border-t-2 border-[#1F2A2E] grid grid-cols-4"
    >
      {items.map(({ id, label, Icon }) => {
        const active = activeTab === id;
        return (
          <button
            key={id}
            type="button"
            onClick={() => onSelectTab(id)}
            aria-current={active ? 'page' : undefined}
            className={`min-w-0 min-h-[56px] flex flex-col items-center justify-center gap-0.5 px-1 transition-colors ${
              active
                ? 'bg-[#0E6B4E] text-white font-bold'
                : 'bg-white text-[#1F2A2E] hover:bg-[#F2F5F3]'
            }`}
          >
            <Icon className="w-5 h-5 shrink-0" aria-hidden="true" />
            <span className="text-xs sm:text-[13px] leading-tight whitespace-nowrap truncate max-w-full">
              {label}
            </span>
          </button>
        );
      })}
    </nav>
  );
}
