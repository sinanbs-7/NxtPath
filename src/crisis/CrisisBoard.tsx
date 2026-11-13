import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  Ban,
  CheckCircle2,
  Clock,
  Crosshair,
  Flame,
  MessageCircle,
  RefreshCw,
  Send,
  ShieldAlert,
  Sparkles,
  Square,
  Users,
} from 'lucide-react';
import { composeCannotReachMessage, fetchCrisisBriefing } from '../ai/geminiClient';
import {
  buildWhatsAppShareUrl,
  fallbackAdminBriefing,
  type AdminBriefingResponse,
} from '../ai/geminiSchemas';
import { useI18n } from '../i18n/I18nContext';
import { NxtMap, type ExamStudentOverlay, type ExtraRouteOverlay, type LiveVehicleMarker } from '../map/NxtMap';
import { isLivePositionFresh } from '../matching/matchRides';
import type {
  BlockedZone,
  DemandPin,
  LatLngPoint,
  SeatRequest,
  Trip,
} from '../types/firestore';
import { BottomSheet } from '../ui/BottomSheet';
import type { SheetSnap } from '../ui/bottomSheet';
import { computeSurgeCount } from './crisisDrillHelpers';
import { useCrisisPlanner } from './useCrisisPlanner';

interface CrisisBoardProps {
  trips: Trip[];
  seatRequests: SeatRequest[];
  demandPins: DemandPin[];
  onBack: () => void;
}

function useIsDesktopLg(): boolean {
  const [isLg, setIsLg] = useState(() =>
    typeof window !== 'undefined' ? window.innerWidth >= 1024 : true,
  );
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 1024px)');
    const update = () => setIsLg(mq.matches);
    update();
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, []);
  return isLg;
}

