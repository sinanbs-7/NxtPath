import 'dotenv/config';
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { GoogleGenAI, Type } from '@google/genai';
import {
  fallbackAdminBriefing,
  fallbackCannotReachMessage,
  fallbackParseRequest,
  fallbackParentMessage,
  fallbackPlanB,
  fallbackVoicePlanB,
  validateAdminBriefingResponse,
  validateCannotReachMessageResponse,
  validateParsedRequest,
  validateParentMessageResponse,
  validatePlanBResponse,
  validateVoicePlanBResponse,
  type AdminBriefingInput,
  type CannotReachMessageInput,
  type ParentMessageInput,
  type PlanBRequestInput,
  type VoicePlanBInput,
} from './src/ai/geminiSchemas.ts';
import type { Language } from './src/types/firestore.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT || 3000);
const MODEL_NAME = 'gemini-4-hydrogen';

function getGeminiClient(): GoogleGenAI | null {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey || apiKey === 'MY_GEMINI_API_KEY') {
    return null;
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

function parseLanguage(raw: unknown): Language {
  if (raw === 'kn' || raw === 'hi') return raw;
  return 'en';
}

function languageName(lang: Language): string {
  if (lang === 'kn') return 'Kannada (ಕನ್ನಡ)';
  if (lang === 'hi') return 'Hindi (हिन्दी)';
  return 'English';
}

async function createApp() {
  const app = express();
  app.use(express.json({ limit: '64kb' }));

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, geminiConfigured: Boolean(getGeminiClient()) });
  });

  app.post('/api/gemini/parse-request', async (req, res) => {
    const rawText = typeof req.body?.text === 'string' ? req.body.text.trim().slice(0, 300) : '';
    const preferredLanguage = parseLanguage(req.body?.preferredLanguage);

    if (!rawText) {
      res.status(400).json({ error: 'Missing request text' });
      return;
    }

    const ai = getGeminiClient();
    if (!ai) {
      res.json(fallbackParseRequest(rawText, preferredLanguage));
      return;
    }

    try {
      const response = await ai.models.generateContent({
        model: MODEL_NAME,
        contents: [
          'Extract the student ride request from the input below.',
          `Default preferred language if ambiguous: ${preferredLanguage}.`,
          `User text: "${rawText}"`,
        ].join('\n'),
        config: {
          systemInstruction:
            'You parse rural student ride requests in English, Kannada, and Hindi into JSON. ' +
            'Return ONLY destination (place/school/village name or null), arriveBy (24-hour HH:MM string or null), ' +
            'and language ("en", "kn", or "hi"). Never invent places or times that are not implied by the user text.',
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              destination: {
                type: Type.STRING,
                nullable: true,
                description: 'Destination school, village, or bus stop name if mentioned.',
              },
              arriveBy: {
                type: Type.STRING,
                nullable: true,
                description: 'Target arrival time in 24-hour HH:MM format (e.g. 08:30) or null.',
              },
              language: {
                type: Type.STRING,
                description: 'Detected language code: en, kn, or hi.',
              },
            },
            required: ['destination', 'arriveBy', 'language'],
          },
        },
      });

      const parsedJson = JSON.parse((response.text ?? '{}').trim());
      const validated = validateParsedRequest(parsedJson);
      if (validated) {
        res.json(validated);
        return;
      }
    } catch {
      // Fall through to deterministic rule-based parser
    }

    res.json(fallbackParseRequest(rawText, preferredLanguage));
  });

  app.post('/api/gemini/plan-b', async (req, res) => {
    const body = req.body as Partial<PlanBRequestInput> | undefined;
    if (!body || typeof body.destinationName !== 'string' || !Array.isArray(body.alternatives)) {
      res.status(400).json({ error: 'Invalid Plan B payload' });
      return;
    }

    const input: PlanBRequestInput = {
      language: parseLanguage(body.language),
      triggerReason:
        body.triggerReason === 'scheduled_late' || body.triggerReason === 'student_no_show'
          ? body.triggerReason
          : 'driver_breakdown',
      disruptedVehicleLabel: String(body.disruptedVehicleLabel || 'Vehicle').slice(0, 80),
      disruptedDriverName: String(body.disruptedDriverName || 'Driver').slice(0, 80),
      destinationName: body.destinationName.slice(0, 160),
      nearbyLiveDriversCount:
        typeof body.nearbyLiveDriversCount === 'number' && Number.isFinite(body.nearbyLiveDriversCount)
          ? Math.max(0, Math.round(body.nearbyLiveDriversCount))
          : 0,
      alternatives: body.alternatives.slice(0, 3).map((alt) => ({
        tripId: String(alt.tripId || ''),
        vehicleLabel: String(alt.vehicleLabel || 'Vehicle').slice(0, 80),
        driverName: String(alt.driverName || 'Driver').slice(0, 80),
        driverVerified: Boolean(alt.driverVerified),
        etaPickupMin: Number.isFinite(alt.etaPickupMin) ? Math.max(0, Math.round(alt.etaPickupMin)) : 0,
        walkMin: Number.isFinite(alt.walkMin) ? Math.max(0, Math.round(alt.walkMin)) : 0,
        arrivalTime: String(alt.arrivalTime || '').slice(0, 32),
        seatsLeft: Number.isFinite(alt.seatsLeft) ? Math.max(0, Math.round(alt.seatsLeft)) : 0,
      })),
    };

    const allowedTripIds = input.alternatives.map((a) => a.tripId).filter(Boolean);
    const ai = getGeminiClient();
    if (!ai) {
      res.json(fallbackPlanB(input));
      return;
    }

    try {
      const response = await ai.models.generateContent({
        model: MODEL_NAME,
        contents: JSON.stringify(input),
        config: {
          systemInstruction:
            `Write a calm, short Plan B explanation in ${languageName(input.language)} for a rural student whose ride was disrupted. ` +
            'STRICT RULE: Use ONLY the exact vehicles, driver names, tripIds, ETAs, arrival times, and destination provided in the JSON input. ' +
            'NEVER invent vehicles, times, places, or tripIds. ' +
            'If alternatives is empty, recommendedTripId MUST be null and suggest posting a waiting pin.',
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              headline: { type: Type.STRING },
              summary: { type: Type.STRING },
              recommendedTripId: { type: Type.STRING, nullable: true },
              actionPrompt: { type: Type.STRING },
            },
            required: ['headline', 'summary', 'recommendedTripId', 'actionPrompt'],
          },
        },
      });

      const parsedJson = JSON.parse((response.text ?? '{}').trim());
      const validated = validatePlanBResponse(parsedJson, allowedTripIds);
      if (validated) {
        res.json(validated);
        return;
      }
    } catch {
      // Fall through to deterministic template fallback
    }

    res.json(fallbackPlanB(input));
  });

  app.post('/api/gemini/parent-message', async (req, res) => {
    const body = req.body as Partial<ParentMessageInput> | undefined;
    if (!body || typeof body.liveLink !== 'string' || typeof body.destinationName !== 'string') {
      res.status(400).json({ error: 'Invalid parent message payload' });
      return;
    }

    const input: ParentMessageInput = {
      language: parseLanguage(body.language),
      studentName: String(body.studentName || 'Student').slice(0, 80),
      destinationName: body.destinationName.slice(0, 160),
      vehicleLabel: String(body.vehicleLabel || 'Vehicle').slice(0, 80),
      driverName: String(body.driverName || 'Driver').slice(0, 80),
      driverVerified: Boolean(body.driverVerified),
      rideCode: typeof body.rideCode === 'string' ? body.rideCode.slice(0, 8) : undefined,
      stage: String(body.stage || 'waiting').slice(0, 32),
      etaMinutes:
        typeof body.etaMinutes === 'number' && Number.isFinite(body.etaMinutes)
          ? Math.max(0, Math.round(body.etaMinutes))
          : null,
      liveLink: body.liveLink.slice(0, 500),
    };

    const ai = getGeminiClient();
    if (!ai) {
      res.json(fallbackParentMessage(input));
      return;
    }

    try {
      const response = await ai.models.generateContent({
        model: MODEL_NAME,
        contents: JSON.stringify(input),
        config: {
          systemInstruction:
            `Write one short WhatsApp message (2 sentences max) to a parent in ${languageName(input.language)}. ` +
            'Use ONLY the exact student name, destination, vehicle, driver name, ride code, ETA, and liveLink provided in the JSON input. ' +
            'Include the liveLink verbatim. Never invent times, places, or phone numbers.',
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              message: { type: Type.STRING },
            },
            required: ['message'],
          },
        },
      });

      const parsedJson = JSON.parse((response.text ?? '{}').trim());
      const validated = validateParentMessageResponse(parsedJson, input.liveLink);
      if (validated) {
        res.json(validated);
        return;
      }
    } catch {
      // Fall through to deterministic template fallback
    }

    res.json(fallbackParentMessage(input));
  });

  app.post('/api/gemini/crisis-briefing', async (req, res) => {
    const body = req.body as Partial<AdminBriefingInput> | undefined;
    if (!body || !body.kpis || typeof body.kpis.totalStudents !== 'number') {
      res.status(400).json({ error: 'Invalid crisis briefing payload' });
      return;
    }

    const input: AdminBriefingInput = {
      language: parseLanguage(body.language),
      kpis: {
        totalStudents: Math.max(0, Math.round(body.kpis.totalStudents)),
        examStudents: Math.max(0, Math.round(body.kpis.examStudents ?? 0)),
        onTime: Math.max(0, Math.round(body.kpis.onTime ?? 0)),
        atRisk: Math.max(0, Math.round(body.kpis.atRisk ?? 0)),
        cannotReach: Math.max(0, Math.round(body.kpis.cannotReach ?? 0)),
        vehiclesReallocated: Math.max(0, Math.round(body.kpis.vehiclesReallocated ?? 0)),
      },
      fcfsOnTime: Math.max(0, Math.round(body.fcfsOnTime ?? 0)),
      blockedZoneLabels: Array.isArray(body.blockedZoneLabels)
        ? body.blockedZoneLabels.slice(0, 5).map((z) => String(z).slice(0, 120))
        : [],
      topProposals: Array.isArray(body.topProposals)
        ? body.topProposals.slice(0, 3).map((p) => ({
            driverName: String(p.driverName || 'Driver').slice(0, 80),
            clusterPlace: String(p.clusterPlace || 'Village').slice(0, 120),
            studentCount: Math.max(0, Math.round(p.studentCount ?? 0)),
            detourMinutes: Math.max(0, Math.round(p.detourMinutes ?? 0)),
          }))
        : [],
    };

    const ai = getGeminiClient();
    if (!ai) {
      res.json(fallbackAdminBriefing(input));
      return;
    }

    try {
      const response = await ai.models.generateContent({
        model: MODEL_NAME,
        contents: JSON.stringify(input),
        config: {
          systemInstruction:
            `Write an urgent transit control briefing in ${languageName(input.language)} for a rural exam transport coordinator. ` +
            'Return JSON with "headline" (1 short sentence) and "actions" (array of exactly 3 plain-language action items). ' +
            'STRICT LIMITS: Total words across headline + all 3 actions MUST BE 60 WORDS OR FEWER. ' +
            'Use ONLY the exact numbers, names, and zone labels in the JSON input; NEVER invent numbers or vehicles.',
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              headline: { type: Type.STRING },
              actions: {
                type: Type.ARRAY,
                items: { type: Type.STRING },
              },
            },
            required: ['headline', 'actions'],
          },
        },
      });
      const parsedJson = JSON.parse((response.text ?? '{}').trim());
      const validated = validateAdminBriefingResponse(parsedJson);
      if (validated) {
        res.json(validated);
        return;
      }
    } catch {
      // Fall through to deterministic template fallback
    }

    res.json(fallbackAdminBriefing(input));
  });

  app.post('/api/gemini/cannot-reach-message', async (req, res) => {
    const body = req.body as Partial<CannotReachMessageInput> | undefined;
    if (!body || typeof body.studentName !== 'string' || typeof body.destinationName !== 'string') {
      res.status(400).json({ error: 'Invalid cannot-reach message payload' });
      return;
    }

    const input: CannotReachMessageInput = {
      language: parseLanguage(body.language),
      studentName: body.studentName.slice(0, 80),
      destinationName: body.destinationName.slice(0, 160),
      examTimeText: typeof body.examTimeText === 'string' ? body.examTimeText.slice(0, 32) : undefined,
      reason:
        body.reason === 'road_blocked' || body.reason === 'no_seat'
          ? body.reason
          : 'no_vehicle_in_range',
      detail: String(body.detail || '').slice(0, 200),
    };

    const ai = getGeminiClient();
    if (!ai) {
      res.json(fallbackCannotReachMessage(input));
      return;
    }

    try {
      const response = await ai.models.generateContent({
        model: MODEL_NAME,
        contents: JSON.stringify(input),
        config: {
          systemInstruction:
            `Write one short message (max 2 sentences) in ${languageName(input.language)} for a parent or exam school coordinator explaining that the student cannot reach on time, and requesting late exam entry or local alternate transport. ` +
            'Use ONLY the provided studentName, destinationName, examTimeText, and reason. Never invent names or times.',
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              message: { type: Type.STRING },
            },
            required: ['message'],
          },
        },
      });
      const parsedJson = JSON.parse((response.text ?? '{}').trim());
      const validated = validateCannotReachMessageResponse(parsedJson);
      if (validated) {
        res.json(validated);
        return;
      }
    } catch {
      // Fall through to deterministic fallback
    }

    res.json(fallbackCannotReachMessage(input));
  });

  app.post('/api/gemini/voice-plan-b', async (req, res) => {
    const body = req.body as Partial<VoicePlanBInput> | undefined;
    if (!body || typeof body.vehicleLabel !== 'string' || typeof body.destinationName !== 'string') {
      res.status(400).json({ error: 'Invalid voice Plan B payload' });
      return;
    }

    const input: VoicePlanBInput = {
      language: parseLanguage(body.language),
      studentName: String(body.studentName || 'Student').slice(0, 80),
      destinationName: body.destinationName.slice(0, 160),
      departureTimeText: String(body.departureTimeText || 'now').slice(0, 32),
      vehicleLabel: body.vehicleLabel.slice(0, 80),
      driverName: String(body.driverName || 'Driver').slice(0, 80),
      etaPickupMin:
        typeof body.etaPickupMin === 'number' && Number.isFinite(body.etaPickupMin)
          ? Math.max(0, Math.round(body.etaPickupMin))
          : 5,
    };

    const ai = getGeminiClient();
    if (!ai) {
      res.json(fallbackVoicePlanB(input));
      return;
    }

    try {
      const response = await ai.models.generateContent({
        model: MODEL_NAME,
        contents: JSON.stringify(input),
        config: {
          systemInstruction:
            `Write ONE clear spoken-friendly sentence in ${languageName(input.language)} for text-to-speech advising an exam student of their urgent Plan B ride. ` +
            'No URLs, no markdown, no bullets. Use ONLY the exact vehicleLabel, driverName, departureTimeText, etaPickupMin, and destinationName provided.',
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              spokenMessage: { type: Type.STRING },
            },
            required: ['spokenMessage'],
          },
        },
      });
      const parsedJson = JSON.parse((response.text ?? '{}').trim());
      const validated = validateVoicePlanBResponse(parsedJson);
      if (validated) {
        res.json(validated);
        return;
      }
    } catch {
      // Fall through to deterministic fallback
    }

    res.json(fallbackVoicePlanB(input));
  });

  let vitePromise: Promise<import('vite').ViteDevServer> | null = null;
  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    vitePromise = createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });

    app.use(async (req, res, next) => {
      try {
        const vite = await vitePromise!;
        vite.middlewares(req, res, next);
      } catch (err) {
        next(err);
      }
    });
  } else {
    const distDir = path.resolve(__dirname, 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      const indexPath = path.join(distDir, 'index.html');
      if (fs.existsSync(indexPath)) {
        res.sendFile(indexPath);
      } else {
        res.status(404).send('Build output not found. Run npm run build first.');
      }
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Nxtpath server listening on http://0.0.0.0:${PORT}`);
    if (vitePromise) {
      void vitePromise.catch((err) => {
        console.error('Failed to initialize Vite middleware:', err);
      });
    }
  });
}

void createApp();
