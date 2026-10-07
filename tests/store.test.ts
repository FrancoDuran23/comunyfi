import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { getAddress } from "viem";
import { openStoredSession } from "../src/voting/session.js";

test("un reinicio no pierde la ronda ni las fichitas", () => {
  const path = join(mkdtempSync(join(tmpdir(), "comunyfi-")), "ronda.sqlite");
  const config = { poolAmount: 500n, fichitasPerAttendee: 100, maxFichitasPerProject: 40 };
  const first = openStoredSession(path, config);
  assert.equal(first.ensureRound("jujuy.dev"), true);
  assert.equal(first.votingStatus(), "draft");
  first.addProject({
    id: "agua",
    name: "Agua",
    summary: "Cisternas",
    recipient: getAddress("0x1111111111111111111111111111111111111111"),
  });
  first.openVoting();
  first.registerAttendee({
    lumaGuestId: "gst-ana",
    email: "ana@jujuy.dev",
    telegramUserId: 10,
    displayName: "Ana",
  });
  first.setFichitas("gst-ana", "agua", 25);
  first.close();

  const second = openStoredSession(path, { ...config, poolAmount: 1n });
  assert.equal(second.ensureRound("otra"), false);
  assert.equal(second.roundName(), "jujuy.dev");
  assert.equal(second.votingStatus(), "open");
  assert.equal(second.config.poolAmount, 500n);
  assert.equal(second.allocationOf("gst-ana", "agua"), 25);
  assert.equal(second.attendeeByEmail("ANA@jujuy.dev")?.displayName, "Ana");
  second.close();
});
