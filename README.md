# PromoDNA

Aplicação web para identificar, comparar e confirmar promoções verdadeiras com identidade universal de produtos, histórico de preços e recuperação inteligente de links.

## Site

https://rodrigoesmerio-byte.github.io/promodna/

## Estado atual

- interface pública no GitHub Pages;
- protótipo demonstrativo ativo;
- backend de conectores reais preparado em `api/`;
- primeiro conector: Mercado Livre via OAuth 2.0 e API oficial;
- credenciais e tokens rotativos protegidos pelo Google Secret Manager.

## Implantar o backend

No Google Cloud Shell, dentro do repositório:

```bash
bash scripts/bootstrap-cloud-run.sh
```

O comando cria o serviço `promodna-api` no Cloud Run e informa a URL HTTPS e o callback necessário para cadastrar o aplicativo no Mercado Livre.

Depois de criar o aplicativo no DevCenter do Mercado Livre:

```bash
bash scripts/configure-mercadolivre.sh
```

As credenciais são digitadas silenciosamente no Cloud Shell e não são gravadas no repositório.

## Recursos

- painel de oportunidades e filtros;
- Índice de Oportunidade;
- comparação entre lojas;
- Passaporte do Link;
- histórico visual de preços;
- alertas salvos localmente;
- backend com CORS, cache, limite de consultas, OAuth com PKCE e rotação automática de tokens.

> A interface publicada continuará mostrando dados demonstrativos até o backend ser implantado e a primeira fonte ser autorizada.
