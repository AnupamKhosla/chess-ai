"""Tests for teachable lines and trap extraction (no engine needed)."""

from types import SimpleNamespace as NS

from server.lines import build_teachable_line, find_traps, naturalness, win_percent

STARTPOS = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1"


def _line(pv, cp, mate=None):
    return NS(pv=pv, score_cp=cp, score_mate=mate)


class TestWinPercent:
    def test_level_is_fifty(self):
        assert win_percent(0) == 50.0

    def test_winning_is_high(self):
        assert win_percent(300) > 70.0

    def test_losing_is_low(self):
        assert win_percent(-300) < 30.0

    def test_mate_saturates(self):
        assert win_percent(9997) > 99.9
        assert win_percent(-9997) < 0.1


class TestTraps:
    def test_grabbing_trap_detected_with_refutation(self):
        fen = "r1bqkb1r/pppp1ppp/2n2n2/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR w KQkq - 0 1"
        lines = [
            _line(["h5f7"], 10000, 1),
            _line(["h5e5", "f6e4", "e5e4", "d8e7"], 150),
            _line(["c4f7", "e8f7", "h5h4"], 80),
        ]
        traps = find_traps(fen, lines)
        sans = [t["move_san"] for t in traps]
        assert "Qxe5+" in sans
        trap = next(t for t in traps if t["move_san"] == "Qxe5+")
        assert trap["tempting_because"] == "it grabs material"
        assert trap["win_drop"] >= 10.0
        assert trap["refutation_san"][0] == "Qxe5+"

    def test_quiet_position_has_no_traps(self):
        lines = [
            _line(["e2e4", "e7e5", "g1f3"], 30),
            _line(["d2d4", "d7d5"], 25),
            _line(["g1f3", "g8f6"], 20),
        ]
        assert find_traps(STARTPOS, lines) == []

    def test_illegal_first_move_skipped(self):
        lines = [_line(["e2e4"], 30), _line(["e2e5"], -100)]
        assert find_traps(STARTPOS, lines) == []


class TestBuildLine:
    def test_walk_stops_at_illegal(self):
        line = build_teachable_line(STARTPOS, ["e2e4", "e2e5"], 30, None, 12)
        assert [p["san"] for p in line["moves"]] == ["e4"]

    def test_comments_and_verdict(self):
        line = build_teachable_line(STARTPOS, ["e2e4", "e7e5"], 30, None, 12)
        assert len(line["moves"]) == 2
        assert "e4" in line["moves"][0]["comment"]
        assert "engine" in line["verdict"]
