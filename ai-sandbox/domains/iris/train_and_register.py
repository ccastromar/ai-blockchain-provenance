import argparse
import hashlib
import pickle
import requests
import json
from sklearn import datasets
from sklearn.model_selection import train_test_split
from sklearn.neighbors import KNeighborsClassifier
import mlflow
from mlflow.models import infer_signature

STATE_FILE = "state.json"
API_BASE = "http://localhost:3001/api" 

def train_model():
    iris = datasets.load_iris()
    X_train, X_test, y_train, y_test = train_test_split(
        iris.data, iris.target, test_size=0.25, random_state=1
    )

    # Define the model hyperparameters
    params = {
        "solver": "lbfgs",
        "max_iter": 1000,
        "multi_class": "auto",
        "random_state": 8888,
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
    print(f"Hash del artefacto: {hash_main}")

    state = {
        "model_id": "iris-classifier-v1",
        "hash_main": hash_main,
        "accuracy": accuracy,
        "model_file": model_file
    }
    with open(STATE_FILE, "w") as sf:
        json.dump(state, sf)

    # START MLFlow integration - you can skip and comment this if not using MLflow
    # Set our tracking server uri for logging
    mlflow.set_tracking_uri(uri="http://127.0.0.1:8111")

    # Create a new MLflow Experiment
    mlflow.set_experiment("MLflow Quickstart")

    # Start an MLflow run
    with mlflow.start_run():
        # Log the hyperparameters
        mlflow.log_params(params)

        # Log the loss metric
        mlflow.log_metric("accuracy", accuracy)

        # Infer the model signature
        signature = infer_signature(X_train, model.predict(X_train))

        # Log the model, which inherits the parameters and metric
        model_info = mlflow.sklearn.log_model(
            sk_model=model,
            name="iris_model",
            signature=signature,
            input_example=X_train,
            registered_model_name="tracking-quickstart",
        )

        # Set a tag that we can use to remind ourselves what this model was for
        mlflow.set_logged_model_tags(
            model_info.model_id, {"Training Info": "Basic KNC model for iris data"}
        )    
    # END MLFlow integration - you can skip and comment this if not using MLflow    

    return model, X_test, y_test, hash_main, accuracy

def register_model(hash_main, accuracy):
    with open(STATE_FILE) as sf:
        state = json.load(sf)

    payload = {
        "modelName": state["model_id"],
        "version": "0.1.3",
        "status": "published",
        "metadata": {
            "dataset": "iris",
            "accuracy": accuracy
        }
    }

    resp = requests.post(f"{API_BASE}/models", json=payload)
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

    return model_id, hash_main, input_hash, output_hash

def register_inference(model_id, hash_main):
    if model_id is None:
        with open(STATE_FILE) as sf:
            state = json.load(sf)
        model_id = state.get("model_id")
        if model_id is None:
            raise RuntimeError("model_id no definido en el estado. Ejecute primero inferencia o train.")
    
    if hash_main is None:
        with open(STATE_FILE) as sf:
            state = json.load(sf)
        hash_main = state.get("hash_main")
        if hash_main is None:
            raise RuntimeError("hash_main no definido en el estado. Ejecute primero train o register.")

    payload = {
        "modelId": model_id,
        "input": {"hash": hash_main}
    }

    resp = requests.post(f"{API_BASE}/inference", json=payload)
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
        model_file = state["model_file"]
        hash_main = state["hash_main"]
        register_inference(model_id, hash_main)

if __name__ == "__main__":
    main()
