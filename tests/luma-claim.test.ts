import assert from "node:assert/strict";
import { test } from "node:test";
import { getAddress } from "viem";
import { createLumaValidator, LumaValidationError } from "../src/luma/checkin.js";
import { claimFichitas } from "../src/voting/claim.js";
import { createSession } from "../src/voting/session.js";
import { AllocationError } from "../src/voting/types.js";

test("el placeholder de Luma acepta guest_ y la lista, y rechaza el resto", async () => {
  const open = createLumaValidator({ eventId: "jujuy-dev", allowPlaceholderPrefix: true });
  const ana = await open.assertCheckedIn("guest_ana", "jujuy-dev");
  assert.equal(ana.checkedIn, true);
  assert.equal(ana.name, "ana");
  await assert.rejects(
    () => open.assertCheckedIn("ana", "jujuy-dev"),
    (error: unknown) => error instanceof LumaValidationError && error.code === "NOT_CHECKED_IN",
  );
  await assert.rejects(
    () => open.assertCheckedIn("guest_ana", "otro-evento"),
    (error: unknown) => error instanceof LumaValidationError && error.code === "WRONG_EVENT",
  );

  const listed = createLumaValidator({
    eventId: "jujuy-dev",
    checkedInGuestIds: new Set(["gst_real_1"]),
  });
  const real = await listed.assertCheckedIn("gst_real_1", "jujuy-dev");
  assert.equal(real.guestId, "gst_real_1");
  await assert.rejects(
    () => listed.assertCheckedIn("guest_ana", "jujuy-dev"),
    (error: unknown) => error instanceof LumaValidationError && error.code === "NOT_CHECKED_IN",
  );

  const closed = createLumaValidator({ eventId: "jujuy-dev" });
  await assert.rejects(
    () => closed.assertCheckedIn("gst_real_1", "jujuy-dev"),
    (error: unknown) => error instanceof LumaValidationError && error.code === "MISCONFIGURED",
  );
});

test("las fichitas se entregan una vez por check-in verificado", async () => {
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
  const luma = createLumaValidator({ eventId: "jujuy-dev", allowPlaceholderPrefix: true });

  const ana = await claimFichitas({
    session,
    luma,
    eventId: "jujuy-dev",
    guestId: "guest_ana",
    telegramUserId: 10,
    displayName: "Ana",
  });
  assert.equal(ana.displayName, "Ana");
  assert.equal(session.remainingFichitas("guest_ana"), 100);

  await assert.rejects(
    () =>
      claimFichitas({
        session,
        luma,
        eventId: "jujuy-dev",
        guestId: "guest_ana",
        telegramUserId: 11,
        displayName: "Ana otra vez",
      }),
    (error: unknown) => error instanceof AllocationError && error.code === "DUPLICATE_ATTENDEE",
  );

  await assert.rejects(
    () =>
      claimFichitas({
        session,
        luma,
        eventId: "jujuy-dev",
        guestId: "nadie",
        telegramUserId: 12,
      }),
    (error: unknown) => error instanceof LumaValidationError && error.code === "NOT_CHECKED_IN",
  );
  assert.equal(session.listAttendees().length, 1);
});
