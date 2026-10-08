/**
 * MODEL-SERVE-001-T09. `InferenceWindow.failureReason` has a writer class
 * the other two do not: the infer-mode container's own terminal report
 * (`InferenceWindowCompleteSchema.failureReason`, completeService) stores
 * `str(err)` VERBATIM from `images/trainer/app/train.py`'s top-level
 * handler — never sanitized on the way in, unlike python's own `_run`
 * (routers/preprocess.py), which maps an unexpected exception to a generic
 * 502 specifically so driver/credential text cannot reach a client.
 *
 * A `requests.HTTPError` against a PRESIGNED object URL renders as
 * `... for url: https://…?X-Amz-Signature=…&X-Amz-Credential=…` — exactly
 * the class MODEL-FLOW-000-T06 forbids from reaching a client ("the URL IS
 * the capability"). Applied at the READ boundary (`getStatusService`), not
 * at write: the stored row stays full evidence for server-side logs, and
 * only what a client actually receives is redacted.
 */
const URL_PATTERN = /https?:\/\/\S+/gi;

export function redactUrls(text: string): string {
  return text.replace(URL_PATTERN, '[redacted url]');
}
