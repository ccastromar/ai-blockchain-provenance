# logger.py
import json
import logging
import os
import sys
from datetime import datetime

COLORS = {
    "DEBUG": "\033[36m",
    "INFO": "\033[32m",
    "WARNING": "\033[33m",
    "ERROR": "\033[31m",
    "CRITICAL": "\033[41m",
}
RESET = "\033[0m"

class JsonFormatter(logging.Formatter):
    def format(self, record):
        data = {
            "timestamp": datetime.utcnow().isoformat() + "Z",
            "level": record.levelname,
            "message": record.getMessage(),
            "module": record.module,
            "function": record.funcName,
        }

        if record.exc_info:
            data["exception"] = self.formatException(record.exc_info)

        return json.dumps(data)

class ColorFormatter(logging.Formatter):
    def format(self, record):
        color = COLORS.get(record.levelname, "")
        try:
            msg = record.getMessage()  # deja que Python intente el formato normal
        except Exception:
            # Si peta, construimos nosotros manualmente:
            msg = f"{record.msg} {record.args}".strip()

        base = f"{record.levelname:<8} | {record.module:<12} | {msg}"
        return f"{color}{base}{RESET}"

def get_logger(name="agent"):
    logger = logging.getLogger(name)
    logger.setLevel(logging.INFO)

    if logger.handlers:
        return logger

    # Mode selection:
    # LOCAL DEVELOPMENT: LOG_MODE=local → COLOR ONLY
    # PRODUCTION: LOG_MODE=prod → JSON ONLY
    mode = os.getenv("LOG_MODE", "local").lower()

    handler = logging.StreamHandler(sys.stdout)

    if mode == "local":
        # LOCAL DEV MODE → pretty colored logs
        handler.setFormatter(ColorFormatter())
    else:
        # PROD MODE → JSON logs
        handler.setFormatter(JsonFormatter())

    logger.handlers = [handler]
    logger.propagate = True

    return logger
