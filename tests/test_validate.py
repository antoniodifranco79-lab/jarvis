from jarvis.tools.base import validate_against

SCHEMA = {
    "type": "object",
    "properties": {
        "q": {"type": "string"},
        "n": {"type": "integer"},
        "unit": {"type": "string", "enum": ["c", "f"]},
        "tags": {"type": "array", "items": {"type": "string"}},
        "data": {"anyOf": [{"type": "object"}, {"type": "null"}]},
    },
    "required": ["q"],
    "additionalProperties": False,
}


def test_validate_against():
    assert validate_against(SCHEMA, {"q": "x"}) is None
    assert validate_against(SCHEMA, {"q": "x", "n": 3, "unit": "c", "tags": ["a"], "data": None}) is None
    assert "missing required" in validate_against(SCHEMA, {})
    assert "expected integer" in validate_against(SCHEMA, {"q": "x", "n": "3"})
    assert "boolean" in validate_against(SCHEMA, {"q": "x", "n": True})
    assert "must be one of" in validate_against(SCHEMA, {"q": "x", "unit": "k"})
    assert "unexpected property" in validate_against(SCHEMA, {"q": "x", "zzz": 1})
    assert "tags/0" in validate_against(SCHEMA, {"q": "x", "tags": [1]})
    assert "no alternative" in validate_against(SCHEMA, {"q": "x", "data": 5})
