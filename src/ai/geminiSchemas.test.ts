import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildParentTrackUrl,
  buildWhatsAppShareUrl,
  countWords,
  fallbackAdminBriefing,
  fallbackCannotReachMessage,
  fallbackParseRequest,
  fallbackParentMessage,
  fallbackPlanB,
  fallbackVoicePlanB,
  looksLikeNaturalLanguageRequest,
  validateAdminBriefingResponse,
  validateCannotReachMessageResponse,
  validateParsedRequest,
  validateParentMessageResponse,
  validatePlanBResponse,
  validateVoicePlanBResponse,
} from './geminiSchemas';

test('fallbackParseRequest extracts destination, HH:mm time, and language across EN, KN, HI', () => {
  const en = fallbackParseRequest('I need to reach Mandya High School by 8:30', 'en');
  assert.equal(en.language, 'en');
  assert.equal(en.arriveBy, '08:30');
  assert.match(en.destination ?? '', /Mandya High School/i);
  assert.equal(en.usedFallback, true);

  const kn = fallbackParseRequest('ಬೆಳಿಗ್ಗೆ 8:30ಕ್ಕೆ ಮಂಡ್ಯ ಶಾಲೆಗೆ ಹೋಗಬೇಕು', 'en');
  assert.equal(kn.language, 'kn');
  assert.equal(kn.arriveBy, '08:30');
  assert.ok((kn.destination ?? '').length > 0);

  const hi = fallbackParseRequest('मुझे सुबह 8:30 बजे तक मंड्या स्कूल पहुँचना है', 'en');
  assert.equal(hi.language, 'hi');
  assert.equal(hi.arriveBy, '08:30');
  assert.ok((hi.destination ?? '').length > 0);
});

test('looksLikeNaturalLanguageRequest distinguishes plain town names from full sentences', () => {
  assert.equal(looksLikeNaturalLanguageRequest('Mandya'), false);
  assert.equal(looksLikeNaturalLanguageRequest('I need to reach school by 8:30'), true);
  assert.equal(looksLikeNaturalLanguageRequest('मुझे 8:30 बजे तक स्कूल पहुँचना है'), true);
});

test('validateParsedRequest enforces strict schema bounds', () => {
  const valid = validateParsedRequest({
    destination: 'Govt High School',
    arriveBy: '8:30',
    language: 'en',
  });
  assert.deepEqual(valid, {
    destination: 'Govt High School',
    arriveBy: '08:30',
    language: 'en',
    usedFallback: false,
  });

  assert.equal(
    validateParsedRequest({ destination: 'School', arriveBy: '25:99', language: 'en' }),
    null,
  );
  assert.equal(
    validateParsedRequest({ destination: null, arriveBy: null, language: 'en' }),
    null,
  );
  assert.equal(
    validateParsedRequest({ destination: 'School', arriveBy: '08:30', language: 'fr' }),
    null,
  );
});

test('validatePlanBResponse rejects hallucinated tripIds and placeholder brackets', () => {
  const valid = validatePlanBResponse(
    {
      headline: 'Backup ride ready',
      summary: 'Milk van with Ramesh reaches your stop in 6 min.',
      recommendedTripId: 'trip-2',
      actionPrompt: 'Switch to backup ride',
    },
    ['trip-2', 'trip-3'],
  );
  assert.equal(valid?.recommendedTripId, 'trip-2');

  const hallucinatedId = validatePlanBResponse(
    {
      headline: 'Backup ride ready',
      summary: 'Fake bus arrives in 2 min.',
      recommendedTripId: 'invented-trip-999',
      actionPrompt: 'Switch',
    },
    ['trip-2'],
  );
  assert.equal(hallucinatedId, null);

  const placeholderText = validatePlanBResponse(
    {
      headline: 'Backup [Vehicle]',
      summary: 'Take [Driver] now.',
      recommendedTripId: 'trip-2',
      actionPrompt: 'Switch',
    },
    ['trip-2'],
  );
  assert.equal(placeholderText, null);
});

