.PHONY: install test up build

# Proyecto que abre `make up` (sobrescribible: make up PROJECT=ruta/al/proyecto)
PROJECT  ?= examples/demo
API_PORT ?= 3333
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

install:
	npm install

test:
	npm test

# Desarrollo local: API del editor + Vite con recarga en caliente (+ túnel intergate si GATE=...).
# Ctrl+C para parar todo.
up:
	@trap 'kill 0' INT TERM EXIT; \
	node bin/templaitor.js editor --cwd $(PROJECT) --port $(API_PORT) & \
	if [ -n "$(GATE)" ]; then \
		echo "⇄ intergate: https://$(GATE_HOST) → localhost:$(DEV_PORT) (vía $(GATE_SERVER):$(GATE_PORT))"; \
		( while true; do \
			ssh $(GATE_SSH_OPTS) -R $(GATE_SUBDOMAIN):80:localhost:$(DEV_PORT) $(GATE_SERVER); \
			echo "⇄ intergate: túnel caído, reintentando en 3s..."; sleep 3; \
		done ) & \
	fi; \
	TEMPLAITOR_API=http://127.0.0.1:$(API_PORT) TEMPLAITOR_ALLOWED_HOSTS=$(GATE_HOST) \
		npx vite --config vite.config.js --port $(DEV_PORT) --strictPort; \
	wait

build:
	npm run build
