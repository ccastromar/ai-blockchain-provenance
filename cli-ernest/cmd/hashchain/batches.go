package hashchain

import (
	"context"
	"fmt"
	"net/http"
	"os"
	"sort"
	"time"

	"cli-ernest/internal/db/mongo"
	"cli-ernest/internal/hashcanon"
	"cli-ernest/internal/rfc6962"

	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/mongo/options"
)

// ADR-004 batch blocks commit to their events only through an RFC 6962 root, so the
// chain alone cannot prove what a batch contains: verification also needs the events.
// Each one's leaf is recomputed from its data (never taken from a stored leafHash), and
// the events whose seq falls in a batch's [firstSeq, lastSeq] must reproduce its root.

type batchEvent struct {
	Seq  int64
	Data map[string]any
}

// eventsExport matches GET /api/events/export.
type eventsExport struct {
	ExportedAt  string           `json:"exportedAt"`
	TotalEvents int64            `json:"totalEvents"`
	Events      []map[string]any `json:"events"`
}

func toBatchEvents(raw []map[string]any) []batchEvent {
	out := make([]batchEvent, 0, len(raw))
	for _, m := range raw {
		e := batchEvent{Seq: getInt64FromAny(m["seq"])}
		if d, ok := hashcanon.NormalizeBSON(m["data"]).(map[string]any); ok {
			e.Data = d
		}
		out = append(out, e)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Seq < out[j].Seq })
	return out
}

func loadEventsFromFile(path string) ([]batchEvent, error) {
	file, err := os.Open(path)
	if err != nil {
		return nil, fmt.Errorf("cannot open events export: %w", err)
	}
	defer file.Close()
	var bundle eventsExport
	if err := decodeUseNumber(file, &bundle); err != nil {
		return nil, fmt.Errorf("events export is not valid JSON: %w", err)
	}
	return toBatchEvents(bundle.Events), nil
}

func loadEventsFromAPI(baseURL, apiKey string) ([]batchEvent, error) {
	request, err := http.NewRequest(http.MethodGet, baseURL+"/api/events/export", nil)
	if err != nil {
		return nil, err
	}
	if apiKey != "" {
		request.Header.Set(apiKeyHeader, apiKey)
	}
	response, err := (&http.Client{Timeout: 5 * time.Minute}).Do(request)
	if err != nil {
		return nil, fmt.Errorf("cannot reach Ernest API: %w", err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("Ernest API returned %s for /api/events/export", response.Status)
	}
	var bundle eventsExport
	if err := decodeUseNumber(response.Body, &bundle); err != nil {
		return nil, fmt.Errorf("cannot decode events export: %w", err)
	}
	return toBatchEvents(bundle.Events), nil
}

func loadEventsFromMongo() ([]batchEvent, error) {
	client, err := mongo.GetClient()
	if err != nil {
		return nil, fmt.Errorf("failed to get Mongo client: %w", err)
	}
	coll := client.Database(os.Getenv("BLUEPRINT_DB_DATABASE")).Collection("evidence_events")
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
	defer cancel()
	cursor, err := coll.Find(ctx, bson.D{{Key: "chain.kind", Value: "batch"}, {Key: "state", Value: "chained"}},
		options.Find().SetSort(bson.D{{Key: "seq", Value: 1}}).SetProjection(bson.D{{Key: "seq", Value: 1}, {Key: "data", Value: 1}}))
	if err != nil {
		return nil, fmt.Errorf("error reading evidence_events: %w", err)
	}
	var results []map[string]any
	if err := cursor.All(ctx, &results); err != nil {
		return nil, fmt.Errorf("error decoding evidence_events: %w", err)
	}
	return toBatchEvents(results), nil
}

func hasBatchBlocks(blocks []Block) bool {
	for _, b := range blocks {
		if b.Data["type"] == "batch" {
			return true
		}
	}
	return false
}

// verifyBatches re-derives the root of every batch block from its events.
func verifyBatches(blocks []Block, events []batchEvent) []error {
	var errs []error
	for _, b := range blocks {
		if b.Data["type"] != "batch" {
			continue
		}
		if b.Data["treeAlg"] != rfc6962.TreeAlg {
			errs = append(errs, fmt.Errorf("bloque %d: algoritmo de batch desconocido %v", b.Index, b.Data["treeAlg"]))
			continue
		}
		first, last, size := getInt64FromAny(b.Data["firstSeq"]), getInt64FromAny(b.Data["lastSeq"]), getInt64FromAny(b.Data["size"])
		lo := sort.Search(len(events), func(i int) bool { return events[i].Seq >= first })
		hi := sort.Search(len(events), func(i int) bool { return events[i].Seq > last })
		members := events[lo:hi]
		if int64(len(members)) != size {
			errs = append(errs, fmt.Errorf("bloque %d: el batch declara %d eventos (seq %d..%d), hay %d", b.Index, size, first, last, len(members)))
			continue
		}
		leaves := make([]string, len(members))
		var leafErr error
		for i, e := range members {
			if leaves[i], leafErr = rfc6962.LeafHash(e.Data); leafErr != nil {
				break
			}
		}
		if leafErr != nil {
			errs = append(errs, fmt.Errorf("bloque %d: no se pudo canonicalizar un evento: %w", b.Index, leafErr))
			continue
		}
		root, err := rfc6962.Root(leaves)
		if err != nil || root != b.Data["root"] {
			errs = append(errs, fmt.Errorf("bloque %d: la raíz del batch no coincide con sus eventos", b.Index))
		}
	}
	return errs
}
