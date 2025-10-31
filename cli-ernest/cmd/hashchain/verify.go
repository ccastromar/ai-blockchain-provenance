package hashchain

import (
	"bytes"
	"cli-ernest/internal/db/repositories/provenanceblocks"
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"reflect"
	"sort"
	"strconv"
	"sync"
	"time"

	"cli-ernest/internal/db/mongo"

	"github.com/spf13/cobra"
)

type Block struct {
	Index        int64
	Timestamp    int64
	Data         map[string]interface{}
	PreviousHash string
	//Nonce        int64
	Hash string
}

var verifyCmd = &cobra.Command{
	Use:   "verify",
	Short: "Verify the hashchain integrity",
	RunE: func(cmd *cobra.Command, args []string) error {

		start := time.Now()

		client, err := mongo.GetClient()
		if err != nil {
			return fmt.Errorf("failed to get Mongo client: %w", err)
		}
		repo := provenanceblocks.NewMongoRepository(client)

		blocks, err := repo.GetAll(10000, 0)
		if err != nil {
			fmt.Printf("Error obteniendo bloques desde repo: %v\n", err)
		}
		fmt.Printf("Total bloques obtenidos: %d\n", len(blocks))

		results := make(chan error, len(blocks))

		if err != nil {
			return fmt.Errorf("error : %w", err)
		}

		var wg sync.WaitGroup
		for i := range blocks {
			wg.Add(1)
			go func(i int) {
				defer wg.Done()
				mappedBlocks := MapResultsToBlocks(blocks)
				err := verifyBlock(mappedBlocks, i)
				results <- err
			}(i)
		}

		wg.Wait()
		close(results)

		var numErrors int
		for err := range results {
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

func verifyBlock(blocks []Block, i int) error {
	if i == 0 {
		return nil // genesis, siempre válido
	}
	//fmt.Printf("[Debug] Verificando bloque %d: prevHash=%s, hashAnterior=%s\n", i, blocks[i].PreviousHash, blocks[i-1].Hash)

	if blocks[i].PreviousHash != blocks[i-1].Hash {
		return fmt.Errorf("bloque %d inválido: PrevHash '%s' no coincide con Hash anterior '%s'", i, blocks[i].PreviousHash, blocks[i-1].Hash)
	}
	// Puedes agregar más chequeos aquí
	// Verifica el hash recalculado con los datos reales
	calculatedHash := CalculateBlockHash(blocks[i])
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

		// Index
		if v, ok := m["index"]; ok {
			block.Index = getInt64FromAny(v)
		}

		// Timestamp
		if v, ok := m["timestamp"]; ok {
			block.Timestamp = getInt64FromAny(v)
		}

		// Data (nested map)
		if v, ok := m["data"].(map[string]interface{}); ok {
			block.Data = v
		} else {
			block.Data = make(map[string]interface{}) // fallback
		}

		// PreviousHash
		if v, ok := m["previousHash"].(string); ok {
			block.PreviousHash = v
		}

		// Hash
		if v, ok := m["hash"].(string); ok {
			block.Hash = v
		}

		blocks = append(blocks, block)
	}

	// Sort blocks by Index (ascending)
	sort.Slice(blocks, func(i, j int) bool {
		return blocks[i].Index < blocks[j].Index
	})

	return blocks
}

func CalculateBlockHash(b Block) string {
	//fmt.Printf("Block raw: %+v\n", b)

	cleanedData := CleanObject(b.Data)
	data, ok := cleanedData.(map[string]interface{})
	if !ok {
		// Por ejemplo, si es un array o no es el objeto esperado
		panic("Cleaned object is not a map[string]interface{}")
	}
	jsonStr := OrderedJSONString(data)

	// Concatenar campos en el orden EXACTO que usas en NestJS:
	blockString := fmt.Sprintf("%d|%d|%s|%s", b.Index, b.Timestamp, jsonStr, b.PreviousHash)
	//fmt.Println(blockString)
	hashBytes := sha256.Sum256([]byte(blockString))
	return fmt.Sprintf("%x", hashBytes[:])
}

// Limpia object/map/array recursivamente, eliminando nil, strings vacíos
func CleanObject(obj interface{}) interface{} {
	if obj == nil {
		return nil // En Go, no hay undefined, solo nil.
	}

	rv := reflect.ValueOf(obj)

	switch rv.Kind() {
	case reflect.Slice, reflect.Array:
		arr := []interface{}{}
		for i := 0; i < rv.Len(); i++ {
			item := CleanObject(rv.Index(i).Interface())
			// Salta nil y string ""
			if item == nil {
				continue
			}
			if str, ok := item.(string); ok && str == "" {
				continue
			}
			arr = append(arr, item)
		}
		return arr

	case reflect.Map:
		cleaned := map[string]interface{}{}
		for _, key := range rv.MapKeys() {
			k := key.String()
			value := rv.MapIndex(key).Interface()

			// Salta nil y string ""
			if value == nil {
				continue
			}
			if str, ok := value.(string); ok && str == "" {
				continue
			}

			// Recursivo para valores anidados
			if reflect.TypeOf(value).Kind() == reflect.Map || reflect.TypeOf(value).Kind() == reflect.Slice {
				cleanedValue := CleanObject(value)
				// Añade solo si no está vacío
				if arr, ok := cleanedValue.([]interface{}); ok {
					if len(arr) > 0 {
						cleaned[k] = cleanedValue
					}
				} else if m, ok := cleanedValue.(map[string]interface{}); ok {
					if len(m) > 0 {
						cleaned[k] = cleanedValue
					}
				}
			} else {
				// Si es time.Time, lo deja tal cual (como Date en JS)
				cleaned[k] = value
			}
		}
		return cleaned

	default:
		// Para tipos básicos (number, bool, string no vacío, time, etc)
		return obj
	}
}

func OrderedJSONString(data map[string]interface{}) string {
	keys := make([]string, 0, len(data))
	for k := range data {
		keys = append(keys, k)
	}
	sort.Strings(keys)

	var buf bytes.Buffer
	buf.WriteByte('{')
	for i, k := range keys {
		keyJson, _ := json.Marshal(k)
		valJson, _ := json.Marshal(data[k])
		buf.Write(keyJson)
		buf.WriteByte(':')
		buf.Write(valJson)
		if i < len(keys)-1 {
			buf.WriteByte(',')
		}
	}
	buf.WriteByte('}')
	return buf.String()
}

func init() {
	HashchainCmd.AddCommand(verifyCmd)
}
