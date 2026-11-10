from __future__ import annotations

from conftest import collect, make_jarvis, text_message, tool_message

from jarvis.brain import is_modern_model


async def test_plain_answer_streams_and_persists(settings):
    jarvis, client = make_jarvis(settings, [text_message("Good evening, Sir.")], mode="text")
    events = await collect(jarvis, "Hello")
    assert [e["type"] for e in events] == ["text", "final"]
    assert events[-1]["text"] == "Good evening, Sir."
    params = client.calls[0]
    assert params["model"] == "claude-opus-5-5"
    assert params["system"][0]["cache_control"] == {"type": "ephemeral"}
    assert params["thinking"] == {"type": "adaptive"}
    assert params["output_config"] == {"effort": "medium"}
    assert params["fallbacks"] == "default" and "server-side-fallback-2026-07-01" in params["betas"]
    names = [t["name"] for t in params["tools"]]
    assert names[:-2] == sorted(names[:-2]) and names[-2:] == ["web_search", "web_fetch"]
    assert all(t.get("eager_input_streaming") for t in params["tools"] if "input_schema" in t)
    roles = [m["role"] for m in params["messages"]]
    assert roles == ["user", "system"]  # the user turn, then the live-context line
    assert params["messages"][0]["content"][-1]["text"] == "Hello"
    history = jarvis.memory.load_messages(jarvis.brain.session.id)
    assert [m["role"] for m in history] == ["user", "system", "assistant"]


async def test_tool_round_trip(settings):
    jarvis, client = make_jarvis(
        settings,
        [tool_message("calculate", {"expression": "2+2"}, text="One moment."), text_message("Four, Sir.")],
    )
    events = await collect(jarvis, "what is 2 plus 2")
    kinds = [e["type"] for e in events]
    assert kinds == ["text", "tool_start", "tool_end", "text", "final"]
    assert events[2]["ok"] and "2+2 = 4" in events[2]["preview"]
    assert events[-1]["text"] == "One moment.Four, Sir."
    second = client.calls[1]["messages"]
    assert second[-2]["role"] == "assistant" and second[-2]["content"][1]["type"] == "tool_use"
    assert second[-1]["role"] == "user"
    result = second[-1]["content"][0]
    assert (
        result["type"] == "tool_result"
        and result["tool_use_id"] == "toolu_1"
        and result["content"] == "2+2 = 4"
    )
    assert "is_error" not in result


async def test_invalid_tool_input_is_reported_not_run(settings):
    jarvis, client = make_jarvis(settings, [tool_message("calculate", {"nope": 1}), text_message("Sorry.")])
    events = await collect(jarvis, "calc")
    tool_end = next(e for e in events if e["type"] == "tool_end")
    assert not tool_end["ok"] and "INVALID_INPUT" in tool_end["preview"]
    assert client.calls[1]["messages"][-1]["content"][0]["is_error"] is True


async def test_dangerous_tool_needs_approval(settings):
    decisions = []

    async def approver(tool, arguments):
        decisions.append((tool, arguments))
        return False

    jarvis, client = make_jarvis(
        settings,
        [tool_message("run_shell", {"command": "rm -rf /"}), text_message("As you wish.")],
        approver=approver,
    )
    events = await collect(jarvis, "wipe it")
    assert decisions == [("run_shell", {"command": "rm -rf /"})]
    tool_end = next(e for e in events if e["type"] == "tool_end")
    assert not tool_end["ok"] and "declined" in tool_end["preview"].lower()


async def test_dangerous_tool_without_channel_is_declined(settings):
    jarvis, _ = make_jarvis(
        settings, [tool_message("run_shell", {"command": "echo hi"}), text_message("Hm.")]
    )
    events = await collect(jarvis, "run it")
    tool_end = next(e for e in events if e["type"] == "tool_end")
    assert not tool_end["ok"]


async def test_auto_approve_runs_shell(settings):
    settings.auto_approve = True
    jarvis, _ = make_jarvis(
        settings, [tool_message("run_shell", {"command": "echo hello"}), text_message("Done.")]
    )
    events = await collect(jarvis, "say hello")
    tool_end = next(e for e in events if e["type"] == "tool_end")
    assert tool_end["ok"] and "hello" in tool_end["preview"]


async def test_truncated_tool_input_is_not_executed(settings):
    jarvis, client = make_jarvis(
        settings, [tool_message("calculate", {"expression": "1+"}, stop_reason="max_tokens")]
    )
    events = await collect(jarvis, "calc")
    assert any(e["type"] == "error" for e in events)
    history = jarvis.memory.load_messages(jarvis.brain.session.id)
    assert history[-1]["content"][0]["is_error"] is True  # history stays valid for the next turn
    assert len(client.calls) == 1


async def test_refusal_is_a_notice(settings):
    jarvis, _ = make_jarvis(
        settings,
        [
            text_message(
                "",
            ).model_copy(update={"stop_reason": "refusal"})
        ],
    )
    events = await collect(jarvis, "x")
    assert events[0]["type"] == "notice"


async def test_session_resumes_then_rolls_over_with_summary(settings):
    jarvis, client = make_jarvis(
        settings, [text_message("One."), text_message("Two."), text_message("Three.")]
    )
    await collect(jarvis, "first")
    first_id = jarvis.brain.session.id
    await collect(jarvis, "second")
    assert jarvis.brain.session.id == first_id
    assert len(client.calls[1]["messages"]) == 5  # user, system, assistant, user, system
    settings.session_token_budget = 10  # force a roll-over
    await collect(jarvis, "third")
    assert jarvis.brain.session.id != first_id
    assert client.create_calls, "the old session should have been summarised"
    first_user = client.calls[2]["messages"][0]["content"]
    assert first_user[0]["text"].startswith("[Summary of our previous conversation]")


async def test_legacy_model_puts_context_in_user_turn(settings):
    settings.model = "claude-sonnet-4-6"
    jarvis, client = make_jarvis(settings, [text_message("ok")])
    await collect(jarvis, "hi")
    params = client.calls[0]
    assert "fallbacks" not in params
    assert [m["role"] for m in params["messages"]] == ["user"]
    assert params["messages"][0]["content"][0]["text"].startswith("[Context]")


def test_is_modern_model():
    assert is_modern_model("claude-opus-5-5") and is_modern_model("claude-fable-5-2")
    assert not is_modern_model("claude-sonnet-4-6")
