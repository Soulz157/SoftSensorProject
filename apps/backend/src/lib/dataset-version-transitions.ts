/**
 * DS-LAKE-010-T01/T02: the DatasetVersion registry lifecycle state machine.
 *
 * Pure — no Prisma, no I/O — same shape as `artifact-cleanup-eligibility.ts`.
 * The caller (`DatasetVersionAuthorizedService.promoteVersionService`) owns
 * fetching the current status and writing the new one; this module only
 * decides whether a requested transition is legal.
 *
 * The graph is a STRICT FORWARD-ONLY LINE, per the feature's own title:
 *
 *   DRAFT -> VALIDATED -> ACTIVE -> DEPRECATED -> ARCHIVED
 *
 * No skips (DRAFT -> ACTIVE), no backward moves (ARCHIVED -> ACTIVE — this
 * exact pair is DS-LAKE-010-V02's own probe), and no branches. Two
 * deliberate decisions worth recording, since neither falls out of the
 * acceptance criteria by itself:
 *
 * - SAME-STATE requests (e.g. VALIDATED -> VALIDATED) are treated as an
 *   IDEMPOTENT NO-OP, not an illegal transition — `isLegalTransition`
 *   returns `false` for them (they are not an edge in the graph below), but
 *   the SERVICE layer checks for this case first and short-circuits to a
 *   no-write success before ever consulting this predicate. A client
 *   retrying a promote call after a dropped response should not get a 422
 *   for a state that is already correct. This module stays a strict yes/no
 *   on the GRAPH; the idempotency carve-out is a service-level policy
 *   layered on top, not baked in here, so this predicate's own meaning
 *   ("is this edge in the state machine") stays unambiguous.
 *
 * - Single-ACTIVE-version enforcement (T05) is DELIBERATELY NOT part of
 *   this predicate. Whether ACTIVE is reachable depends only on the FROM
 *   status here; whether ANOTHER version of the same dataset already holds
 *   ACTIVE is a cross-row constraint the service layer checks separately
 *   (it needs a database read this module cannot and should not perform).
 *   Promoting into ACTIVE while another version holds it is REFUSED, not
 *   auto-resolved by demoting the old one — a hidden second-row write
 *   inside what is supposed to be one version's own transition would be a
 *   surprising side effect; `ACTIVE -> DEPRECATED` is already a legal edge,
 *   so the caller demotes the old version first, as its own separate,
 *   auditable transition.
 */

export type DatasetLifecycleStatus =
  | 'DRAFT'
  | 'VALIDATED'
  | 'ACTIVE'
  | 'DEPRECATED'
  | 'ARCHIVED';

const LEGAL_TRANSITIONS: ReadonlyMap<
  DatasetLifecycleStatus,
  DatasetLifecycleStatus
> = new Map([
  ['DRAFT', 'VALIDATED'],
  ['VALIDATED', 'ACTIVE'],
  ['ACTIVE', 'DEPRECATED'],
  ['DEPRECATED', 'ARCHIVED'],
]);

/**
 * True only for the exact next status in the forward chain. Same-state,
 * skips and backward moves all return `false` — see the module doc comment
 * for why same-state is handled as a separate idempotency policy at the
 * service layer rather than folded into this predicate's own meaning.
 */
export function isLegalTransition(
  from: DatasetLifecycleStatus,
  to: DatasetLifecycleStatus,
): boolean {
  return LEGAL_TRANSITIONS.get(from) === to;
}
