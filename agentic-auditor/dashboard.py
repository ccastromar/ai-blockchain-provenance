
from fastapi import FastAPI,Request
from fastapi.templating import Jinja2Templates
from fastapi.staticfiles import StaticFiles
import requests

app=FastAPI()
app.mount("/static",StaticFiles(directory="static"),name="static")
templates=Jinja2Templates(directory="templates")
ERNEST_URL="http://localhost:4000"

def get_events():
    try: return requests.get(f"{ERNEST_URL}/events?limit=50").json()
    except: return []

def get_reports():
    try: return requests.get(f"{ERNEST_URL}/audit").json()
    except: return []

@app.get("/")
def index(request:Request):
    return templates.TemplateResponse("index.html",{
        "request":request,
        "events":get_events(),
        "reports":get_reports()
    })

@app.get("/events")
def events(request:Request):
    return templates.TemplateResponse("events.html",{
        "request":request,
        "events":get_events()
    })
