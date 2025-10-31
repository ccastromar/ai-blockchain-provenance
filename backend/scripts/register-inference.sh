curl -X POST http://localhost:3001/api/inferences \
  -H "Content-Type: application/json" \
  -d '{ 
    "modelId": "credit-risk-logreg-v1",
    "inferenceId":"1111-22222",
    "inputHash":"e13236b63f7c5c5c8e7d1d52ebc4188e85f1dc474f0f3b2186e3b061087df6f5",
    "outputHash": "8caa1ff8cf0eb5080f6fc2c157e53b1a239a2b58075b0cc9ed01215d7ac0dc45",
    "params": {
      "return_probs": true
    },
    "metadata": {
      "scoring_request_id": "score-20251027-1001",
      "source": "branch_app"
    }
  }'
