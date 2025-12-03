COMPOSE := docker compose

.PHONY: dev
dev:
	COMPOSE_PROFILES=dev $(COMPOSE) --profile dev up -d backend-dev frontend-dev

.PHONY: dev-all
dev-all:
	COMPOSE_PROFILES=dev $(COMPOSE) --profile dev up -d

.PHONY: dev-down
dev-down:
	COMPOSE_PROFILES=dev $(COMPOSE) --profile dev down

.PHONY: dev-logs
dev-logs:
	COMPOSE_PROFILES=dev $(COMPOSE) --profile dev logs -f backend-dev frontend-dev

.PHONY: dev-ps
dev-ps:
	COMPOSE_PROFILES=dev $(COMPOSE) --profile dev ps