function defaultExamHHmm(): string {
  const d = new Date(Date.now() + 2 * 60 * 60 * 1000);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function parseTodayHHmmToMs(hhmm: string): number {
  const parts = hhmm.split(':');
  const hh = Number(parts[0]);
  const mm = Number(parts[1]);
  if (!Number.isFinite(hh) || !Number.isFinite(mm)) {
    return Date.now() + 2 * 60 * 60 * 1000;
  }
  const target = new Date();
  target.setHours(hh, mm, 0, 0);
  if (target.getTime() < Date.now() - 30 * 60_000) {
    target.setDate(target.getDate() + 1);
  }
  return target.getTime();
}

export function CrisisBoard({ trips, seatRequests, demandPins, onBack }: CrisisBoardProps) {
  const { t, language } = useI18n();
  const isDesktop = useIsDesktopLg();
  const [sheetSnap, setSheetSnap] = useState<SheetSnap>('half');
  const [drillOpen, setDrillOpen] = useState(false);
  const [examHHmm, setExamHHmm] = useState(defaultExamHHmm);
  const [selectedBreakIds, setSelectedBreakIds] = useState<string[]>([]);
  const [addDrillVehicles, setAddDrillVehicles] = useState(true);
  const [placingFloodZone, setPlacingFloodZone] = useState(false);
  const [zoneLabel, setZoneLabel] = useState('Flooded bridge');
  const [zoneRadiusMeters, setZoneRadiusMeters] = useState(400);
  const [briefing, setBriefing] = useState<AdminBriefingResponse | null>(null);
  const [briefingBusy, setBriefingBusy] = useState(false);
  const [draftedNotices, setDraftedNotices] = useState<Record<string, string>>({});
  const [draftingStudentId, setDraftingStudentId] = useState<string | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    const id = window.setInterval(() => setNowMs(Date.now()), 15_000);
    return () => window.clearInterval(id);
  }, []);

  const {
    plan,
    livePositionsByTripId,
    blockedZones,
    reallocationStatusByTrip,
    computing,
    drillBusy,
    isDrillActive,
    crisisError,
    approvedIds,
    busyId,
    replanNow,
    createBlockedZone,
    toggleBlockedZone,
    approveReallocation,
    startCrisisDrill,
    endCrisisDrill,
  } = useCrisisPlanner({
    enabled: true,
    trips,
    seatRequests,
    demandPins,
  });

  const realActiveTrips = useMemo(
    () => trips.filter((tr) => !tr.isDrill && (tr.status === 'live' || tr.status === 'scheduled')),
    [trips],
  );

  const realStudentCount = useMemo(() => {
    const ids = new Set<string>();
    seatRequests.forEach((r) => {
      if (!r.isDrill && (r.status === 'pending' || r.status === 'accepted')) ids.add(r.studentId);
    });
    demandPins.forEach((p) => {
      if (!p.isDrill && p.active) ids.add(p.studentId);
    });
    return ids.size;
  }, [seatRequests, demandPins]);

  const previewSurgeCount = useMemo(() => computeSurgeCount(realStudentCount), [realStudentCount]);

  // Pre-select up to 2 live/scheduled real vehicles when opening drill panel if none picked yet
  useEffect(() => {
    if (drillOpen && selectedBreakIds.length === 0 && realActiveTrips.length > 0) {
      setSelectedBreakIds(realActiveTrips.slice(0, 2).map((tr) => tr.id));
    }
  }, [drillOpen, realActiveTrips, selectedBreakIds.length]);

  const loadBriefing = async () => {
    if (!plan) return;
    setBriefingBusy(true);
    const input = {
      language,
      kpis: {
        totalStudents: plan.kpis.totalStudents,
        examStudents: plan.kpis.examStudents,
        onTime: plan.kpis.onTime,
        atRisk: plan.kpis.atRisk,
        cannotReach: plan.kpis.cannotReach,
        vehiclesReallocated: plan.kpis.vehiclesReallocated,
      },
      fcfsOnTime: plan.fcfsKpis.onTime,
      blockedZoneLabels: blockedZones.filter((z) => z.active).map((z) => z.label),
      topProposals: plan.reallocations.slice(0, 3).map((r) => ({
        driverName: r.driverName,
        clusterPlace: r.clusterPlace,
        studentCount: r.studentCount,
        detourMinutes: r.detourMinutes,
      })),
    };
    setBriefing(fallbackAdminBriefing(input));
    try {
      const res = await fetchCrisisBriefing(input);
      setBriefing(res);
    } finally {
      setBriefingBusy(false);
    }
  };

  useEffect(() => {
    if (plan && plan.tieredStudents.length > 0 && !briefing) {
      void loadBriefing();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plan?.computedAtMs]);

  const handleToggleBreakTrip = (tripId: string) => {
    setSelectedBreakIds((prev) => {
      if (prev.includes(tripId)) return prev.filter((id) => id !== tripId);
      if (prev.length >= 2) return [prev[1], tripId];
      return [...prev, tripId];
    });
  };

  const handleMapClick = async (pt: LatLngPoint) => {
    if (!placingFloodZone) return;
    const label = zoneLabel.trim() || 'Flooded road';
    const ok = await createBlockedZone({
      label,
      lat: pt.lat,
      lng: pt.lng,
      radiusMeters: zoneRadiusMeters,
      isDrill: true,
    });
    if (ok) {
      setPlacingFloodZone(false);
    }
  };

  const handleRunDrill = async () => {
    const ok = await startCrisisDrill({
      examStartMs: parseTodayHHmmToMs(examHHmm),
      breakTripIds: selectedBreakIds,
      addDrillVehicles,
    });
    if (ok) {
      setDrillOpen(false);
      await loadBriefing();
    }
  };

  const mapVehicles = useMemo<LiveVehicleMarker[]>(() => {
    return trips.map((tr) => {
      const lp = livePositionsByTripId[tr.id];
      const isBroken = tr.status === 'unavailable' || tr.status === 'disrupted';
      return {
        tripId: tr.id,
        vehicleType: tr.vehicleType,
        driverName: tr.driverName,
        driverVerified: tr.driverVerified,
        seatsFree: tr.seatsFree,
        lat: lp ? lp.lat : tr.originLat,
        lng: lp ? lp.lng : tr.originLng,
        isOffline: tr.status === 'live' && lp ? !isLivePositionFresh(lp, nowMs) : false,
        isSelected: plan?.assignments.some((a) => a.tripId === tr.id) ?? false,
        isBroken,
        isDrill: Boolean(tr.isDrill),
      };
    });
  }, [trips, livePositionsByTripId, nowMs, plan]);

  const extraRoutes = useMemo<ExtraRouteOverlay[]>(() => {
    const assignedTripIds = new Set(plan?.assignments.map((a) => a.tripId) ?? []);
    const reallocTripIds = new Set(plan?.reallocations.map((r) => r.tripId) ?? []);

    const list: ExtraRouteOverlay[] = [];
    for (const tr of trips) {
      if (tr.routeGeometry.length < 2) continue;
      if (tr.status === 'unavailable' || tr.status === 'disrupted') continue;
      const isRealloc = reallocTripIds.has(tr.id);
      const isAssigned = assignedTripIds.has(tr.id);
      if (isRealloc || isAssigned) {
        list.push({
          id: `route-${tr.id}`,
          geometry: tr.routeGeometry,
          color: '#0E6B4E',
          animate: isRealloc,
        });
      }
    }
    return list;
  }, [trips, plan]);

  const disruptedPolyline = useMemo(() => {
    const broken = trips.find(
      (tr) => (tr.status === 'unavailable' || tr.status === 'disrupted') && tr.routeGeometry.length >= 2,
    );
    return broken?.routeGeometry ?? null;
  }, [trips]);

  const examStudentMarkers = useMemo<ExamStudentOverlay[]>(() => {
    if (!plan) return [];
    const assignByStudent = new Map(plan.assignments.map((a) => [a.studentId, a]));
    const unreachByStudent = new Map(plan.unreachable.map((u) => [u.studentId, u]));
    return plan.tieredStudents
      .filter((ts) => ts.tier === 1 || ts.student.examAtMs !== null)
      .map((ts) => {
        const assign = assignByStudent.get(ts.student.studentId);
        const unreach = unreachByStudent.get(ts.student.studentId);
        return {
          id: ts.student.studentId,
          name: ts.student.studentName,
          lat: ts.student.pickup.lat,
          lng: ts.student.pickup.lng,
          isAtRisk: Boolean(assign?.atRisk),
          unreachable: Boolean(unreach),
          isDrill: Boolean(ts.student.isDrill),
          detail: assign
            ? `${assign.driverName} · ${ts.slackMinutes ?? 0}m slack`
            : unreach?.detail,
        };
      });
  }, [plan]);

  const focusBoundsPoints = useMemo<LatLngPoint[]>(() => {
    const pts: LatLngPoint[] = [];
    mapVehicles.forEach((v) => pts.push({ lat: v.lat, lng: v.lng }));
    examStudentMarkers.forEach((s) => pts.push({ lat: s.lat, lng: s.lng }));
    blockedZones.forEach((z) => pts.push(z.center));
    return pts;
  }, [mapVehicles, examStudentMarkers, blockedZones]);

  const rankedExamStudents = useMemo(() => {
    if (!plan) return [];
    const assignByStudent = new Map(plan.assignments.map((a) => [a.studentId, a]));
    const unreachByStudent = new Map(plan.unreachable.map((u) => [u.studentId, u]));
    return plan.tieredStudents
      .filter((ts) => ts.tier === 1 || ts.student.examAtMs !== null)
      .sort((a, b) => (a.slackMinutes ?? -999) - (b.slackMinutes ?? -999))
      .map((ts) => ({
        tiered: ts,
        assignment: assignByStudent.get(ts.student.studentId) ?? null,
        unreachable: unreachByStudent.get(ts.student.studentId) ?? null,
      }));
  }, [plan]);

  const reasonLabel = (reason: 'no_seat' | 'road_blocked' | 'no_vehicle_in_range') => {
    if (reason === 'no_seat') return t.crisisReasonNoSeat;
    if (reason === 'road_blocked') return t.crisisReasonRoadBlocked;
    return t.crisisReasonNoVehicle;
  };

  const handleDraftCannotReachNotice = async (item: {
    studentId: string;
    studentName: string;
    reason: 'no_seat' | 'road_blocked' | 'no_vehicle_in_range';
    detail: string;
  }) => {
    setDraftingStudentId(item.studentId);
    try {
      const firstTrip = trips.find((tr) => tr.destinationName);
      const res = await composeCannotReachMessage({
        language,
        studentName: item.studentName,
        destinationName: firstTrip?.destinationName || 'School',
        reason: item.reason,
        detail: item.detail,
      });
      setDraftedNotices((prev) => ({ ...prev, [item.studentId]: res.message }));
    } finally {
      setDraftingStudentId(null);
    }
  };

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

  const panelBody = (
    <div className="space-y-4">
      {isDrillActive && (
        <div
          role="status"
          data-testid="crisis-drill-banner"
          className="p-3 rounded-xl bg-[#FFC20E] border-2 border-[#1F2A2E] flex items-center justify-between gap-2"
        >
          <div className="min-w-0">
            <span className="inline-block px-1.5 py-0.5 rounded bg-[#1F2A2E] text-[#FFC20E] font-sign font-extrabold text-[10px] mr-1.5">
              {t.crisisDrillBadge}
            </span>
            <span className="text-xs font-extrabold text-[#1F2A2E]">{t.crisisDrillBanner}</span>
          </div>
          <button
            type="button"
            disabled={drillBusy !== null}
            onClick={() => void endCrisisDrill()}
            data-testid="end-crisis-drill-btn"
            className="min-h-[38px] px-3 rounded-lg bg-[#D7352B] text-white font-bold text-xs inline-flex items-center gap-1 shrink-0 disabled:opacity-60"
          >
            <Square className="w-3.5 h-3.5" aria-hidden="true" />
            <span>{drillBusy === 'ending' ? t.crisisDrillEndingBtn : t.crisisDrillEndBtn}</span>
          </button>
        </div>
      )}

      {/* Action bar: Start drill + Replan */}
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => setDrillOpen((v) => !v)}
          data-testid="start-crisis-drill-btn"
          className="flex-1 min-h-[46px] px-3.5 rounded-xl bg-[#D7352B] hover:bg-[#b82a21] text-white border-2 border-[#1F2A2E] font-sign font-bold text-sm inline-flex items-center justify-center gap-2"
        >
          <Flame className="w-4 h-4 shrink-0" aria-hidden="true" />
          <span>{t.crisisDrillStartBtn}</span>
        </button>

        <button
          type="button"
          disabled={computing}
          onClick={() => void replanNow()}
          className="min-h-[46px] px-3.5 rounded-xl bg-[#0E6B4E] hover:bg-[#0A523B] text-white border-2 border-[#1F2A2E] font-bold text-xs inline-flex items-center justify-center gap-1.5 disabled:opacity-50"
        >
          <RefreshCw className={`w-4 h-4 ${computing ? 'animate-spin' : ''}`} aria-hidden="true" />
          <span>{t.crisisReplanNowBtn}</span>
        </button>
      </div>

      {crisisError && (
        <div
          role="alert"
          className="p-3 rounded-xl bg-[#D7352B]/10 border-2 border-[#D7352B] text-xs font-bold text-[#1F2A2E]"
        >
          {crisisError}
        </div>
      )}

      {/* Interactive Crisis Drill Builder */}
      {drillOpen && (
        <section
          aria-label={t.crisisDrillStartBtn}
          data-testid="crisis-drill-panel"
          className="p-4 rounded-2xl bg-white border-2 border-[#1F2A2E] space-y-3.5"
        >
          <div className="flex items-center justify-between gap-2">
            <h2 className="font-sign font-bold text-base text-[#1F2A2E]">
              {t.crisisDrillStartBtn}
            </h2>
            <span className="px-2 py-0.5 rounded bg-[#FFC20E] border border-[#1F2A2E] text-[10px] font-extrabold text-[#1F2A2E]">
              {t.crisisDrillBadge}
            </span>
          </div>

          <label className="flex items-center justify-between gap-2 p-2.5 rounded-xl bg-[#F2F5F3] border border-[#D5DDD8]">
            <span className="text-xs font-bold text-[#1F2A2E] inline-flex items-center gap-1.5">
              <Clock className="w-4 h-4 text-[#D7352B]" aria-hidden="true" />
              <span>{t.crisisDrillExamStartLabel}</span>
            </span>
            <input
              type="time"
              value={examHHmm}
              onChange={(e) => setExamHHmm(e.target.value)}
              className="px-2.5 py-1 rounded-lg bg-white border border-[#1F2A2E] text-sm font-bold tabular-nums"
            />
          </label>

          {/* Break up to 2 real vehicles */}
          <div className="space-y-1.5">
            <p className="text-xs font-bold text-[#1F2A2E]">{t.crisisDrillBreakVehiclesLabel}</p>
            {realActiveTrips.length === 0 ? (
              <p className="text-xs text-[#526066]">{t.crisisDrillBreakVehiclesEmpty}</p>
            ) : (
              <div className="space-y-1.5 max-h-36 overflow-y-auto">
                {realActiveTrips.map((tr) => {
                  const checked = selectedBreakIds.includes(tr.id);
                  return (
                    <label
                      key={tr.id}
                      className={`p-2 rounded-xl border flex items-center justify-between gap-2 cursor-pointer text-xs ${
                        checked
                          ? 'bg-[#D7352B]/10 border-[#D7352B] font-bold'
                          : 'bg-[#F2F5F3] border-[#D5DDD8]'
                      }`}
                    >
                      <span className="truncate text-[#1F2A2E]">
                        {tr.driverName} · {tr.destinationName} ({tr.seatsFree}/{tr.seatsTotal})
                      </span>
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => handleToggleBreakTrip(tr.id)}
                        className="w-4 h-4 accent-[#D7352B]"
                      />
                    </label>
                  );
                })}
              </div>
            )}
          </div>

          {/* Flooded road map placer */}
          <div className="p-3 rounded-xl bg-[#F2F5F3] border border-[#D5DDD8] space-y-2.5">
            <p className="text-xs font-bold text-[#1F2A2E]">{t.crisisDrillFloodZoneLabel}</p>
            <input
              type="text"
              value={zoneLabel}
              onChange={(e) => setZoneLabel(e.target.value)}
              placeholder={t.crisisAddZoneLabelPlaceholder}
              className="w-full min-h-[40px] px-3 rounded-lg bg-white border border-[#1F2A2E] text-xs font-medium text-[#1F2A2E]"
            />
            <label className="block space-y-1">
              <div className="flex items-center justify-between text-xs text-[#526066]">
                <span>{t.crisisDrillRadiusLabel}</span>
                <span className="font-bold text-[#1F2A2E] tabular-nums">{zoneRadiusMeters} m</span>
              </div>
              <input
                type="range"
                min={100}
                max={3000}
                step={50}
                value={zoneRadiusMeters}
                onChange={(e) => setZoneRadiusMeters(Number(e.target.value))}
                className="w-full accent-[#D7352B]"
              />
            </label>
            <button
              type="button"
              onClick={() => {
                setPlacingFloodZone((v) => !v);
                if (!isDesktop) setSheetSnap('collapsed');
              }}
              className={`w-full min-h-[42px] px-3 rounded-xl border-2 border-[#1F2A2E] text-xs font-bold inline-flex items-center justify-center gap-1.5 ${
                placingFloodZone
                  ? 'bg-[#D7352B] text-white'
                  : 'bg-white text-[#1F2A2E]'
              }`}
            >
              <Crosshair className="w-4 h-4 shrink-0" aria-hidden="true" />
              <span>
                {placingFloodZone ? t.crisisDrillTapMapActive : t.crisisDrillTapMapBtn}
              </span>
            </button>
          </div>

          {/* Surge summary + Add drill vehicles */}
          <div className="p-2.5 rounded-xl bg-[#FFC20E]/20 border border-[#1F2A2E] text-xs text-[#1F2A2E] flex items-center justify-between gap-2">
            <span className="font-bold inline-flex items-center gap-1.5">
              <Users className="w-4 h-4 shrink-0" aria-hidden="true" />
              <span>{t.crisisDrillSurgeLabel}</span>
            </span>
            <span className="font-sign font-extrabold text-sm tabular-nums">+{previewSurgeCount}</span>
          </div>

          <label className="flex items-center justify-between gap-2 p-2.5 rounded-xl bg-[#F2F5F3] border border-[#D5DDD8] cursor-pointer">
            <span className="text-xs font-bold text-[#1F2A2E]">{t.crisisDrillAddVehiclesLabel}</span>
            <input
              type="checkbox"
              checked={addDrillVehicles}
              onChange={(e) => setAddDrillVehicles(e.target.checked)}
              className="w-4 h-4 accent-[#0E6B4E]"
            />
          </label>

          <button
            type="button"
            disabled={drillBusy !== null}
            onClick={() => void handleRunDrill()}
            data-testid="run-crisis-drill-btn"
            className="w-full min-h-[48px] px-4 rounded-xl bg-[#0E6B4E] hover:bg-[#0A523B] text-white font-sign font-bold text-sm border-2 border-[#1F2A2E] disabled:opacity-60"
          >
            {drillBusy === 'starting' ? t.crisisDrillRunningBtn : t.crisisDrillRunBtn}
          </button>
        </section>
      )}

      {/* Headline KPI Row */}
      <section aria-label="Crisis KPIs" className="grid grid-cols-3 gap-2">
        <div className="bg-white border-2 border-[#1F2A2E] rounded-2xl p-3 space-y-0.5">
          <p className="text-[11px] font-bold text-[#526066] truncate">{t.crisisKpiOnTime}</p>
          <p className="font-sign font-extrabold text-2xl text-[#0E6B4E] tabular-nums">
            {kpis.onTime}
          </p>
        </div>
        <div className="bg-white border-2 border-[#1F2A2E] rounded-2xl p-3 space-y-0.5">
          <p className="text-[11px] font-bold text-[#526066] truncate">{t.crisisKpiAtRisk}</p>
          <p className="font-sign font-extrabold text-2xl text-[#b45309] tabular-nums">
            {kpis.atRisk}
          </p>
        </div>
        <div className="bg-white border-2 border-[#1F2A2E] rounded-2xl p-3 space-y-0.5">
          <p className="text-[11px] font-bold text-[#526066] truncate">{t.crisisKpiCannotReach}</p>
          <p className="font-sign font-extrabold text-2xl text-[#D7352B] tabular-nums">
            {kpis.cannotReach}
          </p>
        </div>
      </section>

      {/* Gemini Admin Briefing (<= 60 words) */}
      {briefing && (
        <section
          aria-label={t.crisisAiBriefingTitle}
          className="bg-white border-2 border-[#1F2A2E] rounded-2xl p-3.5 space-y-2"
        >
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5">
              <Sparkles className="w-4 h-4 text-[#0E6B4E] shrink-0" aria-hidden="true" />
              <h2 className="font-sign font-bold text-sm text-[#1F2A2E]">
                {t.crisisAiBriefingTitle}
              </h2>
            </div>
            <button
              type="button"
              disabled={briefingBusy}
              onClick={() => void loadBriefing()}
              className="text-xs font-bold text-[#0E6B4E] underline disabled:opacity-50"
            >
              {t.crisisAiBriefingRefresh}
            </button>
          </div>
          <p className="font-bold text-sm text-[#1F2A2E]">{briefing.headline}</p>
          <ol className="list-decimal pl-4 text-xs text-[#526066] space-y-1">
            {briefing.actions.map((act, idx) => (
              <li key={idx}>{act}</li>
            ))}
          </ol>
        </section>
      )}

      {/* FCFS vs Nxtpath Comparison */}
      <section className="bg-white border-2 border-[#1F2A2E] rounded-2xl p-3.5 space-y-2">
        <h2 className="font-sign font-bold text-sm text-[#1F2A2E]">{t.crisisBaselineTitle}</h2>
        <div className="overflow-x-auto border border-[#D5DDD8] rounded-xl">
          <table className="w-full text-xs text-left">
            <thead className="bg-[#F2F5F3] border-b border-[#D5DDD8]">
              <tr>
                <th className="py-1.5 px-2.5 font-bold text-[#1F2A2E]">{t.crisisMetricHeader}</th>
                <th className="py-1.5 px-2.5 font-bold text-[#526066] text-right tabular-nums">
                  {t.crisisFcfsHeader}
                </th>
                <th className="py-1.5 px-2.5 font-bold text-[#0E6B4E] text-right tabular-nums">
                  {t.crisisNxtpathHeader}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#D5DDD8]">
              <tr>
                <td className="py-1.5 px-2.5 font-medium">{t.crisisKpiOnTime}</td>
                <td className="py-1.5 px-2.5 text-right tabular-nums">{fcfs.onTime}</td>
                <td className="py-1.5 px-2.5 text-right font-bold text-[#0E6B4E] tabular-nums">
                  {kpis.onTime}
                </td>
              </tr>
              <tr>
                <td className="py-1.5 px-2.5 font-medium">{t.crisisKpiCannotReach}</td>
                <td className="py-1.5 px-2.5 text-right tabular-nums">{fcfs.cannotReach}</td>
                <td className="py-1.5 px-2.5 text-right font-bold text-[#D7352B] tabular-nums">
                  {kpis.cannotReach}
                </td>
              </tr>
              <tr>
                <td className="py-1.5 px-2.5 font-medium">{t.crisisKpiSeatUtilisation}</td>
                <td className="py-1.5 px-2.5 text-right tabular-nums">{fcfs.seatUtilisationPct}%</td>
                <td className="py-1.5 px-2.5 text-right font-bold text-[#0E6B4E] tabular-nums">
                  {kpis.seatUtilisationPct}%
                </td>
              </tr>
              <tr>
                <td className="py-1.5 px-2.5 font-medium">{t.crisisKpiAvgSlack}</td>
                <td className="py-1.5 px-2.5 text-right tabular-nums">{fcfs.averageSlackMinutes}m</td>
                <td className="py-1.5 px-2.5 text-right font-bold text-[#0E6B4E] tabular-nums">
                  {kpis.averageSlackMinutes}m
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      {/* Active Blocked Zones */}
      <section className="bg-white border-2 border-[#1F2A2E] rounded-2xl p-3.5 space-y-2">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5">
            <Ban className="w-4 h-4 text-[#D7352B]" aria-hidden="true" />
            <h2 className="font-sign font-bold text-sm text-[#1F2A2E]">
              {t.crisisBlockedZonesTitle} ({blockedZones.length})
            </h2>
          </div>
          {!drillOpen && (
            <button
              type="button"
              onClick={() => {
                setPlacingFloodZone((v) => !v);
                if (!isDesktop) setSheetSnap('collapsed');
              }}
              className={`min-h-[34px] px-2.5 rounded-lg border text-[11px] font-bold ${
                placingFloodZone
                  ? 'bg-[#D7352B] text-white border-[#1F2A2E]'
                  : 'bg-[#F2F5F3] text-[#1F2A2E] border-[#1F2A2E]'
              }`}
            >
              {placingFloodZone ? t.crisisDrillTapMapActive : t.crisisDrillTapMapBtn}
            </button>
          )}
        </div>

        {blockedZones.length === 0 ? (
          <p className="text-xs text-[#526066]">{t.crisisBlockedZonesEmpty}</p>
        ) : (
          <div className="space-y-1.5">
            {blockedZones.map((zone: BlockedZone) => (
              <div
                key={zone.id}
                className="p-2 rounded-xl bg-[#F2F5F3] border border-[#D5DDD8] flex items-center justify-between gap-2"
              >
                <div className="min-w-0">
                  <p className="font-bold text-xs text-[#1F2A2E] truncate">
                    {zone.label}
                    {zone.isDrill && (
                      <span className="ml-1.5 px-1.5 py-0.5 rounded bg-[#FFC20E] text-[10px] font-extrabold">
                        {t.crisisDrillBadge}
                      </span>
                    )}
                  </p>
                  <p className="text-[11px] text-[#526066] font-mono tabular-nums">
                    r={zone.radiusMeters}m
                  </p>
                </div>
                <button
                  type="button"
                  disabled={busyId === zone.id}
                  onClick={() => void toggleBlockedZone(zone)}
                  className={`min-h-[32px] px-2.5 rounded-lg text-[11px] font-bold border ${
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
      </section>

      {/* Ranked Exam Students (Tier 1) */}
      <section className="bg-white border-2 border-[#1F2A2E] rounded-2xl p-3.5 space-y-2">
        <h2 className="font-sign font-bold text-sm text-[#1F2A2E]">
          {t.crisisRankedExamTitle} ({rankedExamStudents.length})
        </h2>
        {rankedExamStudents.length === 0 ? (
          <p className="text-xs text-[#526066]">{t.crisisRankedExamEmpty}</p>
        ) : (
          <div className="space-y-2 max-h-60 overflow-y-auto">
            {rankedExamStudents.map(({ tiered, assignment, unreachable }) => {
              const isAtRisk = Boolean(assignment?.atRisk);
              return (
                <div
                  key={tiered.student.requestId}
                  className="p-2.5 rounded-xl bg-[#F2F5F3] border border-[#D5DDD8] flex items-start justify-between gap-2"
                >
                  <div className="min-w-0 space-y-0.5">
                    <p className="font-bold text-xs text-[#1F2A2E] flex items-center gap-1.5 flex-wrap">
                      <span className="truncate">{tiered.student.studentName}</span>
                      {tiered.student.isDrill && (
                        <span className="px-1.5 py-0.5 rounded bg-[#FFC20E] border border-[#1F2A2E] text-[10px] font-extrabold">
                          {t.crisisDrillBadge}
                        </span>
                      )}
                    </p>
                    <p className="text-[11px] text-[#526066] tabular-nums">
                      {t.crisisSlackLabel}:{' '}
                      <span className="font-bold text-[#1F2A2E]">
                        {tiered.slackMinutes !== null ? `${tiered.slackMinutes} min` : '—'}
                      </span>
                      {assignment
                        ? ` · ${assignment.driverName} (L${assignment.assignmentLevel})`
                        : ''}
                    </p>
                  </div>

                  <span
                    className={`px-2 py-0.5 rounded-md text-[10px] font-extrabold border shrink-0 ${
                      unreachable
                        ? 'bg-[#D7352B] text-white border-[#1F2A2E]'
                        : isAtRisk
                          ? 'bg-[#FFC20E] text-[#1F2A2E] border-[#1F2A2E]'
                          : 'bg-[#0E6B4E] text-white border-[#1F2A2E]'
                    }`}
                  >
                    {unreachable
                      ? t.crisisKpiCannotReach
                      : isAtRisk
                        ? t.crisisAtRiskBadge
                        : t.crisisOnTimeBadge}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Reallocation Proposals */}
      <section className="bg-white border-2 border-[#1F2A2E] rounded-2xl p-3.5 space-y-2">
        <h2 className="font-sign font-bold text-sm text-[#1F2A2E]">
          {t.crisisReallocationsTitle} ({plan?.reallocations.length ?? 0})
        </h2>
        {!plan || plan.reallocations.length === 0 ? (
          <p className="text-xs text-[#526066]">{t.crisisReallocationsEmpty}</p>
        ) : (
          <div className="space-y-2">
            {plan.reallocations.map((prop) => {
              const liveStatus = reallocationStatusByTrip[prop.tripId];
              const isApproved = Boolean(approvedIds[prop.id]) || Boolean(liveStatus);
              return (
                <div
                  key={prop.id}
                  className="p-2.5 rounded-xl bg-[#F2F5F3] border border-[#1F2A2E] flex items-center justify-between gap-2"
                >
                  <div className="min-w-0 space-y-0.5">
                    <p className="font-bold text-xs text-[#1F2A2E] truncate">
                      {prop.driverName} · {prop.clusterPlace} ({prop.studentCount})
                    </p>
                    <p className="text-[11px] text-[#526066] tabular-nums">
                      {prop.reasonTag} · +{prop.detourMinutes} {t.crisisDetourMinSuffix}
                    </p>
                  </div>

                  {liveStatus === 'accepted' ? (
                    <span className="px-2.5 py-1.5 rounded-lg bg-[#0E6B4E] text-white text-xs font-bold shrink-0">
                      {t.crisisDriverAcceptedLabel}
                    </span>
                  ) : liveStatus === 'declined' ? (
                    <span className="px-2.5 py-1.5 rounded-lg bg-[#D7352B] text-white text-xs font-bold shrink-0">
                      {t.crisisDriverDeclinedLabel}
                    </span>
                  ) : (
                    <button
                      type="button"
                      disabled={isApproved || busyId === prop.id}
                      onClick={() => void approveReallocation(prop)}
                      className={`min-h-[38px] px-3 rounded-lg text-xs font-bold inline-flex items-center gap-1 shrink-0 ${
                        isApproved
                          ? 'bg-[#0E6B4E]/15 text-[#0E6B4E] border border-[#0E6B4E]'
                          : 'bg-[#0E6B4E] text-white'
                      }`}
                    >
                      {isApproved ? (
                        <>
                          <CheckCircle2 className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                          <span>{t.crisisApprovedBadge}</span>
                        </>
                      ) : (
                        <>
                          <Send className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                          <span>{t.crisisApproveBtn}</span>
                        </>
                      )}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Unreachable Students + Draft School/Parent Notice */}
      <section className="bg-white border-2 border-[#1F2A2E] rounded-2xl p-3.5 space-y-2">
        <div className="flex items-center gap-1.5">
          <AlertTriangle className="w-4 h-4 text-[#D7352B]" aria-hidden="true" />
          <h2 className="font-sign font-bold text-sm text-[#1F2A2E]">
            {t.crisisUnreachableTitle} ({plan?.unreachable.length ?? 0})
          </h2>
        </div>

        {!plan || plan.unreachable.length === 0 ? (
          <p className="text-xs text-[#526066]">{t.crisisUnreachableEmpty}</p>
        ) : (
          <div className="space-y-2">
            {plan.unreachable.map((item) => {
              const drafted = draftedNotices[item.studentId];
              return (
                <div
                  key={item.requestId}
                  className="p-2.5 rounded-xl bg-[#D7352B]/10 border border-[#D7352B] space-y-2"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-bold text-xs text-[#1F2A2E] truncate">
                        T{item.tier} · {item.studentName}
                      </p>
                      <p className="text-[11px] text-[#526066]">{item.detail}</p>
                    </div>
                    <span className="px-2 py-0.5 rounded bg-white border border-[#D7352B] text-[10px] font-bold text-[#D7352B] shrink-0">
                      {reasonLabel(item.reason)}
                    </span>
                  </div>

                  {drafted ? (
                    <div className="p-2 rounded-lg bg-white border border-[#1F2A2E] space-y-1.5">
                      <p className="text-xs text-[#1F2A2E] break-words">{drafted}</p>
                      <a
                        href={buildWhatsAppShareUrl(drafted)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-[#0E6B4E] text-white text-xs font-bold"
                      >
                        <MessageCircle className="w-3.5 h-3.5" aria-hidden="true" />
                        <span>{t.shareOpenWhatsAppBtn}</span>
                      </a>
                    </div>
                  ) : (
                    <button
                      type="button"
                      disabled={draftingStudentId === item.studentId}
                      onClick={() => void handleDraftCannotReachNotice(item)}
                      className="min-h-[34px] px-2.5 rounded-lg bg-white border border-[#1F2A2E] text-[11px] font-bold text-[#1F2A2E]"
                    >
                      {t.crisisComposeNoticeBtn}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );

  return (
    <div
      data-testid="crisis-board"
      className="h-[100dvh] w-full flex flex-col bg-[#F2F5F3] overflow-hidden"
    >
      <header className="h-14 shrink-0 px-3 sm:px-4 bg-white border-b-2 border-[#1F2A2E] flex items-center justify-between gap-2 z-[650]">
        <div className="flex items-center gap-2 min-w-0">
          <ShieldAlert className="w-5 h-5 text-[#D7352B] shrink-0" aria-hidden="true" />
          <h1 className="font-sign font-bold text-base sm:text-lg text-[#1F2A2E] truncate">
            {t.crisisBoardTitle}
          </h1>
          {isDrillActive && (
            <span className="px-2 py-0.5 rounded bg-[#FFC20E] border border-[#1F2A2E] font-sign font-extrabold text-[10px] text-[#1F2A2E] shrink-0">
              {t.crisisDrillBadge}
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={onBack}
          className="min-h-[40px] px-3 rounded-xl bg-[#F2F5F3] border-2 border-[#1F2A2E] text-xs font-bold text-[#1F2A2E] inline-flex items-center gap-1.5 shrink-0"
        >
          <ArrowLeft className="w-4 h-4 shrink-0" aria-hidden="true" />
          <span className="whitespace-nowrap">{t.crisisBoardBackBtn}</span>
        </button>
      </header>

      <div className="flex-1 min-h-0 flex flex-col lg:flex-row relative">
        <div className={`flex-1 min-h-0 relative ${placingFloodZone ? 'cursor-crosshair' : ''}`}>
          {placingFloodZone && (
            <div className="absolute top-3 left-1/2 -translate-x-1/2 z-[500] px-3 py-1.5 rounded-xl bg-[#D7352B] text-white border-2 border-[#1F2A2E] text-xs font-bold shadow">
              {t.crisisDrillTapMapActive}
            </div>
          )}
          <NxtMap
            position={null}
            selectedPlace={null}
            disruptedPolyline={disruptedPolyline}
            animateRecovery={Boolean(plan?.reallocations.length)}
            liveVehicles={mapVehicles}
            blockedZones={blockedZones}
            extraRoutes={extraRoutes}
            examStudents={examStudentMarkers}
            focusBoundsPoints={focusBoundsPoints}
            onMapClick={placingFloodZone ? (pt) => void handleMapClick(pt) : undefined}
          />
        </div>

        {isDesktop ? (
          <aside className="w-[460px] xl:w-[500px] shrink-0 h-full overflow-y-auto border-l-2 border-[#1F2A2E] bg-[#F2F5F3] p-4">
            {panelBody}
          </aside>
        ) : (
          <BottomSheet
            snap={sheetSnap}
            onSnapChange={setSheetSnap}
            title={t.crisisBoardTitle}
            scrollResetKey={isDrillActive ? 'drill' : 'live'}
          >
            {panelBody}
          </BottomSheet>
        )}
      </div>
    </div>
  );
}
