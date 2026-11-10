.PHONY: install dev test lint serve voice chat doctor docker
install:        ## core + HUD
	pip install -e ".[server]"
dev:            ## everything, including tests and voice
	pip install -e ".[all]"
test:
	pytest -q
lint:
	ruff check jarvis tests
serve:
	jarvis serve
voice:
	jarvis voice
chat:
	jarvis
doctor:
	jarvis doctor
docker:
	docker compose up --build
