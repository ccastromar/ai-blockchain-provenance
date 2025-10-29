package provenanceblocks

import (
	"context"
	"fmt"
	"os"
	"time"

	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/mongo"
	"go.mongodb.org/mongo-driver/mongo/options"
)

// mongoRepository implementa Repository usando MongoDB.
type mongoRepository struct {
	client *mongo.Client
	dbName string
}

func NewMongoRepository(client *mongo.Client) Repository {
	dbName := os.Getenv("BLUEPRINT_DB_DATABASE")
	if dbName == "" {
		panic("BLUEPRINT_DB_DATABASE environment variable not set")
	}

	return &mongoRepository{
		client: client,
		dbName: dbName,
	}
}

func (r *mongoRepository) Count(filter bson.D) (int64, error) {
	coll := r.client.Database(r.dbName).Collection("provenanceblocks")
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	count, err := coll.CountDocuments(ctx, filter, &options.CountOptions{})
	if err != nil {
		return 0, fmt.Errorf("error counting aimodels: %w", err)
	}
	return count, nil
}

func (r *mongoRepository) Height(filter bson.D) (int64, error) {
	coll := r.client.Database(r.dbName).Collection("provenanceblocks")
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	count, err := coll.CountDocuments(ctx, filter, &options.CountOptions{})
	if err != nil {
		return 0, fmt.Errorf("error counting aimodels: %w", err)
	}
	return count - 1, nil
}

func (r *mongoRepository) GetAll(limit int64, skip int64) ([]map[string]interface{}, error) {
	coll := r.client.Database(r.dbName).Collection("provenanceblocks")
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	opts := options.Find().SetLimit(limit).SetSkip(skip)
	cursor, err := coll.Find(ctx, bson.D{}, opts)
	if err != nil {
		return nil, fmt.Errorf("error finding ai models: %w", err)
	}

	var results []map[string]interface{}
	if err := cursor.All(ctx, &results); err != nil {
		return nil, fmt.Errorf("error decoding ai models: %w", err)
	}
	return results, nil
}

func (r *mongoRepository) GetByIndex(index int64) (map[string]interface{}, error) {
	coll := r.client.Database(r.dbName).Collection("provenanceblocks")
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	var result map[string]interface{}
	err := coll.FindOne(ctx, bson.D{{"index", index}}).Decode(&result)
	if err != nil {
		if err == mongo.ErrNoDocuments {
			return nil, fmt.Errorf("no block found with index %s", index)
		}
		return nil, fmt.Errorf("error finding block: %w", err)
	}
	return result, nil
}

func (r *mongoRepository) GetByHash(hash string) (map[string]interface{}, error) {
	coll := r.client.Database(r.dbName).Collection("provenanceblocks")
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	var result map[string]interface{}
	err := coll.FindOne(ctx, bson.D{{"hash", hash}}).Decode(&result)
	if err != nil {
		if err == mongo.ErrNoDocuments {
			return nil, fmt.Errorf("no block found with hash %s", hash)
		}
		return nil, fmt.Errorf("error finding block: %w", err)
	}
	return result, nil
}
