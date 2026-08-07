#!/usr/bin/env bash
set -euo pipefail

PROMODNA_GCP_PROJECT="${PROMODNA_GCP_PROJECT:-}"
PROMODNA_GCP_REGION="${PROMODNA_GCP_REGION:-southamerica-east1}"
PROMODNA_SERVICE="promodna-api"

if [[ -z "$PROMODNA_GCP_PROJECT" ]]; then
  read -r -p "ID do projeto Google Cloud: " PROMODNA_GCP_PROJECT
fi

gcloud config set project "$PROMODNA_GCP_PROJECT"

PROMODNA_API_URL="$(gcloud run services describe "$PROMODNA_SERVICE" --region="$PROMODNA_GCP_REGION" --format='value(status.url)')"
PROMODNA_REDIRECT_URI="${PROMODNA_API_URL}/oauth/mercadolivre/callback"

read -r -p "Client ID do aplicativo Mercado Livre: " PROMODNA_MELI_CLIENT_ID
read -r -s -p "Client Secret do aplicativo Mercado Livre: " PROMODNA_MELI_CLIENT_SECRET
echo

if [[ -z "$PROMODNA_MELI_CLIENT_ID" || -z "$PROMODNA_MELI_CLIENT_SECRET" ]]; then
  echo "Client ID e Client Secret são obrigatórios."
  exit 1
fi

for secret_name in promodna-meli-client-id promodna-meli-client-secret; do
  if ! gcloud secrets describe "$secret_name" >/dev/null 2>&1; then
    gcloud secrets create "$secret_name" --replication-policy="automatic"
  fi
done

printf '%s' "$PROMODNA_MELI_CLIENT_ID" | gcloud secrets versions add "promodna-meli-client-id" --data-file=-
printf '%s' "$PROMODNA_MELI_CLIENT_SECRET" | gcloud secrets versions add "promodna-meli-client-secret" --data-file=-
unset PROMODNA_MELI_CLIENT_SECRET

PROMODNA_SERVICE_EMAIL="promodna-api@${PROMODNA_GCP_PROJECT}.iam.gserviceaccount.com"
for secret_name in promodna-meli-client-id promodna-meli-client-secret; do
  gcloud secrets add-iam-policy-binding "$secret_name" \
    --member="serviceAccount:${PROMODNA_SERVICE_EMAIL}" \
    --role="roles/secretmanager.secretAccessor" >/dev/null
done

gcloud run services update "$PROMODNA_SERVICE" \
  --region="$PROMODNA_GCP_REGION" \
  --update-env-vars="MELI_REDIRECT_URI=${PROMODNA_REDIRECT_URI}" \
  --update-secrets="MELI_CLIENT_ID=promodna-meli-client-id:latest,MELI_CLIENT_SECRET=promodna-meli-client-secret:latest"

printf '\nMercado Livre configurado no backend.\n'
printf 'Abra %s/admin para autorizar a conta.\n' "$PROMODNA_API_URL"

