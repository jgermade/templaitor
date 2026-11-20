.PHONY: install test up build

# Proyecto que abre `make up` (sobrescribible: make up PROJECT=ruta/al/proyecto)
PROJECT  ?= examples/demo
API_PORT ?= 3333

install:
	npm install

test:
	npm test

# Desarrollo local: API del editor + Vite con recarga en caliente (Ctrl+C para parar ambos)
up:
	@trap 'kill 0' INT TERM EXIT; \
	node bin/templaitor.js editor --cwd $(PROJECT) --port $(API_PORT) & \
	TEMPLAITOR_API=http://127.0.0.1:$(API_PORT) npx vite --config vite.config.js; \
	wait

build:
	npm run build
