# fastapi_app.py
from fastapi import FastAPI
from pydantic import BaseModel
from app.agent.run_agent import run_agent

app = FastAPI(
    title="Auditor Agent",
    version="1.0.0",
)

class AuditRequest(BaseModel):
    message: str

@app.get("/health")
def health():
    return {"alive": True, "service": "auditor-agent"}

@app.post("/audit")
def audit(req: AuditRequest):
    result = run_agent(req.message)
    return {"result": result}
