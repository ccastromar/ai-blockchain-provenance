# Agentic Auditor

Optional FastAPI-based auditor assistant for querying Ernest and summarizing provenance data.

## Local Run

```bash
cd agentic-auditor
./run.sh
```

`run.sh` creates a local `.venv`, installs `requirements.txt`, and starts Uvicorn on port `8000`.

Useful environment variables:

- `ERNEST_URL`: Ernest backend URL, default depends on the app configuration.
- `OPENAI_BASE_URL`: OpenAI-compatible API base URL.
- `OPENAI_API_KEY`: API key for the model provider.
- `OPENAI_MODEL`: model name.
- `PYTHON_BIN`: Python executable used to create the virtual environment, default `python3`.
- `VENV_DIR`: virtual environment directory, default `.venv`.

## Docker

The Dockerfile lives at `agentic-auditor/docker/Dockerfile`.
