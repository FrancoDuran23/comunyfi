import assert from "node:assert/strict";
import { test } from "node:test";
import { getAddress, parseUnits, type Address } from "viem";
import { planPayouts } from "../src/voting/allocation.js";
import { createSession } from "../src/voting/session.js";
import { AllocationError, type Attendee, type Project, type SessionConfig } from "../src/voting/types.js";

const pool = parseUnits("50000", 18);

const config: SessionConfig = {
  poolAmount: pool,
  fichitasPerAttendee: 100,
  maxFichitasPerProject: 40,
};

function project(id: string, name: string, recipient: Address): Project {
  return { id, name, summary: `Proyecto ${name}`, recipient };
}

function person(id: string, telegramUserId: number, displayName: string): Attendee {
  return { lumaGuestId: id, email: `${id}@jujuy.dev`, telegramUserId, displayName };
}

function sessionWithProjects(): ReturnType<typeof createSession> {
  const session = createSession(config);
  session.addProject(project("agua", "Agua", getAddress("0x1111111111111111111111111111111111111111")));
  session.addProject(project("residuos", "Residuos", getAddress("0x2222222222222222222222222222222222222222")));
  session.addProject(project("oficio", "Oficio", getAddress("0x3333333333333333333333333333333333333333")));
  return session;
}

test("un asistente de Luma y un Telegram reciben fichitas una sola vez", () => {
  const session = sessionWithProjects();
  session.registerAttendee(person("guest_ana", 10, "Ana"));

  assert.throws(
    () => session.registerAttendee(person("guest_ana", 11, "Otra")),
    (error: unknown) => error instanceof AllocationError && error.code === "DUPLICATE_ATTENDEE",
  );
  assert.throws(
    () => session.registerAttendee({ ...person("guest_beto", 10, "Beto"), email: "otro@jujuy.dev" }),
    (error: unknown) => error instanceof AllocationError && error.code === "DUPLICATE_TELEGRAM",
  );
  assert.equal(session.listAttendees().length, 1);
});

test("el presupuesto y el tope por proyecto frenan el reparto", () => {
  const session = sessionWithProjects();
  session.registerAttendee(person("guest_ana", 10, "Ana"));

  session.setFichitas("guest_ana", "agua", 40);
  assert.throws(
    () => session.setFichitas("guest_ana", "agua", 41),
    (error: unknown) => error instanceof AllocationError && error.code === "PROJECT_CAP_EXCEEDED",
  );
  session.setFichitas("guest_ana", "agua", 10);
  assert.equal(session.allocationOf("guest_ana", "agua"), 10);
  assert.equal(session.remainingFichitas("guest_ana"), 90);

  session.setFichitas("guest_ana", "agua", 40);
  session.setFichitas("guest_ana", "residuos", 40);
  session.setFichitas("guest_ana", "oficio", 20);
  assert.equal(session.remainingFichitas("guest_ana"), 0);
  assert.throws(
    () => session.setFichitas("guest_ana", "oficio", 21),
    (error: unknown) => error instanceof AllocationError && error.code === "BUDGET_EXCEEDED",
  );
});

test("rechaza montos, proyectos y asistentes que no corresponden", () => {
  const session = sessionWithProjects();
  assert.throws(
    () => session.setFichitas("nadie", "agua", 1),
    (error: unknown) => error instanceof AllocationError && error.code === "UNKNOWN_ATTENDEE",
  );
  session.registerAttendee(person("guest_ana", 10, "Ana"));
  assert.throws(
    () => session.setFichitas("guest_ana", "fantasma", 1),
    (error: unknown) => error instanceof AllocationError && error.code === "UNKNOWN_PROJECT",
  );
  assert.throws(
    () => session.setFichitas("guest_ana", "agua", -1),
    (error: unknown) => error instanceof AllocationError && error.code === "INVALID_AMOUNT",
  );
  assert.throws(
    () => session.setFichitas("guest_ana", "agua", 1.5),
    (error: unknown) => error instanceof AllocationError && error.code === "INVALID_AMOUNT",
  );
});

