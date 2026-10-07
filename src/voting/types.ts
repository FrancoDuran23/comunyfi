import type { Address } from "viem";

export interface SessionConfig {
  poolAmount: bigint;
  fichitasPerAttendee: number;
  maxFichitasPerProject: number;
}

export interface Project {
  id: string;
  name: string;
  summary: string;
  recipient: Address;
}

export type RoundStatus = "draft" | "open" | "closed" | "paid";

export interface Attendee {
  lumaGuestId: string;
  email: string;
  telegramUserId: number;
  displayName: string;
}

export interface PayoutLine {
  projectId: string;
  projectName: string;
  recipient: Address;
  fichitas: number;
  amount: bigint;
}

export interface Standing {
  projectId: string;
  projectName: string;
  summary: string;
  recipient: Address;
  fichitas: number;
  amount: bigint;
}

export const AllocationErrorCode = {
  INVALID_CONFIG: "INVALID_CONFIG",
  DUPLICATE_PROJECT: "DUPLICATE_PROJECT",
  INVALID_PROJECT: "INVALID_PROJECT",
  INVALID_ATTENDEE: "INVALID_ATTENDEE",
  DUPLICATE_ATTENDEE: "DUPLICATE_ATTENDEE",
  DUPLICATE_TELEGRAM: "DUPLICATE_TELEGRAM",
  UNKNOWN_ATTENDEE: "UNKNOWN_ATTENDEE",
  UNKNOWN_PROJECT: "UNKNOWN_PROJECT",
  INVALID_AMOUNT: "INVALID_AMOUNT",
  BUDGET_EXCEEDED: "BUDGET_EXCEEDED",
  PROJECT_CAP_EXCEEDED: "PROJECT_CAP_EXCEEDED",
  SESSION_FROZEN: "SESSION_FROZEN",
  ALREADY_APPROVED: "ALREADY_APPROVED",
  VOTING_CLOSED: "VOTING_CLOSED",
  VOTING_OPEN: "VOTING_OPEN",
  NO_ROUND: "NO_ROUND",
  NO_PROJECTS: "NO_PROJECTS",
  ALREADY_OPEN: "ALREADY_OPEN",
  ALREADY_CLOSED: "ALREADY_CLOSED",
} as const;

export type AllocationErrorCode = (typeof AllocationErrorCode)[keyof typeof AllocationErrorCode];

export class AllocationError extends Error {
  readonly code: AllocationErrorCode;

  constructor(code: AllocationErrorCode, message: string) {
    super(message);
    this.name = "AllocationError";
    this.code = code;
  }
}
