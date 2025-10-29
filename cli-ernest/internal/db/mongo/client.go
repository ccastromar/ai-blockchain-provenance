package mongo

import (
	"context"
	"fmt"
	"os"
	"sync"
	"time"

	"go.mongodb.org/mongo-driver/mongo"
	"go.mongodb.org/mongo-driver/mongo/options"
	"go.mongodb.org/mongo-driver/mongo/readpref"
)

var (
	clientInstance *mongo.Client
	clientOnce     sync.Once
)

// GetClient retorna un *mongo.Client singleton.
// Usa variables de entorno: MONGO_URI, MONGO_DB_NAME (o tus propias).
func GetClient() (*mongo.Client, error) {
	var err error

	clientOnce.Do(func() {
		uri := os.Getenv("MONGO_URI")
		if uri == "" {
			err = fmt.Errorf("MONGO_URI environment variable not set")
			return
		}

		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()

		clientOpts := options.Client().ApplyURI(uri)
		clientInstance, err = mongo.Connect(ctx, clientOpts)
		if err != nil {
			return
		}

		// Verificar conexión
		if err = clientInstance.Ping(ctx, readpref.Primary()); err != nil {
			return
		}
	})

	return clientInstance, err
}

// Disconnect desconecta el cliente cuando la app se está cerrando.
func Disconnect(ctx context.Context) error {
	if clientInstance == nil {
		return nil
	}
	return clientInstance.Disconnect(ctx)
}
