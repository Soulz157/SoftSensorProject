"""An empty PI fetch must say WHICH kind of empty it was.

`materialize_window` used to answer both "the historian had no samples" and
"we never reached the historian" with one sentence that described only the
first, and told the operator to check a fetch config that was fine. These
tests pin the distinction, because the two have opposite fixes and the
failing window itself looks identical either way.
"""

import pytest

from services.inference_window_service import _diagnose_empty_pi_fetch


def tag(name: str, status: str, error: str | None = None) -> dict:
    """One entry of DataFetchResponse.results, as DataService.fetch builds
    it: a failed tag still occupies a row and carries its own error."""
    return {"tag_name": name, "data": [], "status": status, "error": error}


# The text a genuinely unresolvable host produces, kept as a literal so a
# change in how the connector words its errors cannot quietly pass through
# this test by being reformatted on both sides at once.
DNS_ERROR = (
    "HTTPSConnectionPool(host='scgc-piwebapi.scg.com', port=443): Max retries "
    "exceeded (Caused by NameResolutionError)"
)


class TestDiagnoseEmptyPiFetch:
    def test_returns_None_when_every_tag_answered(self):
        payload = {"results": [tag("TI202.PV", "ok"), tag("TI203.PV", "ok")]}

        # Tags that answered and had nothing to say are a LEGITIMATE empty
        # window. Dressing that up as an error would trade one wrong
        # diagnosis for another.
        assert _diagnose_empty_pi_fetch(payload) is None

    def test_returns_None_for_a_partial_tag(self):
        # "partial" means some windows came back — the source is reachable.
        payload = {"results": [tag("TI202.PV", "partial", "one window timed out")]}

        assert _diagnose_empty_pi_fetch(payload) is None

    def test_names_the_source_error_VERBATIM_when_every_tag_failed(self):
        payload = {
            "results": [
                tag("TI202.PV", "failed", DNS_ERROR),
                tag("TI203.PV", "failed", DNS_ERROR),
            ]
        }

        result = _diagnose_empty_pi_fetch(payload)

        assert result is not None
        assert "every tag" in result
        # The connector's own words, not a category this module invented.
        assert DNS_ERROR in result

    def test_collapses_ONE_repeated_error_into_one_mention(self):
        # An unreachable host fails identically once per tag. Nineteen copies
        # of the same sentence is not nineteen pieces of information.
        payload = {"results": [tag(f"T{i}.PV", "failed", DNS_ERROR) for i in range(19)]}

        result = _diagnose_empty_pi_fetch(payload)

        assert result.count("NameResolutionError") == 1

    def test_counts_a_PARTIAL_failure_rather_than_claiming_every_tag(self):
        payload = {
            "results": [
                tag("TI202.PV", "ok"),
                tag("TI203.PV", "failed", "tag not found"),
                tag("TI205.PV", "failed", "tag not found"),
            ]
        }

        result = _diagnose_empty_pi_fetch(payload)

        # Three tags, two broken — saying "every tag" would be false, and
        # would point at the connection instead of at those two tags.
        assert "2 of 3 tags" in result
        assert "every tag" not in result

    def test_caps_a_long_list_of_DISTINCT_errors(self):
        payload = {
            "results": [tag(f"T{i}.PV", "failed", f"error number {i}") for i in range(6)]
        }

        result = _diagnose_empty_pi_fetch(payload)

        assert "(+3 more)" in result
        assert "error number 0" in result

    def test_still_reports_a_failure_that_recorded_no_reason(self):
        payload = {"results": [tag("TI202.PV", "failed", None)]}

        result = _diagnose_empty_pi_fetch(payload)

        # Silence about the reason is itself worth saying out loud, rather
        # than falling back to the old guess about fetch config.
        assert result is not None
        assert "without recording a reason" in result

    @pytest.mark.parametrize("payload", [{}, {"results": []}, {"results": None}])
    def test_returns_None_when_there_is_nothing_to_read(self, payload):
        # No results at all is not evidence of a transport failure, so this
        # must not manufacture one.
        assert _diagnose_empty_pi_fetch(payload) is None
