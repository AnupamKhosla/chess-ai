import chess

from server.openings import identify_opening, opening_context


def board_from_san(*moves: str) -> chess.Board:
    board = chess.Board()
    for move in moves:
        board.push_san(move)
    return board


def test_recognizes_kings_gambit_before_evaluating_f_pawn():
    board = board_from_san("e4", "e5", "f4")

    opening = identify_opening(board)

    assert opening is not None
    assert opening.name == "King's Gambit"
    assert "1.e4 e5 2.f4" in opening_context(board)
    assert "offers the f-pawn" in opening_context(board)


def test_recognizes_more_specific_kings_gambit_accepted_line():
    board = board_from_san("e4", "e5", "f4", "exf4")

    opening = identify_opening(board)

    assert opening is not None
    assert opening.name == "King's Gambit Accepted"
    assert opening.eco == "C34-C39"


def test_does_not_invent_opening_from_arbitrary_fen():
    board = chess.Board()

    assert identify_opening(board) is None
    assert "Do not invent an opening name" in opening_context(board)
