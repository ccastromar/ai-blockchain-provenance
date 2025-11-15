# fastapi_app.py
from fastapi import FastAPI
from pydantic import BaseModel
from fastapi import FastAPI, Request
from fastapi.templating import Jinja2Templates
from fastapi.responses import HTMLResponse
from app.agent.run_agent import run_agent

app = FastAPI(
    title="Auditor Agent",
    version="1.0.0",
)
templates = Jinja2Templates(directory="app/templates")


class AuditRequest(BaseModel):
    message: str

from markdown2 import markdown

def markdown_filter(text: str):
    if not text:
        return ""
    return markdown(text, extras=["fenced-code-blocks"])

templates.env.filters["markdown"] = markdown_filter

@app.get("/", response_class=HTMLResponse)
async def home(request: Request):
    return templates.TemplateResponse("index.html", {"request": request})

@app.post("/ui/run")
async def ui_run(request: Request):
    data = await request.form()
    query = data.get("query")
    result = run_agent(query)
    if "result" in result:
        # Forma A
        data = result["result"]
    else:
        # Forma B
        data = result

    summary = data.get("response", "(no response)")
    tools = data.get("tools", [])

    # Empaquetamos para la plantilla
    parsed = {
        "summary": summary,
        "tools": tools,
        "raw": result
    }

    return templates.TemplateResponse("index.html", {
        "request": request,
        "query": query,
        "parsed": parsed
    })


@app.get("/health")
def health():
    return {"alive": True, "service": "auditor-agent"}

@app.post("/audit")
def audit(req: AuditRequest):
    result = run_agent(req.message)
    return {"result": result}
