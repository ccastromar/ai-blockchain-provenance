// internal/db/repositories/aimodels/repo.go
package aimodels

import "go.mongodb.org/mongo-driver/bson"

// Repository define las operaciones sobre la colección “aimodels”.
type Repository interface {
    Count(filter bson.D) (int64, error)
    GetByModelID(modelID string) (map[string]interface{}, error)
    GetAll(limit int64, skip int64) ([]map[string]interface{}, error)
}
