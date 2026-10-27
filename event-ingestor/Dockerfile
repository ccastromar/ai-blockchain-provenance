FROM golang:1.26-alpine AS builder

WORKDIR /src
COPY event-ingestor/go.mod event-ingestor/go.sum* ./
RUN go mod download
COPY event-ingestor/ ./
# The release, for service.version in logs (docker build --build-arg VERSION=0.3.0).
ARG VERSION=dev
RUN CGO_ENABLED=0 GOOS=linux go build -ldflags "-X event-ingestor/internal/logging.Version=${VERSION}" -o /out/event-ingestor ./cmd/event-ingestor

FROM alpine:3.24
RUN adduser -D -H ernest
USER ernest
COPY --from=builder /out/event-ingestor /usr/local/bin/event-ingestor
EXPOSE 3011
ENTRYPOINT ["event-ingestor"]
