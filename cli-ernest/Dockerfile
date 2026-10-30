FROM golang:1.27-alpine AS build

WORKDIR /app

COPY go.mod go.sum ./
RUN go mod download

COPY . .

RUN go build -o ernest .

FROM alpine:3.24.3 AS prod
WORKDIR /app
COPY --from=build /app/ernest /app/ernest
ENTRYPOINT ["./ernest"]

