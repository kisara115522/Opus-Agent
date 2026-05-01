.PHONY: dev build test clean lint typecheck start

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
