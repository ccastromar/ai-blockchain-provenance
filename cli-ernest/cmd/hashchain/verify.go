package hashchain

import (
	"encoding/json"
	"fmt"
	"os"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"cli-ernest/internal/db/mongo"
	"cli-ernest/internal/db/repositories/provenanceblocks"
	"cli-ernest/internal/hashcanon"

	"github.com/spf13/cobra"
)

type Block struct {
	Index        int64
	Timestamp    int64
	Data         map[string]interface{}
	PreviousHash string
	Hash         string
}

var (
	verifyAPIURL string
	verifyAPIKey string
	verifyFile   string
)

var verifyCmd = &cobra.Command{
	Use:   "verify",
	Short: "Verify the hashchain integrity",
	Long: `Verify the hashchain integrity.

Block sources, in priority order:
  --file   offline verification of an export bundle (GET /api/blocks/export)
  --api    read-only verification through the Ernest API (a read-only key suffices;
           defaults to $ERNEST_URL, key from --key or $ERNEST_API_KEY)
  (none)   legacy direct-MongoDB mode, for forensic use on the host itself

The API and file modes are the ones meant for external auditors: no database
credentials involved.`,
	RunE: func(cmd *cobra.Command, args []string) error {

		start := time.Now()

		results, err := loadBlocks()
		if err != nil {
			return err
		}
		fmt.Printf("Total bloques obtenidos: %d\n", len(results))

		blocks := MapResultsToBlocks(results)

		errs := make(chan error, len(blocks))
		var wg sync.WaitGroup
		for i := range blocks {
			wg.Add(1)
			go func(i int) {
				defer wg.Done()
				errs <- verifyBlock(blocks, i)
			}(i)
		}

		wg.Wait()
		close(errs)

		var numErrors int
		for err := range errs {
			if err != nil {
				fmt.Printf("Error verificación: %v\n", err)
				numErrors++
			}
		}
		if numErrors > 0 {
			return fmt.Errorf("%d bloques inválidos detectados", numErrors)
		}

		fmt.Println("¡Verificación completa y exitosa!")
		end := time.Now()
		duration := end.Sub(start)
		fmt.Printf("Timings: Start=%s, End=%s, Duration=%s\n", start.Format(time.RFC3339Nano), end.Format(time.RFC3339Nano), duration)

		return nil
	},
}

func loadBlocks() ([]map[string]interface{}, error) {
	if verifyFile != "" {
		fmt.Printf("Fuente: export file %s\n", verifyFile)
		return loadBlocksFromFile(verifyFile)
	}

	apiURL := verifyAPIURL
	if apiURL == "" {
		apiURL = os.Getenv("ERNEST_URL")
	}
	if apiURL != "" {
		apiKey := verifyAPIKey
		if apiKey == "" {
			apiKey = os.Getenv("ERNEST_API_KEY")
		}
		fmt.Printf("Fuente: Ernest API %s\n", apiURL)
		return loadBlocksFromAPI(strings.TrimRight(apiURL, "/"), apiKey)
	}

	fmt.Println("Fuente: MongoDB directo (modo forense; use --api o --file para verificar sin credenciales de base de datos)")
	client, err := mongo.GetClient()
	if err != nil {
		return nil, fmt.Errorf("failed to get Mongo client: %w", err)
	}
	repo := provenanceblocks.NewMongoRepository(client)
	results, err := repo.GetAll(10000, 0)
	if err != nil {
		return nil, fmt.Errorf("error obteniendo bloques desde repo: %w", err)
	}
	return results, nil
}

func verifyBlock(blocks []Block, i int) error {
	if i == 0 {
		return nil // genesis, siempre válido
	}

	if blocks[i].PreviousHash != blocks[i-1].Hash {
		return fmt.Errorf("bloque %d inválido: PrevHash '%s' no coincide con Hash anterior '%s'", i, blocks[i].PreviousHash, blocks[i-1].Hash)
	}

	// Recomputes with the shared canonicalization pinned by
	// testdata/hash-golden-vectors.json -- the same law the NestJS backend and the Go
	// event-writer hash with. The stored data is canonicalized as-is: no re-cleaning at
	// verify time, since cleaning is an append-time concern and re-applying it here
	// would reject valid blocks written by the event-writer (which preserves nulls).
	calculatedHash, err := hashcanon.CalculateBlockHash(blocks[i].Index, blocks[i].Timestamp, blocks[i].Data, blocks[i].PreviousHash)
	if err != nil {
		return fmt.Errorf("bloque %d: no se pudo canonicalizar: %w", i, err)
	}
	if blocks[i].Hash != calculatedHash {
		return fmt.Errorf("bloque %d inválido: Hash calculado '%s' no coincide con Hash almacenado '%s'", i, calculatedHash, blocks[i].Hash)
	}
	return nil
}

func getInt64FromAny(val interface{}) int64 {
	switch v := val.(type) {
	case int:
		return int64(v)
	case int32:
		return int64(v)
	case int64:
		return v
	case float64:
		return int64(v)
	case json.Number:
		iv, _ := v.Int64()
		return iv
	case string:
		iv, _ := strconv.ParseInt(v, 10, 64)
		return iv
	default:
		return 0
	}
}

func MapResultsToBlocks(results []map[string]interface{}) []Block {
	var blocks []Block
	for _, m := range results {
		block := Block{}

		if v, ok := m["index"]; ok {
			block.Index = getInt64FromAny(v)
		}
		if v, ok := m["timestamp"]; ok {
			block.Timestamp = getInt64FromAny(v)
		}
		// The driver decodes nested documents as primitive.M (a named type), so a
		// direct assertion to map[string]interface{} always failed here -- the old
		// fallback silently verified every block against EMPTY data. NormalizeBSON
		// unwraps the named container types first.
		if v, ok := m["data"]; ok {
			if normalized, isMap := hashcanon.NormalizeBSON(v).(map[string]interface{}); isMap {
				block.Data = normalized
			}
		}
		if block.Data == nil {
			block.Data = make(map[string]interface{})
		}
		if v, ok := m["previousHash"].(string); ok {
			block.PreviousHash = v
		}
		if v, ok := m["hash"].(string); ok {
			block.Hash = v
		}

		blocks = append(blocks, block)
	}

	sort.Slice(blocks, func(i, j int) bool {
		return blocks[i].Index < blocks[j].Index
	})

	return blocks
}

func init() {
	verifyCmd.Flags().StringVar(&verifyAPIURL, "api", "", "Ernest API base URL (e.g. http://localhost:3001); defaults to $ERNEST_URL")
	verifyCmd.Flags().StringVar(&verifyAPIKey, "key", "", "Ernest API key for --api mode (read-only key suffices); defaults to $ERNEST_API_KEY")
	verifyCmd.Flags().StringVar(&verifyFile, "file", "", "verify an offline export bundle (GET /api/blocks/export) instead of a live source")
	HashchainCmd.AddCommand(verifyCmd)
}
