import json
from openai import OpenAI
from app.agent.tools import TOOLS_MAP
from app.core.logger import get_logger
import traceback

logger = get_logger("agent")

client = OpenAI(base_url="http://192.168.1.74:11434/v1", api_key="not-needed")

TOOLS_SCHEMA = [
    {
        "type": "function",
        "function": {
            "name": "healthcheck",
            "description": "Return system health",
            "parameters": {"type": "object", "properties": {}},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "verify_chain",
            "description": "Verify the hashchain integrity stored in MongoDB using Ernest CLI",
            "parameters": {"type": "object", "properties": {}},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "audit_inference",
            "description": "Audit input and output of an inference",
            "parameters": {
                "type": "object",
                "properties": {
                    "input_text": {"type": "string"},
                    "output_text": {"type": "string"},
                },
                "required": ["input_text", "output_text"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "list_models",
            "description": "Return AI models registered in the Ernest system",
            "parameters": {"type": "object", "properties": {}},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "list_events",
            "description": "Return recent events stored in the Ernest system",
            "parameters": {"type": "object", "properties": {}},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "provenance_by_model",
            "description": "Return provenance data for a given model ID",
            "parameters": {"type": "object", "properties": {
                "model_id": {"type": "string"}
            }},
        },
    },
     {
        "type": "function",
        "function": {
            "name": "get_block",
            "description": "Return block data for a given block ID",
            "parameters": {"type": "object", "properties": {
                "block_id": {"type": "string"}
            }},
        },
    },
]

def run_agent(user_message: str):
    logger.info(f"New request: {user_message}")

    messages = [
        {
            "role": "system",
            "content": (
                "You are an autonomous auditing agent. "
                "You verify system health, hashchain integrity, and regiser inferences.\n\n"
                "You have several tools:\n"
                "- healthcheck(): checks if the NestJS backend is alive.\n"
                "- verify_chain(): validates the hashchain using the Ernest CLI.\n"
                "- audit_inference(): hashes input/output and detects drift.\n\n"
                "- list_models(): lists AI models registered in the system.\n\n"
                "- list_events(): lists recent events stored in the system.\n\n"
                "- provenance_by_model(): retrieves provenance data for a given model ID.\n\n"
                "- get_block(): retrieves block data for a given block ID.\n\n"
                "Rules:\n"
                "- ALWAYS use a tool when the user asks for real system data.\n"
                "- Use verify_chain when the user asks for chain integrity or database consistency.\n"
                "- Use audit_inference when the user provides an input/output pair.\n"
                "- Use healthcheck for system status.\n"
                "- After each tool call, analyze the returned JSON and give a final summary.\n"
                "- Do not hallucinate. Do not invent facts.\n"
                "- Be precise and technical."
            ),
        },
        {"role": "user", "content": user_message},
    ]

    try:
        response = client.chat.completions.create(
            model="qwen3:8b",
            messages=messages,
            tools=TOOLS_SCHEMA,
            timeout=60,
        )
    except Exception as e:
        logger.error("LLM call failed", exc_info=True)
        return {"error": str(e)}

    msg = response.choices[0].message

    if not msg.tool_calls:
        logger.warning("No tool calls detected in LLM response")
        return {"response": msg.content}

    tool_results = []

    for call in msg.tool_calls:
        name = call.function.name
        raw_args = call.function.arguments or "{}"

        try:
            args = json.loads(raw_args)
        except:
            args = {}

        logger.info(f"Tool-call: {name} args={args}")

        try:
            result = TOOLS_MAP[name](**args)
        except Exception as e:
            result = {"error": str(e), "trace": traceback.format_exc()}
            logger.error(f"Tool error: {name}", exc_info=True)

        tool_results.append({"id": call.id, "name": name, "result": result})

    # Segunda pasada al LLM
    followup_messages = [
        msg,
        *[
            {
                "role": "tool",
                "tool_call_id": tr["id"],
                "content": json.dumps(tr["result"]),
            }
            for tr in tool_results
        ],
    ]

    try:
        second = client.chat.completions.create(
            model="qwen3:8b",
            messages=messages + followup_messages,
            timeout=60,
        )
    except Exception as e:
        logger.error("LLM second-pass failed", exc_info=True)
        return {"error": str(e)}

    final_text = second.choices[0].message.content

    logger.info("Final agent response", extra={"final": final_text})
    return {"response": final_text, "tools": tool_results}
