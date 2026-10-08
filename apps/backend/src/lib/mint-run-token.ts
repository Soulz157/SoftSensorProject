import { createHash, randomBytes } from 'node:crypto';

/**
 * Extracted from `ModelRunLaunchAuthorizedService`'s private `mintToken` —
 * MODEL-FLOW-016-T07's scoring trigger needs the identical mint a second
 * time (a fresh token, since the training token is already dead by the time
 * scoring starts; see `ModelTrainingRun.scoringContainerId`'s doc comment).
 * Mint a run token and its hash. The plaintext never touches a DB row.
 */
export function mintRunToken(): { token: string; tokenHash: string } {
  const token = randomBytes(32).toString('base64url');
  return {
    token,
    tokenHash: createHash('sha256').update(token).digest('hex'),
  };
}
