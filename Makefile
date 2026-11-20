.PHONY: install i test up build mailpit down verapdf pdf-tools site screenshots

# Project opened by `make up` (override: make up PROJECT=path/to/project)
PROJECT  ?= examples/demo

# Local Mailpit (docker compose): SMTP on :1025 and inbox under /mailpit/ of the editor
# (http://localhost:5180/mailpit/, also through GATE)
#   make up MAILPIT=0   → do not start it
MAILPIT  ?= 1
DEV_PORT ?= 5180

# Optional public exposure with intergate (https://jgermade.github.io/intergate/):
#   make up GATE=templaitor.gate.example.com          (default SSH port: 2222)
#   make up GATE=templaitor.gate.example.com:2223     (explicit SSH port)
# → SSH tunnel: ssh -p 2222 -R templaitor:80:localhost:$(DEV_PORT) gate.example.com
GATE           ?=
GATE_SSH_PORT  ?= 2222
GATE_KEY       ?=
GATE_HOST       = $(firstword $(subst :, ,$(GATE)))
GATE_PORT       = $(or $(word 2,$(subst :, ,$(GATE))),$(GATE_SSH_PORT))
GATE_SUBDOMAIN  = $(firstword $(subst ., ,$(GATE_HOST)))
GATE_SERVER     = $(patsubst $(GATE_SUBDOMAIN).%,%,$(GATE_HOST))
GATE_SSH_OPTS   = -N -p $(GATE_PORT) -o ExitOnForwardFailure=yes -o ServerAliveInterval=30 -o ServerAliveCountMax=3 $(if $(GATE_KEY),-i $(GATE_KEY) -o IdentitiesOnly=yes)

# Reinstalls only when package.json / package-lock.json change
node_modules: package.json package-lock.json
	npm install
	@touch node_modules

install:
	npm install
	@touch node_modules

i: install

test: node_modules
	npm test

# Local development on a single port: Vite (hot reload) with the engine API mounted as
# middleware (+ intergate tunnel when GATE=...). Ctrl+C stops everything.
up: node_modules mailpit
	@if [ -n "$(GATE)" ]; then \
		command -v ssh >/dev/null || { echo "✗ GATE requires ssh"; exit 1; }; \
		echo "⇄ intergate: https://$(GATE_HOST) → localhost:$(DEV_PORT) (via $(GATE_SERVER):$(GATE_PORT))"; \
		( trap 'kill $$SSH_PID 2>/dev/null; exit 0' TERM; \
		  while true; do \
			ssh $(GATE_SSH_OPTS) -R $(GATE_SUBDOMAIN):80:localhost:$(DEV_PORT) $(GATE_SERVER) & SSH_PID=$$!; \
			wait $$SSH_PID; \
			echo "⇄ intergate: tunnel down, retrying in 3s..."; sleep 3; \
		  done ) & TUNNEL_PID=$$!; \
		trap 'kill $$TUNNEL_PID 2>/dev/null; exit 0' INT TERM EXIT; \
	fi; \
	TEMPLAITOR_PROJECT=$(PROJECT) TEMPLAITOR_ALLOWED_HOSTS=$(GATE_HOST) \
		npx vite --config vite.config.js --port $(DEV_PORT) --strictPort || true

mailpit:
	@if [ "$(MAILPIT)" = "1" ]; then \
		if command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then \
			if docker compose up -d --quiet-pull mailpit >/dev/null 2>&1; then \
				echo "✉ Mailpit → http://localhost:$(DEV_PORT)/mailpit/ (SMTP localhost:1025)"; \
			else echo "⚠ Could not start Mailpit (docker compose up mailpit)"; fi; \
		else \
			echo "⚠ Docker is not available: starting without Mailpit (make up MAILPIT=0 hides this warning)"; \
		fi; \
	fi

down:
	docker compose down

# PDF/UA validator (veraPDF) in Docker
verapdf:
	docker pull verapdf/cli:latest

# PDF tools: accessible engine (WeasyPrint) + validator
pdf-tools: verapdf
	@command -v weasyprint >/dev/null 2>&1 && weasyprint --version || \
		echo "→ Install WeasyPrint (recommended PDF/UA engine): pip install weasyprint"
	@node bin/templaitor.js engines --cwd $(PROJECT)

build: node_modules
	npm run build

# Landing page for GitHub Pages → dist/site
site: node_modules
	npm run build:site

# Regenerates the landing screenshots (needs Playwright with Chromium; pdftoppm for the PDF page)
screenshots: build
	npm run screenshots