test("la aprobación humana cierra la votación", () => {
  const session = sessionWithProjects();
  session.registerAttendee(person("guest_ana", 10, "Ana"));
  session.setFichitas("guest_ana", "agua", 10);
  assert.throws(
    () => session.approve(),
    (error: unknown) => error instanceof AllocationError && error.code === "VOTING_OPEN",
  );
  session.closeVoting();
  assert.throws(
    () => session.setFichitas("guest_ana", "residuos", 10),
    (error: unknown) => error instanceof AllocationError && error.code === "VOTING_CLOSED",
  );
  session.approve();
  assert.equal(session.isApproved(), true);
  assert.throws(
    () => session.setFichitas("guest_ana", "residuos", 10),
    (error: unknown) => error instanceof AllocationError && error.code === "SESSION_FROZEN",
  );
  assert.throws(
    () => session.registerAttendee(person("guest_beto", 11, "Beto")),
    (error: unknown) => error instanceof AllocationError && error.code === "SESSION_FROZEN",
  );
  assert.throws(
    () => session.approve(),
    (error: unknown) => error instanceof AllocationError && error.code === "ALREADY_APPROVED",
  );
});

test("dos asistentes suman fichitas y el pozo se parte a la mitad", () => {
  const session = sessionWithProjects();
  session.registerAttendee(person("guest_ana", 10, "Ana"));
  session.registerAttendee(person("guest_beto", 11, "Beto"));
  session.setFichitas("guest_ana", "agua", 40);
  session.setFichitas("guest_beto", "residuos", 40);

  const lines = session.plan();
  assert.equal(lines.length, 2);
  assert.equal(lines[0]?.projectId, "agua");
  assert.equal(lines[1]?.projectId, "residuos");
  assert.equal(lines[0]?.amount, pool / 2n);
  assert.equal(lines[1]?.amount, pool / 2n);
  assert.equal(
    lines.reduce((sum, line) => sum + line.amount, 0n),
    pool,
  );
});

test("el resto en wei se asigna sin perder ni duplicar el pozo", () => {
  const projects = [
    project("agua", "Agua", getAddress("0x1111111111111111111111111111111111111111")),
    project("residuos", "Residuos", getAddress("0x2222222222222222222222222222222222222222")),
    project("oficio", "Oficio", getAddress("0x3333333333333333333333333333333333333333")),
  ];
  const totals = new Map([
    ["agua", 1],
    ["residuos", 1],
    ["oficio", 1],
  ]);
  const lines = planPayouts(projects, totals, 10n);
  assert.deepEqual(
    lines.map((line) => [line.projectId, line.amount]),
    [
      ["agua", 4n],
      ["oficio", 3n],
      ["residuos", 3n],
    ],
  );
  assert.equal(
    lines.reduce((sum, line) => sum + line.amount, 0n),
    10n,
  );
});

test("sin fichitas no hay líneas de pago", () => {
  const session = sessionWithProjects();
  assert.deepEqual(session.plan(), []);
  const rows = session.standings();
  assert.equal(rows.length, 3);
  assert.ok(rows.every((row) => row.amount === 0n && row.fichitas === 0));
});

test("un reparto 2 a 1 cae en tercios exactos cuando el pozo divide", () => {
  const projects = [
    project("agua", "Agua", getAddress("0x1111111111111111111111111111111111111111")),
    project("oficio", "Oficio", getAddress("0x3333333333333333333333333333333333333333")),
  ];
  const lines = planPayouts(projects, new Map([["agua", 2], ["oficio", 1]]), 3000n);
  assert.equal(lines.find((line) => line.projectId === "agua")?.amount, 2000n);
  assert.equal(lines.find((line) => line.projectId === "oficio")?.amount, 1000n);
});
