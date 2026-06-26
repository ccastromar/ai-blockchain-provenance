import argparse
import hashlib
import os
import pickle
import requests
import json
import uuid
from sklearn import datasets
from sklearn.model_selection import train_test_split
from sklearn.neighbors import KNeighborsClassifier
import mlflow
from mlflow.models import infer_signature

STATE_FILE = "state.json"
API_BASE = os.getenv("ERNEST_API_BASE", "http://localhost:3001/api")
ENABLE_MLFLOW = os.getenv("ENABLE_MLFLOW", "false").lower() == "true"
ERNEST_API_KEY = os.getenv("ERNEST_API_KEY")

def ernest_headers():
    headers = {}
    if ERNEST_API_KEY:
        headers["X-Ernest-Api-Key"] = ERNEST_API_KEY
    return headers

def train_model():
    iris = datasets.load_iris()
    X_train, X_test, y_train, y_test = train_test_split(
        iris.data, iris.target, test_size=0.25, random_state=1
    )

    params = {
        "model_type": "KNeighborsClassifier",
        "n_neighbors": 3,
    }

    model = KNeighborsClassifier(n_neighbors=3)
    model.fit(X_train, y_train)
    accuracy = model.score(X_test, y_test)
    print(f"Modelo entrenado, accuracy = {accuracy:.4f}")

    model_file = "iris_model_v1.pkl"
    with open(model_file, "wb") as f:
        pickle.dump((model, X_test, y_test), f)

    with open(model_file, "rb") as f:
        bytes_model = f.read()
    hash_main = hashlib.sha256(bytes_model).hexdigest()
    git_commit = hashlib.sha1(bytes_model).hexdigest()
    print(f"Hash del artefacto: {hash_main}")

    state = {
        "model_id": "iris-classifier-v1",
        "model_name": "Iris KNN classifier",
        "version": "0.1.3",
        "hash_main": hash_main,
        "git_commit": git_commit,
        "accuracy": accuracy,
        "model_file": model_file,
        "params": params
    }
    with open(STATE_FILE, "w") as sf:
        json.dump(state, sf)

    if ENABLE_MLFLOW:
        # START MLFlow integration - optional for local Ernest demos.
        mlflow.set_tracking_uri(uri=os.getenv("MLFLOW_TRACKING_URI", "http://127.0.0.1:8111"))

        mlflow.set_experiment("MLflow Quickstart")

        with mlflow.start_run():
            mlflow.log_params(params)

            mlflow.log_metric("accuracy", accuracy)

            signature = infer_signature(X_train, model.predict(X_train))

            model_info = mlflow.sklearn.log_model(
                sk_model=model,
                name="iris_model",
                signature=signature,
                input_example=X_train,
                registered_model_name="tracking-quickstart",
            )

            mlflow.set_logged_model_tags(
                model_info.model_id, {"Training Info": "Basic KNC model for iris data"}
            )
        # END MLFlow integration.

    return model, X_test, y_test, hash_main, accuracy

def register_model(hash_main, accuracy):
    with open(STATE_FILE) as sf:
        state = json.load(sf)

    payload = {
        "modelId": state["model_id"],
        "modelName": state["model_name"],
        "version": state["version"],
        "mlflow": {
            "modelHash": state["hash_main"],
            "gitCommit": state["git_commit"],
        },
        "params": state["params"],
        "metrics": {
            "accuracy": accuracy
        },
        "metadata": {
            "dataset": "iris",
            "framework": "scikit-learn",
            "source": "ai-sandbox/domains/iris"
        }
    }

    resp = requests.post(f"{API_BASE}/models", json=payload, headers=ernest_headers())
    if resp.status_code not in (200, 201):
        raise RuntimeError(f"Error al registrar modelo: {resp.status_code} {resp.text}")
    print("Modelo registrado correctamente:", resp.json())

def run_inference(model_file, hash_main):
    with open(STATE_FILE) as sf:
        state = json.load(sf)

    model_file = state["model_file"]
    model_id   = state["model_id"]

    with open(model_file, "rb") as f:
        model, X_test, y_test = pickle.load(f)

    input_data = X_test[0].tolist()
    predicted = model.predict([X_test[0]])[0]
    print(f"Inferencia realizada: input → {input_data}, prediction → {predicted}")

    input_bytes = pickle.dumps(input_data)
    output_bytes = pickle.dumps(predicted)
    input_hash = hashlib.sha256(input_bytes).hexdigest()
    output_hash = hashlib.sha256(output_bytes).hexdigest()
    print(f"input_hash={input_hash}, output_hash={output_hash}")

    state["last_input_hash"] = input_hash
    state["last_output_hash"] = output_hash
    state["last_prediction"] = int(predicted)
    with open(STATE_FILE, "w") as sf:
        json.dump(state, sf)

    return model_id, hash_main, input_hash, output_hash

def register_inference(model_id, input_hash=None, output_hash=None):
    if model_id is None:
        with open(STATE_FILE) as sf:
            state = json.load(sf)
        model_id = state.get("model_id")
        if model_id is None:
            raise RuntimeError("model_id no definido en el estado. Ejecute primero inferencia o train.")
    
    if input_hash is None or output_hash is None:
        with open(STATE_FILE) as sf:
            state = json.load(sf)
        input_hash = input_hash or state.get("last_input_hash")
        output_hash = output_hash or state.get("last_output_hash")
        if input_hash is None or output_hash is None:
            raise RuntimeError("input_hash/output_hash no definidos. Ejecute primero infer o all.")

    payload = {
        "modelId": model_id,
        "inferenceId": f"iris-{uuid.uuid4()}",
        "inputHash": input_hash,
        "outputHash": output_hash,
        "params": {
            "return_probs": False
        },
        "metadata": {
            "source": "ai-sandbox/domains/iris",
            "dataset": "iris"
        }
    }

    resp = requests.post(f"{API_BASE}/inferences", json=payload, headers=ernest_headers())
    if resp.status_code not in (200, 201):
        raise RuntimeError(f"Error al registrar inferencia: {resp.status_code} {resp.text}")
    print("Inferencia registrada correctamente:", resp.json())

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--step", choices=["train", "register", "infer", "register_inference", "all"],
                        default="all", help="Paso del flujo a ejecutar")
    args = parser.parse_args()

    model = None
    X_test = None
    y_test = None
    hash_main = None
    accuracy = None

    if args.step in ("train", "all"):
        model, X_test, y_test, hash_main, accuracy = train_model()

    if args.step in ("register", "all"):
        if hash_main is None:
            with open(STATE_FILE) as sf:
                state = json.load(sf)
            hash_main = state["hash_main"]
            accuracy = state.get("accuracy")
        register_model(hash_main, accuracy)

    if args.step in ("infer", "all"):
        with open(STATE_FILE) as sf:
            state = json.load(sf)
        model_id = state["model_id"]
        model_file = state["model_file"]
        hash_main = state["hash_main"]
        # Ejecuta inferencia
        model_id, hash_main, input_hash, output_hash = run_inference(model_file, hash_main)

    if args.step in ("register_inference", "all"):
        # Asegura que input_hash/output_hash están definidos
        with open(STATE_FILE) as sf:
            state = json.load(sf)
        model_id = state["model_id"]
        register_inference(model_id)

if __name__ == "__main__":
    main()
