package hashchain

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"time"
)

// Block sources for verification. The point of the API and file modes is that an
// external auditor never needs MongoDB credentials: a read-only Ernest key (or a
// downloaded export bundle) is enough to independently re-verify the chain.

const apiKeyHeader = "X-Ernest-Api-Key"

// exportBundle matches GET /api/blocks/export.
type exportBundle struct {
	ExportedAt  string           `json:"exportedAt"`
	TotalBlocks int64            `json:"totalBlocks"`
	Blocks      []map[string]any `json:"blocks"`
}

// blocksPage matches GET /api/blocks?page=N&limit=M.
type blocksPage struct {
	Items      []map[string]any `json:"items"`
	Total      int64            `json:"total"`
	Page       int64            `json:"page"`
	TotalPages int64            `json:"totalPages"`
}

// decodeUseNumber decodes JSON keeping numeric lexemes as json.Number, so block
// numbers survive without float64 rounding until the canonicalizer normalizes them.
func decodeUseNumber(r io.Reader, target any) error {
	decoder := json.NewDecoder(r)
	decoder.UseNumber()
	return decoder.Decode(target)
}

// loadBlocksFromFile reads an export bundle (or a bare JSON array of blocks) produced
// by GET /api/blocks/export.
func loadBlocksFromFile(path string) ([]map[string]any, error) {
	file, err := os.Open(path)
	if err != nil {
		return nil, fmt.Errorf("cannot open export file: %w", err)
	}
	defer file.Close()

	raw, err := io.ReadAll(file)
	if err != nil {
		return nil, fmt.Errorf("cannot read export file: %w", err)
	}

	var bundle exportBundle
	if err := decodeUseNumber(bytes.NewReader(raw), &bundle); err == nil && bundle.Blocks != nil {
		return bundle.Blocks, nil
	}

	var bare []map[string]any
	if err := decodeUseNumber(bytes.NewReader(raw), &bare); err != nil {
		return nil, fmt.Errorf("export file is neither an export bundle nor a block array: %w", err)
	}
	return bare, nil
}

// loadBlocksFromAPI pages through GET /api/blocks with an optional API key. A
// read-only key is sufficient; no database access is involved.
func loadBlocksFromAPI(baseURL string, apiKey string) ([]map[string]any, error) {
	client := &http.Client{Timeout: 30 * time.Second}
	var blocks []map[string]any

	for page := int64(1); ; page++ {
		// 200 is the API's PaginationDto maximum.
		url := fmt.Sprintf("%s/api/blocks?page=%d&limit=200", baseURL, page)
		request, err := http.NewRequest(http.MethodGet, url, nil)
		if err != nil {
			return nil, err
		}
		if apiKey != "" {
			request.Header.Set(apiKeyHeader, apiKey)
		}

		response, err := client.Do(request)
		if err != nil {
			return nil, fmt.Errorf("cannot reach Ernest API: %w", err)
		}
		if response.StatusCode == http.StatusUnauthorized {
			response.Body.Close()
			return nil, fmt.Errorf("Ernest API rejected the key (401) — pass --key or set ERNEST_API_KEY")
		}
		if response.StatusCode != http.StatusOK {
			response.Body.Close()
			return nil, fmt.Errorf("Ernest API returned %s for %s", response.Status, url)
		}

		var pageResult blocksPage
		err = decodeUseNumber(response.Body, &pageResult)
		response.Body.Close()
		if err != nil {
			return nil, fmt.Errorf("cannot decode API response: %w", err)
		}

		blocks = append(blocks, pageResult.Items...)
		if pageResult.Page >= pageResult.TotalPages || len(pageResult.Items) == 0 {
			return blocks, nil
		}
	}
}
