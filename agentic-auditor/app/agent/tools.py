
import os
import requests, subprocess, time
from app.core.logger import get_logger

ERNEST_URL = "http://localhost:3001"
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
CLI_PATH = os.path.abspath(os.path.join(BASE_DIR, "..", "..", "cli", "ernest"))

logger = get_logger("tools")

def ernest_health():
    try:
        r = requests.get(f"{ERNEST_URL}/health", timeout=1)
        logger.info("[healthcheck] status:", r.status_code)

        return "ALIVE" if r.status_code==200 else "DOWN"
    except Exception as e:
        logger.error("[healthcheck] error:", e)
        return "DOWN"

def verify_chain():
    import subprocess
    
    result = subprocess.run(
        [CLI_PATH, "hashchain", "verify"],
        capture_output=True,
        text=True,
        timeout=5
    )
    
    logger.info(f"[DEBUG] verify_chain stdout: {result.stdout}")
    return result.stdout

def list_events(limit=200):
    r = requests.get(f"{ERNEST_URL}/api/events?limit={limit}", timeout=2)
    r.raise_for_status()
    return r.json()

def list_models(limit=200):
    r = requests.get(f"{ERNEST_URL}/api/models?limit={limit}", timeout=2)
    r.raise_for_status()
    return r.json()

def provenance_by_model(model_id):
    r = requests.get(f"{ERNEST_URL}/api/provenances/{model_id}", timeout=2)
    r.raise_for_status()
    return r.json()

def get_block(block_id):
    try:
        r = requests.get(f"{ERNEST_URL}/api/blocks/{block_id}", timeout=2)
        r.raise_for_status()
        return r.json()
    except requests.exceptions.RequestException as e:
        logger.error(f"[get_block] error fetching block {block_id}: {e}")
        return {"error": str(e)}
    
def get_event(eid):
    return requests.get(f"{ERNEST_URL}/events/{eid}").json()

def verify_event_cli(eid):
    result = subprocess.run(
        ["./ernest","verify","--id",eid],
        capture_output=True,text=True
    )
    return result.stdout

def audit_inference(report):
    payload={"type":"audit_inference","timestamp":time.time(),"report":report}
    r=requests.post(f"{ERNEST_URL}/audit",json=payload)
    return {"status":r.status_code}

TOOLS_MAP = {
    "healthcheck": ernest_health,
    "audit_inference": audit_inference,
    "verify_chain": verify_chain,
    "list_models": list_models,
    "list_events": list_events,
    "provenance_by_model": provenance_by_model,
    "get_block": get_block,
}
