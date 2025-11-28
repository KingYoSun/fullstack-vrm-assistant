COMPOSE_FILE := docker-compose.dev.yml
COMPOSE := docker compose -f $(COMPOSE_FILE)

.PHONY: dev
dev:
	$(COMPOSE) --profile dev up -d backend frontend

.PHONY: dev-all
dev-all:
	$(COMPOSE) --profile dev up -d

.PHONY: dev-down
dev-down:
	$(COMPOSE) --profile dev down

.PHONY: dev-logs
dev-logs:
	$(COMPOSE) --profile dev logs -f backend frontend

.PHONY: dev-ps
dev-ps:
	$(COMPOSE) --profile dev ps
