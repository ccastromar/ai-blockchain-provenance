FROM golang:1.24-alpine AS builder

WORKDIR /src
COPY event-ingestor/go.mod event-ingestor/go.sum* ./
RUN go mod download
COPY event-ingestor/ ./
RUN CGO_ENABLED=0 GOOS=linux go build -o /out/event-ingestor ./cmd/event-ingestor

FROM alpine:3.22
RUN adduser -D -H ernest
USER ernest
COPY --from=builder /out/event-ingestor /usr/local/bin/event-ingestor
EXPOSE 3011
ENTRYPOINT ["event-ingestor"]
