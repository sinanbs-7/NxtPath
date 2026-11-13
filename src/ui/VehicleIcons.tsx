import React from 'react';
import L from 'leaflet';
import type { VehicleType } from '../types/firestore';
import type { TranslationStrings } from '../i18n/types';

export const VEHICLE_TYPES: VehicleType[] = [
  'govt_bus',
  'private_bus',
  'school_van',
  'milk_van',
  'ration_truck',
  'tractor',
  'auto',
  'other',
];

export function getVehicleLabel(type: VehicleType, t: TranslationStrings): string {
  switch (type) {
    case 'govt_bus':
      return t.vehicleGovtBus;
    case 'private_bus':
      return t.vehiclePrivateBus;
    case 'school_van':
      return t.vehicleSchoolVan;
    case 'milk_van':
      return t.vehicleMilkVan;
    case 'ration_truck':
      return t.vehicleRationTruck;
    case 'tractor':
      return t.vehicleTractor;
    case 'auto':
      return t.vehicleAuto;
    case 'other':
    default:
      return t.vehicleOther;
  }
}

export function getVehicleSvgMarkup(type: VehicleType, color = '#1F2A2E'): string {
  switch (type) {
    case 'govt_bus':
      return `<svg viewBox="0 0 36 28" width="32" height="24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <rect x="2" y="4" width="32" height="17" rx="3" fill="#0E6B4E" stroke="${color}" stroke-width="2"/>
        <rect x="5" y="7" width="7" height="6" rx="1" fill="#F2F5F3"/>
        <rect x="14" y="7" width="7" height="6" rx="1" fill="#F2F5F3"/>
        <rect x="23" y="7" width="8" height="6" rx="1" fill="#F2F5F3"/>
        <rect x="2" y="15" width="32" height="3" fill="#FFC20E"/>
        <circle cx="9" cy="23" r="3" fill="${color}"/>
        <circle cx="27" cy="23" r="3" fill="${color}"/>
      </svg>`;
    case 'private_bus':
      return `<svg viewBox="0 0 36 28" width="32" height="24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <rect x="2" y="4" width="32" height="17" rx="3" fill="#FFFFFF" stroke="${color}" stroke-width="2"/>
        <rect x="5" y="7" width="6" height="6" rx="1" fill="#1F2A2E"/>
        <rect x="13" y="7" width="6" height="6" rx="1" fill="#1F2A2E"/>
        <rect x="21" y="7" width="10" height="6" rx="1" fill="#1F2A2E"/>
        <rect x="2" y="15" width="32" height="3" fill="#0E6B4E"/>
        <circle cx="9" cy="23" r="3" fill="${color}"/>
        <circle cx="27" cy="23" r="3" fill="${color}"/>
      </svg>`;
    case 'school_van':
      return `<svg viewBox="0 0 36 28" width="32" height="24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M3 9C3 7.34 4.34 6 6 6H23L31 12V21H3V9Z" fill="#FFC20E" stroke="${color}" stroke-width="2" stroke-linejoin="round"/>
        <rect x="6" y="9" width="7" height="5" rx="1" fill="#FFFFFF"/>
        <rect x="15" y="9" width="6" height="5" rx="1" fill="#FFFFFF"/>
        <path d="M23 9L28 13H23V9Z" fill="#FFFFFF"/>
        <circle cx="9" cy="23" r="3" fill="${color}"/>
        <circle cx="26" cy="23" r="3" fill="${color}"/>
      </svg>`;
    case 'milk_van':
      return `<svg viewBox="0 0 36 28" width="32" height="24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <rect x="2" y="6" width="20" height="15" rx="2" fill="#FFFFFF" stroke="${color}" stroke-width="2"/>
        <path d="M22 10H29L33 14V21H22V10Z" fill="#2F6FDE" stroke="${color}" stroke-width="2" stroke-linejoin="round"/>
        <path d="M10 10H14V12L15 14V18H9V14L10 12V10Z" fill="#2F6FDE"/>
        <circle cx="9" cy="23" r="3" fill="${color}"/>
        <circle cx="27" cy="23" r="3" fill="${color}"/>
      </svg>`;
    case 'ration_truck':
      return `<svg viewBox="0 0 36 28" width="32" height="24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <rect x="2" y="7" width="20" height="14" rx="1.5" fill="#D9822B" stroke="${color}" stroke-width="2"/>
        <line x1="8" y1="7" x2="8" y2="21" stroke="${color}" stroke-width="1.5"/>
        <line x1="15" y1="7" x2="15" y2="21" stroke="${color}" stroke-width="1.5"/>
        <path d="M22 11H29L33 15V21H22V11Z" fill="#FFC20E" stroke="${color}" stroke-width="2" stroke-linejoin="round"/>
        <circle cx="9" cy="23" r="3" fill="${color}"/>
        <circle cx="27" cy="23" r="3" fill="${color}"/>
      </svg>`;
    case 'tractor':
      return `<svg viewBox="0 0 36 28" width="32" height="24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <rect x="14" y="6" width="10" height="10" rx="1.5" fill="#0E6B4E" stroke="${color}" stroke-width="2"/>
        <rect x="16" y="8" width="6" height="4" fill="#F2F5F3"/>
        <path d="M4 13H14V19H4V13Z" fill="#0E6B4E" stroke="${color}" stroke-width="2"/>
        <line x1="7" y1="8" x2="7" y2="13" stroke="${color}" stroke-width="2.5"/>
        <circle cx="9" cy="22" r="3" fill="${color}"/>
        <circle cx="25" cy="20" r="5" fill="${color}" stroke="#FFC20E" stroke-width="2"/>
      </svg>`;
    case 'auto':
      return `<svg viewBox="0 0 36 28" width="32" height="24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M6 19V11C6 7.5 9.5 6 14 6H24L29 13V19H6Z" fill="#FFC20E" stroke="${color}" stroke-width="2" stroke-linejoin="round"/>
        <rect x="6" y="14" width="23" height="5" fill="#1F2A2E"/>
        <path d="M18 8H23L26 13H18V8Z" fill="#F2F5F3"/>
        <circle cx="10" cy="22" r="3" fill="${color}"/>
        <circle cx="25" cy="22" r="3" fill="${color}"/>
      </svg>`;
    case 'other':
    default:
      return `<svg viewBox="0 0 36 28" width="32" height="24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M4 14L9 8H24L31 14V20H4V14Z" fill="#F2F5F3" stroke="${color}" stroke-width="2" stroke-linejoin="round"/>
        <rect x="10" y="10" width="12" height="4" fill="#1F2A2E"/>
        <circle cx="10" cy="22" r="3" fill="${color}"/>
        <circle cx="25" cy="22" r="3" fill="${color}"/>
      </svg>`;
  }
}