test('fallbackPlanB and fallbackParentMessage include only real provided data and valid wa.me link', () => {
  const planB = fallbackPlanB({
    language: 'en',
    triggerReason: 'scheduled_late',
    disruptedVehicleLabel: 'Govt bus',
    disruptedDriverName: 'Mahesh',
    destinationName: 'Mandya High School',
    nearbyLiveDriversCount: 2,
    alternatives: [
      {
        tripId: 'trip-milk',
        vehicleLabel: 'Milk van',
        driverName: 'Ramesh',
        driverVerified: true,
        etaPickupMin: 5,
        walkMin: 2,
        arrivalTime: '8:18 AM',
        seatsLeft: 3,
      },
    ],
  });
  assert.match(planB.summary, /Milk van/);
  assert.match(planB.summary, /Ramesh/);
  assert.equal(planB.recommendedTripId, 'trip-milk');

  const link = buildParentTrackUrl('https://nxtpath.app', {
    tripId: 'trip-milk',
    studentName: 'Asha',
    dest: 'Mandya High School',
    rideCode: '4821',
  });
  assert.match(link, /track=trip-milk/);

  const msg = fallbackParentMessage({
    language: 'en',
    studentName: 'Asha',
    destinationName: 'Mandya High School',
    vehicleLabel: 'Milk van',
    driverName: 'Ramesh',
    driverVerified: true,
    rideCode: '4821',
    stage: 'arriving',
    etaMinutes: 5,
    liveLink: link,
  });
  assert.match(msg.message, /4821/);
  assert.ok(msg.message.includes(link));

  const validatedMsg = validateParentMessageResponse({ message: 'Asha is in Milk van' }, link);
  assert.ok(validatedMsg?.message.includes(link));

  const wa = buildWhatsAppShareUrl(msg.message);
  assert.ok(wa.startsWith('https://wa.me/?text='));
});

test('Admin Briefing enforces <= 60 words and 3 concrete actions', () => {
  const ok = validateAdminBriefingResponse({
    headline: '8 of 10 exam students on time; 2 at risk.',
    actions: [
      'Approve Ramesh to East Cross.',
      'Reroute van around Flooded Bridge.',
      'Notify school gate for 1 student.',
    ],
  });
  assert.ok(ok);
  assert.equal(ok.actions.length, 3);

  const tooLongWords = Array.from({ length: 65 }, (_, i) => `word${i}`).join(' ');
  const rejected = validateAdminBriefingResponse({
    headline: tooLongWords,
    actions: ['Action one.', 'Action two.', 'Action three.'],
  });
  assert.equal(rejected, null);

  const fb = fallbackAdminBriefing({
    language: 'en',
    kpis: {
      totalStudents: 12,
      examStudents: 7,
      onTime: 9,
      atRisk: 2,
      cannotReach: 1,
      vehiclesReallocated: 1,
    },
    fcfsOnTime: 6,
    blockedZoneLabels: ['Bridge'],
    topProposals: [{ driverName: 'Ramesh', clusterPlace: 'Stop A', studentCount: 3, detourMinutes: 4 }],
  });
  assert.ok(countWords(`${fb.headline} ${fb.actions.join(' ')}`) <= 60);
});

test('Cannot-reach notice and Voice Plan B validate cleanly across languages', () => {
  const notice = fallbackCannotReachMessage({
    language: 'hi',
    studentName: 'Ravi',
    destinationName: 'Mandya School',
    reason: 'road_blocked',
    detail: 'Flooded bridge',
  });
  assert.match(notice.message, /Ravi/);
  assert.ok(validateCannotReachMessageResponse({ message: notice.message }));

  const voice = fallbackVoicePlanB({
    language: 'kn',
    studentName: 'Asha',
    destinationName: 'Mandya High School',
    departureTimeText: '08:15 AM',
    vehicleLabel: 'School van',
    driverName: 'Kumar',
    etaPickupMin: 4,
  });
  assert.match(voice.spokenMessage, /08:15 AM/);
  assert.ok(validateVoicePlanBResponse({ spokenMessage: voice.spokenMessage }));
  assert.equal(
    validateVoicePlanBResponse({ spokenMessage: 'See https://bad.link now' }),
    null,
  );
});
