FROM golang:1.25.3-alpine AS build

WORKDIR /app

COPY go.mod go.sum ./
RUN go mod download

COPY . .

RUN go build -o ernest .

FROM alpine:3.20.1 AS prod
WORKDIR /app
COPY --from=build /app/ernest /app/ernest
ENTRYPOINT ["./ernest"]