export function VehicleIcon({
  type,
  className = 'w-9 h-7',
}: {
  type: VehicleType;
  className?: string;
}) {
  return (
    <span
      className={`inline-flex items-center justify-center shrink-0 ${className}`}
      aria-hidden="true"
      dangerouslySetInnerHTML={{ __html: getVehicleSvgMarkup(type) }}
    />
  );
}

export function createVehicleLeafletIcon(
  type: VehicleType,
  isOffline = false,
  isBroken = false,
  isDrill = false,
): L.DivIcon {
  const opacity = isBroken ? '0.62' : isOffline ? '0.55' : '1';
  const border = isBroken ? '#D7352B' : isOffline ? '#526066' : '#1F2A2E';
  const filterStyle = isBroken ? 'filter:grayscale(1);' : '';
  const brokenCross = isBroken
    ? `<span style="position:absolute;inset:-6px -6px auto auto;width:18px;height:18px;border-radius:999px;background:#D7352B;color:#FFFFFF;border:2px solid #FFFFFF;font-family:Archivo,sans-serif;font-weight:900;font-size:11px;line-height:14px;text-align:center;box-shadow:0 1px 4px rgba(31,42,46,0.35);">✕</span>`
    : '';
  const drillTag = isDrill
    ? `<span style="position:absolute;inset:auto auto -7px 50%;transform:translateX(-50%);padding:0 4px;border-radius:4px;background:#FFC20E;color:#1F2A2E;border:1px solid #1F2A2E;font-family:Archivo,sans-serif;font-weight:800;font-size:8px;line-height:11px;letter-spacing:0.04em;">DRILL</span>`
    : '';

  return L.divIcon({
    className: 'nx-vehicle-marker',
    html: `<div style="position:relative;display:flex;align-items:center;justify-content:center;width:42px;height:34px;background:#FFFFFF;border:2px solid ${border};border-radius:8px;box-shadow:0 2px 6px rgba(31,42,46,0.28);opacity:${opacity};${filterStyle}">${getVehicleSvgMarkup(type)}${brokenCross}${drillTag}</div>`,
    iconSize: [42, 34],
    iconAnchor: [21, 17],
  });
}
