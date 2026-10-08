import assert from "node:assert/strict";
import { test } from "node:test";
import { getAddress } from "viem";
import {
  createGuestListValidator,
  createLumaApiValidator,
  LumaValidationError,
  parseLumaGuestPayload,
} from "../src/luma/checkin.js";
import { parseGuestsCsv } from "../src/luma/guests-file.js";
import { claimFichitas } from "../src/voting/claim.js";
import { createSession } from "../src/voting/node-session.js";
import { AllocationError } from "../src/voting/types.js";

const guests = [
  { email: "Ana@jujuy.dev", name: "Ana Pérez", guestId: "gst-ana", checkedIn: true },
  { email: "beto@jujuy.dev", name: "Beto", guestId: "gst-beto", checkedIn: false },
];

test("el archivo local acepta el mail con check-in y rechaza al resto", async () => {
  const luma = createGuestListValidator("jujuy-dev", guests);
  const ana = await luma.assertCheckedInByEmail(" ana@jujuy.dev ");
  assert.equal(ana.guestId, "gst-ana");
  assert.equal(ana.email, "ana@jujuy.dev");
  assert.equal(ana.name, "Ana Pérez");
  await assert.rejects(
    () => luma.assertCheckedInByEmail("beto@jujuy.dev"),
    (error: unknown) => error instanceof LumaValidationError && error.code === "NOT_CHECKED_IN",
  );
  await assert.rejects(
    () => luma.assertCheckedInByEmail("nadie@jujuy.dev"),
    (error: unknown) => error instanceof LumaValidationError && error.code === "UNKNOWN_GUEST",
  );
});

test("el CSV de invitados marca el check-in", () => {
  const parsed = parseGuestsCsv("email,name,guestId,checkedIn\nana@jujuy.dev,Ana,gst-ana,sí\nbeto@jujuy.dev,Beto,gst-beto,no\n");
  assert.equal(parsed[0]?.checkedIn, true);
  assert.equal(parsed[1]?.checkedIn, false);
});

test("la ficha de Luma exige checked_in_at", () => {
  const checked = parseLumaGuestPayload(
    {
      id: "gst-ana",
      user_email: "ana@jujuy.dev",
      user_name: "Ana",
      approval_status: "approved",
      event_tickets: [{ checked_in_at: "2026-10-07T18:00:00.000Z" }],
    },
    "evt-jujuy",
    "ana@jujuy.dev",
  );
  assert.equal(checked.guestId, "gst-ana");
  assert.throws(
    () =>
      parseLumaGuestPayload(
        {
          id: "gst-ana",
          user_email: "ana@jujuy.dev",
          user_name: "Ana",
          approval_status: "approved",
          event_tickets: [{ checked_in_at: null }],
        },
        "evt-jujuy",
        "ana@jujuy.dev",
      ),
    (error: unknown) => error instanceof LumaValidationError && error.code === "NOT_CHECKED_IN",
  );
});

test("la API de Luma se consulta por mail y no pega a la red en el test", async () => {
  const calls: string[] = [];
  const luma = createLumaApiValidator({
    eventId: "evt-jujuy",
    apiKey: "test-key",
    baseUrl: "https://public-api.luma.com",
    fetchImpl: async (input, init) => {
      const url = String(input);
      calls.push(url);
      assert.equal(new Headers(init?.headers).get("x-luma-api-key"), "test-key");
      assert.match(url, /event_id=evt-jujuy/);
      assert.match(url, /id=ana%40jujuy.dev/);
      return new Response(
        JSON.stringify({
          guest: {
            id: "gst-ana",
            user_email: "ana@jujuy.dev",
            user_first_name: "Ana",
            user_last_name: "Pérez",
            user_name: null,
            approval_status: "approved",
            event_tickets: [{ checked_in_at: "2026-10-07T18:00:00.000Z" }],
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    },
  });
  const ana = await luma.assertCheckedInByEmail("ana@jujuy.dev");
  assert.equal(ana.name, "Ana Pérez");
  assert.equal(calls.length, 1);

  const missing = createLumaApiValidator({
    eventId: "evt-jujuy",
    apiKey: "test-key",
    fetchImpl: async () => new Response("no", { status: 404 }),
  });
  await assert.rejects(
    () => missing.assertCheckedInByEmail("ana@jujuy.dev"),
    (error: unknown) => error instanceof LumaValidationError && error.code === "UNKNOWN_GUEST",
  );
});

test("las fichitas se entregan una vez por mail verificado", async () => {
  const session = createSession({
    poolAmount: 1000n,
    fichitasPerAttendee: 100,
    maxFichitasPerProject: 40,
  });
  session.addProject({
    id: "agua",
    name: "Agua",
    summary: "Cisternas",
    recipient: getAddress("0x1111111111111111111111111111111111111111"),
  });
  const luma = createGuestListValidator("jujuy-dev", guests);
  const ana = await claimFichitas({
    session,
    luma,
    email: "ana@jujuy.dev",
    telegramUserId: 10,
    displayName: "Ana",
  });
  assert.equal(ana.displayName, "Ana");
  assert.equal(session.remainingFichitas("gst-ana"), 100);
  await assert.rejects(
    () =>
      claimFichitas({
        session,
        luma,
        email: "ana@jujuy.dev",
        telegramUserId: 11,
      }),
    (error: unknown) => error instanceof AllocationError && error.code === "DUPLICATE_ATTENDEE",
  );
  assert.equal(session.listAttendees().length, 1);
});
