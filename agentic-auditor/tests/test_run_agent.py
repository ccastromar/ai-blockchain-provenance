from types import SimpleNamespace
import unittest

from app.agent.run_agent import assistant_tool_message


class RunAgentTests(unittest.TestCase):
    def test_assistant_tool_message_is_plain_dict(self):
        msg = SimpleNamespace(
            content=None,
            tool_calls=[
                SimpleNamespace(
                    id="call-1",
                    function=SimpleNamespace(name="healthcheck", arguments="{}"),
                )
            ],
        )

        self.assertEqual(
            assistant_tool_message(msg),
            {
                "role": "assistant",
                "content": None,
                "tool_calls": [
                    {
                        "id": "call-1",
                        "type": "function",
                        "function": {"name": "healthcheck", "arguments": "{}"},
                    }
                ],
            },
        )


if __name__ == "__main__":
    unittest.main()
