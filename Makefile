.PHONY: install i test up build mailpit down

# Proyecto que abre `make up` (sobrescribible: make up PROJECT=ruta/al/proyecto)
PROJECT  ?= examples/demo

# Mailpit local (docker compose): SMTP en :1025 y bandeja en /mailpit/ del editor
# (http://localhost:5180/mailpit/, también a través de GATE)
#   make up MAILPIT=0   → no arrancarlo
MAILPIT  ?= 1
DEV_PORT ?= 5180

# Exposición pública opcional con intergate (https://jgermade.github.io/intergate/):
#   make up GATE=templaitor.gate.example.com          (puerto SSH por defecto: 2222)
#   make up GATE=templaitor.gate.example.com:2223     (puerto SSH explícito)
# → túnel SSH: ssh -p 2222 -R templaitor:80:localhost:$(DEV_PORT) gate.example.com
GATE           ?=
GATE_SSH_PORT  ?= 2222
GATE_KEY       ?=
GATE_HOST       = $(firstword $(subst :, ,$(GATE)))
GATE_PORT       = $(or $(word 2,$(subst :, ,$(GATE))),$(GATE_SSH_PORT))
GATE_SUBDOMAIN  = $(firstword $(subst ., ,$(GATE_HOST)))
GATE_SERVER     = $(patsubst $(GATE_SUBDOMAIN).%,%,$(GATE_HOST))
GATE_SSH_OPTS   = -N -p $(GATE_PORT) -o ExitOnForwardFailure=yes -o ServerAliveInterval=30 -o ServerAliveCountMax=3 $(if $(GATE_KEY),-i $(GATE_KEY) -o IdentitiesOnly=yes)

# Se reinstala solo si cambian package.json / package-lock.json
node_modules: package.json package-lock.json
	npm install
	@touch node_modules

install:
	npm install
	@touch node_modules

i: install

test: node_modules
	npm test

# Desarrollo local en un solo puerto: Vite (recarga en caliente) con la API del motor montada
# como middleware (+ túnel intergate si GATE=...). Ctrl+C para parar todo.
up: node_modules mailpit
	@if [ -n "$(GATE)" ]; then \
		command -v ssh >/dev/null || { echo "✗ GATE requiere ssh instalado"; exit 1; }; \
		echo "⇄ intergate: https://$(GATE_HOST) → localhost:$(DEV_PORT) (vía $(GATE_SERVER):$(GATE_PORT))"; \
		( trap 'kill $$SSH_PID 2>/dev/null; exit 0' TERM; \
		  while true; do \
			ssh $(GATE_SSH_OPTS) -R $(GATE_SUBDOMAIN):80:localhost:$(DEV_PORT) $(GATE_SERVER) & SSH_PID=$$!; \
			wait $$SSH_PID; \
			echo "⇄ intergate: túnel caído, reintentando en 3s..."; sleep 3; \
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
			else echo "⚠ No se pudo arrancar Mailpit (docker compose up mailpit)"; fi; \
		else \
			echo "⚠ Docker no disponible: se arranca sin Mailpit (make up MAILPIT=0 oculta este aviso)"; \
		fi; \
	fi

down:
	docker compose down

build: node_modules
	npm run build
