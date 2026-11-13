import React, { useState } from 'react';
import {
  AlertTriangle,
  Ban,
  CheckCircle2,
  Plus,
  RefreshCw,
  Send,
  ShieldAlert,
} from 'lucide-react';
import { useI18n } from '../i18n/I18nContext';
import type { BlockedZone, DemandPin, SeatRequest, Trip } from '../types/firestore';
import { useCrisisPlanner } from './useCrisisPlanner';

interface CrisisDebugPanelProps {
  trips: Trip[];
  seatRequests: SeatRequest[];
  demandPins: DemandPin[];
}

export function CrisisDebugPanel({
  trips,
  seatRequests,
  demandPins,
}: CrisisDebugPanelProps) {
  const { t } = useI18n();
  const {
    plan,
    blockedZones,
    computing,
    crisisError,
    approvedIds,
    busyId,
    replanNow,
    createBlockedZone,
    toggleBlockedZone,
    approveReallocation,
  } = useCrisisPlanner({
    enabled: true,
    trips,
    seatRequests,
    demandPins,
  });

  const [zoneLabel, setZoneLabel] = useState('');
  const [zoneLat, setZoneLat] = useState('');
  const [zoneLng, setZoneLng] = useState('');
  const [zoneRadius, setZoneRadius] = useState('300');

  const kpis = plan?.kpis ?? {
    totalStudents: 0,
    examStudents: 0,
    onTime: 0,
    atRisk: 0,
    cannotReach: 0,
    seatUtilisationPct: 0,
    vehiclesReallocated: 0,
    averageSlackMinutes: 0,
  };

  const fcfs = plan?.fcfsKpis ?? {
    totalStudents: 0,
    examStudents: 0,
    onTime: 0,
    atRisk: 0,
    cannotReach: 0,
    seatUtilisationPct: 0,
    vehiclesReallocated: 0,
    averageSlackMinutes: 0,
  };

  const tier1Count = plan?.tieredStudents.filter((s) => s.tier === 1).length ?? 0;
  const tier2Count = plan?.tieredStudents.filter((s) => s.tier === 2).length ?? 0;

  const reasonLabel = (reason: 'no_seat' | 'road_blocked' | 'no_vehicle_in_range') => {
    if (reason === 'no_seat') return t.crisisReasonNoSeat;
    if (reason === 'road_blocked') return t.crisisReasonRoadBlocked;
    return t.crisisReasonNoVehicle;
  };

  const handleAddZone = async (e: React.FormEvent) => {
    e.preventDefault();
    const ok = await createBlockedZone({
      label: zoneLabel,
      lat: Number(zoneLat),
      lng: Number(zoneLng),
      radiusMeters: Number(zoneRadius),
    });
    if (ok) {
      setZoneLabel('');
      setZoneLat('');
      setZoneLng('');
    }
  };

  const metricRows: Array<{ label: string; fcfsVal: string; nxtVal: string }> = [
    {
      label: t.crisisKpiTotalStudents,
      fcfsVal: String(fcfs.totalStudents),
      nxtVal: String(kpis.totalStudents),
    },
    {
      label: t.crisisKpiExamStudents,
      fcfsVal: String(fcfs.examStudents),
      nxtVal: String(kpis.examStudents),
    },
    {
      label: t.crisisKpiOnTime,
      fcfsVal: String(fcfs.onTime),
      nxtVal: String(kpis.onTime),
    },
    {
      label: t.crisisKpiAtRisk,
      fcfsVal: String(fcfs.atRisk),
      nxtVal: String(kpis.atRisk),
    },
    {
      label: t.crisisKpiCannotReach,
      fcfsVal: String(fcfs.cannotReach),
      nxtVal: String(kpis.cannotReach),
    },
    {
      label: t.crisisKpiSeatUtilisation,
      fcfsVal: `${fcfs.seatUtilisationPct}%`,
      nxtVal: `${kpis.seatUtilisationPct}%`,
    },
    {
      label: t.crisisKpiReallocated,
      fcfsVal: String(fcfs.vehiclesReallocated),
      nxtVal: String(kpis.vehiclesReallocated),
    },
    {
      label: t.crisisKpiAvgSlack,
      fcfsVal: `${fcfs.averageSlackMinutes}m`,
      nxtVal: `${kpis.averageSlackMinutes}m`,
    },
  ];

  return (
    <section
      aria-label={t.crisisDebugTitle}
      className="bg-white border-2 border-[#1F2A2E] rounded-2xl overflow-hidden"
    >
      <div className="h-2 bg-[#D7352B] border-b border-[#1F2A2E]" aria-hidden="true" />
      <div className="p-4 sm:p-5 space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <ShieldAlert className="w-5 h-5 text-[#D7352B] shrink-0" aria-hidden="true" />
              <h2 className="font-sign font-bold text-lg text-[#1F2A2E]">
                {t.crisisDebugTitle}
              </h2>
            </div>
            <p className="text-sm text-[#526066]">{t.crisisDebugSubtitle}</p>
            <p className="text-xs text-[#526066]">
              {t.crisisAutoReplanNote} · {t.crisisTierSummaryLabel}: T1={tier1Count}, T2={tier2Count}
            </p>
          </div>

          <button
            type="button"
            disabled={computing}
            onClick={() => void replanNow()}
            className="min-h-[44px] px-4 rounded-xl bg-[#0E6B4E] hover:bg-[#0A523B] text-white font-bold text-sm inline-flex items-center justify-center gap-1.5 shrink-0 disabled:opacity-50"
          >
            <RefreshCw
              className={`w-4 h-4 shrink-0 ${computing ? 'animate-spin' : ''}`}
              aria-hidden="true"
            />
            <span>{t.crisisReplanNowBtn}</span>
          </button>
        </div>

        {crisisError && (
          <div
            role="alert"
            className="p-3 rounded-xl bg-[#D7352B]/10 border-2 border-[#D7352B] text-sm font-medium text-[#1F2A2E]"
          >
            {crisisError}
          </div>
        )}

        {plan && plan.validationErrors.length > 0 && (
          <div
            role="alert"
            className="p-3 rounded-xl bg-[#FFC20E]/20 border-2 border-[#FFC20E] space-y-1"
          >
            <p className="font-bold text-sm text-[#1F2A2E]">{t.crisisValidationTitle}</p>
            <ul className="list-disc pl-5 text-xs text-[#1F2A2E] space-y-0.5">
              {plan.validationErrors.map((err, idx) => (
                <li key={idx}>{err}</li>
              ))}
            </ul>
          </div>
        )}

        {/* FCFS vs Nxtpath Comparison Table */}
        <div className="space-y-2">
          <h3 className="font-sign font-bold text-base text-[#1F2A2E]">
            {t.crisisBaselineTitle}
          </h3>
          <div className="overflow-x-auto border border-[#D5DDD8] rounded-xl">
            <table className="w-full text-sm text-left">
              <thead className="bg-[#F2F5F3] border-b border-[#D5DDD8]">
                <tr>
                  <th className="py-2 px-3 font-bold text-[#1F2A2E]">{t.crisisMetricHeader}</th>
                  <th className="py-2 px-3 font-bold text-[#526066] text-right tabular-nums">
                    {t.crisisFcfsHeader}
                  </th>
                  <th className="py-2 px-3 font-bold text-[#0E6B4E] text-right tabular-nums">
                    {t.crisisNxtpathHeader}
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#D5DDD8]">
                {metricRows.map((row) => (
                  <tr key={row.label}>
                    <td className="py-2 px-3 text-[#1F2A2E] font-medium">{row.label}</td>
                    <td className="py-2 px-3 text-right text-[#526066] tabular-nums">
                      {row.fcfsVal}
                    </td>
                    <td className="py-2 px-3 text-right font-bold text-[#0E6B4E] tabular-nums">
                      {row.nxtVal}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Blocked Road Zones */}
        <div className="space-y-2.5 pt-2 border-t border-[#D5DDD8]">
          <div className="flex items-center gap-2">
            <Ban className="w-4 h-4 text-[#D7352B]" aria-hidden="true" />
            <h3 className="font-sign font-bold text-base text-[#1F2A2E]">
              {t.crisisBlockedZonesTitle} ({blockedZones.length})
            </h3>
          </div>

          {blockedZones.length === 0 ? (
            <p className="text-sm text-[#526066]">{t.crisisBlockedZonesEmpty}</p>
          ) : (
            <div className="space-y-2">
              {blockedZones.map((zone: BlockedZone) => (
                <div
                  key={zone.id}
                  className="p-2.5 rounded-xl bg-[#F2F5F3] border border-[#D5DDD8] flex items-center justify-between gap-2"
                >
                  <div className="min-w-0">
                    <p className="font-bold text-sm text-[#1F2A2E] truncate">{zone.label}</p>
                    <p className="text-xs text-[#526066] font-mono tabular-nums">
                      {zone.center.lat.toFixed(4)}, {zone.center.lng.toFixed(4)} · r=
                      {zone.radiusMeters}m
                    </p>
                  </div>
                  <button
                    type="button"
                    disabled={busyId === zone.id}
                    onClick={() => void toggleBlockedZone(zone)}
                    className={`min-h-[38px] px-3 rounded-lg text-xs font-bold border transition-colors shrink-0 ${
                      zone.active
                        ? 'bg-[#D7352B] text-white border-[#1F2A2E]'
                        : 'bg-white text-[#526066] border-[#D5DDD8]'
                    }`}
                  >
                    {zone.active ? t.crisisZoneActive : t.crisisZoneInactive}
                  </button>
                </div>
              ))}
            </div>
          )}

          <form onSubmit={(e) => void handleAddZone(e)} className="grid grid-cols-1 sm:grid-cols-5 gap-2">
            <input
              type="text"
              value={zoneLabel}
              onChange={(e) => setZoneLabel(e.target.value)}
              placeholder={t.crisisAddZoneLabelPlaceholder}
              className="sm:col-span-2 min-h-[42px] px-3 rounded-xl border border-[#D5DDD8] bg-white text-sm text-[#1F2A2E]"
            />
            <input
              type="number"
              step="any"
              value={zoneLat}
              onChange={(e) => setZoneLat(e.target.value)}
              placeholder="Lat (e.g. 12.52)"
              className="min-h-[42px] px-3 rounded-xl border border-[#D5DDD8] bg-white text-sm text-[#1F2A2E]"
            />
            <input
              type="number"
              step="any"
              value={zoneLng}
              onChange={(e) => setZoneLng(e.target.value)}
              placeholder="Lng (e.g. 76.89)"
              className="min-h-[42px] px-3 rounded-xl border border-[#D5DDD8] bg-white text-sm text-[#1F2A2E]"
            />
            <div className="flex gap-2">
              <input
                type="number"
                min={20}
                max={50000}
                value={zoneRadius}
                onChange={(e) => setZoneRadius(e.target.value)}
                aria-label="Radius meters"
                className="w-20 min-h-[42px] px-2 rounded-xl border border-[#D5DDD8] bg-white text-sm text-[#1F2A2E] tabular-nums"
              />
              <button
                type="submit"
                disabled={busyId === 'add-zone'}
                className="flex-1 min-h-[42px] px-3 rounded-xl bg-[#1F2A2E] text-white font-bold text-xs inline-flex items-center justify-center gap-1 disabled:opacity-50"
              >
                <Plus className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                <span className="truncate">{t.crisisAddZoneBtn}</span>
              </button>
            </div>
          </form>
        </div>

        {/* Reallocation Proposals */}
        <div className="space-y-2 pt-2 border-t border-[#D5DDD8]">
          <h3 className="font-sign font-bold text-base text-[#1F2A2E]">
            {t.crisisReallocationsTitle} ({plan?.reallocations.length ?? 0})
          </h3>
          {!plan || plan.reallocations.length === 0 ? (
            <p className="text-sm text-[#526066]">{t.crisisReallocationsEmpty}</p>
          ) : (
            <div className="space-y-2">
              {plan.reallocations.map((prop) => {
                const isApproved = Boolean(approvedIds[prop.id]);
                return (
                  <div
                    key={prop.id}
                    className="p-3 rounded-xl bg-[#F2F5F3] border border-[#1F2A2E] flex flex-col sm:flex-row sm:items-center justify-between gap-2.5"
                  >
                    <div className="min-w-0 space-y-0.5">
                      <p className="font-bold text-sm text-[#1F2A2E]">
                        {prop.driverName} · {prop.clusterPlace} ({prop.studentCount})
                      </p>
                      <p className="text-xs text-[#526066] tabular-nums">
                        {prop.reasonTag} · +{prop.detourMinutes} {t.crisisDetourMinSuffix}
                      </p>
                    </div>
                    <button
                      type="button"
                      disabled={isApproved || busyId === prop.id}
                      onClick={() => void approveReallocation(prop)}
                      className={`min-h-[40px] px-3.5 rounded-xl text-xs font-bold inline-flex items-center justify-center gap-1.5 shrink-0 ${
                        isApproved
                          ? 'bg-[#0E6B4E]/15 text-[#0E6B4E] border border-[#0E6B4E]'
                          : 'bg-[#0E6B4E] text-white'
                      }`}
                    >
                      {isApproved ? (
                        <>
                          <CheckCircle2 className="w-4 h-4 shrink-0" aria-hidden="true" />
                          <span>{t.crisisApprovedBadge}</span>
                        </>
                      ) : (
                        <>
                          <Send className="w-4 h-4 shrink-0" aria-hidden="true" />
                          <span>{t.crisisApproveBtn}</span>
                        </>
                      )}
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Unreachable Students (never hidden) */}
        <div className="space-y-2 pt-2 border-t border-[#D5DDD8]">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-[#D7352B]" aria-hidden="true" />
            <h3 className="font-sign font-bold text-base text-[#1F2A2E]">
              {t.crisisUnreachableTitle} ({plan?.unreachable.length ?? 0})
            </h3>
          </div>
          {!plan || plan.unreachable.length === 0 ? (
            <p className="text-sm text-[#526066]">{t.crisisUnreachableEmpty}</p>
          ) : (
            <div className="space-y-2">
              {plan.unreachable.map((item) => (
                <div
                  key={item.requestId}
                  className="p-2.5 rounded-xl bg-[#D7352B]/10 border border-[#D7352B] flex items-start justify-between gap-2"
                >
                  <div className="min-w-0">
                    <p className="font-bold text-sm text-[#1F2A2E] truncate">
                      T{item.tier} · {item.studentName}
                    </p>
                    <p className="text-xs text-[#526066]">{item.detail}</p>
                  </div>
                  <span className="px-2 py-0.5 rounded-md bg-white border border-[#D7352B] text-[11px] font-bold text-[#D7352B] shrink-0">
                    {reasonLabel(item.reason)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
