// Run with: mongosh "mongodb://localhost:27017/ernest" seed-models.js
// Or with auth: mongosh "mongodb://user:pass@localhost:27017/ernest?authSource=admin" seed-models.js

db = db.getSiblingDB('ernest');

db.aimodels.insertMany([
  {
    modelId: "fraud-detector-v1",
    name: "Fraud Detection Model",
    version: "1.0.0",
    parameters: {
      algorithm: "XGBoost",
      max_depth: 6,
      learning_rate: 0.1,
      n_estimators: 300,
      subsample: 0.8
    },
    metrics: {
      accuracy: 0.9712,
      precision: 0.9634,
      recall: 0.9541,
      f1_score: 0.9587,
      auc_roc: 0.9891
    },
    metadata: {
      framework: "scikit-learn",
      python_version: "3.10.4",
      training_dataset: "transactions_2024_q1.csv",
      training_samples: 1200000,
      trained_by: "alice@ernest-demo.ai",
      organization: "ernest-demo",
      domain: "ai-provenance",
      tags: ["fraud", "classification", "production"]
    },
    createdAt: new Date(),
    updatedAt: new Date()
  },
  {
    modelId: "sentiment-analyzer-v2",
    name: "Sentiment Analysis Model",
    version: "2.1.3",
    parameters: {
      architecture: "BERT",
      pretrained_model: "bert-base-uncased",
      max_seq_length: 512,
      batch_size: 32,
      epochs: 5,
      learning_rate: 2e-5
    },
    metrics: {
      accuracy: 0.9245,
      precision: 0.9187,
      recall: 0.9301,
      f1_score: 0.9244,
      val_loss: 0.2134
    },
    metadata: {
      framework: "PyTorch",
      python_version: "3.11.2",
      training_dataset: "reviews_multilingual_2024.jsonl",
      training_samples: 450000,
      trained_by: "bob@ernest-demo.ai",
      organization: "ernest-demo",
      domain: "ai-provenance",
      tags: ["nlp", "sentiment", "bert", "staging"]
    },
    createdAt: new Date(),
    updatedAt: new Date()
  },
  {
    modelId: "image-classifier-v1",
    name: "Medical Image Classifier",
    version: "1.2.0",
    parameters: {
      architecture: "ResNet50",
      input_shape: [224, 224, 3],
      num_classes: 14,
      batch_size: 16,
      epochs: 40,
      optimizer: "Adam",
      learning_rate: 0.0001
    },
    metrics: {
      accuracy: 0.8834,
      top5_accuracy: 0.9671,
      val_accuracy: 0.8712,
      val_loss: 0.3891,
      mean_auc: 0.9423
    },
    metadata: {
      framework: "TensorFlow",
      python_version: "3.10.12",
      training_dataset: "chest_xray_nih_2024.tar.gz",
      training_samples: 86000,
      trained_by: "carol@ernest-demo.ai",
      organization: "ernest-demo",
      domain: "ai-provenance",
      tags: ["computer-vision", "medical", "resnet", "experimental"]
    },
    createdAt: new Date(),
    updatedAt: new Date()
  }
]);

print("✓ 3 modelos insertados en ernest.aimodels");
print(db.aimodels.countDocuments() + " documentos en la colección");
