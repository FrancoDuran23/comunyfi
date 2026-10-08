import { PAYOUT_REF, PAYOUT_REPO, PAYOUT_WORKFLOW_FILE } from "./constants.js";

export interface DispatchInput {
  token: string;
  idempotencyKey: string;
  repo?: string;
  ref?: string;
  fetchImpl?: typeof fetch;
}

export interface DispatchResult {
  ok: boolean;
  status: number;
}

/** Dispara workflow_dispatch. El archivo tiene que estar en la rama (main) para que GitHub lo acepte. */
export async function dispatchPayoutWorkflow(input: DispatchInput): Promise<DispatchResult> {
  const repo = input.repo ?? PAYOUT_REPO;
  const ref = input.ref ?? PAYOUT_REF;
  const fetchImpl = input.fetchImpl ?? fetch;
  const body = {
    ref,
    inputs: { idempotency_key: input.idempotencyKey },
  };
  const response = await fetchImpl(`https://api.github.com/repos/${repo}/actions/workflows/${PAYOUT_WORKFLOW_FILE}/dispatches`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${input.token}`,
      accept: "application/vnd.github+json",
      "content-type": "application/json",
      "user-agent": "comunyfi",
      "x-github-api-version": "2022-11-28",
    },
    body: JSON.stringify(body),
  });
  return { ok: response.status === 204, status: response.status };
}
