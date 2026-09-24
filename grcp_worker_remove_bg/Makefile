.PHONY: setup gen test run server demo clean docker-build docker-up docker-down docker-logs

setup:
	python3 -m venv .venv
	.venv/bin/pip install -U pip
	.venv/bin/pip install -r requirements.txt

gen:
	bash scripts/gen_proto.sh

test:
	bash scripts/dev.sh

server:
	bash scripts/gen_proto.sh
	.venv/bin/python -m server.server

demo:
	bash scripts/demo.sh

docker-build:
	docker build -t portrait-service .

docker-up:
	docker compose up -d --build

docker-down:
	docker compose down

docker-logs:
	docker compose logs -f

clean:
	rm -rf server/gen .venv .pytest_cache __pycache__