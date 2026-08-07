#!/usr/bin/env bash
set -euo pipefail

if ! command -v gcloud >/dev/null 2>&1; then
  echo "Abra o Google Cloud Shell e execute este script novamente."
  exit 1
fi

PROMODNA_GCP_PROJECT="${PROMODNA_GCP_PROJECT:-}"
PROMODNA_GCP_REGION="${PROMODNA_GCP_REGION:-southamerica-east1}"
PROMODNA_SERVICE="promodna-api"
PROMODNA_SERVICE_ACCOUNT="promodna-api"

if [[ -z "$PROMODNA_GCP_PROJECT" ]]; then
  read -r -p "ID do projeto Google Cloud: " PROMODNA_GCP_PROJECT
fi

if [[ -z "$PROMODNA_GCP_PROJECT" ]]; then
  echo "O ID do projeto é obrigatório."
  exit 1
fi

gcloud config set project "$PROMODNA_GCP_PROJECT"
gcloud services enable run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com secretmanager.googleapis.com

PROMODNA_PROJECT_NUMBER="$(gcloud projects describe "$PROMODNA_GCP_PROJECT" --format='value(projectNumber)')"
PROMODNA_SERVICE_EMAIL="${PROMODNA_SERVICE_ACCOUNT}@${PROMODNA_GCP_PROJECT}.iam.gserviceaccount.com"

if ! gcloud iam service-accounts describe "$PROMODNA_SERVICE_EMAIL" >/dev/null 2>&1; then
  gcloud iam service-accounts create "$PROMODNA_SERVICE_ACCOUNT" --display-name="PromoDNA API"
fi

ensure_secret() {
  local secret_name="$1"
  if ! gcloud secrets describe "$secret_name" >/dev/null 2>&1; then
    gcloud secrets create "$secret_name" --replication-policy="automatic"
  fi
}

ensure_secret "promodna-admin-password"
ensure_secret "promodna-oauth-signing-key"
ensure_secret "promodna-meli-token"

if ! gcloud secrets versions list "promodna-admin-password" --filter='state=ENABLED' --format='value(name)' | head -n 1 | grep -q .; then
  read -r -s -p "Crie uma senha forte para a administração do PromoDNA: " PROMODNA_ADMIN_PASSWORD
  echo
  if [[ ${#PROMODNA_ADMIN_PASSWORD} -lt 12 ]]; then
    echo "Use uma senha com pelo menos 12 caracteres."
    exit 1
  fi
  printf '%s' "$PROMODNA_ADMIN_PASSWORD" | gcloud secrets versions add "promodna-admin-password" --data-file=-
  unset PROMODNA_ADMIN_PASSWORD
fi

if ! gcloud secrets versions list "promodna-oauth-signing-key" --filter='state=ENABLED' --format='value(name)' | head -n 1 | grep -q .; then
  PROMODNA_SIGNING_KEY="$(openssl rand -base64 48)"
  printf '%s' "$PROMODNA_SIGNING_KEY" | gcloud secrets versions add "promodna-oauth-signing-key" --data-file=-
  unset PROMODNA_SIGNING_KEY
fi

for secret_name in promodna-admin-password promodna-oauth-signing-key promodna-meli-token; do
  gcloud secrets add-iam-policy-binding "$secret_name" \
    --member="serviceAccount:${PROMODNA_SERVICE_EMAIL}" \
    --role="roles/secretmanager.secretAccessor" >/dev/null
done

gcloud secrets add-iam-policy-binding "promodna-meli-token" \
  --member="serviceAccount:${PROMODNA_SERVICE_EMAIL}" \
  --role="roles/secretmanager.secretVersionAdder" >/dev/null

gcloud run deploy "$PROMODNA_SERVICE" \
  --source=api \
  --region="$PROMODNA_GCP_REGION" \
  --allow-unauthenticated \
  --service-account="$PROMODNA_SERVICE_EMAIL" \
  --set-env-vars="ALLOWED_ORIGINS=https://rodrigoesmerio-byte.github.io,MELI_TOKEN_SECRET=projects/${PROMODNA_PROJECT_NUMBER}/secrets/promodna-meli-token" \
  --set-secrets="ADMIN_PASSWORD=promodna-admin-password:latest,OAUTH_SIGNING_KEY=promodna-oauth-signing-key:latest"

PROMODNA_API_URL="$(gcloud run services describe "$PROMODNA_SERVICE" --region="$PROMODNA_GCP_REGION" --format='value(status.url)')"

printf '\nBackend criado com sucesso.\n'
printf 'URL da API: %s\n' "$PROMODNA_API_URL"
printf 'Saúde: %s/health\n' "$PROMODNA_API_URL"
printf 'Callback para cadastrar no Mercado Livre: %s/oauth/mercadolivre/callback\n' "$PROMODNA_API_URL"

