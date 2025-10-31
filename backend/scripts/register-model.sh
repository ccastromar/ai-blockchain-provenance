curl -X POST http://localhost:3001/api/models \
  -H "Content-Type: application/json" \
  -d '{
    "modelId": "credit-risk-logreg-v1",
    "modelName":"Credit Risk logaritmic regression version 1",
    "version": "1.0.0",
    "mlflow": {
      "modelHash": "8caa1ff8cf0eb5080f6fc2c157e53b1a239a2b58075b0cc9ed01215d7ac0dc45",
      "gitCommit": "a3f9d12e6b4c8f72b6f2c1d0ef9a31fcb4dbe7b2"
    },
    "params": {
      "model_type": "LogisticRegression",
      "solver": "liblinear",
      "penalty": "l2",
      "C": 1.0,
      "random_state": 42
    },
    "metrics": {
      "roc_auc": 0.81,
      "accuracy": 0.76,
      "precision": 0.72,
      "recall": 0.69,
      "f1_score": 0.70
    },
    "metadata": {
      "framework": "scikit-learn",
      "training_data": "German Credit Risk Dataset",
      "feature_names": [
        "age", "credit_amount", "duration", "housing", "employment_status", "job_type", "other_debtors", "own_telephone"
      ],
      "target": "creditworthiness",
      "classes": ["Good", "Bad"],
      "author": "Your Name",
      "creation_date": "2025-10-27"
    }
  }'
