
#!/usr/bin/env python3
import requests, random, uuid, time, sys

ERNEST_URL = "http://localhost:3001"
MODELS = ["llama3-8b","mixtral-8x7b","phi-3-mini","gpt-neo","falcon-7b"]
AGENTS = ["agent-1","agent-2","agent-3","agent-susp","agent-demo"]

def post_event(evt):
    try:
        r = requests.post(f"{ERNEST_URL}/events", json=evt, timeout=2)
        return r.json()
    except Exception as e:
        print("Error:", e)

def random_model_event():
    return {
        "type":"model_version",
        "model_id":random.choice(MODELS),
        "version":str(random.randint(1,50)),
        "metadata":{"params":random.randint(1_000_000,7_000_000_000),
                    "description":f"Random model {uuid.uuid4()}"}
    }

def random_inference_event(model=None):
    model = model or random.choice(MODELS)
    return {
        "type":"model_inference",
        "model_id":model,
        "input":f"Random input {uuid.uuid4()}",
        "output":f"Random output {uuid.uuid4()}",
        "timestamp":time.time(),
        "latency_ms":random.randint(5,500)
    }

def random_agent_action(inf_id=None):
    return {
        "type":"agent_action",
        "agent_id":random.choice(AGENTS),
        "action_type":random.choice(["access_api","x402_payment"]),
        "links":{"inference_ids":[inf_id] if inf_id else [],
                 "model_ids":[random.choice(MODELS)]},
        "metadata":{"decision":random.choice(["ok","weird","uncertain"]),
                    "cost":random.random()*0.005}
    }

def inject_weird_cases():
    post_event({"type":"agent_action","links":{}})
    post_event({"type":"model_inference","input":"x","output":"y"})
    post_event({"type":"agent_action","timestamp":time.time()+9999999,
                "links":{"model_ids":["llama3-8b"],"inference_ids":[]}})
    post_event({"type":"model_version","model_id":"ghost","version":"999"})
    print("Injected weird cases.")

def generate_suspicious_agent(n=20):
    model="llama3-8b"; agent="agent-suspicious-999"
    for _ in range(n):
        post_event({
            "type":"model_inference","model_id":model,
            "input":"same-input","output":f"{uuid.uuid4()}"
        })
        post_event({
            "type":"agent_action","agent_id":agent,
            "action_type":"x402_payment",
            "metadata":{"cost":random.random()*3}
        })
    print("Suspicious agent generated.")

def stress(n=1000):
    for _ in range(n):
        evt={"type":random.choice(["model_inference","agent_action","model_version"]),
             "data":str(uuid.uuid4())}
        post_event(evt)
    print("Stress test done.")

def generate(n=100):
    ids=[]
    for _ in range(n):
        post_event(random_model_event())
        inf=post_event(random_inference_event())
        if inf and "id" in inf: ids.append(inf["id"])
        post_event(random_agent_action(random.choice(ids) if ids else None))
    print("Generated",n,"events.")

if __name__=="__main__":
    if len(sys.argv)<2:
        print("Commands: generate N | weird | suspicious N | stress N")
        sys.exit(1)
    cmd=sys.argv[1]
    if cmd=="generate": generate(int(sys.argv[2]) if len(sys.argv)>2 else 100)
    elif cmd=="weird": inject_weird_cases()
    elif cmd=="suspicious": generate_suspicious_agent(int(sys.argv[2]) if len(sys.argv)>2 else 20)
    elif cmd=="stress": stress(int(sys.argv[2]) if len(sys.argv)>2 else 1000)
