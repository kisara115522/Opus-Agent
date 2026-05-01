.PHONY: dev build test clean lint typecheck start docker-up docker-down format setup

# Interactive setup
setup:
	npx tsx src/setup.ts

# Development
dev:
	npx tsx --watch src/index.ts

# Build
build:
	npx tsc

# Start (production)
start:
	node dist/index.js

# Type check
typecheck:
	npx tsc --noEmit

# Tests
test:
	npx vitest run

# Tests with watch
test-watch:
	npx vitest

# Lint (if eslint is configured)
lint:
	npx eslint src/ --ext .ts 2>/dev/null || echo "No eslint config found"

# Clean build output
clean:
	rm -rf dist

# Install dependencies
install:
	npm install

# Run all checks
check: typecheck test

# Build and run
all: build start

# Start Milvus with Docker
docker-up:
	docker-compose -f vector-database.yml up -d

# Stop Milvus
docker-down:
	docker-compose -f vector-database.yml down

# Format code (if prettier is configured)
format:
	npx prettier --write "src/**/*.ts" 2>/dev/null || echo "No prettier config found"
