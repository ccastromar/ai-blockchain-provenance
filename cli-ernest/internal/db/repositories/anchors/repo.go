package anchors

import "go.mongodb.org/mongo-driver/bson"

type Repository interface {
	Count(filter bson.D) (int64, error)
	GetAll(limit int64, skip int64) ([]map[string]interface{}, error)
}
